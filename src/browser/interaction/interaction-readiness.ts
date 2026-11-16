import type {McpResult} from '../../transport/mcp/types.js';

import {z} from 'zod';

import {BACKGROUND_ANCESTOR_TIMEOUT_MS, MAX_READINESS_PAYLOAD_CHARS} from '../config.js';
import {
    ARIA_REF_ARGUMENT_PATTERN,
    CHECKABLE_NODE_PATTERN,
    MCP_RESULT_BLOCK_PATTERN,
    TEXTBOX_NODE_PATTERN,
} from '../patterns.js';
import {driverScript} from '../scripts/driver-script.js';
import {extractUrlFromSnapshot} from '../snapshot/url.js';
import {extractSnapshotNode} from '../../shared/snapshot/parser.js';
import {ToolDispatchRejectedError} from '../errors/tool-dispatch-rejected-error.js';
import {extractText} from '../../transport/mcp/result.js';
import {sanitizeForModel} from '../../shared/sanitize-for-model.js';

import {
    backgroundAncestorInspectionCode,
    backgroundAncestorInspectionResult,
    backgroundAncestorRefs,
} from './background-click.js';
import {blockerLabelsSchema, obstructionSnapshotLabels} from './obstruction-labels.js';

const resultSchema = z.discriminatedUnion('state', [
    z.object({state: z.literal('defer')}).strict(),
    z.object({state: z.literal('blocked'), blockerLabels: blockerLabelsSchema}).strict(),
    z.object({state: z.literal('not-ready')}).strict(),
]);

type ObserveReadiness = (code: string, timeoutMs?: number) => Promise<McpResult>;

// Monaco's textarea receives keyboard input while its sibling renders the code.
// That rendering layer is not an external obstruction; pointer checks stay intact.
export function codeEditorOwnsTextReceiver(el: HTMLElement, hit: Element): boolean {
    const editor = el.tagName === 'TEXTAREA' ? el.closest('.monaco-editor') : null;
    return Boolean(editor && editor.contains(hit));
}

export class InteractionBlockedError extends ToolDispatchRejectedError {
    readonly reason = 'occluded';

    readonly blockerLabels: string[];

    readonly targetRef: string;

    readonly measuredBackgroundAncestorRefs: string[];

    constructor(
        targetRef: string,
        blockerLabels: string[],
        measuredBackgroundAncestorRefs: string[] = [],
        message?: string,
    ) {
        super(
            message ??
                'Target center is occluded; action was not dispatched. Observed target ref=' +
                    `${targetRef}` +
                    '. Inspect the current snapshot and resolve the obstruction blocking this action. A completed ' +
                    'editor from an earlier step may need to close through its normal UI; preserve unsaved changes ' +
                    'and required current-step forms. Use an observed close control or the supported background-click ' +
                    'mode on an observed region when appropriate. Confirm the result in the next fresh snapshot; ' +
                    'Escape alone does not establish that it closed.' +
                    (blockerLabels.length
                        ? ` Observed labels in the covering branch: ${JSON.stringify(blockerLabels)}. These labels do not identify a close control.`
                        : '') +
                    (measuredBackgroundAncestorRefs.length
                        ? ' Measured enclosing container backgrounds: ' +
                          `${JSON.stringify(measuredBackgroundAncestorRefs)}` +
                          '. Inspection only; choose a current ref explicitly for a separately rechecked background click. ' +
                          'No click, dismissal or absence of side effects is implied.'
                        : ''),
        );
        this.name = 'InteractionBlockedError';
        this.blockerLabels = blockerLabels;
        this.targetRef = targetRef;
        this.measuredBackgroundAncestorRefs = measuredBackgroundAncestorRefs;
    }
}

// Read all addressed fields before a bulk mutation; a refusal never follows a partial fill.
export async function rejectBlockedInteraction(
    name: string,
    snapshot: string,
    args: Record<string, unknown>,
    observe: ObserveReadiness,
): Promise<void> {
    const targets: Array<{ref: unknown; textEntry: boolean}> = [];
    if (name === 'browser_fill_form' && Array.isArray(args.fields)) {
        for (const field of args.fields) {
            if (field && typeof field === 'object' && 'ref' in field) {
                targets.push({
                    ref: field.ref,
                    textEntry: 'type' in field && field.type === 'textbox',
                });
            }
        }
    } else if (
        ['browser_click', 'browser_hover', 'browser_type', 'browser_select_option'].includes(name)
    ) {
        targets.push({ref: args.ref, textEntry: name === 'browser_type'});
    }
    for (const ref of new Set(targets.map((target) => target.ref))) {
        if (
            typeof ref === 'string' &&
            ARIA_REF_ARGUMENT_PATTERN.test(ref) &&
            extractSnapshotNode(snapshot, ref)
        ) {
            const textEntry = targets
                .filter((target) => target.ref === ref)
                .every((target) => target.textEntry);
            const node = extractSnapshotNode(snapshot, ref) ?? '';
            if (name === 'browser_click' && nativePointerReadinessApplies(args, node)) {
                await rejectUnreadyPointer(snapshot, ref, args, observe);
            } else {
                const interaction = textEntry ? 'text' : 'other';
                await rejectBlockedRef(
                    snapshot,
                    ref,
                    name === 'browser_hover' ? 'hover' : interaction,
                    observe,
                );
            }
        }
    }
}

function nativePointerReadinessApplies(args: Record<string, unknown>, node: string) {
    // Checkable inputs use the existing keyboard activation and associated-label checks.
    return (
        !CHECKABLE_NODE_PATTERN.test(node) &&
        (args.modifiers === undefined ||
            (Array.isArray(args.modifiers) && args.modifiers.length === 0))
    );
}

async function rejectUnreadyPointer(
    snapshot: string,
    ref: string,
    args: Record<string, unknown>,
    observe: ObserveReadiness,
) {
    const labels = obstructionSnapshotLabels(snapshot);
    let parsed: z.infer<typeof resultSchema> | undefined;
    try {
        const result = await observe(
            driverScript('check-pointer-readiness', {
                ref: ref,
                method: args.doubleClick === true ? 'dblclick' : 'click',
                button: z.enum(['left', 'right', 'middle']).parse(args.button ?? 'left'),
                labels: labels,
            }),
        );
        if (result?.isError) {
            return;
        }
        const payload = extractText(result).match(MCP_RESULT_BLOCK_PATTERN)?.[1];
        if (payload && payload.length <= MAX_READINESS_PAYLOAD_CHARS) {
            const observation = resultSchema.safeParse(JSON.parse(payload));
            if (observation.success) {
                parsed = observation.data;
            }
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        return;
    }
    if (parsed?.state === 'not-ready') {
        throw new ToolDispatchRejectedError(
            'Native click readiness did not pass; no click was dispatched. Target ref=' +
                `${ref}` +
                '. Inspect a fresh snapshot for loading, disabled state or a different visible receiver. Choose ' +
                'another safe approach rather than repeating an unchanged click.',
        );
    }
    if (
        parsed?.state === 'blocked' &&
        parsed.blockerLabels.every((label) => labels.includes(label))
    ) {
        const measured = await measureBackgroundAncestors(snapshot, ref, observe);
        throw new InteractionBlockedError(
            ref,
            parsed.blockerLabels.map((label) => sanitizeForModel(label)),
            measured,
            'Native click readiness failed; action was not dispatched. Target ref=' +
                `${ref}` +
                ". Another element receives the target centre. It may be the intended control's label: inspect " +
                'the fresh snapshot and choose the observed ref of the actual receiver, or another safe approach. ' +
                'This does not establish that the control is unavailable. Observed labels: ' +
                `${JSON.stringify(parsed.blockerLabels)}` +
                '. Measured container backgrounds: ' +
                `${JSON.stringify(measured)}` +
                '; inspection only, no dismissal occurred.' +
                (TEXTBOX_NODE_PATTERN.test(extractSnapshotNode(snapshot, ref) ?? '')
                    ? ' Text entry does not require a preceding click. Use browser_type with the editable textbox ref, not a surrounding paragraph; it checks text readiness and the replacement value.'
                    : ''),
        );
    }
}

// A best-effort read; confirmed interception or residual hover clipping rejects dispatch.
async function rejectBlockedRef(
    snapshot: string,
    ref: string,
    interaction: 'hover' | 'text' | 'other',
    observe: (code: string, timeoutMs?: number) => Promise<McpResult>,
): Promise<void> {
    const labels = obstructionSnapshotLabels(snapshot);
    let blockedLabels: string[] | undefined;
    let clippedHover = false;
    try {
        const result = await observe(
            driverScript('check-interaction-readiness', {
                ref: ref,
                interaction: interaction === 'hover',
                textEntry: interaction === 'text',
                labels: labels,
            }),
        );
        if (result?.isError) {
            return;
        }
        const payload = extractText(result).match(MCP_RESULT_BLOCK_PATTERN)?.[1];
        if (!payload || payload.length > MAX_READINESS_PAYLOAD_CHARS) {
            return;
        }
        const parsed = resultSchema.safeParse(JSON.parse(payload));
        clippedHover = parsed.success && parsed.data.state === 'not-ready';
        if (
            parsed.success &&
            parsed.data.state === 'blocked' &&
            parsed.data.blockerLabels.every((label) => labels.includes(label))
        ) {
            blockedLabels = [...new Set(parsed.data.blockerLabels)];
        }
    } catch {
        // A failed read is not proof of interception. The existing native action handles it.
        return;
    }
    if (clippedHover) {
        throw new ToolDispatchRejectedError(
            'Hover target remains clipped after scrolling; no pointer action was dispatched. Target ref=' +
                `${ref}` +
                '. Inspect the fresh snapshot and choose an exposed control or another safe approach. Do not ' +
                'repeat an unchanged hover.',
        );
    }
    if (blockedLabels) {
        const measured = await measureBackgroundAncestors(snapshot, ref, observe);
        throw new InteractionBlockedError(
            ref,
            blockedLabels.map((label) => sanitizeForModel(label)),
            measured,
        );
    }
}

async function measureBackgroundAncestors(
    snapshot: string,
    ref: string,
    observe: ObserveReadiness,
) {
    const candidates = backgroundAncestorRefs(snapshot, ref);
    const url = extractUrlFromSnapshot(snapshot);
    if (candidates.length && url) {
        try {
            const result = await observe(
                backgroundAncestorInspectionCode(ref, candidates, url),
                BACKGROUND_ANCESTOR_TIMEOUT_MS,
            );
            return backgroundAncestorInspectionResult(result, candidates);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw error;
            }
        }
    }
    return [];
}
