import type {FrameMapSegment} from '../timeline/time-map.js';

import fs from 'node:fs';

import {PCM_COPY_BUFFER_BYTES} from '../config.js';
import {PRIVATE_FILE_MODE} from '../../shared/config.js';
import {EDITORIAL_AUDIO_IS_SHORTER_THAN_ITS_VIDEO} from '../messages.js';
import {throwIfMediaAborted} from '../cancellation.js';
import {MIX_SAMPLE_RATE as SAMPLE_RATE, pcmWaveHeader as waveHeader} from '../audio/audio.js';

export function writeEditorialAudio(
    input: string,
    output: string,
    map: FrameMapSegment[],
    fps: number,
    signal?: AbortSignal,
) {
    const samples = Math.ceil((map[map.length - 1].outputEnd / fps) * SAMPLE_RATE);
    const source = fs.openSync(input, 'r');
    let target: number | undefined;
    try {
        target = fs.openSync(output, 'wx', PRIVATE_FILE_MODE);
        fs.writeSync(target, waveHeader(samples));
        fs.ftruncateSync(target, 44 + samples * 2);
        const buffer = Buffer.alloc(PCM_COPY_BUFFER_BYTES);
        for (const segment of map) {
            const start = Math.round((segment.sourceStart / fps) * SAMPLE_RATE);
            const outputStart = Math.round((segment.outputStart / fps) * SAMPLE_RATE);
            const outputEnd =
                segment.outputEnd === map[map.length - 1].outputEnd
                    ? samples
                    : Math.round((segment.outputEnd / fps) * SAMPLE_RATE);
            let bytes = (outputEnd - outputStart) * 2;
            let offset = 0;
            while (bytes > 0) {
                throwIfMediaAborted(signal);
                const length = Math.min(bytes, buffer.length);
                buffer.fill(0, 0, length);
                const read = fs.readSync(source, buffer, 0, length, 44 + start * 2 + offset);
                // Rounding at a frame boundary can require one final silent sample.
                if (read < length - 2) {
                    throw new Error(EDITORIAL_AUDIO_IS_SHORTER_THAN_ITS_VIDEO);
                }
                fs.writeSync(target, buffer, 0, length, 44 + outputStart * 2 + offset);
                offset += length;
                bytes -= length;
            }
        }
    } finally {
        fs.closeSync(source);
        if (target !== undefined) {
            fs.closeSync(target);
        }
    }
}
