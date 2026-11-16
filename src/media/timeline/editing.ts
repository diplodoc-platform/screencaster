import type {UiOperation} from '../../shared/capture/ui-state.js';
import type {MediaJournal} from '../recording/journal.js';
import type {NarrationAction} from '../audio/action-narration.js';
export {
    uiOperationSchema,
    recordedUiOperation,
    createMediaStateHasher,
} from '../../shared/capture/ui-state.js';
export type {UiOperation} from '../../shared/capture/ui-state.js';

import {z} from 'zod';

import {DRAFT_TOOLS, MAX_CLOSED_STATE_RANGES, MAX_EDIT_REASON_CHARS} from '../config.js';
import {HTTP_URL_PATTERN} from '../patterns.js';
import {sanitizeForModel} from '../../shared/sanitize-for-model.js';

const editorialText = z
    .string()
    .trim()
    .min(1)
    .max(MAX_EDIT_REASON_CHARS)
    .refine((value) => sanitizeForModel(value) === value && !HTTP_URL_PATTERN.test(value));

export const editProposalSchema = z
    .object({
        firstActionId: z.number().int().positive(),
        lastActionId: z.number().int().positive(),
        kind: z.enum(['navigation-detour', 'discarded-draft', 'redundant-gesture']),
        repeatOfActionId: z.number().int().positive().optional(),
        reason: editorialText,
        restoredState: editorialText,
    })
    .strict();
export const editDecisionSchema = editProposalSchema.extend({
    step: z.number().int().positive(),
    applied: z.boolean(),
    diagnostic: z.string().max(MAX_EDIT_REASON_CHARS),
});
export type EditProposal = z.infer<typeof editProposalSchema>;
export type EditDecision = z.infer<typeof editDecisionSchema>;

const CUTTABLE_UI_OPERATIONS: Record<string, UiOperation[]> = {
    browser_click: ['navigation', 'disclosure'],
    browser_navigate: ['navigation'],
    browser_press_key: ['dismissal'],
    browser_hover: ['hover'],
    input_focus: ['hover'],
};

export type ClosedStateRange = {
    firstActionId: number;
    lastActionId: number;
    restoredState: string;
    knownGesturesOnly: boolean;
    repeatOfActionId?: number;
};

function repeatsUnchangedGesture(first: NarrationAction, repeated: NarrationAction) {
    return Boolean(
        first.tool === repeated.tool &&
        first.uiOperation &&
        first.uiOperation === repeated.uiOperation &&
        CUTTABLE_UI_OPERATIONS[first.tool]?.includes(first.uiOperation) &&
        first.submit !== true &&
        repeated.submit !== true &&
        ((first.key === 'Escape' && repeated.key === 'Escape') ||
            (first.targetNode && first.targetNode === repeated.targetNode)) &&
        repeated.beforeState &&
        first.afterState === repeated.beforeState &&
        repeated.beforeState === repeated.afterState,
    );
}

// These are review candidates, never authorization to cut. Prefer the latest
// shortest return so an earlier correct selection remains in the narrative.
const isObservedDraft = (action: NarrationAction) =>
    action.beforeState &&
    action.afterState &&
    DRAFT_TOOLS.has(action.tool) &&
    action.submit !== true &&
    (action.tool !== 'browser_press_key' || action.key === 'Escape');

function hasInvalidActionOrder(actions: readonly NarrationAction[]) {
    return actions.some(
        (action, index) =>
            !Number.isSafeInteger(action.actionId) ||
            action.actionId <= 0 ||
            (index > 0 && action.actionId <= actions[index - 1].actionId),
    );
}

export function closedStateRanges(actions: readonly NarrationAction[]): ClosedStateRange[] {
    if (hasInvalidActionOrder(actions)) {
        return [];
    }
    const candidates: ClosedStateRange[] = [];
    let cursor = actions.length - 1;
    while (cursor > 0 && candidates.length < MAX_CLOSED_STATE_RANGES) {
        const end = cursor--;
        const last = actions[end];
        if (!isObservedDraft(last)) {
            continue;
        }
        const previous = actions[end - 1];
        if (
            last.beforeState &&
            isObservedDraft(previous) &&
            repeatsUnchangedGesture(previous, last)
        ) {
            candidates.push({
                firstActionId: last.actionId,
                lastActionId: last.actionId,
                repeatOfActionId: previous.actionId,
                restoredState: last.beforeState,
                knownGesturesOnly: true,
            });
            continue;
        }
        const start = closedRangeStart(actions, end);
        if (start !== undefined && actions[start].beforeState) {
            const first = actions[start];
            candidates.push({
                firstActionId: first.actionId,
                lastActionId: last.actionId,
                restoredState: actions[start].beforeState,
                knownGesturesOnly: actions.slice(start, end + 1).every(isCuttableGesture),
            });
            cursor = start - 1;
        }
    }
    return candidates.reverse();
}

function closedRangeStart(actions: readonly NarrationAction[], end: number) {
    const last = actions[end];
    let changed = last.beforeState !== last.afterState;
    for (let start = end - 1; start >= 0; start--) {
        const first = actions[start];
        if (
            !first.beforeState ||
            !isObservedDraft(first) ||
            first.afterState !== actions[start + 1].beforeState
        )
            break;
        changed ||= first.beforeState !== first.afterState;
        if (changed && first.beforeState === last.afterState) return start;
    }
    return undefined;
}

// Compare complete driver observations; a projected/truncated model context is
// not a restoration proof. Ref renewal and focus alone do not change UI state.

function includeInputFocus(actions: MediaJournal['actions'], index: number) {
    let first = index;
    while (
        first > 0 &&
        actions[first - 1].tool === 'input_focus' &&
        actions[first - 1].step === actions[first].step &&
        actions[first].beforeState !== undefined &&
        actions[first - 1].beforeState === actions[first].beforeState
    ) {
        first--;
    }
    return first;
}

function checkEditRange(
    journal: Pick<MediaJournal, 'actions' | 'steps' | 'edits'>,
    step: number,
    proposal: EditProposal,
): EditDecision {
    const actions = journal.actions;
    const ids = actions.flatMap((action) => (action.id === undefined ? [] : [action.id]));
    const unambiguous = ids.every((id, index) => index === 0 || id > ids[index - 1]);
    const requestedFirst = actions.findIndex((action) => action.id === proposal.firstActionId);
    const first =
        proposal.kind === 'redundant-gesture'
            ? requestedFirst
            : includeInputFocus(actions, requestedFirst);
    const last = actions.findIndex((action) => action.id === proposal.lastActionId);
    const range = actions.slice(first, last + 1);
    const firstActionId =
        first < 0 ? proposal.firstActionId : (actions[first].id ?? proposal.firstActionId);
    let applied = true;
    let diagnostic = 'Confirmed reversible detour; original actions retained in audit';
    if (
        !unambiguous ||
        first < 0 ||
        last < first ||
        !journal.steps.some(
            (entry) => entry.id === step && entry.status === 'success' && !entry.skipped,
        ) ||
        !range.length ||
        range.some(
            (action) =>
                action.id === undefined ||
                action.step !== step ||
                action.outcome !== 'returned' ||
                (action.kind === 'interaction' &&
                    (!DRAFT_TOOLS.has(action.tool) ||
                        action.submit === true ||
                        (action.tool === 'browser_press_key' && action.key !== 'Escape'))),
        )
    ) {
        applied = false;
        diagnostic = 'Unconfirmed range, outcome or operation; detour retained';
    } else if (
        !range[0].beforeState ||
        range[0].beforeState !== range[range.length - 1].afterState
    ) {
        applied = false;
        diagnostic = 'No matching complete before/after observation; detour retained';
    } else if (
        proposal.kind === 'redundant-gesture' &&
        !verifiedRedundantGesture(actions, first, last, proposal.repeatOfActionId)
    ) {
        applied = false;
        diagnostic =
            'No immediately preceding matching gesture with unchanged state; repeat retained';
    } else if (
        journal.edits?.some(
            (edit) =>
                edit.applied &&
                ((edit.firstActionId <= proposal.lastActionId &&
                    edit.lastActionId >= firstActionId) ||
                    (edit.repeatOfActionId !== undefined &&
                        edit.repeatOfActionId >= firstActionId &&
                        edit.repeatOfActionId <= proposal.lastActionId) ||
                    (proposal.kind === 'redundant-gesture' &&
                        proposal.repeatOfActionId !== undefined &&
                        proposal.repeatOfActionId >= edit.firstActionId &&
                        proposal.repeatOfActionId <= edit.lastActionId)),
        )
    ) {
        applied = false;
        diagnostic = 'Overlapping edit or removed repeat anchor; detour retained';
    }
    return {
        ...proposal,
        firstActionId,
        step,
        applied,
        diagnostic,
    };
}

function verifiedRedundantGesture(
    actions: MediaJournal['actions'],
    first: number,
    last: number,
    repeatOfActionId?: number,
) {
    if (first !== last || repeatOfActionId === undefined) {
        return false;
    }
    const previous = actions
        .slice(0, first)
        .reverse()
        .find((action) => action.kind === 'interaction');
    const repeated = actions[first];
    if (
        !previous ||
        previous.id !== repeatOfActionId ||
        previous.step !== repeated.step ||
        previous.outcome !== 'returned' ||
        previous.id === undefined ||
        repeated.id === undefined
    ) {
        return false;
    }
    return repeatsUnchangedGesture(
        {...previous, actionId: previous.id},
        {...repeated, actionId: repeated.id},
    );
}

export function decideEdit(
    journal: Pick<MediaJournal, 'actions' | 'steps' | 'edits'>,
    step: number,
    proposal: EditProposal,
): EditDecision {
    const decision = checkEditRange(journal, step, proposal);
    if (
        decision.applied &&
        journal.actions.some(
            (action) =>
                action.id !== undefined &&
                action.id >= decision.firstActionId &&
                action.id <= decision.lastActionId &&
                action.kind === 'interaction' &&
                (!action.uiOperation ||
                    !CUTTABLE_UI_OPERATIONS[action.tool]?.includes(action.uiOperation)),
        )
    ) {
        decision.applied = false;
        decision.diagnostic =
            'Action effects are not established as navigation/disclosure; proposal retained for editorial review';
    }
    return decision;
}

function appliedMediaEdits(journal: Pick<MediaJournal, 'actions' | 'steps' | 'edits'>) {
    const applied: EditDecision[] = [];
    for (const edit of journal.edits ?? []) {
        if (!edit.applied) {
            continue;
        }
        const checked = decideEdit({...journal, edits: applied}, edit.step, edit);
        if (checked.applied) {
            applied.push(checked);
        }
    }
    return applied;
}

export function retainedMediaActions<Action extends MediaJournal['actions'][number]>(
    journal: Omit<Pick<MediaJournal, 'actions' | 'steps' | 'edits'>, 'actions'> & {
        actions: Action[];
    },
) {
    const applied = appliedMediaEdits(journal);
    return journal.actions.filter((action) => {
        const id = action.id;
        return (
            id === undefined ||
            !applied.some((edit) => id >= edit.firstActionId && id <= edit.lastActionId)
        );
    });
}

export function excludedMediaIntervals(journal: Pick<MediaJournal, 'actions' | 'steps' | 'edits'>) {
    return appliedMediaEdits(journal).map((edit) => {
        const removed = journal.actions.filter(
            (action) =>
                action.id !== undefined &&
                action.id >= edit.firstActionId &&
                action.id <= edit.lastActionId,
        );
        return {
            startMs: Math.min(
                ...removed.map((action) =>
                    Math.min(action.startMs, action.target?.atMs ?? Infinity),
                ),
            ),
            endMs: Math.max(...removed.map((action) => action.endMs)),
        };
    });
}

function isCuttableGesture(action: NarrationAction): boolean {
    return action.uiOperation
        ? (CUTTABLE_UI_OPERATIONS[action.tool]?.includes(action.uiOperation) ?? false)
        : false;
}
