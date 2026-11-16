import path from 'node:path';
import {z} from 'zod';

import {MILLISECONDS_PER_SECOND} from '../../shared/config.js';
import {GIF_OPTIONS_MAY_REDUCE_SOURCE_FPS_AND_WIDTH} from '../messages.js';
import {writePrivateJson} from '../../shared/private-files.js';
import {ffmpeg} from '../recording/process.js';
import {sha256} from '../recording/recording.js';

import {clipRangeSchema, renderSelectedExport} from './editorial.js';

export const clipOptionsSchema = z
    .object({
        range: clipRangeSchema,
        format: z.enum(['webm', 'gif']).default('webm'),
        fps: z.number().positive().optional(),
        width: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
        (options) =>
            options.format === 'gif' || (options.fps === undefined && options.width === undefined),
        'FPS and width are GIF options; WebM preserves source dimensions and timing',
    );
export type ClipOptions = z.input<typeof clipOptionsSchema>;

export async function exportClip(
    options: ClipOptions & {input: string; output: string; signal?: AbortSignal},
) {
    const {input, output, signal, ...requested} = options;
    signal?.throwIfAborted();
    const settings = clipOptionsSchema.parse(requested);
    const rendered = await renderSelectedExport(
        {input, output, cuts: [settings.range], signal},
        'keep',
    );
    const fps = settings.fps ?? Math.min(15, rendered.fps);
    const width = settings.width ?? rendered.width;
    if (settings.format === 'gif' && (fps > rendered.fps || width > rendered.width)) {
        throw new Error(GIF_OPTIONS_MAY_REDUCE_SOURCE_FPS_AND_WIDTH);
    }
    const file = settings.format === 'gif' ? 'clip.gif' : 'video.webm';
    const target = path.join(path.resolve(output), file);
    if (settings.format === 'gif') {
        const filter =
            `[0:v]fps=${fps}:round=up,scale=${width}:-1:flags=lanczos,split[image][colors];` +
            '[colors]palettegen[palette];[image][palette]paletteuse=dither=sierra2_4a[gif]';
        await ffmpeg(
            [
                '-v',
                'error',
                '-threads',
                '2',
                '-i',
                path.join(path.resolve(output), 'video.webm'),
                '-filter_complex',
                filter,
                '-map',
                '[gif]',
                '-an',
                '-loop',
                '0',
                '-n',
                target,
            ],
            undefined,
            undefined,
            signal,
        );
    }
    const manifest = {
        parentVideoSha256: rendered.parentVideoSha256,
        range: settings.range,
        format: settings.format,
        file,
        sha256: await sha256(target, signal),
        sourceFps: rendered.fps,
        sourceFrames: rendered.sourceFrames,
        outputFrames: rendered.outputFrames,
        durationMs: (rendered.outputFrames / rendered.fps) * MILLISECONDS_PER_SECOND,
        segments: rendered.cutMap,
        ...(settings.format === 'gif' ? {gif: {fps, width}} : {}),
        partialCaptionCues: rendered.partialCaptionCues,
    };
    writePrivateJson(path.join(path.resolve(output), 'clip-manifest.json'), manifest);
    return manifest;
}
