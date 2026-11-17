import {beforeEach, expect, it, vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {FrameTable, frameHash} from '../../../src/media/recording/frame-table.js';
import {readFrameTable, readFrames, scanFrames} from '../../../src/media/recording/recording.js';
import {ffmpeg} from '../../../src/media/recording/process.js';
import {
    buildFrameMap,
    expandFrameMap,
    packedFrameRefs,
} from '../../../src/media/timeline/time-map.js';
import {FRAME_TABLE_CHUNK_SIZE} from '../../../src/media/config.js';
import {fitAudio, fitAudioPacked} from '../../../src/media/audio/narration-time.js';
import {renderMappedVideo} from '../../../src/media/timeline/render-mapped-video.js';

vi.mock('../../../src/media/recording/process.js', () => ({ffmpeg: vi.fn()}));
const hash = (index: number) => index.toString(16).padStart(32, '0');
beforeEach(() => vi.mocked(ffmpeg).mockReset());
function stream(indices = [0, 1, 2]) {
    vi.mocked(ffmpeg).mockImplementation(async (_args, onLine) => {
        onLine?.('#tb 0: 1/25');
        onLine?.('#dimensions 0: 1280x720');
        for (const index of indices) {
            onLine?.(`0, ${index}, ${index}, 1, 42, ${hash(index)}`);
        }
        return {hasAudio: false};
    });
}

it('keeps exact hashes and indices across chunk boundaries without per-frame objects', () => {
    const table = new FrameTable();
    for (let index = 0; index <= FRAME_TABLE_CHUNK_SIZE; index++) {
        table.push({index, hash: hash(index)});
    }
    expect(table.length).toBe(FRAME_TABLE_CHUNK_SIZE + 1);
    expect(table.byteLength).toBe(2 * FRAME_TABLE_CHUNK_SIZE * 20);
    for (const index of [0, FRAME_TABLE_CHUNK_SIZE - 1, FRAME_TABLE_CHUNK_SIZE]) {
        expect(table.index(index)).toBe(index);
        expect(frameHash(table, index)).toBe(hash(index));
    }
    expect(table.hash(-1)).toBeUndefined();
    expect(table.hash(table.length)).toBeUndefined();
    expect(() => table.push({index: 1, hash: hash(1)})).toThrow();
    expect(() => table.push({index: table.length, hash: 'invalid'})).toThrow();
});

it('streams frame verification and preserves the eager public API', async () => {
    stream();
    const eager = await readFrames('fixture');
    const packed = await readFrameTable('fixture');
    const seen: number[] = [];
    const stats = await scanFrames('fixture', undefined, {
        onFrame: (frame) => seen.push(frame.index),
    });
    expect(eager.frames.map((frame) => frame.hash)).toEqual([hash(0), hash(1), hash(2)]);
    expect(packed.frames.hash(2)).toBe(eager.frames[2].hash);
    expect(stats).toMatchObject({fps: 25, width: 1280, height: 720, frameCount: 3});
    expect(stats).not.toHaveProperty('frames');
    expect(seen).toEqual([0, 1, 2]);
});

it('rejects discontinuities, reordered frames, audio and failures of a streaming verifier', async () => {
    stream([0, 2]);
    await expect(scanFrames('fixture')).rejects.toThrow();
    await expect(scanFrames('fixture', 'selection')).resolves.toMatchObject({frameCount: 2});
    stream([1, 0]);
    await expect(scanFrames('fixture', 'selection')).rejects.toThrow();
    stream();
    await expect(
        scanFrames('fixture', undefined, {
            onFrame: () => {
                throw new Error('hash mismatch');
            },
        }),
    ).rejects.toThrow('hash mismatch');
    vi.mocked(ffmpeg).mockResolvedValue({hasAudio: true});
    await expect(scanFrames('fixture')).rejects.toThrow('silent');
});

it('builds the same monotonic range map for packed refs, including adjacent holds and cuts', () => {
    const refs = [0, 1, 1, 1, 2, 3, 7, 7, 8];
    const map = buildFrameMap(refs);
    expect(buildFrameMap(Uint32Array.from(refs))).toEqual(map);
    expect([...packedFrameRefs(map)]).toEqual(expandFrameMap(map));
    expect(() => buildFrameMap(Uint32Array.from([1, 0]))).toThrow();
});

it('fits narration with packed counts and holds while preserving the public array contract', () => {
    const input = {
        indices: [0, 1, 2, 3],
        timeline: {fps: 10, sourceFrames: 10, protection: {markers: []}},
    };
    const windows = [
        {
            id: 1,
            first: 0,
            last: 1,
            start: 0,
            end: 4,
            anchorFrame: 0,
            evidenceFrame: 3,
            ranges: [{start: 0, end: 4}],
        },
    ];
    const audio = new Map([[1, {durationMs: 300}]]);
    const options = {surroundingSeconds: 1, maxHoldSeconds: 1};
    const packed = fitAudioPacked(input, windows, audio, options);
    const eager = fitAudio(input, windows, audio, options);
    expect([...packed.frameRefs]).toEqual([0, 1, 2, 3, 3]);
    expect(Array.isArray(eager.frameRefs)).toBe(true);
    expect(eager.frameRefs).toEqual([...packed.frameRefs]);
    expect(eager.placements).toEqual(packed.placements);
    expect(() => fitAudioPacked({...input, indices: [0, 11]}, windows, audio, options)).toThrow();
});

it('verifies every retained hash/order before decoration and streams the final frame count', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mapped-verification-'));
    try {
        const input = path.join(directory, 'raw.webm');
        await fs.writeFile(input, 'unchanged raw recording');
        const frames = new FrameTable();
        frames.push({index: 0, hash: hash(0)});
        frames.push({index: 1, hash: hash(1)});
        const options = {
            input,
            output: path.join(directory, 'video.webm'),
            frameRefs: Uint32Array.from([0, 0, 1]),
            sourceFrames: frames,
            fps: 25,
            videoWidth: 1280,
            videoHeight: 720,
        };
        const render = (tamper: boolean, finalCount = 3) => {
            vi.mocked(ffmpeg)
                .mockReset()
                .mockImplementationOnce(async (_args, onLine) => {
                    for (const [index, source] of [0, 0, 1].entries()) {
                        onLine?.(
                            `0, ${index}, ${index}, 1, 42, ${hash(tamper && index === 1 ? 1 : source)}`,
                        );
                    }
                    return {hasAudio: false};
                })
                .mockImplementationOnce(async (_args, onLine) => {
                    onLine?.('#tb 0: 1/25');
                    for (let index = 0; index < finalCount; index++) {
                        onLine?.(`0, ${index}, ${index}, 1, 42, ${hash(index)}`);
                    }
                    return {hasAudio: false};
                });
        };
        render(false);
        await expect(renderMappedVideo(options)).resolves.toMatchObject({
            retainedFramesVerified: true,
        });
        render(true);
        await expect(renderMappedVideo(options)).rejects.toThrow('order');
        expect(ffmpeg).toHaveBeenCalledTimes(1);
        render(false, 2);
        await expect(renderMappedVideo(options)).rejects.toThrow('count');
        expect(await fs.readFile(input, 'utf8')).toBe('unchanged raw recording');
        expect((await fs.readdir(directory)).some((file) => file.endsWith('.filter.txt'))).toBe(
            false,
        );
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});
