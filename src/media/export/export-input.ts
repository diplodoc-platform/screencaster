import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';

import {
    ACTION_JOURNAL_BELONGS_TO_A_DIFFERENT_SOURCE_RECORDING,
    EXPORT_FRAME_MAP_IS_INCONSISTENT,
    EXPORT_INPUT_HASHES_DO_NOT_MATCH_ITS_TIMELINE,
    EXPORT_SOURCE_DOES_NOT_MATCH_ITS_DECLARED_FRAME,
} from '../messages.js';
import {MAX_FRAMES, MAX_TIMELINE_SEGMENTS, MAX_VIDEO_FPS} from '../config.js';
import {readFrameTable, sha256} from '../recording/recording.js';
import {packedFrameRefs, validateFrameMap} from '../timeline/time-map.js';
import {mediaJournalSchema} from '../recording/journal.js';

const segmentSchema = z.object({
    sourceStart: z.number().int(),
    sourceEnd: z.number().int(),
    outputStart: z.number().int(),
    outputEnd: z.number().int(),
});
export const timelineSchema = z
    .object({
        sourceSha256: z.string(),
        videoSha256: z.string(),
        fps: z.number().positive().max(MAX_VIDEO_FPS),
        sourceFrames: z.number().int().positive().max(MAX_FRAMES),
        outputFrames: z.number().int().positive().max(MAX_FRAMES),
        segments: z.array(segmentSchema).min(1).max(MAX_TIMELINE_SEGMENTS),
        protection: z
            .object({
                offsetSeconds: z.number().finite(),
                uncertaintySeconds: z.number().finite(),
                markers: z.array(z.object({start: z.number().int(), end: z.number().int()})),
                excluded: z
                    .array(z.object({start: z.number().int(), end: z.number().int()}))
                    .optional(),
                ranges: z.array(z.object({start: z.number().int(), end: z.number().int()})),
                content: z.object({start: z.number().int(), end: z.number().int()}).optional(),
            })
            .passthrough()
            .optional(),
        annotations: z
            .object({filters: z.array(z.string())})
            .passthrough()
            .optional(),
        layout: z.literal('playwright-top-left').optional(),
    })
    .passthrough();

export async function loadExport(directory: string, signal?: AbortSignal) {
    const root = await fs.realpath(directory);
    const timeline = timelineSchema.parse(
        JSON.parse(await fs.readFile(path.join(root, 'timeline.json'), 'utf8')),
    );
    validateFrameMap(timeline.segments);
    const raw = path.join(root, 'raw.webm');
    const video = path.join(root, 'video.webm');
    if (
        (await sha256(raw, signal)) !== timeline.sourceSha256 ||
        (await sha256(video, signal)) !== timeline.videoSha256
    ) {
        throw new Error(EXPORT_INPUT_HASHES_DO_NOT_MATCH_ITS_TIMELINE);
    }
    const indices = packedFrameRefs(timeline.segments);
    if (
        indices.length !== timeline.outputFrames ||
        indices.some((frame) => frame >= timeline.sourceFrames)
    ) {
        throw new Error(EXPORT_FRAME_MAP_IS_INCONSISTENT);
    }
    const frames = await readFrameTable(raw, {signal});
    if (frames.frames.length !== timeline.sourceFrames || frames.fps !== timeline.fps) {
        throw new Error(EXPORT_SOURCE_DOES_NOT_MATCH_ITS_DECLARED_FRAME);
    }
    let journal: ReturnType<typeof mediaJournalSchema.parse> | undefined;
    try {
        journal = mediaJournalSchema.parse(
            JSON.parse(await fs.readFile(path.join(root, 'media-events.json'), 'utf8')),
        );
        if (journal.sourceSha256 !== timeline.sourceSha256) {
            throw new Error(ACTION_JOURNAL_BELONGS_TO_A_DIFFERENT_SOURCE_RECORDING);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    return {root, raw, video, timeline, indices, frames, journal};
}

export function exportHighlights(
    input: Awaited<ReturnType<typeof loadExport>>,
    requested?: boolean,
) {
    return requested ?? Boolean(input.timeline.annotations?.filters.length);
}
