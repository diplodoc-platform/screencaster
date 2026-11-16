import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {FrameTable} from '../build/media/recording/frame-table.js';
import {readFrameTable, readFrames} from '../build/media/recording/recording.js';
import {ffmpeg} from '../build/media/recording/process.js';
import {optimizeVideo} from '../build/media/export/montage.js';
import {writePrivateJson} from '../build/shared/private-files.js';
import {JournalWriter} from '../build/shared/journal-writer.js';

const FRAME_COUNT = 1_000_000;
const JOURNAL_ACTION_COUNT = 4_000;
const JOURNAL_WRITE_COUNT = 100;
const JOURNAL_BATCH_SIZE = 20;
const VIDEO_SECONDS = 1800;
const VIDEO_FPS = 25;
const MIB = 1024 * 1024;
const mode = process.argv[2];

function memory() {
    const {heapUsed, external} = process.memoryUsage();
    return heapUsed + external;
}
function hash(index: number) {
    return index.toString(16).padStart(32, '0');
}

if (!mode || mode === '--video') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-video-benchmark-'));
    try {
        const input = path.join(directory, 'recording.webm');
        const modes = [
            'eager-frames',
            'packed-frames',
            'sync-journal',
            'queued-journal',
            'queued-receipts',
        ];
        if (mode === '--video') {
            await ffmpeg([
                '-v',
                'error',
                '-f',
                'lavfi',
                '-i',
                `color=c=gray:size=320x180:rate=${VIDEO_FPS}`,
                '-t',
                String(VIDEO_SECONDS),
                '-c:v',
                'libvpx-vp9',
                '-lossless',
                '1',
                '-cpu-used',
                '8',
                '-threads',
                '2',
                '-n',
                input,
            ]);
            modes.push('eager-video', 'packed-video', 'export-video');
        }
        const results: unknown[] = [];
        for (const selected of modes) {
            const child = spawnSync(
                process.execPath,
                ['--expose-gc', fileURLToPath(import.meta.url), selected, input],
                {encoding: 'utf8'},
            );
            if (child.status !== 0) {
                throw new Error(`Benchmark failed: ${selected}\n${child.stderr}`);
            }
            results.push(JSON.parse(child.stdout));
        }
        process.stdout.write(
            JSON.stringify(
                {node: process.version, platform: `${process.platform}/${process.arch}`, results},
                null,
                2,
            ) + '\n',
        );
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
} else if (mode.endsWith('video')) {
    const input = process.argv[3];
    global.gc?.();
    const before = memory();
    const start = performance.now();
    if (mode === 'export-video') {
        const timeline = await optimizeVideo({
            input,
            output: path.join(path.dirname(input), 'export'),
        });
        process.stdout.write(
            JSON.stringify({
                mode,
                totalMs: performance.now() - start,
                sourceFrames: timeline.sourceFrames,
                outputFrames: timeline.outputFrames,
                fps: timeline.fps,
                retainedFramesVerified: timeline.retainedFramesVerified,
                peakRssMiB: process.resourceUsage().maxRSS / 1024,
            }) + '\n',
        );
    } else {
        const metadata =
            mode === 'eager-video' ? await readFrames(input) : await readFrameTable(input);
        const readMs = performance.now() - start;
        global.gc?.();
        const retainedMiB = (memory() - before) / MIB;
        process.stdout.write(
            JSON.stringify({
                mode,
                frameCount: metadata.frames.length,
                fps: metadata.fps,
                width: metadata.width,
                height: metadata.height,
                readMs,
                retainedMiB,
                peakRssMiB: process.resourceUsage().maxRSS / 1024,
            }) + '\n',
        );
    }
} else if (mode.endsWith('frames')) {
    global.gc?.();
    const before = memory();
    const start = performance.now();
    const frames =
        mode === 'packed-frames' ? new FrameTable() : ([] as {index: number; hash: string}[]);
    for (let index = 0; index < FRAME_COUNT; index++) {
        frames.push({index, hash: hash(index)});
    }
    const storageMs = performance.now() - start;
    const mappingStart = performance.now();
    const refs =
        mode === 'packed-frames'
            ? Uint32Array.from({length: FRAME_COUNT}, (_, index) => index)
            : Array.from({length: FRAME_COUNT}, (_, index) => index);
    const selection =
        mode === 'packed-frames' ? new Uint8Array(FRAME_COUNT).fill(1) : new Set(refs);
    const mappingMs = performance.now() - mappingStart;
    global.gc?.();
    const retainedMiB = (memory() - before) / MIB;
    const verifyStart = performance.now();
    for (let index = 0; index < FRAME_COUNT; index++) {
        const actual = frames instanceof FrameTable ? frames.hash(index) : frames[index].hash;
        if (actual !== hash(refs[index])) {
            throw new Error('Frame hash/order changed');
        }
    }
    const verificationMs = performance.now() - verifyStart;
    process.stdout.write(
        JSON.stringify({
            mode,
            frameCount: frames.length,
            selected: selection instanceof Set ? selection.size : selection.length,
            retainedMiB,
            peakRssMiB: process.resourceUsage().maxRSS / 1024,
            storageMs,
            mappingMs,
            verificationMs,
        }) + '\n',
    );
} else {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-benchmark-'));
    try {
        const file = path.join(directory, 'journal.json');
        const journal = {
            revision: 0,
            actions: Array.from({length: JOURNAL_ACTION_COUNT}, (_, id) => ({
                id,
                tool: 'browser_click',
                outcome: 'returned',
                startMs: id * 10,
                endMs: id * 10 + 1,
                targetNode: 'Synthetic observed control '.repeat(4),
            })),
        };
        const writer = new JournalWriter();
        const batchSize = mode === 'queued-receipts' ? 1 : JOURNAL_BATCH_SIZE;
        let largestTimerDelayMs = 0;
        let previous = performance.now();
        const timer = setInterval(() => {
            const now = performance.now();
            largestTimerDelayMs = Math.max(largestTimerDelayMs, now - previous);
            previous = now;
        }, 1);
        const start = performance.now();
        for (let index = 0; index < JOURNAL_WRITE_COUNT; index++) {
            journal.revision = index;
            if (mode === 'sync-journal') {
                writePrivateJson(file, journal);
            } else {
                writer.snapshot(file, journal);
                if ((index + 1) % batchSize === 0) {
                    await writer.flush();
                }
            }
        }
        await writer.flush();
        const totalMs = performance.now() - start;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        clearInterval(timer);
        if (JSON.parse(await fs.readFile(file, 'utf8')).revision !== JOURNAL_WRITE_COUNT - 1) {
            throw new Error('Final journal revision was not persisted');
        }
        process.stdout.write(
            JSON.stringify({
                mode,
                actions: JOURNAL_ACTION_COUNT,
                snapshots: JOURNAL_WRITE_COUNT,
                batchSize,
                bytes: (await fs.stat(file)).size,
                totalMs,
                largestTimerDelayMs,
                peakRssMiB: process.resourceUsage().maxRSS / 1024,
            }) + '\n',
        );
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
}
