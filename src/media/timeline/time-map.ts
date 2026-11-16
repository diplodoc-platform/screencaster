import {
    INVALID_FRAME_MAP,
    INVALID_SOURCE_FRAME,
    INVALID_SOURCE_FRAME_SEQUENCE,
} from '../messages.js';
import {MAX_FRAMES} from '../config.js';
export type FrameMapSegment = {
    sourceStart: number;
    sourceEnd: number;
    outputStart: number;
    outputEnd: number;
};

export function validateFrameMap(map: FrameMapSegment[]): void {
    if (!Array.isArray(map) || !map.length || map.length > MAX_FRAMES) {
        throw new Error(INVALID_FRAME_MAP);
    }
    let outputEnd = 0;
    let sourceEnd = 0;
    for (const segment of map) {
        const values = [
            segment.sourceStart,
            segment.sourceEnd,
            segment.outputStart,
            segment.outputEnd,
        ];
        const sourceLength = segment.sourceEnd - segment.sourceStart;
        const outputLength = segment.outputEnd - segment.outputStart;
        if (
            values.some(
                (value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_FRAMES,
            ) ||
            segment.sourceStart < sourceEnd ||
            segment.outputStart !== outputEnd ||
            sourceLength < 1 ||
            outputLength < 1 ||
            (sourceLength !== outputLength && sourceLength !== 1)
        ) {
            throw new Error(INVALID_FRAME_MAP);
        }
        sourceEnd = segment.sourceEnd;
        outputEnd = segment.outputEnd;
    }
}

// A hold repeats one source frame; normal segments retain source frame order.
export function buildFrameMap(frameRefs: ArrayLike<number>): FrameMapSegment[] {
    if (!frameRefs.length || frameRefs.length > MAX_FRAMES) {
        throw new Error(INVALID_SOURCE_FRAME_SEQUENCE);
    }
    for (let index = 0; index < frameRefs.length; index++) {
        const frame = frameRefs[index];
        if (
            !Number.isSafeInteger(frame) ||
            frame < 0 ||
            frame >= MAX_FRAMES ||
            (index > 0 && frame < frameRefs[index - 1])
        ) {
            throw new Error(INVALID_SOURCE_FRAME_SEQUENCE);
        }
    }
    const map: FrameMapSegment[] = [];
    let index = 0;
    while (index < frameRefs.length) {
        const start = index;
        const frame = frameRefs[index];
        while (index + 1 < frameRefs.length && frameRefs[index + 1] === frame) {
            index++;
        }
        if (index > start) {
            map.push({
                sourceStart: frame,
                sourceEnd: frame + 1,
                outputStart: start,
                outputEnd: index + 1,
            });
        } else {
            const previous = map[map.length - 1];
            if (
                previous &&
                previous.sourceEnd === frame &&
                previous.outputEnd - previous.outputStart ===
                    previous.sourceEnd - previous.sourceStart
            ) {
                previous.sourceEnd++;
                previous.outputEnd++;
            } else {
                map.push({
                    sourceStart: frame,
                    sourceEnd: frame + 1,
                    outputStart: index,
                    outputEnd: index + 1,
                });
            }
        }
        index++;
    }
    validateFrameMap(map);
    return map;
}

export function expandFrameMap(map: FrameMapSegment[]): number[] {
    validateFrameMap(map);
    return map.flatMap((segment) =>
        Array.from({length: segment.outputEnd - segment.outputStart}, (_, index) =>
            segment.sourceEnd - segment.sourceStart === 1
                ? segment.sourceStart
                : segment.sourceStart + index,
        ),
    );
}

// Monotonic maps give a source frame one contiguous output interval, including holds.
export function mapSourceFrame(
    map: FrameMapSegment[],
    sourceFrame: number,
): {start: number; end: number} | undefined {
    validateFrameMap(map);
    if (!Number.isSafeInteger(sourceFrame) || sourceFrame < 0) {
        throw new Error(INVALID_SOURCE_FRAME);
    }
    const segment = map.find(
        (entry) => sourceFrame >= entry.sourceStart && sourceFrame < entry.sourceEnd,
    );
    if (!segment) {
        return undefined;
    }
    if (segment.sourceEnd - segment.sourceStart === 1) {
        return {start: segment.outputStart, end: segment.outputEnd};
    }
    const start = segment.outputStart + sourceFrame - segment.sourceStart;
    return {start, end: start + 1};
}

export function packedFrameRefs(map: FrameMapSegment[]): Uint32Array {
    validateFrameMap(map);
    const refs = new Uint32Array(map[map.length - 1].outputEnd);
    for (const segment of map) {
        for (let index = segment.outputStart; index < segment.outputEnd; index++) {
            refs[index] =
                segment.sourceStart +
                (segment.sourceEnd - segment.sourceStart === 1 ? 0 : index - segment.outputStart);
        }
    }
    return refs;
}
