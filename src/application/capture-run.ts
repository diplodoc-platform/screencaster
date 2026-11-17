import type {ScreenshotOptions} from '../browser/capture/screenshot.js';
import type {TtsProvider} from '../media/audio/audio.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE} from '../shared/config.js';
import {BrowserSession, type BrowserSessionOptions} from '../browser/session.js';
import {BrowserActionError} from '../browser/outcome.js';
import {HostAuthenticationChallengeError} from '../browser/errors/host-auth-challenge-error.js';
import {
    type InstructionInput,
    type InstructionLoader,
    type InstructionSource,
    loadInstruction,
} from '../instruction/source.js';
import {type InstructionPlan, validatePlan} from '../instruction/plan.js';
import {MediaRecorder} from '../media/recording/journal.js';
import {optimizeVideo} from '../media/export/montage.js';
import {sha256} from '../media/recording/recording.js';
import {writePrivateJson} from '../shared/private-files.js';
import {JournalPersistenceError, JournalWriter} from '../shared/journal-writer.js';
import {sanitizeForModel} from '../shared/sanitize-for-model.js';
import {decideEdit, editProposalSchema} from '../media/timeline/editing.js';
import {generatePreview} from '../media/preview/preview.js';
import {narrateVideo} from '../media/audio/narration.js';
import {MAX_SPEECH_TEXT_CHARS} from '../media/config.js';

import {MAX_COMPLETION_EVIDENCE_CHARS} from './config.js';
import {ARTIFACT_NAME_PATTERN} from './patterns.js';
import {
    type OutputOptions,
    type PreparedOutputOptions,
    outputOptionsSchema,
    recordingEnabled,
} from './output-options.js';
import {
    ACTION_JOURNAL_UNCONFIRMED,
    ARTIFACT_NAMES_USE_LETTERS_NUMBERS_HYPHENS_AND_UNDERSCORES,
    AUTOMATIC_NARRATION_FAILED,
    AUTOMATIC_NARRATION_REQUIRES_STEPS,
    AUTOMATIC_NARRATION_REQUIRES_TTS,
    AUTOMATIC_VIDEO_EXPORT_FAILED,
    AWAIT_THE_CURRENT_OPERATION_BEFORE_CHANGING_PLAN_STATE,
    A_REGISTERED_ARTIFACT_CHANGED,
    CANNOT_CAPTURE_A_SCREENSHOT_AFTER_FINISHING_THE_BROWSER,
    COMPLETION_NEEDS_AN_ACTIVE_STEP_AND_BOUNDED_EVIDENCE,
    EXPORT_ARTIFACTS_MUST_NOT_BE_SYMBOLIC_LINKS,
    EXPORT_DIRECTORY_MUST_NOT_BE_A_SYMBOLIC_LINK,
    FINAL_JOURNAL_UNCONFIRMED,
    FINISH_A_RECORDED_RUN_BEFORE_EXPORTING_VIDEO,
    JOURNAL_UNCONFIRMED_SUFFIX,
    LOAD_ONE_INSTRUCTION_BEFORE_RECORDING_ACTIONS,
    ONLY_A_PENDING_REGISTERED_STEP_CAN_BE_STARTED,
    OPERATION_JOURNAL_UNCONFIRMED,
    REGISTER_A_PLAN_ONCE_AFTER_ITS_SOURCE_AND,
    RESOLUTION_NEEDS_AN_UNRESOLVED_ACTION_AND_BOUNDED_OBSERVED,
    RUN_ARTIFACTS_MUST_STAY_INSIDE_THE_RUN_DIRECTORY,
    UNKNOWN_ACTION_RECEIPT_UNAVAILABLE,
} from './messages.js';

export type Artifact = {
    path: string;
    kind: string;
    sha256: string;
    stepId?: number;
    metadata?: Record<string, unknown>;
    derivedFrom?: {path: string; sha256: string};
};
export type RunManifest = {
    id: string;
    status: 'running' | 'completed' | 'incomplete' | 'failed' | 'aborted';
    artifacts: Artifact[];
    steps: Array<{
        id: number;
        status: 'pending' | 'running' | 'success' | 'fail' | 'skipped';
        evidence?: string;
    }>;
    source?: {sha256: string};
    error?: string;
    unresolvedActions: Array<{id: number; tool: string}>;
    outputs?: OutputOptions;
};
export type RunOptions = Omit<BrowserSessionOptions, 'onActivity' | 'onClock' | 'videoDir'> & {
    directory: string;
    video?: boolean;
    loader?: InstructionLoader;
    tts?: TtsProvider;
    outputs?: OutputOptions;
};

export class CaptureRun {
    static async create(options: RunOptions): Promise<CaptureRun> {
        const outputs = outputOptionsSchema.parse(options.outputs ?? {});
        if (outputs.narration && !options.tts) {
            throw new Error(AUTOMATIC_NARRATION_REQUIRES_TTS);
        }
        options = {...options, outputs, video: recordingEnabled(options.video, outputs)};
        const absolute = path.resolve(options.directory);
        const canonical = path.join(
            await fs.realpath(path.dirname(absolute)),
            path.basename(absolute),
        );
        const run = new CaptureRun({...options, outputs, directory: canonical});
        await fs.mkdir(run.directory, {mode: PRIVATE_DIRECTORY_MODE});
        if (options.video) {
            await fs.mkdir(path.join(run.directory, 'recordings'), {mode: PRIVATE_DIRECTORY_MODE});
        }
        run.save();
        await run.flush();
        try {
            await run.browser.start();
            await run.flush();
            return run;
        } catch (cause) {
            await run.browser.abort().catch(() => {});
            run.manifest.status =
                cause instanceof HostAuthenticationChallengeError ? 'incomplete' : 'failed';
            run.manifest.error =
                cause instanceof HostAuthenticationChallengeError
                    ? cause.message
                    : 'Browser initialization failed';
            run.save();
            await run.flush();
            if (cause instanceof HostAuthenticationChallengeError) {
                throw cause;
            }
            throw new Error(
                `Browser initialization failed; local diagnostics retained in ${run.directory}`,
                {cause},
            );
        }
    }

    readonly manifest: RunManifest;
    readonly directory: string;
    readonly browser: BrowserSession;
    private readonly recorder: MediaRecorder;
    private readonly writer = new JournalWriter();
    private source?: InstructionSource;
    private plan?: InstructionPlan;
    private stepId?: number;
    private video?: string;
    private finished = false;
    private tail: Promise<unknown> = Promise.resolve();
    private pending = 0;

    private readonly options: RunOptions & {outputs: PreparedOutputOptions};

    private constructor(options: RunOptions & {outputs: PreparedOutputOptions}) {
        this.options = options;
        this.directory = path.resolve(options.directory);
        this.manifest = {
            id: randomUUID(),
            status: 'running',
            artifacts: [],
            steps: [],
            unresolvedActions: [],
            ...(options.outputs && Object.keys(options.outputs).length
                ? {outputs: options.outputs}
                : {}),
        };
        this.recorder = new MediaRecorder(this.directory, this.writer);
        this.browser = new BrowserSession({
            ...options,
            ...(options.video ? {videoDir: path.join(this.directory, 'recordings')} : {}),
            onClock: (clock) => this.recorder.clock(clock),
            onActivity: (activity) => {
                if (!activity) {
                    this.recorder.journal.writeErrors++;
                    this.recorder.save();
                    return;
                }
                this.recorder.record(activity, this.stepId);
                this.event({
                    kind: 'action',
                    actionId: this.recorder.journal.actions.at(-1)?.id,
                    tool: activity.tool,
                    outcome: activity.outcome,
                    stepId: this.stepId,
                });
            },
        });
    }

    async instruction(input: InstructionInput, signal?: AbortSignal) {
        return this.exclusive(async () => {
            if (this.finished || this.source || this.recorder.journal.actions.length) {
                throw new Error(LOAD_ONE_INSTRUCTION_BEFORE_RECORDING_ACTIONS);
            }
            this.source = await loadInstruction(input, {loader: this.options.loader, signal});
            this.manifest.source = {sha256: this.source.sha256};
            writePrivateJson(path.join(this.directory, 'instruction-source.json'), this.source);
            await fs.writeFile(path.join(this.directory, 'instruction.md'), this.source.markdown, {
                mode: PRIVATE_FILE_MODE,
            });
            this.save();
            return this.source;
        });
    }

    registerPlan(value: unknown) {
        this.assertIdle();
        if (!this.source || this.finished || this.recorder.journal.actions.length || this.plan) {
            throw new Error(REGISTER_A_PLAN_ONCE_AFTER_ITS_SOURCE_AND);
        }
        const plan = validatePlan(value, this.source);
        if (
            this.options.outputs.narration &&
            plan.steps.some((step) => step.actionText.length > MAX_SPEECH_TEXT_CHARS)
        ) {
            throw new Error(AUTOMATIC_NARRATION_REQUIRES_STEPS);
        }
        this.plan = plan;
        this.manifest.steps = this.plan.steps.map((step) => ({id: step.id, status: 'pending'}));
        this.recorder.journal.steps = this.plan.steps.map((step) => ({
            id: step.id,
            text: step.actionText,
            status: 'running',
        }));
        writePrivateJson(path.join(this.directory, 'plan.json'), this.plan);
        this.save();
        return this.plan;
    }

    beginStep(id: number) {
        this.assertIdle();
        const step = this.manifest.steps.find((entry) => entry.id === id);
        if (step?.status !== 'pending' || this.stepId !== undefined || this.finished) {
            throw new Error(ONLY_A_PENDING_REGISTERED_STEP_CAN_BE_STARTED);
        }
        step.status = 'running';
        this.stepId = id;
        this.save();
    }

    completeStep(status: 'success' | 'fail' | 'skipped', evidence: string) {
        this.assertIdle();
        const step = this.manifest.steps.find((entry) => entry.id === this.stepId);
        if (
            !step ||
            !evidence.trim() ||
            evidence.length > MAX_COMPLETION_EVIDENCE_CHARS ||
            this.finished
        ) {
            throw new Error(COMPLETION_NEEDS_AN_ACTIVE_STEP_AND_BOUNDED_EVIDENCE);
        }
        step.status = status;
        step.evidence = sanitizeForModel(evidence);
        const mediaStep = this.recorder.journal.steps.find((entry) => entry.id === this.stepId);
        if (mediaStep) {
            mediaStep.status = status === 'fail' ? 'fail' : 'success';
            if (status === 'skipped') {
                mediaStep.skipped = true;
            }
        }
        this.event({kind: 'step-completed', stepId: this.stepId, status});
        this.stepId = undefined;
        this.recorder.save();
        this.save();
    }

    snapshot(query: Record<string, unknown> = {}) {
        return this.exclusive(() => this.browser.snapshot(query));
    }

    proposeEdit(stepId: number, value: unknown) {
        this.assertIdle();
        const proposal = editProposalSchema.parse(value);
        const decision = decideEdit(this.recorder.journal, stepId, proposal);
        this.recorder.journal.edits ??= [];
        this.recorder.journal.edits.push(decision);
        this.recorder.save();
        return decision;
    }

    action(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
        return this.exclusive(async () => {
            if (this.finished) {
                throw new BrowserActionError('The run is already finalized', 'not-dispatched');
            }
            if (
                this.manifest.unresolvedActions.length &&
                ![
                    'browser_snapshot',
                    'browser_verify_inputs',
                    'browser_navigate',
                    'browser_wait_for',
                    'browser_take_screenshot',
                ].includes(name)
            ) {
                throw new BrowserActionError(
                    'Resolve the previous unknown action before another interaction',
                    'not-dispatched',
                );
            }
            if (this.plan && this.stepId === undefined) {
                throw new BrowserActionError(
                    'Begin a registered step before acting',
                    'not-dispatched',
                );
            }
            const before = this.recorder.journal.actions.length;
            try {
                const observation = await this.browser.execute(name, args, signal);
                try {
                    await this.flush();
                } catch (cause) {
                    throw new BrowserActionError(ACTION_JOURNAL_UNCONFIRMED, 'unknown', undefined, {
                        cause,
                    });
                }
                return {
                    actionId:
                        this.recorder.journal.actions.length > before
                            ? this.recorder.journal.actions.at(-1)?.id
                            : undefined,
                    ...observation,
                };
            } catch (error) {
                await this.recordActionFailure(error, name, before, signal);
                throw error;
            }
        });
    }

    resolveAction(id: number, outcome: 'applied' | 'not-applied', evidence: string) {
        return this.exclusive(async () => {
            if (
                !this.manifest.unresolvedActions.some((action) => action.id === id) ||
                !evidence.trim() ||
                evidence.length > MAX_COMPLETION_EVIDENCE_CHARS
            ) {
                throw new Error(RESOLUTION_NEEDS_AN_UNRESOLVED_ACTION_AND_BOUNDED_OBSERVED);
            }
            await this.browser.snapshot();
            this.manifest.unresolvedActions = this.manifest.unresolvedActions.filter(
                (action) => action.id !== id,
            );
            this.event({
                kind: 'action-resolved',
                actionId: id,
                outcome,
                evidence: sanitizeForModel(evidence),
            });
            this.save();
        });
    }

    screenshot(options: ScreenshotOptions & {name?: string} = {}) {
        return this.exclusive(async () => {
            if (this.finished) {
                throw new Error(CANNOT_CAPTURE_A_SCREENSHOT_AFTER_FINISHING_THE_BROWSER);
            }
            const name = options.name ?? `capture-${this.manifest.artifacts.length + 1}`;
            this.assertName(name);
            const file = path.join(this.directory, `${name}.png`);
            const {name: _name, ...capture} = options;
            const metadata = await this.browser.screenshot(file, {
                ...capture,
                highlight: capture.highlight ?? this.options.outputs?.screenshots?.highlight,
            });
            const originalPath = path.relative(this.directory, metadata.original.path);
            const normalized = {...metadata, original: {...metadata.original, path: originalPath}};
            let original: Artifact | undefined;
            if (path.resolve(metadata.original.path) !== file) {
                original = await this.addArtifact(
                    metadata.original.path,
                    'screenshot-original',
                    normalized,
                );
                if (original.sha256 !== metadata.original.sha256) {
                    throw new Error(A_REGISTERED_ARTIFACT_CHANGED);
                }
            }
            return this.addArtifact(file, 'screenshot', normalized, original);
        });
    }

    finish(signal?: AbortSignal) {
        return this.exclusive(
            async () => {
                if (this.finished) {
                    return this.manifest;
                }
                this.finished = true;
                try {
                    this.video = await this.browser.close();
                    await this.flush();
                    if (this.video) {
                        if (
                            !this.recorder.journal.actions.length &&
                            this.recorder.journal.clocks.length >= 2
                        ) {
                            const clocks = this.recorder.journal.clocks;
                            this.recorder.record({
                                kind: 'evidence',
                                tool: 'passive-recording',
                                outcome: 'returned',
                                startMs: clocks[0].endMs,
                                endMs: clocks[clocks.length - 1].startMs,
                            });
                        }
                        await this.recorder.finalize(this.video);
                        await this.addArtifact(this.video, 'recording');
                        await this.addArtifact(
                            path.join(this.directory, 'media-events.json'),
                            'actions',
                        );
                    }
                    this.manifest.status = 'completed';
                    if (
                        this.manifest.steps.some((step) =>
                            ['pending', 'running'].includes(step.status),
                        )
                    ) {
                        this.manifest.status = 'incomplete';
                    }
                    if (this.manifest.unresolvedActions.length) {
                        this.manifest.status = 'incomplete';
                    }
                    if (this.manifest.steps.some((step) => step.status === 'fail')) {
                        this.manifest.status = 'failed';
                    }
                    await this.finishOutputs(signal);
                } catch {
                    this.manifest.status = 'failed';
                    this.manifest.error =
                        'Browser finalization is unconfirmed; retain raw recordings';
                }
                this.save();
                return this.manifest;
            },
            {finalizing: true},
        ).catch(async (cause: unknown) => {
            if (cause instanceof JournalPersistenceError) {
                this.manifest.status = 'failed';
                this.manifest.error = FINAL_JOURNAL_UNCONFIRMED;
                this.save();
                await this.flush().catch(() => {});
            }
            throw cause;
        });
    }

    async exportVideo(options: {name: string; highlights?: boolean; signal?: AbortSignal}) {
        if (!this.finished || !this.video) {
            throw new Error(FINISH_A_RECORDED_RUN_BEFORE_EXPORTING_VIDEO);
        }
        this.assertName(options.name);
        const output = path.join(this.directory, options.name);
        const timeline = await optimizeVideo({
            input: this.video,
            output,
            ...(this.recorder.journal.actions.length
                ? {journal: path.join(this.directory, 'media-events.json')}
                : {}),
            highlights: options.highlights ?? false,
            signal: options.signal,
        });
        await this.registerExport(options.name);
        this.save();
        await this.flush();
        return timeline;
    }

    async registerExport(name: string) {
        this.assertName(name);
        const output = path.join(this.directory, name);
        const real = await fs.realpath(output);
        if (real !== output) {
            throw new Error(EXPORT_DIRECTORY_MUST_NOT_BE_A_SYMBOLIC_LINK);
        }
        for (const entry of await fs.readdir(output, {withFileTypes: true})) {
            if (entry.isSymbolicLink()) {
                throw new Error(EXPORT_ARTIFACTS_MUST_NOT_BE_SYMBOLIC_LINKS);
            }
            if (entry.isFile()) {
                let kind = 'media-data';
                if (entry.name.endsWith('.webm')) {
                    kind = 'video';
                } else if (entry.name.endsWith('.gif')) {
                    kind = 'animation';
                }
                await this.addArtifact(path.join(output, entry.name), kind);
            }
        }
        await this.flush();
        return this.manifest.artifacts;
    }

    async preview(options: {name: string; title: string; subtitle?: string}) {
        this.assertName(options.name);
        const output = path.join(this.directory, `${options.name}.png`);
        await generatePreview({...options, output});
        return this.addArtifact(output, 'preview');
    }

    async abort() {
        if (this.finished) {
            await this.tail.catch(() => {});
            await this.flush();
            return;
        }
        this.manifest.status = 'aborted';
        this.finished = true;
        try {
            await this.browser.abort();
        } finally {
            await this.tail.catch(() => {});
            this.save();
            await this.flush();
        }
    }

    // Synchronous plan mutations enqueue snapshots; async operations and this
    // explicit barrier return only after all earlier journal writes are durable.
    flush(): Promise<void> {
        return this.writer.flush();
    }

    private async recordActionFailure(
        error: unknown,
        name: string,
        before: number,
        signal?: AbortSignal,
    ) {
        if (signal?.aborted) {
            await this.browser.abort().catch(() => {});
            this.manifest.status = 'aborted';
            this.finished = true;
            this.save();
        }
        if (error instanceof BrowserActionError) {
            this.event({kind: 'action-error', tool: name, outcome: error.outcome});
            if (error.outcome === 'unknown' && !signal?.aborted) {
                const id =
                    this.recorder.journal.actions.length > before
                        ? this.recorder.journal.actions.at(-1)?.id
                        : undefined;
                if (id !== undefined) {
                    this.manifest.unresolvedActions.push({id, tool: name});
                    this.save();
                    throw new BrowserActionError(error.message, error.outcome, id);
                }
                // An earlier action cannot own a missing receipt. Stop the
                // session rather than permit another unresolved mutation.
                this.manifest.status = 'failed';
                this.manifest.error = UNKNOWN_ACTION_RECEIPT_UNAVAILABLE;
                this.finished = true;
                this.save();
                await this.browser.abort().catch(() => {});
            }
        }
    }

    private async finishOutputs(signal?: AbortSignal) {
        if (this.options.outputs?.video) {
            try {
                await this.exportVideo({...this.options.outputs.video, signal});
                if (this.options.outputs.narration) {
                    try {
                        await this.narrateSteps(signal);
                    } catch {
                        this.manifest.status = 'failed';
                        this.manifest.error = AUTOMATIC_NARRATION_FAILED;
                    }
                }
            } catch {
                this.manifest.status = 'failed';
                this.manifest.error = AUTOMATIC_VIDEO_EXPORT_FAILED;
            }
        }
    }

    private async narrateSteps(signal?: AbortSignal) {
        const narration = this.options.outputs.narration;
        const video = this.options.outputs.video;
        if (!narration || !video) throw new Error(AUTOMATIC_NARRATION_REQUIRES_STEPS);
        const phrases = (this.plan?.steps ?? []).flatMap((step) => {
            if (
                !this.manifest.steps.some(
                    (entry) => entry.id === step.id && entry.status === 'success',
                )
            ) {
                return [];
            }
            const action = this.recorder.journal.actions.find(
                (entry) =>
                    entry.step === step.id &&
                    entry.kind === 'interaction' &&
                    entry.outcome === 'returned',
            );
            if (!action) {
                return [];
            }
            return [{id: step.id, text: step.actionText, actionId: action.id}];
        });
        if (
            !phrases.length ||
            phrases.some((phrase) => phrase.text.length > MAX_SPEECH_TEXT_CHARS)
        ) {
            throw new Error(AUTOMATIC_NARRATION_REQUIRES_STEPS);
        }
        await narrateVideo({
            input: path.join(this.directory, video.name),
            output: path.join(this.directory, narration.name),
            phrases,
            provider: this.options.tts,
            captions: narration.captions,
            maxHoldSeconds: narration.maxHoldSeconds,
            signal,
        });
        await this.registerExport(narration.name);
    }

    private exclusive<T>(
        callback: () => Promise<T>,
        options: {finalizing?: boolean} = {},
    ): Promise<T> {
        this.pending++;
        const task = this.tail
            .then(async () => {
                if (options.finalizing) {
                    await this.flush().catch(() => {});
                } else {
                    await this.flush();
                }
                let result: T;
                try {
                    result = await callback();
                } catch (error) {
                    try {
                        await this.flush();
                    } catch (cause) {
                        if (error instanceof BrowserActionError) {
                            throw new BrowserActionError(
                                error.message + JOURNAL_UNCONFIRMED_SUFFIX,
                                error.outcome,
                                error.actionId,
                                {
                                    cause: new AggregateError(
                                        [error, cause],
                                        OPERATION_JOURNAL_UNCONFIRMED,
                                    ),
                                },
                            );
                        }
                        throw new AggregateError([error, cause], OPERATION_JOURNAL_UNCONFIRMED);
                    }
                    throw error;
                }
                await this.flush();
                return result;
            })
            .finally(() => {
                this.pending--;
            });
        this.tail = task.catch(() => {});
        return task;
    }

    private assertIdle() {
        if (this.pending) {
            throw new Error(AWAIT_THE_CURRENT_OPERATION_BEFORE_CHANGING_PLAN_STATE);
        }
    }

    private assertName(name: string) {
        if (!ARTIFACT_NAME_PATTERN.test(name)) {
            throw new Error(ARTIFACT_NAMES_USE_LETTERS_NUMBERS_HYPHENS_AND_UNDERSCORES);
        }
    }

    private async addArtifact(
        file: string,
        kind: string,
        metadata?: Record<string, unknown>,
        original?: Pick<Artifact, 'path' | 'sha256'>,
    ): Promise<Artifact> {
        const relative = path.relative(this.directory, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(RUN_ARTIFACTS_MUST_STAY_INSIDE_THE_RUN_DIRECTORY);
        }
        const existing = this.manifest.artifacts.find((artifact) => artifact.path === relative);
        if (existing) {
            if (existing.sha256 !== (await sha256(file))) {
                throw new Error(A_REGISTERED_ARTIFACT_CHANGED);
            }
            return existing;
        }
        const artifact = {
            path: relative,
            kind,
            sha256: await sha256(file),
            ...(this.stepId === undefined ? {} : {stepId: this.stepId}),
            ...(metadata ? {metadata} : {}),
            ...(original ? {derivedFrom: {path: original.path, sha256: original.sha256}} : {}),
        };
        this.manifest.artifacts.push(artifact);
        this.save();
        await this.flush();
        return artifact;
    }

    private event(value: Record<string, unknown>) {
        const event = {...value, at: new Date().toISOString()};
        this.writer.append(path.join(this.directory, 'events.jsonl'), event);
    }

    private save() {
        this.writer.snapshot(path.join(this.directory, 'manifest.json'), this.manifest);
    }
}
