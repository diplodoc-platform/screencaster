import fs from 'node:fs';
import path from 'node:path';

import {
    ACTIVITY_GUARD_SECONDS,
    FINAL_FRAME_HOLD_SECONDS,
    MAX_FRAMES,
    TARGET_HOLD_SECONDS,
} from '../config.js';
import {PRIVATE_DIRECTORY_MODE} from '../../shared/config.js';
import {
    CLOCK_MARKER_OVERLAPS_RECORDING_BOUNDARY,
    EXPECTED_A_REGULAR_VIDEO_FILE,
    FFMPEG_SELECTION_CHANGED_A_RETAINED_FRAME,
    INVALID_MEDIA_JOURNAL,
    INVALID_RETAINED_FRAME_SEQUENCE,
} from '../messages.js';
import {readJson, writePrivateJson} from '../../shared/private-files.js';
import {readFrameTable, scanFrames, sha256} from '../recording/recording.js';
import {type FrameRange, bindProtection, markerRanges} from '../recording/protection.js';
import {frameHash} from '../recording/frame-table.js';
import {throwIfMediaAborted} from '../cancellation.js';
import {type MediaJournal, mediaJournalSchema} from '../recording/journal.js';
import {type AnnotationOptions, buildAnnotations} from '../timeline/annotations.js';
import {renderMappedVideo} from '../timeline/render-mapped-video.js';
import {type FrameMapSegment, buildFrameMap} from '../timeline/time-map.js';

export {TARGET_HOLD_SECONDS} from '../config.js';
export {FINAL_FRAME_HOLD_SECONDS} from '../config.js';

export type VideoSegment = FrameMapSegment;

export function planFrames(
    indices: number[],
    count: number,
    bounds: FrameRange = {start: 0, end: count},
): VideoSegment[] {
    if (
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        !Number.isSafeInteger(bounds.start) ||
        !Number.isSafeInteger(bounds.end) ||
        bounds.start < 0 ||
        bounds.end > count ||
        bounds.start >= bounds.end ||
        !indices.length ||
        indices.some(
            (index, offset) =>
                !Number.isSafeInteger(index) ||
                index < bounds.start ||
                index >= bounds.end ||
                (offset > 0 && index <= indices[offset - 1]),
        )
    ) {
        throw new Error(INVALID_RETAINED_FRAME_SEQUENCE);
    }
    const retained = [...new Set([bounds.start, ...indices, bounds.end - 1])].sort((a, b) => a - b);
    return buildFrameMap(retained);
}

async function loadProtection(
    journalFile: string | MediaJournal | undefined,
    raw: string,
    sourceHash: string,
    source: Awaited<ReturnType<typeof readFrameTable>>,
    signal?: AbortSignal,
) {
    if (!journalFile) {
        return undefined;
    }
    const journal = typeof journalFile === 'string' ? readJson(journalFile) : journalFile;
    if (!journal || typeof journal !== 'object') {
        throw new Error(INVALID_MEDIA_JOURNAL);
    }
    const parsed = mediaJournalSchema.parse(journal);
    return {
        journal: parsed,
        protection: bindProtection(
            parsed,
            sourceHash,
            await markerRanges(raw, source.frames.length, signal),
            source.fps,
            source.frames.length,
        ),
    };
}

function selectFrames(
    retained: Uint8Array,
    source: Awaited<ReturnType<typeof readFrameTable>>,
    protection: ReturnType<typeof bindProtection> | undefined,
) {
    const bounds = protection?.content ?? {start: 0, end: source.frames.length};
    for (const range of protection?.ranges ?? []) {
        retained.fill(1, range.start, range.end);
    }
    for (const range of [...(protection?.markers ?? []), ...(protection?.excluded ?? [])]) {
        retained.fill(0, range.start, range.end);
    }
    if (
        protection?.markers.some(
            (range) =>
                (range.start <= bounds.start && range.end > bounds.start) ||
                (range.start < bounds.end && range.end >= bounds.end),
        )
    ) {
        throw new Error(CLOCK_MARKER_OVERLAPS_RECORDING_BOUNDARY);
    }
    if (!retained.subarray(bounds.start, bounds.end).some(Boolean)) {
        throw new Error(INVALID_RETAINED_FRAME_SEQUENCE);
    }
    retained[bounds.start] = 1;
    retained[bounds.end - 1] = 1;
    return bounds;
}

export async function optimizeVideo(options: {
    input: string;
    output: string;
    journal?: string | MediaJournal;
    layout?: AnnotationOptions['layout'];
    highlights?: boolean;
    signal?: AbortSignal;
}) {
    throwIfMediaAborted(options.signal);
    const input = fs.realpathSync(options.input);
    const output = path.resolve(options.output);
    if (!fs.statSync(input).isFile()) {
        throw new Error(EXPECTED_A_REGULAR_VIDEO_FILE);
    }
    // mkdir without recursive/exist-ok and COPYFILE_EXCL protect original runs,
    // existing exports and hardlinked source recordings.
    fs.mkdirSync(output, {mode: PRIVATE_DIRECTORY_MODE});
    const raw = path.join(output, 'raw.webm');
    fs.copyFileSync(input, raw, fs.constants.COPYFILE_EXCL);
    const sourceSha256 = await sha256(raw, options.signal);
    const source = await readFrameTable(raw, {signal: options.signal});
    const protectedInput = await loadProtection(
        options.journal,
        raw,
        sourceSha256,
        source,
        options.signal,
    );
    const protection = protectedInput?.protection;
    const layout = options.layout ?? protectedInput?.journal.videoLayout;
    // Protected exports use actual activity intervals; model latency and browser
    // waits outside those intervals do not create additional retained windows.
    const filter = protection
        ? 'recorded-activity-windows'
        : `mpdecimate=hi=64:lo=64:frac=0:keep=${Math.ceil(source.fps)}`;
    const retained = new Uint8Array(source.frames.length);
    if (!protection) {
        const selected = await scanFrames(raw, filter, {
            signal: options.signal,
            onFrame: (frame) => {
                if (frameHash(source.frames, frame.index) !== frame.hash) {
                    throw new Error(FFMPEG_SELECTION_CHANGED_A_RETAINED_FRAME);
                }
                retained[frame.index] = 1;
            },
        });
        if (selected.fps !== source.fps) {
            throw new Error(FFMPEG_SELECTION_CHANGED_A_RETAINED_FRAME);
        }
    }
    throwIfMediaAborted(options.signal);
    const bounds = selectFrames(retained, source, protection);
    const targets =
        protectedInput && protection
            ? buildAnnotations({
                  journal: protectedInput.journal,
                  frameMap: [
                      {
                          sourceStart: 0,
                          sourceEnd: source.frames.length,
                          outputStart: 0,
                          outputEnd: source.frames.length,
                      },
                  ],
                  fps: source.fps,
                  sourceFrames: source.frames.length,
                  videoWidth: source.width,
                  videoHeight: source.height,
                  protection,
                  layout,
              }).sourceTargets
            : [];
    const holds = new Set(
        targets
            .filter(
                (target) =>
                    target.sourceFrame >= bounds.start &&
                    target.sourceFrame < bounds.end &&
                    !protection?.markers.some(
                        (marker) =>
                            target.sourceFrame >= marker.start && target.sourceFrame < marker.end,
                    ),
            )
            .map((target) => target.sourceFrame),
    );
    for (const frame of holds) {
        retained[frame] = 1;
    }
    // Hold measured pre-action stills and the actual final frame long enough to read.
    // Coordinates never follow a new page or scroll; all repeats share the frame map.
    const repetitions = (frame: number) =>
        Math.max(
            1,
            holds.has(frame) ? Math.ceil(source.fps * TARGET_HOLD_SECONDS) : 1,
            frame === bounds.end - 1 ? Math.ceil(source.fps * FINAL_FRAME_HOLD_SECONDS) : 1,
        );
    const frameRefs = repeatedFrameRefs(retained, bounds, repetitions);
    const video = path.join(output, 'video.webm');
    const rendered = await renderMappedVideo({
        input: raw,
        output: video,
        frameRefs,
        fps: source.fps,
        sourceFrames: source.frames,
        journal: options.highlights ? protectedInput?.journal : undefined,
        protection,
        videoWidth: source.width,
        videoHeight: source.height,
        layout,
        signal: options.signal,
    });
    const segments = rendered.frameMap;
    const expected = frameRefs;
    const timeline = {
        sourceSha256,
        videoSha256: await sha256(video, options.signal),
        fps: source.fps,
        sourceFrames: source.frames.length,
        videoWidth: source.width,
        videoHeight: source.height,
        outputFrames: expected.length,
        filter,
        protection,
        segments,
        annotations: rendered.annotations,
        layout,
        retainedFramesVerified: rendered.retainedFramesVerified,
    };
    throwIfMediaAborted(options.signal);
    writePrivateJson(path.join(output, 'timeline.json'), timeline);
    const metrics = {
        sourceSeconds: source.frames.length / source.fps,
        outputSeconds: expected.length / source.fps,
        removedSeconds: (source.frames.length - expected.length) / source.fps,
        retainedFramesVerified: true,
        protectedFramesVerified: Boolean(protection),
        limitation: protection
            ? `Actual activity windows plus ${ACTIVITY_GUARD_SECONDS} seconds and clock uncertainty retained; measured pre-action ` +
              'stills held for ' +
              `${TARGET_HOLD_SECONDS}` +
              ' seconds. Final recorded frame held for ' +
              `${FINAL_FRAME_HOLD_SECONDS}` +
              ' second. Outside-window waits and clock markers removed. Raw preserves the complete chronology; ' +
              'returned tools do not imply successful steps.'
            : 'Visual similarity is not an action or success detector. Final recorded frame held for ' +
              `${FINAL_FRAME_HOLD_SECONDS}` +
              ' second. Review actions and useful waits against raw and the optional audit journal. No action ' +
              'timestamps are inferred.',
    };
    writePrivateJson(path.join(output, 'metrics.json'), metrics);
    if (options.journal) {
        // The journal remains audit material, never a source of fabricated video clocks.
        writePrivateJson(
            path.join(output, 'media-events.json'),
            typeof options.journal === 'string' ? readJson(options.journal) : options.journal,
        );
    }
    return timeline;
}

function repeatedFrameRefs(
    retained: Uint8Array,
    bounds: FrameRange,
    repetitions: (frame: number) => number,
) {
    let outputCount = 0;
    for (let frame = bounds.start; frame < bounds.end; frame++) {
        if (retained[frame]) {
            outputCount += repetitions(frame);
        }
    }
    if (outputCount > MAX_FRAMES) {
        throw new Error(INVALID_RETAINED_FRAME_SEQUENCE);
    }
    const frameRefs = new Uint32Array(outputCount);
    let offset = 0;
    for (let frame = bounds.start; frame < bounds.end; frame++) {
        if (retained[frame]) {
            const end = offset + repetitions(frame);
            frameRefs.fill(frame, offset, end);
            offset = end;
        }
    }
    return frameRefs;
}
