import path from 'node:path';
import {z} from 'zod';

import {
    MAX_JOURNAL_CLOCKS,
    MAX_JOURNAL_STEPS,
    MAX_JOURNAL_STEP_CHARS,
    MAX_JOURNAL_TARGET_CHARS,
    MAX_JOURNAL_TOOL_CHARS,
    MAX_MEDIA_ACTIVITIES,
    MAX_SPEECH_TEXT_CHARS,
} from '../config.js';
import {uiOperationSchema} from '../../shared/capture/ui-state.js';
import {ACTION_JOURNAL_LIMIT_EXCEEDED} from '../messages.js';
import {
    ARIA_REF_VALUE_PATTERN as JOURNAL_JOURNAL_PATTERN,
    SHA256_DIGEST_PATTERN as JOURNAL_PATTERN,
} from '../patterns.js';
import {JournalWriter} from '../../shared/journal-writer.js';
import {editDecisionSchema, retainedMediaActions} from '../timeline/editing.js';

import {sha256} from './recording.js';

export {MAX_MEDIA_ACTIVITIES} from '../config.js';
const digest = z.string().regex(JOURNAL_PATTERN);
const interval = z.object({startMs: z.number().finite(), endMs: z.number().finite()});
const targetSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
    viewportWidth: z.number().positive().finite(),
    viewportHeight: z.number().positive().finite(),
    atMs: z.number().finite(),
    untilMs: z.number().finite(),
    recording: z.string().min(1),
    ref: z.string().regex(JOURNAL_JOURNAL_PATTERN).optional(),
});
export type MediaTarget = z.infer<typeof targetSchema>;
export type MediaClock = {recording: string; startMs: number; endMs: number};
const activitySchema = interval.extend({
    kind: z.enum(['highlight', 'interaction', 'evidence']),
    tool: z.string().min(1).max(MAX_JOURNAL_TOOL_CHARS),
    outcome: z.enum(['returned', 'threw']),
    target: targetSchema.optional(),
    beforeState: digest.optional(),
    afterState: digest.optional(),
    uiOperation: uiOperationSchema.optional(),
    submit: z.boolean().optional(),
    key: z.literal('Escape').optional(),
});
export type MediaActivity = z.infer<typeof activitySchema>;
export const mediaJournalSchema = z.object({
    videoLayout: z.literal('playwright-top-left').optional(),
    clocks: z.array(interval.extend({recording: z.string().min(1)})).max(MAX_JOURNAL_CLOCKS),
    clockErrors: z.literal(0),
    writeErrors: z.literal(0),
    selectedRecording: z.string().min(1),
    sourceSha256: digest,
    contentStartMs: z.number().finite().optional(),
    actions: z
        .array(
            activitySchema.extend({
                id: z.number().int().positive().optional(),
                step: z.number().int().positive().optional(),
                speechText: z.string().max(MAX_SPEECH_TEXT_CHARS).optional(),
                captionText: z.string().max(MAX_SPEECH_TEXT_CHARS).optional(),
                targetNode: z.string().max(MAX_JOURNAL_TARGET_CHARS).optional(),
                targetContext: z.string().max(MAX_JOURNAL_TARGET_CHARS).optional(),
                submit: z.boolean().optional(),
                key: z.literal('Escape').optional(),
                uiOperation: uiOperationSchema.optional(),
                beforeState: digest.optional(),
                afterState: digest.optional(),
            }),
        )
        .max(MAX_MEDIA_ACTIVITIES),
    steps: z
        .array(
            z.object({
                id: z.number().int().positive(),
                text: z.string().max(MAX_JOURNAL_STEP_CHARS),
                status: z.enum(['running', 'success', 'fail']),
                skipped: z.literal(true).optional(),
            }),
        )
        .max(MAX_JOURNAL_STEPS),
    edits: z.array(editDecisionSchema).max(MAX_MEDIA_ACTIVITIES).optional(),
});
type CompletedJournal = z.infer<typeof mediaJournalSchema>;
export type MediaJournal = Omit<
    CompletedJournal,
    'selectedRecording' | 'sourceSha256' | 'clockErrors' | 'writeErrors'
> & {
    selectedRecording?: string;
    sourceSha256?: string;
    clockErrors: number;
    writeErrors: number;
};

export function selectMediaContent(
    journal: Pick<MediaJournal, 'steps' | 'actions' | 'contentStartMs' | 'edits'>,
) {
    return {
        steps: journal.steps,
        actions: retainedMediaActions(journal),
        contentStartMs: journal.contentStartMs,
    };
}

export function selectMediaActivities(actions: MediaJournal['actions']) {
    const lastInteraction = new Map<number, number>();
    for (const action of actions) {
        if (action.step !== undefined && action.kind === 'interaction') {
            lastInteraction.set(
                action.step,
                Math.max(lastInteraction.get(action.step) ?? -Infinity, action.endMs),
            );
        }
    }
    return actions.filter(
        (action) =>
            action.kind !== 'evidence' ||
            action.outcome !== 'returned' ||
            action.step === undefined ||
            action.startMs >= (lastInteraction.get(action.step) ?? -Infinity),
    );
}

export class MediaRecorder {
    readonly journal: MediaJournal = {
        videoLayout: 'playwright-top-left',
        clocks: [],
        clockErrors: 0,
        writeErrors: 0,
        actions: [],
        steps: [],
    };
    private readonly directory: string;

    private readonly writer: JournalWriter;

    constructor(directory: string, writer = new JournalWriter()) {
        this.writer = writer;
        this.directory = directory;
    }

    clock(clock?: MediaClock) {
        if (clock) {
            this.journal.clocks.push(clock);
        } else {
            this.journal.clockErrors++;
        }
        this.save();
    }

    record(activity: MediaActivity, step?: number) {
        if (this.journal.actions.length >= MAX_MEDIA_ACTIVITIES) {
            throw new Error(ACTION_JOURNAL_LIMIT_EXCEEDED);
        }
        const action = {
            ...activity,
            id: this.journal.actions.length + 1,
            ...(step === undefined ? {} : {step}),
        };
        this.journal.actions.push(action);
        this.save();
        return action.id;
    }

    async finalize(recording: string) {
        this.journal.selectedRecording = path.basename(recording);
        this.journal.sourceSha256 = await sha256(recording);
        this.save();
        await this.flush();
    }

    flush() {
        return this.writer.flush();
    }

    save() {
        this.writer.snapshot(path.join(this.directory, 'media-events.json'), this.journal);
    }
}
