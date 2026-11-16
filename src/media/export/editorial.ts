import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {z} from 'zod';

import {MAX_EDITORIAL_CUTS, MAX_MEDIA_ACTIVITIES, MIX_SAMPLE_RATE} from '../config.js';
import {
    MILLISECONDS_PER_SECOND,
    PRIVATE_DIRECTORY_MODE,
    PRIVATE_FILE_MODE,
} from '../../shared/config.js';
import {
    ACTION_AND_STEP_SELECTION_REQUIRES_THE_ORIGINAL_SYNCHRONIZED,
    EDITORIAL_SOURCE_MUST_MATCH_ITS_EXPORT_TIMELINE,
    SELECTED_INTERVAL_IS_OUTSIDE_THE_INPUT_VIDEO,
    SELECTION_MUST_PRODUCE_A_NONEMPTY_RESULT_AND_CUTS,
    SELECTION_REFERENCES_AN_UNOBSERVED_ACTION_OR_STEP,
} from '../messages.js';
import {writePrivateJson} from '../../shared/private-files.js';
import {scanFrames, sha256} from '../recording/recording.js';
import {ffmpeg} from '../recording/process.js';
import {buildFrameMap} from '../timeline/time-map.js';
import {renderMappedVideo} from '../timeline/render-mapped-video.js';
import {type CaptionCue, remapCaptions, webVtt} from '../audio/captions.js';

import {exportHighlights, loadExport} from './export-input.js';

const idList = z.array(z.number().int().positive()).min(1).max(MAX_MEDIA_ACTIVITIES);
export const clipRangeSchema = z.union([
    z
        .object({startMs: z.number().finite().nonnegative(), endMs: z.number().finite().positive()})
        .strict(),
    z.object({actionIds: idList}).strict(),
    z.object({stepIds: idList}).strict(),
]);
export type EditorialCut = z.infer<typeof clipRangeSchema>;
export const editorialCutsSchema = z.array(clipRangeSchema).min(1).max(MAX_EDITORIAL_CUTS);

export async function editVideo(options: {
    input: string;
    output: string;
    cuts: EditorialCut[];
    highlights?: boolean;
    signal?: AbortSignal;
}) {
    return renderSelectedExport(options, 'remove');
}

// Both author cuts and requested clips use the same frame/audio/caption mapping.
export async function renderSelectedExport(
    options: Parameters<typeof editVideo>[0],
    mode: 'remove' | 'keep',
) {
    const cuts = editorialCutsSchema.parse(options.cuts);
    const input = await loadExport(options.input, options.signal);
    const video = await scanFrames(input.video, undefined, {
        allowAudio: true,
        signal: options.signal,
    });
    const fps = input.timeline.fps;
    if (video.fps !== fps || video.frameCount !== input.indices.length) {
        throw new Error(EDITORIAL_SOURCE_MUST_MATCH_ITS_EXPORT_TIMELINE);
    }
    const selected = resolveCuts(cuts, input);
    const kept = input.indices
        .map((_, index) => index)
        .filter((index) => selected.has(index) === (mode === 'keep'));
    if (!kept.length || (mode === 'remove' && kept.length === input.indices.length)) {
        throw new Error(SELECTION_MUST_PRODUCE_A_NONEMPTY_RESULT_AND_CUTS);
    }
    const cutMap = buildFrameMap(kept);
    const output = path.resolve(options.output);
    await fs.mkdir(output, {mode: PRIVATE_DIRECTORY_MODE});
    let audioFile: string | undefined;
    if (video.hasAudio) {
        audioFile = path.join(output, 'audio.wav');
        const split =
            cutMap.length > 1
                ? `[0:a:0]asplit=${cutMap.length}${cutMap.map((_, index) => `[s${index}]`).join('')};`
                : '';
        const trim = cutMap
            .map(
                (segment, index) =>
                    `${cutMap.length > 1 ? `[s${index}]` : '[0:a:0]'}atrim=start=${segment.sourceStart / fps}:end=${segment.sourceEnd / fps},asetpts=PTS-STARTPTS[a${index}]`,
            )
            .join(';');
        const concat = `${cutMap.map((_, index) => `[a${index}]`).join('')}concat=n=${cutMap.length}:v=0:a=1,apad=whole_dur=${kept.length / fps},atrim=duration=${kept.length / fps}[audio]`;
        await ffmpeg(
            [
                '-v',
                'error',
                '-i',
                input.video,
                '-filter_complex',
                `${split}${trim};${concat}`,
                '-map',
                '[audio]',
                '-ac',
                '1',
                '-ar',
                String(MIX_SAMPLE_RATE),
                '-c:a',
                'pcm_s16le',
                audioFile,
            ],
            undefined,
            undefined,
            options.signal,
        );
    }
    const raw = path.join(output, 'raw.webm');
    await fs.copyFile(input.raw, raw, constants.COPYFILE_EXCL);
    const sourceRefs = kept.map((index) => input.indices[index]);
    const rendered = await renderMappedVideo({
        input: raw,
        output: path.join(output, 'video.webm'),
        frameRefs: sourceRefs,
        fps,
        sourceFrames: input.frames.frames,
        videoWidth: input.frames.width,
        videoHeight: input.frames.height,
        journal: exportHighlights(input, options.highlights) ? input.journal : undefined,
        protection: input.timeline.protection,
        layout: input.timeline.layout,
        audioFile,
        signal: options.signal,
    });
    let captions: ReturnType<typeof remapCaptions> | undefined;
    try {
        const cues = JSON.parse(
            await fs.readFile(path.join(input.root, 'captions.json'), 'utf8'),
        ) as CaptionCue[];
        captions = remapCaptions(cues, cutMap, fps);
        await fs.writeFile(path.join(output, 'captions.vtt'), webVtt(captions.cues), {
            flag: 'wx',
            mode: PRIVATE_FILE_MODE,
        });
        writePrivateJson(path.join(output, 'captions.json'), captions.cues);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    if (input.journal) {
        writePrivateJson(path.join(output, 'media-events.json'), input.journal);
    }
    const audioSha256 = audioFile ? await sha256(audioFile, options.signal) : undefined;
    const timeline = {
        sourceSha256: input.timeline.sourceSha256,
        fps,
        sourceFrames: input.timeline.sourceFrames,
        protection: input.timeline.protection,
        layout: input.timeline.layout,
        videoSha256: await sha256(path.join(output, 'video.webm'), options.signal),
        audioSha256,
        outputFrames: kept.length,
        segments: rendered.frameMap,
        annotations: rendered.annotations,
        captions: captions?.cues,
    };
    writePrivateJson(path.join(output, 'timeline.json'), timeline);
    const manifest = {
        parentVideoSha256: input.timeline.videoSha256,
        cuts,
        cutMap,
        sourceFrames: input.indices.length,
        outputFrames: kept.length,
        partialCaptionCues: captions?.partial ?? [],
        requiresAuthorReview: true,
        videoSha256: timeline.videoSha256,
        audioSha256,
        fps,
        width: video.width,
        height: video.height,
    };
    if (mode === 'remove') {
        writePrivateJson(path.join(output, 'edit-manifest.json'), manifest);
    }
    return manifest;
}

function resolveCuts(cuts: EditorialCut[], input: Awaited<ReturnType<typeof loadExport>>) {
    const fps = input.timeline.fps;
    const excluded = new Set<number>();
    const excludeTime = (start: number, end: number) => {
        if (end <= start || end > (input.indices.length / fps) * MILLISECONDS_PER_SECOND + 1) {
            throw new Error(SELECTED_INTERVAL_IS_OUTSIDE_THE_INPUT_VIDEO);
        }
        for (
            let frame = Math.floor((start / MILLISECONDS_PER_SECOND) * fps);
            frame < Math.ceil((end / MILLISECONDS_PER_SECOND) * fps);
            frame++
        ) {
            excluded.add(frame);
        }
    };
    for (const cut of cuts) {
        if ('startMs' in cut) {
            excludeTime(cut.startMs, cut.endMs);
            continue;
        }
        if (!input.journal || !input.timeline.protection) {
            throw new Error(ACTION_AND_STEP_SELECTION_REQUIRES_THE_ORIGINAL_SYNCHRONIZED);
        }
        const selected =
            'actionIds' in cut
                ? input.journal.actions.filter(
                      (action) => action.id !== undefined && cut.actionIds.includes(action.id),
                  )
                : input.journal.actions.filter(
                      (action) => action.step !== undefined && cut.stepIds.includes(action.step),
                  );
        const resolved = new Set(
            selected.map((action) => ('actionIds' in cut ? action.id : action.step)),
        );
        if (('actionIds' in cut ? cut.actionIds : cut.stepIds).some((id) => !resolved.has(id))) {
            throw new Error(SELECTION_REFERENCES_AN_UNOBSERVED_ACTION_OR_STEP);
        }
        for (const action of selected) {
            const start =
                ((action.target?.atMs ?? action.startMs) / MILLISECONDS_PER_SECOND -
                    input.timeline.protection.offsetSeconds) *
                fps;
            const end =
                (action.endMs / MILLISECONDS_PER_SECOND - input.timeline.protection.offsetSeconds) *
                fps;
            input.indices.forEach((source, index) => {
                if (
                    source >= Math.floor(start) &&
                    source < Math.max(Math.ceil(end), Math.floor(start) + 1)
                ) {
                    excluded.add(index);
                }
            });
        }
    }
    return excluded;
}
