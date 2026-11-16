import type {AudioClip} from './audio.js';

import {z} from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';

import {
    MILLISECONDS_PER_HOUR,
    MILLISECONDS_PER_MINUTE,
    MILLISECONDS_PER_SECOND,
    PRIVATE_DIRECTORY_MODE,
    PRIVATE_FILE_MODE,
} from '../../shared/config.js';
import {
    CAPTION_CUES_MUST_BE_ORDERED_AND_MUST_NOT,
    CAPTION_INTERVAL_EXCEEDS_THE_EXPORTED_VIDEO,
    CAPTION_MAPPING_REQUIRES_A_POSITIVE_FRAME_RATE,
} from '../messages.js';
import {
    LESS_THAN_PATTERN as CAPTIONS_WEB_VTT_PATTERN,
    AMPERSAND_PATTERN as WEB_VTT_PATTERN,
    GREATER_THAN_PATTERN as WEB_VTT_PATTERN_2,
} from '../patterns.js';
import {MAX_CAPTION_CHARS, MAX_MEDIA_ACTIVITIES} from '../config.js';
import {writePrivateJson} from '../../shared/private-files.js';
import {loadExport} from '../export/export-input.js';
import {type FrameMapSegment, validateFrameMap} from '../timeline/time-map.js';

import {audioDuration} from './audio.js';

export const captionSchema = z
    .object({
        startMs: z.number().finite().nonnegative(),
        endMs: z.number().finite().positive(),
        text: z.string().trim().min(1).max(MAX_CAPTION_CHARS),
    })
    .strict();
export type CaptionCue = z.infer<typeof captionSchema>;

export function validateCaptions(value: unknown): CaptionCue[] {
    const cues = z.array(captionSchema).max(MAX_MEDIA_ACTIVITIES).parse(value);
    let end = 0;
    for (const cue of cues) {
        if (cue.startMs < end || cue.endMs <= cue.startMs) {
            throw new Error(CAPTION_CUES_MUST_BE_ORDERED_AND_MUST_NOT);
        }
        end = cue.endMs;
    }
    return cues;
}

export function vttTime(milliseconds: number): string {
    const value = Math.round(milliseconds);
    return `${String(Math.floor(value / MILLISECONDS_PER_HOUR)).padStart(2, '0')}:${String(Math.floor(value / MILLISECONDS_PER_MINUTE) % 60).padStart(2, '0')}:${String(Math.floor(value / MILLISECONDS_PER_SECOND) % 60).padStart(2, '0')}.${String(value % MILLISECONDS_PER_SECOND).padStart(3, '0')}`;
}

export function webVtt(cues: CaptionCue[]): string {
    return (
        'WEBVTT\n\n' +
        validateCaptions(cues)
            .map((cue, index) => {
                const text = cue.text
                    .replace(WEB_VTT_PATTERN, '&amp;')
                    .replace(CAPTIONS_WEB_VTT_PATTERN, '&lt;')
                    .replace(WEB_VTT_PATTERN_2, '&gt;');
                return `${index + 1}\n${vttTime(cue.startMs)} --> ${vttTime(cue.endMs)}\n${text}\n`;
            })
            .join('\n')
    );
}

export function speechCaption(text: string, clip: AudioClip, offsetMs: number): CaptionCue {
    return captionSchema.parse({text, startMs: offsetMs, endMs: offsetMs + audioDuration(clip)});
}

export function remapCaptions(cues: CaptionCue[], frameMap: FrameMapSegment[], fps: number) {
    validateCaptions(cues);
    validateFrameMap(frameMap);
    if (!Number.isFinite(fps) || fps <= 0) {
        throw new Error(CAPTION_MAPPING_REQUIRES_A_POSITIVE_FRAME_RATE);
    }
    const result: CaptionCue[] = [];
    const partial: number[] = [];
    for (const [index, cue] of cues.entries()) {
        const start = Math.floor((cue.startMs * fps) / MILLISECONDS_PER_SECOND);
        const end = Math.ceil((cue.endMs * fps) / MILLISECONDS_PER_SECOND);
        const {mapped, retained} = remapCue(cue, start, end, frameMap, fps);
        result.push(...mapped);
        if (retained > 0 && retained < end - start) {
            partial.push(index);
        }
    }
    return {cues: validateCaptions(result), partial};
}

export async function exportCaptions(options: {input: string; output: string; cues: CaptionCue[]}) {
    const source = await loadExport(options.input);
    const cues = validateCaptions(options.cues);
    if (
        cues.some(
            (cue) =>
                cue.endMs >
                (source.timeline.outputFrames / source.timeline.fps) * MILLISECONDS_PER_SECOND,
        )
    ) {
        throw new Error(CAPTION_INTERVAL_EXCEEDS_THE_EXPORTED_VIDEO);
    }
    const output = path.resolve(options.output);
    await fs.mkdir(output, {mode: PRIVATE_DIRECTORY_MODE});
    for (const name of [
        'raw.webm',
        'video.webm',
        'timeline.json',
        'media-events.json',
        'audio.wav',
    ]) {
        try {
            await fs.copyFile(
                path.join(source.root, name),
                path.join(output, name),
                constants.COPYFILE_EXCL,
            );
        } catch (error) {
            if (
                !['media-events.json', 'audio.wav'].includes(name) ||
                (error as NodeJS.ErrnoException).code !== 'ENOENT'
            ) {
                throw error;
            }
        }
    }
    await fs.writeFile(path.join(output, 'captions.vtt'), webVtt(cues), {
        flag: 'wx',
        mode: PRIVATE_FILE_MODE,
    });
    writePrivateJson(path.join(output, 'captions.json'), cues);
    return source.timeline;
}

function remapCue(
    cue: CaptionCue,
    start: number,
    end: number,
    frameMap: FrameMapSegment[],
    fps: number,
) {
    const mapped: CaptionCue[] = [];
    let retained = 0;
    for (const segment of frameMap) {
        const a = Math.max(start, segment.sourceStart);
        const b = Math.min(end, segment.sourceEnd);
        if (a >= b) {
            continue;
        }
        retained += b - a;
        const held = segment.sourceEnd - segment.sourceStart === 1;
        mapped.push({
            text: cue.text,
            startMs:
                ((held ? segment.outputStart : segment.outputStart + a - segment.sourceStart) /
                    fps) *
                MILLISECONDS_PER_SECOND,
            endMs:
                ((held ? segment.outputEnd : segment.outputStart + b - segment.sourceStart) / fps) *
                MILLISECONDS_PER_SECOND,
        });
    }

    return {mapped, retained};
}
