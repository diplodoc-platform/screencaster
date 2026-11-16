import type {McpResult} from '../../transport/mcp/types.js';

import {z} from 'zod';

import {MAX_BACKGROUND_REPLY_CHARS, MAX_LABEL_CHARS} from '../config.js';
import {
    BACKGROUND_CANDIDATE_CANNOT_BE_THE_REQUESTED_TARGET,
    BACKGROUND_CLICK_OUTCOME_UNAVAILABLE_ACTION_MUST_NOT_BE,
    UNREQUESTED_BACKGROUND_CANDIDATE,
} from '../messages.js';
import {
    ARIA_REF_ARGUMENT_PATTERN,
    BACKGROUND_CONTAINER_ROLE_PATTERN,
    MCP_RESULT_BLOCK_PATTERN,
    REF_ATTRIBUTE_PATTERN,
} from '../patterns.js';
import {driverScript} from '../scripts/driver-script.js';
import {snapshotNodes} from '../../shared/snapshot/parser.js';
import {sanitizeSnapshotForModel} from '../../shared/sanitize-for-model.js';
import {ToolDispatchRejectedError} from '../errors/tool-dispatch-rejected-error.js';
import {extractText} from '../../transport/mcp/result.js';

export const backgroundClickArgs = z
    .object({
        element: z.string().min(1).max(MAX_LABEL_CHARS),
        ref: z.string().regex(ARIA_REF_ARGUMENT_PATTERN),
        targetArea: z.literal('background'),
        doubleClick: z.literal(false).optional(),
        button: z.literal('left').optional(),
        modifiers: z.array(z.never()).max(0).optional(),
    })
    .strict();

const structuralRoles = [
    'application',
    'region',
    'group',
    'generic',
    'presentation',
    'none',
    'main',
    'document',
    'banner',
    'complementary',
    'contentinfo',
    'form',
    'navigation',
];

export function backgroundClickRef(args: Record<string, unknown>, snapshot: string): string {
    const parsed = backgroundClickArgs.safeParse(args);
    const targets = parsed.success
        ? snapshotNodes(sanitizeSnapshotForModel(snapshot).split('\n')).filter(
              (node) => REF_ATTRIBUTE_PATTERN.exec(node.attributes)?.[1] === parsed.data.ref,
          )
        : [];
    if (!parsed.success || targets.length !== 1 || !structuralRoles.includes(targets[0].role)) {
        throw new ToolDispatchRejectedError(
            'Background click requires a unique current structural container ref and a single left click without modifiers or coordinates; action was not dispatched.',
        );
    }
    return parsed.data.ref;
}

// Candidate refs come only from the current observed subtree, never from tool arguments.
export function backgroundClickCandidates(snapshot: string, ref: string): string[] {
    const nodes = snapshotNodes(sanitizeSnapshotForModel(snapshot).split('\n'));
    const refOf = (node: (typeof nodes)[number]) =>
        REF_ATTRIBUTE_PATTERN.exec(node.attributes)?.[1];
    const counts = new Map<string, number>();
    for (const node of nodes) {
        const value = refOf(node);
        if (value) {
            counts.set(value, (counts.get(value) ?? 0) + 1);
        }
    }
    const start = nodes.findIndex((node) => refOf(node) === ref);
    if (start < 0 || counts.get(ref) !== 1) {
        return [];
    }
    const root = nodes[start];
    const descendants = [];
    for (const node of nodes.slice(start + 1)) {
        if (node.indent <= root.indent) {
            break;
        }
        const value = refOf(node);
        if (BACKGROUND_CONTAINER_ROLE_PATTERN.test(node.role) && value && counts.get(value) === 1) {
            descendants.push({ref: value, indent: node.indent, index: node.index});
        }
    }
    return descendants
        .sort((a, b) => a.indent - b.indent || a.index - b.index)
        .slice(0, 4)
        .map((node) => node.ref);
}

// Only structural ancestors observed in the current snapshot are inspection candidates.
export function backgroundAncestorRefs(snapshot: string, ref: string): string[] {
    const nodes = snapshotNodes(sanitizeSnapshotForModel(snapshot).split('\n'));
    const refOf = (node: (typeof nodes)[number]) =>
        REF_ATTRIBUTE_PATTERN.exec(node.attributes)?.[1];
    const matching = nodes.filter((node) => refOf(node) === ref);
    if (matching.length !== 1) {
        return [];
    }
    const target = matching[0];
    const ancestors: typeof nodes = [];
    for (const node of nodes) {
        if (node.index >= target.index) {
            break;
        }
        while (ancestors.length && ancestors[ancestors.length - 1].indent >= node.indent) {
            ancestors.pop();
        }
        ancestors.push(node);
    }
    return ancestors
        .reverse()
        .filter((node) => {
            const value = refOf(node);
            return (
                node.indent < target.indent &&
                BACKGROUND_CONTAINER_ROLE_PATTERN.test(node.role) &&
                value &&
                nodes.filter((other) => refOf(other) === value).length === 1
            );
        })
        .slice(0, 4)
        .map((node) => refOf(node))
        .filter((value): value is string => value !== undefined);
}

const candidateRefsSchema = z
    .array(z.string().regex(ARIA_REF_ARGUMENT_PATTERN))
    .max(4)
    .refine((refs) => new Set(refs).size === refs.length);

// Only trusted driver code chooses coordinates. No descendant hit is a surface hit.
export function backgroundClickCode(ref: string, candidateRefs: string[] = []): string {
    return backgroundCode(ref, candidateRefs);
}

export function backgroundAncestorInspectionCode(
    ref: string,
    candidateRefs: string[],
    expectedUrl: string,
): string {
    return backgroundCode(ref, candidateRefs, expectedUrl);
}

function backgroundCode(ref: string, candidateRefs: string[], inspectionUrl?: string): string {
    candidateRefsSchema.parse(candidateRefs);
    if (candidateRefs.includes(ref)) {
        throw new Error(BACKGROUND_CANDIDATE_CANNOT_BE_THE_REQUESTED_TARGET);
    }
    return driverScript('inspect-background', {
        ref: ref,
        candidateRefs: candidateRefs,
        inspectionUrl: inspectionUrl ?? null,
        structuralRoles: structuralRoles,
    });
}

const resultSchema = z.discriminatedUnion('state', [
    z.object({state: z.literal('clicked')}).strict(),
    z
        .object({
            state: z.literal('refused'),
            reason: z.enum([
                'target-unavailable',
                'unsupported-container',
                'no-background-point',
                'target-changed',
            ]),
            candidateRefs: candidateRefsSchema.optional(),
        })
        .strict(),
]);

export function backgroundClickResult(result: McpResult, candidateRefs: string[] = []): string {
    const text = extractText(result);
    const payload = MCP_RESULT_BLOCK_PATTERN.exec(text)?.[1];
    if (!result || result.isError || !payload || payload.length > MAX_BACKGROUND_REPLY_CHARS) {
        throw new Error(BACKGROUND_CLICK_OUTCOME_UNAVAILABLE_ACTION_MUST_NOT_BE);
    }
    let parsed: z.infer<typeof resultSchema>;
    try {
        parsed = resultSchema.parse(JSON.parse(payload));
        candidateRefsSchema.parse(candidateRefs);
        if (
            parsed.state === 'refused' &&
            parsed.candidateRefs &&
            (parsed.reason !== 'no-background-point' ||
                parsed.candidateRefs.some((ref) => !candidateRefs.includes(ref)))
        ) {
            throw new Error(UNREQUESTED_BACKGROUND_CANDIDATE);
        }
    } catch {
        throw new Error(BACKGROUND_CLICK_OUTCOME_UNAVAILABLE_ACTION_MUST_NOT_BE);
    }
    if (parsed.state === 'refused') {
        let detail =
            'The requested target was unavailable or changed before dispatch; no click point was established.';
        if (parsed.reason === 'no-background-point') {
            detail =
                'The checked points did not hit the requested container itself. Consider a narrower current observed container ref from the snapshot, then verify the result in a fresh snapshot.';
            if (parsed.candidateRefs?.length) {
                detail +=
                    ' Measured current descendant container candidates with their own background hit: ' +
                    `${JSON.stringify(parsed.candidateRefs)}` +
                    '. These are observations only; choose a ref explicitly for a separate action, which will recheck ' +
                    'it freshly. No candidate was clicked and no dismissal is implied.';
            }
        } else if (parsed.reason === 'unsupported-container') {
            detail =
                'The requested container did not satisfy the supported element or visible geometry checks; no click point was selected.';
        }
        throw new ToolDispatchRejectedError(
            `Background click refused before dispatch (${parsed.reason}). ${detail}`,
        );
    }
    return 'One native click on the requested container background returned. Check the fresh snapshot for the required outcome; no dismissal or absence of side effects is implied.';
}

const inspectionSchema = z
    .object({
        state: z.literal('inspected'),
        candidateRefs: candidateRefsSchema,
    })
    .strict();

// Inspection failure never authorizes the original blocked action.
export function backgroundAncestorInspectionResult(
    result: McpResult,
    candidates: string[],
): string[] {
    try {
        candidateRefsSchema.parse(candidates);
        if (!result || result.isError) {
            return [];
        }
        const payload = MCP_RESULT_BLOCK_PATTERN.exec(extractText(result))?.[1];
        if (!payload || payload.length > MAX_BACKGROUND_REPLY_CHARS) {
            return [];
        }
        const parsed = inspectionSchema.parse(JSON.parse(payload));
        return parsed.candidateRefs.every((ref) => candidates.includes(ref))
            ? parsed.candidateRefs
            : [];
    } catch {
        return [];
    }
}
