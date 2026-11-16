import {MILLISECONDS_PER_SECOND} from '../../shared/config.js';
import {MAX_FRAMES, MIX_SAMPLE_RATE, NARRATION_PADDING_SECONDS} from '../config.js';
import {
    INVALID_SOURCE_FRAME_SEQUENCE,
    NARRATED_VIDEO_EXCEEDS_THE_FRAME_LIMIT,
    NARRATION_HAS_NO_RECORDED_ACTIVITY_FOR_AN_ENABLED,
    SURROUNDING_CONTEXT_MUST_BE_1_5_SECONDS_RESULT,
} from '../messages.js';
export type NarrationWindow = {
    id: number;
    first: number;
    last: number;
    start: number;
    end: number;
    anchorFrame?: number;
    evidenceFrame?: number;
    ranges: Array<{start: number; end: number}>;
};
export type NarrationTimingInput = {
    indices: number[] | Uint32Array;
    timeline: {
        fps: number;
        sourceFrames: number;
        protection: {
            markers: Array<{start: number; end: number}>;
            excluded?: Array<{start: number; end: number}>;
        };
    };
};
export function lowerBound(values: ArrayLike<number>, value: number) {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (values[middle] < value) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

export class NarrationTimingError extends Error {
    constructor(step: number, kind: 'anchor' | 'hold') {
        super(
            kind === 'anchor'
                ? `Narration for phrase ${step} has no confirmed activity anchor`
                : `Narration for phrase ${step} needs a confirmed result hold within its limit; shorten this phrase`,
        );
        this.name = 'NarrationTimingError';
    }
}

function nearbyCandidates(
    input: NarrationTimingInput,
    window: NarrationWindow,
    counts: Uint32Array,
    end: number,
    surroundingSeconds: number,
) {
    const extra = Math.ceil(surroundingSeconds * input.timeline.fps);
    const candidates = new Map<number, number>();
    for (const range of window.ranges) {
        for (
            let frame = Math.max(window.start, range.start - extra);
            frame < Math.min(end, range.end + extra);
            frame++
        ) {
            if (
                counts[frame] === 0 &&
                !input.timeline.protection.markers.some(
                    (marker) => frame >= marker.start && frame < marker.end,
                ) &&
                !(input.timeline.protection.excluded ?? []).some(
                    (cut) => frame >= cut.start && frame < cut.end,
                )
            ) {
                const distance = Math.max(range.start - frame, frame - range.end + 1, 0);
                candidates.set(frame, Math.min(candidates.get(frame) ?? Infinity, distance));
            }
        }
    }
    return [...candidates]
        .sort(([a, distanceA], [b, distanceB]) => distanceA - distanceB || a - b)
        .map(([frame]) => frame);
}

function frameCounts(input: NarrationTimingInput) {
    if (
        !Number.isSafeInteger(input.timeline.sourceFrames) ||
        input.timeline.sourceFrames < 1 ||
        input.timeline.sourceFrames > MAX_FRAMES ||
        !input.indices.length ||
        input.indices.length > MAX_FRAMES
    ) {
        throw new Error(INVALID_SOURCE_FRAME_SEQUENCE);
    }
    const counts = new Uint32Array(input.timeline.sourceFrames);
    let previousFrame = -1;
    for (const frame of input.indices) {
        if (
            !Number.isSafeInteger(frame) ||
            frame < previousFrame ||
            frame < 0 ||
            frame >= counts.length
        ) {
            throw new Error(INVALID_SOURCE_FRAME_SEQUENCE);
        }
        counts[frame]++;
        previousFrame = frame;
    }
    return counts;
}

export function fitAudioPacked(
    input: NarrationTimingInput,
    windows: NarrationWindow[],
    audio: Map<number, {durationMs: number}>,
    options: {surroundingSeconds: number; maxHoldSeconds: number},
) {
    const {fps} = input.timeline;
    if (
        !Number.isFinite(options.surroundingSeconds) ||
        options.surroundingSeconds < 1 ||
        options.surroundingSeconds > 5 ||
        !Number.isFinite(options.maxHoldSeconds) ||
        options.maxHoldSeconds < 0 ||
        options.maxHoldSeconds > 5
    ) {
        throw new Error(SURROUNDING_CONTEXT_MUST_BE_1_5_SECONDS_RESULT);
    }
    const audioEnd = (index: number) => {
        const next = windows[index + 1];
        return next && audio.has(next.id)
            ? Math.min(windows[index].end, next.start)
            : windows[index].end;
    };
    if ([...audio.keys()].some((id) => !windows.some((window) => window.id === id))) {
        throw new Error(NARRATION_HAS_NO_RECORDED_ACTIVITY_FOR_AN_ENABLED);
    }
    const counts = frameCounts(input);
    for (const [index, window] of windows.entries()) {
        const speech = audio.get(window.id);
        if (!speech) {
            continue;
        }
        if (window.anchorFrame === undefined) {
            throw new NarrationTimingError(window.id, 'anchor');
        }
        const end = audioEnd(index);
        let needed =
            Math.ceil(
                (speech.durationMs / MILLISECONDS_PER_SECOND + NARRATION_PADDING_SECONDS) * fps,
            ) -
            (lowerBound(input.indices, end) - lowerBound(input.indices, window.start));
        if (needed <= 0) {
            continue;
        }
        for (const frame of nearbyCandidates(
            input,
            window,
            counts,
            end,
            options.surroundingSeconds,
        )) {
            if (needed-- <= 0) {
                break;
            }
            counts[frame] = 1;
        }
    }
    const count = counts.reduce((total, frames) => total + frames, 0);
    if (count > MAX_FRAMES) {
        throw new Error(NARRATED_VIDEO_EXCEEDS_THE_FRAME_LIMIT);
    }
    const indices = new Uint32Array(count);
    let cursor = 0;
    for (let frame = 0; frame < counts.length; frame++) {
        indices.fill(frame, cursor, cursor + counts[frame]);
        cursor += counts[frame];
    }
    let cumulativeHold = 0;
    const placements = windows.map((window, index) => {
        const baseStart = lowerBound(indices, window.start);
        const baseEnd = lowerBound(indices, audioEnd(index));
        const speech = audio.get(window.id);
        const required = speech
            ? Math.ceil(
                  (speech.durationMs / MILLISECONDS_PER_SECOND + NARRATION_PADDING_SECONDS) * fps,
              )
            : 0;
        const holdFrames = Math.max(0, required - (baseEnd - baseStart));
        const holdBaseIndex =
            window.evidenceFrame === undefined
                ? undefined
                : lowerBound(indices, window.evidenceFrame);
        if (
            (speech && baseStart >= baseEnd) ||
            holdFrames > Math.floor(options.maxHoldSeconds * fps) ||
            (holdFrames &&
                (holdBaseIndex === undefined ||
                    indices[holdBaseIndex] !== window.evidenceFrame ||
                    holdBaseIndex < baseStart ||
                    holdBaseIndex >= baseEnd))
        ) {
            throw new NarrationTimingError(window.id, 'hold');
        }
        const outputStart = baseStart + cumulativeHold;
        cumulativeHold += holdFrames;
        return {
            id: window.id,
            first: window.first,
            last: window.last,
            start: window.start,
            end: window.end,
            anchorFrame: window.anchorFrame,
            baseStart,
            baseEnd,
            holdBaseIndex,
            holdFrames,
            outputStart,
            audioSamples: speech
                ? Math.ceil((speech.durationMs / MILLISECONDS_PER_SECOND) * MIX_SAMPLE_RATE)
                : 0,
        };
    });
    if (indices.length + cumulativeHold > MAX_FRAMES) {
        throw new Error(NARRATED_VIDEO_EXCEEDS_THE_FRAME_LIMIT);
    }
    const holds = new Map(
        placements
            .filter((entry) => entry.holdFrames)
            .map((entry) => [entry.holdBaseIndex, entry.holdFrames]),
    );
    const frameRefs = new Uint32Array(indices.length + cumulativeHold);
    let offset = 0;
    for (const [index, frame] of indices.entries()) {
        const count = 1 + (holds.get(index) ?? 0);
        frameRefs.fill(frame, offset, offset + count);
        offset += count;
    }
    return {
        indices,
        frameRefs,
        placements,
        restoredFrames: indices.length - input.indices.length,
        heldFrames: cumulativeHold,
    };
}

// Preserve the eager array contract for existing direct callers.
export function fitAudio(...args: Parameters<typeof fitAudioPacked>) {
    const fit = fitAudioPacked(...args);
    return {...fit, indices: [...fit.indices], frameRefs: [...fit.frameRefs]};
}
