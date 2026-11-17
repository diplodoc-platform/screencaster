import type {MediaActivity} from '../../../src/media/recording/journal.js';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

import {CaptureRun} from '../../../src/application/capture-run.js';
import {BrowserSession} from '../../../src/browser/session.js';
import {BrowserRuntime} from '../../../src/browser/runtime.js';
import {BrowserActionError} from '../../../src/browser/outcome.js';
import {JournalPersistenceError} from '../../../src/shared/journal-writer.js';
import {HostAuthenticationChallengeError} from '../../../src/browser/errors/host-auth-challenge-error.js';
import {MediaRecorder} from '../../../src/media/recording/journal.js';

let directory: string;
let activity: ((value?: MediaActivity) => void) | undefined;
const receipt: MediaActivity = {
    kind: 'interaction',
    tool: 'browser_click',
    outcome: 'returned',
    startMs: 1,
    endMs: 2,
};

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'run-journal-test-'));
    vi.spyOn(BrowserRuntime.prototype, 'start').mockResolvedValue();
    vi.spyOn(BrowserRuntime.prototype, 'goto').mockResolvedValue();
    vi.spyOn(BrowserSession.prototype, 'close').mockResolvedValue(undefined);
    vi.spyOn(BrowserSession.prototype, 'abort').mockResolvedValue();
    vi.spyOn(BrowserRuntime.prototype, 'setMediaActivityObserver').mockImplementation(
        (observer) => {
            activity = observer;
        },
    );
    vi.spyOn(BrowserSession.prototype, 'execute').mockImplementation(async () => {
        activity?.(receipt);
        return {result: {content: []}, snapshot: 'Observed'};
    });
});
afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, {recursive: true, force: true});
});
async function create() {
    return CaptureRun.create({directory: path.join(directory, 'run'), url: 'https://example.test'});
}
async function json(run: CaptureRun, file: string) {
    return JSON.parse(await fs.readFile(path.join(run.directory, file), 'utf8'));
}

it('returns a receipt only after its journal and ordered events are durable', async () => {
    const run = await create();
    expect((await run.action('browser_click', {})).actionId).toBe(1);
    expect((await json(run, 'media-events.json')).actions[0]).toMatchObject({
        id: 1,
        outcome: 'returned',
    });
    expect(await fs.readFile(path.join(run.directory, 'events.jsonl'), 'utf8')).toContain(
        '"actionId":1',
    );
    await run.finish();
    expect((await json(run, 'manifest.json')).status).toBe('completed');
});

it('persists unknown receipt ownership before rejecting, and never dispatches another mutation', async () => {
    const run = await create();
    vi.mocked(run.browser.execute).mockImplementationOnce(async () => {
        activity?.({...receipt, outcome: 'threw'});
        throw new BrowserActionError('Transport lost', 'unknown');
    });
    await expect(run.action('browser_click', {})).rejects.toMatchObject({
        outcome: 'unknown',
        actionId: 1,
    });
    expect((await json(run, 'manifest.json')).unresolvedActions).toEqual([
        {id: 1, tool: 'browser_click'},
    ]);
    const events = (await fs.readFile(path.join(run.directory, 'events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    expect(events.map((event) => event.kind)).toEqual(['action', 'action-error']);
    await expect(run.action('browser_click', {})).rejects.toMatchObject({
        outcome: 'not-dispatched',
    });
    expect(run.browser.execute).toHaveBeenCalledTimes(1);
    await run.abort();
    expect((await json(run, 'manifest.json')).status).toBe('aborted');
});

it('fails closed on persistence errors without losing the mutation outcome or action id', async () => {
    const run = await create();
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (String(to).endsWith('media-events.json')) {
            throw new Error('simulated disk failure');
        }
        await rename(from, to);
    });
    await expect(run.action('browser_click', {})).rejects.toMatchObject({
        outcome: 'unknown',
        actionId: 1,
    });
    expect((await json(run, 'manifest.json')).unresolvedActions).toHaveLength(1);
    await expect(run.action('browser_click', {})).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(run.browser.execute).toHaveBeenCalledTimes(1);
    await expect(run.abort()).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(run.browser.abort).toHaveBeenCalled();
    expect((await json(run, 'manifest.json')).status).toBe('aborted');
});

it('flushes failed finalization and cancelled actions before returning control', async () => {
    const run = await create();
    vi.mocked(run.browser.close).mockRejectedValueOnce(new Error('close failure'));
    expect((await run.finish()).status).toBe('failed');
    expect((await json(run, 'manifest.json')).status).toBe('failed');

    const cancelled = await CaptureRun.create({
        directory: path.join(directory, 'cancelled'),
        url: 'https://example.test',
    });
    const controller = new AbortController();
    vi.mocked(cancelled.browser.execute).mockImplementationOnce(async () => {
        activity?.({...receipt, outcome: 'threw'});
        controller.abort();
        throw new BrowserActionError('Cancelled after dispatch', 'unknown');
    });
    await expect(cancelled.action('browser_click', {}, controller.signal)).rejects.toMatchObject({
        outcome: 'unknown',
    });
    expect((await json(cancelled, 'manifest.json')).status).toBe('aborted');
    expect((await json(cancelled, 'media-events.json')).actions).toHaveLength(1);
    await cancelled.abort();
});

it('still closes the browser when a previous journal write failed', async () => {
    const run = await create();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated disk failure'));
    await expect(run.action('browser_click', {})).rejects.toMatchObject({outcome: 'unknown'});
    await expect(run.finish()).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(run.browser.close).toHaveBeenCalledTimes(1);
    expect((await json(run, 'manifest.json')).status).toBe('failed');
});

it('never assigns an earlier receipt to an unknown action with missing activity evidence', async () => {
    const run = await create();
    await run.action('browser_click', {});
    vi.mocked(run.browser.execute).mockRejectedValueOnce(
        new BrowserActionError('Missing observation', 'unknown'),
    );
    await expect(run.action('browser_click', {})).rejects.toMatchObject({
        outcome: 'unknown',
        actionId: undefined,
    });
    expect((await json(run, 'manifest.json')).status).toBe('failed');
    expect(run.browser.abort).toHaveBeenCalledTimes(1);
    await expect(run.action('browser_click', {})).rejects.toMatchObject({
        outcome: 'not-dispatched',
    });
    expect(run.browser.execute).toHaveBeenCalledTimes(2);
});

it('attempts a failed manifest if final persistence fails after the completed rename', async () => {
    const run = await create();
    const rename = fs.rename.bind(fs);
    let fail = true;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        await rename(from, to);
        if (fail) {
            fail = false;
            throw new Error('simulated failure after rename, before directory sync');
        }
    });
    await expect(run.finish()).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(run.browser.close).toHaveBeenCalledTimes(1);
    expect((await json(run, 'manifest.json')).status).toBe('failed');
});

it('preserves a structured manual challenge and incomplete journal before capture startup', async () => {
    const authenticate = vi
        .fn()
        .mockResolvedValue({status: 'challenge', origin: 'https://example.test', challenge: 'mfa'});
    const runDirectory = path.join(directory, 'challenge');
    await expect(
        CaptureRun.create({
            directory: runDirectory,
            url: 'https://example.test',
            authentication: {allowedOrigins: ['https://example.test'], authenticate},
        }),
    ).rejects.toBeInstanceOf(HostAuthenticationChallengeError);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(BrowserRuntime.prototype.start).not.toHaveBeenCalled();
    expect(
        JSON.parse(await fs.readFile(path.join(runDirectory, 'manifest.json'), 'utf8')),
    ).toMatchObject({status: 'incomplete', artifacts: []});
});

it('rejects conflicting video settings before creating a run or starting a browser', async () => {
    const runDirectory = path.join(directory, 'conflict');
    await expect(
        CaptureRun.create({
            directory: runDirectory,
            url: 'https://example.test',
            video: false,
            outputs: {video: {}},
        }),
    ).rejects.toThrow('requires recording');
    expect(BrowserRuntime.prototype.start).not.toHaveBeenCalled();
    await expect(fs.stat(runDirectory)).rejects.toMatchObject({code: 'ENOENT'});
});

it.each([false, true])(
    'exports at finish once, retaining raw evidence even on export failure: %s',
    async (failExport) => {
        const run = await CaptureRun.create({
            directory: path.join(directory, 'automatic'),
            url: 'https://example.test',
            outputs: {video: {highlights: true}},
        });
        const raw = path.join(run.directory, 'recordings', 'raw.webm');
        await fs.writeFile(raw, 'retained-raw-fixture');
        vi.mocked(run.browser.close).mockResolvedValueOnce(raw);
        vi.spyOn(MediaRecorder.prototype, 'finalize').mockResolvedValue();
        await run.action('browser_click', {});
        const exported = vi.spyOn(run, 'exportVideo');
        if (failExport) {
            exported.mockRejectedValueOnce(new Error('private-export-error'));
        } else {
            exported.mockResolvedValueOnce({} as never);
        }
        const signal = new AbortController().signal;
        const [manifest] = await Promise.all([run.finish(signal), run.finish(signal)]);
        expect(exported).toHaveBeenCalledExactlyOnceWith({
            name: 'walkthrough',
            highlights: true,
            signal,
        });
        expect(manifest.status).toBe(failExport ? 'failed' : 'completed');
        expect(manifest.artifacts).toContainEqual(
            expect.objectContaining({path: path.join('recordings', 'raw.webm'), kind: 'recording'}),
        );
        expect(await fs.readFile(raw, 'utf8')).toBe('retained-raw-fixture');
        expect(await json(run, 'manifest.json')).toEqual(manifest);
        if (failExport) {
            expect(manifest.error).toContain('Automatic video export failed');
            expect(JSON.stringify(manifest)).not.toContain('private-export-error');
        }
    },
);

it('reports a missing configured recording instead of claiming successful output', async () => {
    const run = await CaptureRun.create({
        directory: path.join(directory, 'missing-video'),
        url: 'https://example.test',
        outputs: {video: {}},
    });
    expect(await run.finish()).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('Automatic video export failed'),
    });
});
