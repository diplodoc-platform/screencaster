import type {MediaJournal, MediaTarget} from '../recording/journal.js';

import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {MAX_VIDEO_FPS} from '../config.js';
import {
    MILLISECONDS_PER_SECOND,
    PRIVATE_DIRECTORY_MODE,
    PRIVATE_FILE_MODE,
} from '../../shared/config.js';
import {
    INVALID_ANNOTATION_RECORDING_OR_TIME_MAP,
    OFFLINE_STEP_SCREENSHOT_WAS_NOT_EXTRACTED,
} from '../messages.js';
import {writePrivateJson} from '../../shared/private-files.js';
import {ffmpeg} from '../recording/process.js';

import {type FrameMapSegment, mapSourceFrame, validateFrameMap} from './time-map.js';
import {outlineGraph} from './outline.js';
import {retainedMediaActions} from './editing.js';

export type RecordedTarget = MediaTarget;
export type AnnotationJournal = Pick<
    MediaJournal,
    'selectedRecording' | 'actions' | 'steps' | 'edits'
>;
type Activity = AnnotationJournal['actions'][number];

export type AnnotationOptions = {
    journal: AnnotationJournal;
    frameMap: FrameMapSegment[];
    fps: number;
    sourceFrames: number;
    videoWidth: number;
    videoHeight: number;
    protection: {
        offsetSeconds: number;
        uncertaintySeconds: number;
        markers?: {start: number; end: number}[];
    };
    layout?: 'playwright-top-left';
};

type Box = {x: number; y: number; width: number; height: number};
export type FrameAnnotation = {
    actionId?: number;
    step?: number;
    sourceFrame: number;
    outputStart: number;
    outputEnd: number;
    box: Box;
    outlineBox: Box;
    scale: number;
};

function checkOptions(options: AnnotationOptions) {
    validateFrameMap(options.frameMap);
    if (
        !Number.isFinite(options.fps) ||
        options.fps <= 0 ||
        options.fps > MAX_VIDEO_FPS ||
        !Number.isSafeInteger(options.sourceFrames) ||
        options.sourceFrames <= 0 ||
        !Number.isSafeInteger(options.videoWidth) ||
        options.videoWidth <= 0 ||
        !Number.isSafeInteger(options.videoHeight) ||
        options.videoHeight <= 0 ||
        !Number.isFinite(options.protection.offsetSeconds) ||
        !Number.isFinite(options.protection.uncertaintySeconds) ||
        options.protection.uncertaintySeconds < 0 ||
        options.frameMap.some((segment) => segment.sourceEnd > options.sourceFrames) ||
        options.journal.steps.some((step) => !Number.isSafeInteger(step.id) || step.id <= 0) ||
        new Set(options.journal.steps.map((step) => step.id)).size !==
            options.journal.steps.length ||
        options.journal.actions.some(
            (action) =>
                !Number.isFinite(action.startMs) ||
                !Number.isFinite(action.endMs) ||
                action.endMs < action.startMs ||
                (action.id !== undefined && (!Number.isSafeInteger(action.id) || action.id <= 0)) ||
                (action.step !== undefined &&
                    !options.journal.steps.some((step) => step.id === action.step)),
        )
    ) {
        throw new Error(INVALID_ANNOTATION_RECORDING_OR_TIME_MAP);
    }
}

// Playwright places the viewport at the top-left and only scales down to fit.
// Unknown recording layouts never receive guessed geometry.
export function targetVideoBox(
    target: RecordedTarget,
    videoWidth: number,
    videoHeight: number,
    layout?: AnnotationOptions['layout'],
): Box | undefined {
    if (
        layout !== 'playwright-top-left' ||
        [
            target.x,
            target.y,
            target.width,
            target.height,
            target.viewportWidth,
            target.viewportHeight,
            target.atMs,
            videoWidth,
            videoHeight,
        ].some((value) => !Number.isFinite(value)) ||
        target.width <= 0 ||
        target.height <= 0 ||
        target.viewportWidth <= 0 ||
        target.viewportHeight <= 0 ||
        videoWidth <= 0 ||
        videoHeight <= 0
    ) {
        return undefined;
    }
    const scale = Math.min(
        1,
        videoWidth / target.viewportWidth,
        videoHeight / target.viewportHeight,
    );
    const x = Math.floor(Math.max(0, target.x) * scale);
    const y = Math.floor(Math.max(0, target.y) * scale);
    const right = Math.min(
        videoWidth,
        Math.ceil(Math.min(target.viewportWidth, target.x + target.width) * scale),
    );
    const bottom = Math.min(
        videoHeight,
        Math.ceil(Math.min(target.viewportHeight, target.y + target.height) * scale),
    );
    return right > x && bottom > y ? {x, y, width: right - x, height: bottom - y} : undefined;
}

function targetSourceFrame(action: Activity, options: AnnotationOptions): number | undefined {
    const target = action.target;
    if (
        !target ||
        !Number.isFinite(action.startMs) ||
        target.untilMs === undefined ||
        !Number.isFinite(target.untilMs) ||
        target.untilMs < target.atMs ||
        target.untilMs > action.startMs
    ) {
        return undefined;
    }
    const {offsetSeconds, uncertaintySeconds} = options.protection;
    // The complete frame exposure, including clock uncertainty, must fit in the
    // measured pre-dispatch interval. Never carry a box onto a post-action frame.
    const frame =
        Math.floor(
            (target.untilMs / MILLISECONDS_PER_SECOND - offsetSeconds - uncertaintySeconds) *
                options.fps,
        ) - 1;
    const earliest = frame / options.fps + offsetSeconds - uncertaintySeconds;
    return frame >= 0 &&
        frame < options.sourceFrames &&
        earliest >= target.atMs / MILLISECONDS_PER_SECOND
        ? frame
        : undefined;
}

export function buildAnnotations(options: AnnotationOptions) {
    checkOptions(options);
    const annotations: FrameAnnotation[] = [];
    const sourceTargets: {
        actionId?: number;
        step?: number;
        sourceFrame: number;
        box: Box;
        outlineBox: Box;
        scale: number;
    }[] = [];
    const omitted: {actionId?: number; step?: number; reason: string}[] = [];
    for (const action of retainedMediaActions(options.journal)) {
        if (!action.target) {
            continue;
        }
        const omit = (reason: string) =>
            omitted.push({actionId: action.id, step: action.step, reason});
        const reason = targetOmissionReason(action, options);
        if (reason) {
            omit(reason);
            continue;
        }
        const box = targetVideoBox(
            action.target,
            options.videoWidth,
            options.videoHeight,
            options.layout,
        );
        const sourceFrame = targetSourceFrame(action, options);
        if (!box || sourceFrame === undefined) {
            omit(box ? 'timing-unresolved' : 'invalid-target');
            continue;
        }
        const scale = Math.min(
            1,
            options.videoWidth / action.target.viewportWidth,
            options.videoHeight / action.target.viewportHeight,
        );
        const outlineBox = {
            x: action.target.x * scale,
            y: action.target.y * scale,
            width: action.target.width * scale,
            height: action.target.height * scale,
        };
        sourceTargets.push({
            actionId: action.id,
            step: action.step,
            sourceFrame,
            box,
            outlineBox,
            scale,
        });
        const output = mapSourceFrame(options.frameMap, sourceFrame);
        if (!output) {
            omit('frame-not-retained');
            continue;
        }
        annotations.push({
            actionId: action.id,
            step: action.step,
            sourceFrame,
            outputStart: output.start,
            outputEnd: output.end,
            box,
            outlineBox,
            scale,
        });
    }
    return {
        annotations,
        sourceTargets,
        omitted,
        filters: annotations.map((entry, index) =>
            outlineGraph(
                index === 0 ? 'picture' : `outline${index - 1}`,
                index === annotations.length - 1 ? 'decorated' : `outline${index}`,
                entry.outlineBox,
                entry.scale,
                {width: options.videoWidth, height: options.videoHeight},
                `between(n,${entry.outputStart},${entry.outputEnd - 1})`,
            ),
        ),
    };
}

async function extractPngBatch(
    raw: string,
    directory: string,
    frames: {file: string; sourceFrame: number; box?: Box; outlineBox?: Box; scale?: number}[],
    viewport: {width: number; height: number},
    signal?: AbortSignal,
) {
    if (!frames.length) {
        return;
    }
    const script = path.join(directory, `.annotations-filter-${randomUUID()}.txt`);
    const branches = frames.map((frame, index) => {
        const filter = `select='eq(n,${frame.sourceFrame})',setpts=PTS-STARTPTS`;
        return frame.box
            ? `[source${index}]${filter}[selected${index}];` +
                  outlineGraph(
                      `selected${index}`,
                      `png${index}`,
                      frame.outlineBox ?? frame.box,
                      frame.scale ?? 1,
                      viewport,
                  )
            : `[source${index}]${filter}[png${index}]`;
    });
    fs.writeFileSync(
        script,
        [
            `[0:v]split=${frames.length}${frames.map((_, index) => `[source${index}]`).join('')}`,
            ...branches,
        ].join(';'),
        {flag: 'wx', mode: PRIVATE_FILE_MODE},
    );
    try {
        await ffmpeg(
            [
                '-v',
                'error',
                '-threads',
                '2',
                '-i',
                raw,
                '-filter_complex_threads',
                '2',
                '-/filter_complex',
                script,
                ...frames.flatMap((frame, index) => [
                    '-map',
                    `[png${index}]`,
                    '-an',
                    '-threads',
                    '1',
                    '-frames:v',
                    '1',
                    '-fps_mode',
                    'passthrough',
                    '-n',
                    path.join(directory, frame.file),
                ]),
            ],
            undefined,
            undefined,
            signal,
        );
        for (const frame of frames) {
            const file = path.join(directory, frame.file);
            if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
                throw new Error(OFFLINE_STEP_SCREENSHOT_WAS_NOT_EXTRACTED);
            }
        }
    } finally {
        fs.rmSync(script, {force: true});
    }
}

type StepScreenshotFrame = {
    step?: number;
    role: 'target' | 'after' | 'documentation';
    file: string;
    sourceFrame: number;
    box?: Box;
    outlineBox?: Box;
    scale?: number;
    actionId?: number;
};

export async function extractStepScreenshots(
    options: AnnotationOptions & {
        raw: string;
        outDir: string;
        signal?: AbortSignal;
    },
) {
    const plan = buildAnnotations(options);
    const frames: StepScreenshotFrame[] = [];
    const screenshotOmissions: {step?: number; role: 'target' | 'after'; reason: string}[] = [];
    fs.mkdirSync(options.outDir, {recursive: true, mode: PRIVATE_DIRECTORY_MODE});
    for (const step of options.journal.steps) {
        const targets = plan.sourceTargets.filter((entry) => entry.step === step.id);
        const target = targets.at(-1);
        const prefix = `step-${String(step.id).padStart(3, '0')}`;
        if (target) {
            const file = `${prefix}.png`;
            frames.push({
                step: step.id,
                role: 'target',
                file,
                sourceFrame: target.sourceFrame,
                box: target.box,
                outlineBox: target.outlineBox,
                scale: target.scale,
                actionId: target.actionId,
            });
        } else {
            screenshotOmissions.push({
                step: step.id,
                role: 'target',
                reason: 'no-verified-target-frame',
            });
        }
        const activities = retainedMediaActions(options.journal);
        const observations = activities.filter(
            (action) =>
                action.step === step.id &&
                action.kind === 'evidence' &&
                action.outcome === 'returned',
        );
        const evidence = observations.at(-1);
        if (!evidence) {
            screenshotOmissions.push({
                step: step.id,
                role: 'after',
                reason: 'no-returned-evidence-point',
            });
            continue;
        }
        const {frame, marker, fresh} = evidenceFrame(options, activities, evidence);
        if (fresh) {
            appendEvidenceFrames(frames, step.id, prefix, frame, evidence.id, Boolean(target));
        } else {
            screenshotOmissions.push({
                step: step.id,
                role: 'after',
                reason: marker
                    ? 'fresh-evidence-frame-overlaps-clock-marker'
                    : 'no-fresh-evidence-frame-before-next-action',
            });
        }
    }
    await extractPngBatch(
        options.raw,
        options.outDir,
        frames.filter((frame) => frame.role !== 'documentation'),
        {width: options.videoWidth, height: options.videoHeight},
        options.signal,
    );
    for (const frame of frames.filter((entry) => entry.role === 'documentation')) {
        fs.copyFileSync(
            path.join(options.outDir, `step-${String(frame.step).padStart(3, '0')}-after.png`),
            path.join(options.outDir, frame.file),
            fs.constants.COPYFILE_EXCL,
        );
    }
    const manifest = {
        layout: options.layout ?? 'unknown',
        recording: options.journal.selectedRecording,
        fps: options.fps,
        videoWidth: options.videoWidth,
        videoHeight: options.videoHeight,
        clock: options.protection,
        ...plan,
        frames,
        screenshotOmissions,
    };
    writePrivateJson(path.join(options.outDir, 'annotations.json'), manifest);
    return manifest;
}

function targetOmissionReason(action: Activity, options: AnnotationOptions): string | undefined {
    if (action.kind !== 'interaction' || action.outcome !== 'returned')
        return 'not-a-returned-step-interaction';
    if (
        !options.journal.selectedRecording ||
        action.target?.recording !== options.journal.selectedRecording
    )
        return 'recording-mismatch';
    if (options.layout !== 'playwright-top-left') return 'layout-unverified';
    return undefined;
}

function evidenceFrame(options: AnnotationOptions, activities: Activity[], evidence: Activity) {
    const frame = Math.ceil(
        (evidence.endMs / MILLISECONDS_PER_SECOND -
            options.protection.offsetSeconds +
            options.protection.uncertaintySeconds) *
            options.fps,
    );
    const nextAction = activities
        .filter((action) => action.kind === 'interaction' && action.startMs >= evidence.endMs)
        .sort((a, b) => a.startMs - b.startMs)[0];
    const latest =
        (frame + 1) / options.fps +
        options.protection.offsetSeconds +
        options.protection.uncertaintySeconds;
    const marker = options.protection.markers?.some(
        (range) => frame >= range.start && frame < range.end,
    );
    return {
        frame,
        marker,
        fresh:
            frame >= 0 &&
            frame < options.sourceFrames &&
            (!nextAction || latest <= nextAction.startMs / MILLISECONDS_PER_SECOND) &&
            !marker,
    };
}

function appendEvidenceFrames(
    frames: StepScreenshotFrame[],
    step: number,
    prefix: string,
    frame: number,
    actionId: number | undefined,
    hasTarget: boolean,
) {
    const file = `${prefix}-after.png`;
    frames.push({
        step: step,
        role: 'after',
        file,
        sourceFrame: frame,
        actionId: actionId,
    });
    if (!hasTarget) {
        const documentation = `${prefix}.png`;
        frames.push({
            step: step,
            role: 'documentation',
            file: documentation,
            sourceFrame: frame,
            actionId: actionId,
        });
    }
}
