import {createHash} from 'node:crypto';
import fs from 'node:fs';

import {MAX_FRAMES, MAX_VIDEO_FPS} from '../config.js';
import {
    EXPECTED_A_CONTINUOUS_CONSTANT_RATE_RECORDING,
    OPTIMIZATION_ACCEPTS_SILENT_BROWSER_RECORDINGS_ONLY_AUDIO_NEEDS,
    UNSUPPORTED_VIDEO_TIME_BASE,
} from '../messages.js';
import {
    FRAME_DIMENSIONS_PATTERN,
    FRAME_TIMEBASE_PATTERN,
    PLAYWRIGHT_RECORDING_ID_PATTERN,
} from '../patterns.js';
import {mediaCancelledError, throwIfMediaAborted} from '../cancellation.js';

import {ffmpeg} from './process.js';
import {type Frame, FrameTable} from './frame-table.js';

export async function sha256(file: string, signal?: AbortSignal): Promise<string> {
    throwIfMediaAborted(signal);
    const hash = createHash('sha256');
    try {
        for await (const chunk of fs.createReadStream(file, {signal})) {
            hash.update(chunk);
        }
    } catch (error) {
        if (signal?.aborted) {
            throw mediaCancelledError();
        }
        throw error;
    }
    throwIfMediaAborted(signal);
    return hash.digest('hex');
}

export async function scanFrames(
    file: string,
    filter?: string,
    options: {allowAudio?: boolean; signal?: AbortSignal; onFrame?: (frame: Frame) => void} = {},
) {
    let fps = 0;
    let width = 0;
    let height = 0;
    let frameCount = 0;
    let previousIndex = -1;
    const diagnostics = await ffmpeg(
        [
            '-hide_banner',
            '-threads',
            '2',
            '-i',
            file,
            '-map',
            '0:v:0',
            '-an',
            ...(filter ? ['-vf', filter] : []),
            '-fps_mode',
            'passthrough',
            '-f',
            'framemd5',
            '-',
        ],
        (line) => {
            const base = FRAME_TIMEBASE_PATTERN.exec(line);
            if (base) {
                fps = Number(base[2]) / Number(base[1]);
            }
            const dimensions = FRAME_DIMENSIONS_PATTERN.exec(line);
            if (dimensions) {
                width = Number(dimensions[1]);
                height = Number(dimensions[2]);
            }
            if (line.startsWith('#') || !line.trim()) {
                return;
            }
            const fields = line.split(',').map((field) => field.trim());
            const index = Number(fields[2]);
            if (
                fields.length !== 6 ||
                !Number.isSafeInteger(index) ||
                index < 0 ||
                previousIndex >= index ||
                (!filter && index !== frameCount) ||
                Number(fields[3]) !== 1 ||
                !PLAYWRIGHT_RECORDING_ID_PATTERN.test(fields[5]) ||
                frameCount >= MAX_FRAMES
            ) {
                throw new Error(EXPECTED_A_CONTINUOUS_CONSTANT_RATE_RECORDING);
            }
            options.onFrame?.({index, hash: fields[5]});
            previousIndex = index;
            frameCount++;
        },
        undefined,
        options.signal,
    );
    if (diagnostics.hasAudio && !options.allowAudio) {
        throw new Error(OPTIMIZATION_ACCEPTS_SILENT_BROWSER_RECORDINGS_ONLY_AUDIO_NEEDS);
    }
    if (!frameCount || !Number.isFinite(fps) || fps <= 0 || fps > MAX_VIDEO_FPS) {
        throw new Error(UNSUPPORTED_VIDEO_TIME_BASE);
    }
    return {fps, width, height, frameCount, hasAudio: diagnostics.hasAudio};
}

// Compatibility API for callers that explicitly need an eager object array.
export async function readFrames(
    file: string,
    filter?: string,
    options: {allowAudio?: boolean; signal?: AbortSignal} = {},
) {
    const frames: Frame[] = [];
    const metadata = await scanFrames(file, filter, {
        ...options,
        onFrame: (frame) => frames.push(frame),
    });
    return {...metadata, frames};
}

export async function readFrameTable(
    file: string,
    options: {allowAudio?: boolean; signal?: AbortSignal} = {},
) {
    const frames = new FrameTable();
    const metadata = await scanFrames(file, undefined, {
        ...options,
        onFrame: (frame) => frames.push(frame),
    });
    return {...metadata, frames};
}
