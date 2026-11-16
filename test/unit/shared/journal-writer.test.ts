import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';

import {JournalPersistenceError, JournalWriter} from '../../../src/shared/journal-writer.js';
import {MediaRecorder} from '../../../src/media/recording/journal.js';

const directories: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
        directories.splice(0).map((directory) => fs.rm(directory, {recursive: true, force: true})),
    );
});
async function fixture() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-test-'));
    directories.push(directory);
    return directory;
}

it('captures immutable snapshots and persists appends in order with private permissions', async () => {
    const directory = await fixture();
    const writer = new JournalWriter();
    const snapshot = {actions: [1]};
    const file = path.join(directory, 'manifest.json');
    const events = path.join(directory, 'events.jsonl');
    writer.snapshot(file, snapshot);
    writer.append(events, {id: 1});
    snapshot.actions.push(2);
    await writer.flush();
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({actions: [1]});
    writer.snapshot(file, snapshot);
    writer.append(events, {id: 2});
    await writer.flush();
    expect(await fs.readFile(events, 'utf8')).toBe('{"id":1}\n{"id":2}\n');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(snapshot);
    if (process.platform !== 'win32') {
        expect((await fs.stat(file)).mode % 0o1000).toBe(0o600);
        expect((await fs.stat(events)).mode % 0o1000).toBe(0o600);
    }
    expect((await fs.readdir(directory)).sort()).toEqual(['events.jsonl', 'manifest.json']);
});

it('coalesces a synchronous snapshot burst and drains writes added during persistence', async () => {
    const directory = await fixture();
    const writer = new JournalWriter();
    const rename = vi.spyOn(fs, 'rename');
    for (let id = 0; id < 100; id++) {
        writer.snapshot(path.join(directory, 'snapshot.json'), {id});
    }
    const flush = writer.flush();
    writer.append(path.join(directory, 'events.jsonl'), {done: true});
    await flush;
    expect(rename).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(path.join(directory, 'snapshot.json'), 'utf8'))).toEqual({
        id: 99,
    });
    expect(await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8')).toContain('true');
});

it('retains the old atomic snapshot after failure, drains later files and reports a sticky error', async () => {
    const directory = await fixture();
    const file = path.join(directory, 'snapshot.json');
    await fs.writeFile(file, '{"id":1}');
    const writer = new JournalWriter();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated IO failure'));
    writer.snapshot(file, {id: 2});
    writer.append(path.join(directory, 'events.jsonl'), {failure: true});
    await expect(writer.flush()).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(await fs.readFile(file, 'utf8')).toBe('{"id":1}');
    expect(await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8')).toContain('true');
    expect((await fs.readdir(directory)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
    await expect(writer.flush()).rejects.toBeInstanceOf(JournalPersistenceError);
});

it('finalizes media only after the last clock, action and source hash are durable', async () => {
    const directory = await fixture();
    const recording = path.join(directory, 'raw.webm');
    await fs.writeFile(recording, 'synthetic recording');
    const recorder = new MediaRecorder(directory);
    recorder.clock({recording: 'raw.webm', startMs: 1, endMs: 2});
    recorder.record({
        kind: 'interaction',
        tool: 'browser_click',
        outcome: 'returned',
        startMs: 3,
        endMs: 4,
    });
    await recorder.finalize(recording);
    const journal = JSON.parse(
        await fs.readFile(path.join(directory, 'media-events.json'), 'utf8'),
    );
    expect(journal.clocks).toHaveLength(1);
    expect(journal.actions[0]).toMatchObject({id: 1, outcome: 'returned'});
    expect(journal.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
});
