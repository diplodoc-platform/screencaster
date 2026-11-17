import {MILLISECONDS_PER_SECOND} from '../../shared/config.js';
import {
    ACTIVITY_GUARD_SECONDS,
    MARKER_BRIGHT_CHANNEL_MIN,
    MARKER_DARK_CHANNEL_MAX,
    MARKER_DETECTION_FILTER,
    MAX_ACTIVITY_GUARD_SECONDS,
    MAX_CLOCK_SPREAD_SECONDS,
    MIN_ACTIVITY_GUARD_SECONDS,
} from '../config.js';
import {
    ACTIONS_SPAN_MULTIPLE_TAB_RECORDINGS_RETAIN_ALL_RAW,
    ACTION_FALLS_OUTSIDE_THE_SELECTED_RECORDING_CLOCK_COVERAGE,
    CONTENT_BOUNDARY_MAY_OVERLAP_RECORDED_ACTIVITY,
    INCOMPLETE_MARKER_SCAN,
    INVALID_MEDIA_ACTIVITY_GUARD,
    INVALID_STEP_IDENTITIES_IN_MEDIA_JOURNAL,
    MEDIA_EDIT_OVERLAPS_A_RETAINED_ACTION_ORIGINAL_RECORDING,
    MISSING_OR_AMBIGUOUS_VIDEO_CLOCK_MARKERS_OR_ACTIONS,
    PROTECTED_EXPORT_REQUIRES_A_COMPLETE_SYNCHRONIZED_ACTIVITY_JOURNAL,
    UNEXPECTED_MARKER_FRAME_COUNT,
    VIDEO_CLOCK_DRIFT_EXCEEDS_500_MS_PLUS_FRAME,
} from '../messages.js';
import {excludedMediaIntervals} from '../timeline/editing.js';

import {ffmpeg} from './process.js';
import {mediaJournalSchema, selectMediaActivities, selectMediaContent} from './journal.js';

export type FrameRange = {start: number; end: number};
type Clock = {recording: string; startMs: number; endMs: number};
type Action = {startMs: number; endMs: number};
export {ACTIVITY_GUARD_SECONDS} from '../config.js';

export async function markerRanges(
    file: string,
    count: number,
    signal?: AbortSignal,
): Promise<FrameRange[]> {
    let pending = Buffer.alloc(0);
    let index = 0;
    const ranges: FrameRange[] = [];
    await ffmpeg(
        [
            '-v',
            'error',
            '-threads',
            '2',
            '-i',
            file,
            '-an',
            '-vf',
            MARKER_DETECTION_FILTER,
            '-f',
            'rawvideo',
            '-',
        ],
        undefined,
        (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            let offset = 0;
            while (offset + 6 <= pending.length) {
                const [r, g, b, r2, g2, b2] = pending.subarray(offset, offset + 6);
                if (
                    r > MARKER_BRIGHT_CHANNEL_MIN &&
                    g < MARKER_DARK_CHANNEL_MAX &&
                    b > MARKER_BRIGHT_CHANNEL_MIN &&
                    r2 < MARKER_DARK_CHANNEL_MAX &&
                    g2 > MARKER_BRIGHT_CHANNEL_MIN &&
                    b2 < MARKER_DARK_CHANNEL_MAX
                ) {
                    const previous = ranges.at(-1);
                    if (previous?.end === index) {
                        previous.end++;
                    } else {
                        ranges.push({start: index, end: index + 1});
                    }
                }
                offset += 6;
                index++;
                if (index > count) {
                    throw new Error(UNEXPECTED_MARKER_FRAME_COUNT);
                }
            }
            pending = Buffer.from(pending.subarray(offset));
        },
        signal,
    );
    if (pending.length || index !== count) {
        throw new Error(INCOMPLETE_MARKER_SCAN);
    }
    return ranges;
}

function validateJournal(journal: unknown, sourceHash: string) {
    const validated = mediaJournalSchema.safeParse(journal);
    if (!validated.success || validated.data.sourceSha256 !== sourceHash) {
        throw new Error(PROTECTED_EXPORT_REQUIRES_A_COMPLETE_SYNCHRONIZED_ACTIVITY_JOURNAL);
    }
    const ids = new Set(validated.data.steps.map((step) => step.id));
    if (
        ids.size !== validated.data.steps.length ||
        validated.data.actions.some((action) => action.step !== undefined && !ids.has(action.step))
    ) {
        throw new Error(INVALID_STEP_IDENTITIES_IN_MEDIA_JOURNAL);
    }
    return validated.data;
}

function exclusionProtection(
    journal: ReturnType<typeof validateJournal>,
    offset: number,
    uncertainty: number,
    fps: number,
    count: number,
    ranges: FrameRange[],
    content?: FrameRange,
) {
    const excluded = excludedMediaIntervals(journal).map((range) => ({
        start: Math.max(
            content?.start ?? 0,
            Math.floor((range.startMs / MILLISECONDS_PER_SECOND - offset - uncertainty) * fps),
        ),
        end: Math.min(
            count,
            Math.ceil((range.endMs / MILLISECONDS_PER_SECOND - offset + uncertainty) * fps),
        ),
    }));
    if (
        excluded.some((cut) =>
            ranges.some((range) => range.start < cut.end && range.end > cut.start),
        )
    ) {
        throw new Error(MEDIA_EDIT_OVERLAPS_A_RETAINED_ACTION_ORIGINAL_RECORDING);
    }
    return excluded.length ? {excluded} : {};
}

// Fail closed: no clock is inferred from file creation, mtime, LLM latency or
// video duration. Marker edges are discrete frames: allow their two-frame
// quantization in addition to the 500 ms clock spread, retaining that uncertainty.
export function bindProtection(
    journal: unknown,
    sourceHash: string,
    markers: FrameRange[],
    fps: number,
    count: number,
    guardSeconds = ACTIVITY_GUARD_SECONDS,
) {
    if (
        !Number.isFinite(guardSeconds) ||
        guardSeconds < MIN_ACTIVITY_GUARD_SECONDS ||
        guardSeconds > MAX_ACTIVITY_GUARD_SECONDS
    ) {
        throw new Error(INVALID_MEDIA_ACTIVITY_GUARD);
    }
    const validated = validateJournal(journal, sourceHash);
    const observedContent = selectMediaContent(validated);
    if (validated.clocks.some((clock) => clock.recording !== validated.selectedRecording)) {
        throw new Error(ACTIONS_SPAN_MULTIPLE_TAB_RECORDINGS_RETAIN_ALL_RAW);
    }
    const clocks: Clock[] = validated.clocks.filter(
        (clock: Clock) => clock?.recording === validated.selectedRecording,
    );
    const actions: Action[] = validated.actions;
    if (
        clocks.length < 2 ||
        clocks.length !== markers.length ||
        !actions.length ||
        clocks.some(
            (clock, index) =>
                !Number.isFinite(clock.startMs) ||
                !Number.isFinite(clock.endMs) ||
                clock.endMs <= clock.startMs ||
                (index > 0 && clock.startMs <= clocks[index - 1].endMs),
        ) ||
        actions.some(
            (action) =>
                !Number.isFinite(action?.startMs) ||
                !Number.isFinite(action?.endMs) ||
                action.endMs < action.startMs,
        )
    ) {
        throw new Error(MISSING_OR_AMBIGUOUS_VIDEO_CLOCK_MARKERS_OR_ACTIONS);
    }
    if (
        actions.some(
            (action) =>
                action.startMs < clocks[0].endMs ||
                action.endMs > clocks[clocks.length - 1].startMs,
        )
    ) {
        throw new Error(ACTION_FALLS_OUTSIDE_THE_SELECTED_RECORDING_CLOCK_COVERAGE);
    }
    const offsets = clocks.flatMap((clock, index) => [
        clock.startMs / MILLISECONDS_PER_SECOND - markers[index].start / fps,
        clock.endMs / MILLISECONDS_PER_SECOND - markers[index].end / fps,
    ]);
    const minimum = Math.min(...offsets);
    const maximum = Math.max(...offsets);
    const edgeUncertaintySeconds = 2 / fps;
    if (maximum - minimum > MAX_CLOCK_SPREAD_SECONDS + edgeUncertaintySeconds) {
        throw new Error(VIDEO_CLOCK_DRIFT_EXCEEDS_500_MS_PLUS_FRAME);
    }
    const offset = (minimum + maximum) / 2;
    const uncertaintySeconds = (maximum - minimum) / 2 + edgeUncertaintySeconds;
    let content: (FrameRange & {startMs: number}) | undefined;
    if (observedContent.contentStartMs !== undefined) {
        const boundary = observedContent.contentStartMs;
        const start = Math.ceil(
            (boundary / MILLISECONDS_PER_SECOND - offset + uncertaintySeconds) * fps,
        );
        const firstActivity = Math.min(
            ...observedContent.actions.map((action) =>
                Math.floor(
                    (action.startMs / MILLISECONDS_PER_SECOND - offset - uncertaintySeconds) * fps,
                ),
            ),
        );
        if (
            !observedContent.actions.length ||
            boundary < clocks[0].endMs ||
            boundary > clocks[clocks.length - 1].startMs ||
            start < 0 ||
            start >= count ||
            start > firstActivity
        ) {
            throw new Error(CONTENT_BOUNDARY_MAY_OVERLAP_RECORDED_ACTIVITY);
        }
        content = {startMs: boundary, start, end: count};
    }
    const ranges = selectMediaActivities(observedContent.actions)
        .map((action) => ({
            start: Math.max(
                content?.start ?? 0,
                Math.floor(
                    (action.startMs / MILLISECONDS_PER_SECOND -
                        offset -
                        guardSeconds -
                        uncertaintySeconds) *
                        fps,
                ),
            ),
            end: Math.min(
                count,
                Math.ceil(
                    (action.endMs / MILLISECONDS_PER_SECOND -
                        offset +
                        guardSeconds +
                        uncertaintySeconds) *
                        fps,
                ),
            ),
        }))
        .filter((range) => range.end > range.start);
    const exclusions = exclusionProtection(
        validated,
        offset,
        uncertaintySeconds,
        fps,
        count,
        ranges,
        content,
    );
    return {
        ranges,
        markers,
        guardSeconds,
        uncertaintySeconds,
        offsetSeconds: offset,
        ...exclusions,
        ...(content ? {content} : {}),
    };
}
