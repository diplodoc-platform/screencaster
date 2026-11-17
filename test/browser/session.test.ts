import type {BrowserObserverResult} from '../../src/browser/observations.js';

import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

import {CaptureRun} from '../../src/application/capture-run.js';
import {createMcpServer} from '../../src/server/mcp/index.js';
import {loadLaunchOptions} from '../../src/application/launch-options.js';
import {narrateVideo} from '../../src/media/audio/narration.js';
import {editVideo} from '../../src/media/export/editorial.js';
import {exportClip} from '../../src/media/export/clips.js';
import {readFrames, sha256} from '../../src/media/recording/recording.js';
import {ffmpeg} from '../../src/media/recording/process.js';
import {McpStdioClient} from '../../src/transport/mcp/client.js';
import {BrowserContextGuard} from '../../src/browser/browser-context-guard.js';
import {BrowserPolicy} from '../../src/browser/policy.js';

afterEach(() => vi.restoreAllMocks());

let server: http.Server;
let url: string;
let directory: string;
beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'core-browser-test-'));
    server = http.createServer((request, response) => {
        if (request.url === '/items' && request.method === 'POST') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({id: 'synthetic-item', password: 'unselected-value'}));
            return;
        }
        response.setHeader('Content-Type', 'text/html');
        if (request.url === '/dialogs') {
            response.end(
                '<!doctype html><title>Dialog fixture</title><h1>Local fixture</h1>' +
                    "<button onclick=\"this.textContent=confirm('Continue?')?'Accepted':'Cancelled'\">Confirm</button>",
            );
            return;
        }
        if (request.url === '/tall') {
            response.end(
                '<!doctype html><title>Tall fixture</title><h1>Local fixture</h1>' +
                    '<div style="height:1500px"></div><button style="width:200px;height:60px">Target</button>',
            );
            return;
        }
        response.end(
            '<!doctype html><title>Fixture</title><h1>Local fixture</h1><button onclick="fetch(\'/items\',{method:\'POST\'}).then(()=>this.textContent=\'Created\')">Create</button><input aria-label="Name" value="typed-value-canary">',
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
});
afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, {recursive: true, force: true});
});

it('restricts pending native dialogs and verifies the page after an explicit answer', async () => {
    const run = await CaptureRun.create({
        url: `${url}/dialogs`,
        directory: path.join(directory, 'dialogs'),
    });
    try {
        expect(run.browser.phase).toBe('ready');
        const snapshot = await run.snapshot();
        const ref = snapshot.match(/button "Confirm" \[ref=([^\]]+)\]/)?.[1];
        expect(ref).toBeTruthy();
        await run.action('browser_click', {element: 'Confirm', ref});
        await expect(run.action('browser_navigate', {url})).rejects.toMatchObject({
            outcome: 'not-dispatched',
        });
        await run.action('browser_handle_dialog', {accept: false});
        expect(await run.snapshot()).toContain('Cancelled');
        await run.action('browser_navigate', {url});
        expect(await run.snapshot()).toContain('Create');
        expect((await run.finish()).status).toBe('completed');
        expect(run.browser.phase).toBe('stopped');
        await expect(run.action('browser_click', {})).rejects.toMatchObject({
            outcome: 'not-dispatched',
        });
    } finally {
        await run.browser.close();
    }
});

it('captures PNG independently and rejects forbidden actions before dispatch', async () => {
    let observed: BrowserObserverResult | undefined;
    const run = await CaptureRun.create({
        url,
        directory: path.join(directory, 'png'),
        observers: [
            {
                id: 'item-ids',
                install: async (access) => {
                    await access.runCode(`async page => {
                const context = page.context();
                context.itemIds = [];
                context.pendingItems = [];
                context.on('response', response => {
                        if (response.url().split('?')[0].endsWith('/items')) {
                        context.pendingItems.push(response.json().then(item => context.itemIds.push(item.id)));
                    }
                });
                return true;
            }`);
                },
                read: (access) =>
                    access.runCode(`async page => {
            await Promise.all(page.context().pendingItems);
            return page.context().itemIds;
        }`),
                accept: (result) => {
                    observed = result;
                },
            },
        ],
    });
    try {
        expect((await run.browser.getSnapshot()).snapshot).toContain('typed-value-canary');
        expect(await run.snapshot()).not.toContain('typed-value-canary');
        const snapshot = await run.snapshot();
        const ref = snapshot.match(/button "Create" \[ref=([^\]]+)\]/)?.[1];
        expect(ref).toBeTruthy();
        const plain = await run.screenshot({name: 'plain'});
        const highlighted = await run.screenshot({name: 'highlighted', ref, highlight: true});
        expect(highlighted.sha256).not.toBe(plain.sha256);
        expect(highlighted.metadata).toMatchObject({
            pixelWidth: 1280,
            pixelHeight: 720,
            viewport: {width: 1280, height: 720},
        });
        const privateState = path.join(directory, 'synthetic-state.json');
        await run.browser.saveStorageState(privateState);
        const stateInfo = await fs.stat(privateState);
        expect(stateInfo.size).toBeGreaterThan(0);
        expect(stateInfo.mode % 0o1000).toBe(0o600);
        await expect(run.browser.saveStorageState(privateState)).rejects.toMatchObject({
            code: 'EEXIST',
        });
        await expect(
            run.action('browser_navigate', {url: 'https://example.invalid'}),
        ).rejects.toMatchObject({outcome: 'not-dispatched'});
        await expect(
            run.action('browser_run_code', {code: 'async page => page.title()'}),
        ).rejects.toMatchObject({outcome: 'not-dispatched'});
        await run.action('browser_click', {element: 'Create', ref});
        expect((await run.action('browser_wait_for', {text: 'Created'})).snapshot).toContain(
            'Created',
        );
        await run.browser.collectObservations();
        expect(observed).toEqual({id: 'item-ids', ok: true, value: ['synthetic-item']});
        expect(JSON.stringify(run.manifest)).not.toContain('synthetic-item');
        expect(await run.snapshot()).not.toContain('unselected-value');
        expect((await run.finish()).status).toBe('completed');
        expect((await run.finish()).artifacts).toHaveLength(3);
        const original = run.manifest.artifacts.find(
            (artifact) => artifact.kind === 'screenshot-original',
        );
        expect(highlighted.derivedFrom).toMatchObject({
            path: original?.path,
            sha256: original?.sha256,
        });
        expect(await sha256(path.join(run.directory, original?.path ?? 'missing'))).toBe(
            original?.sha256,
        );
    } finally {
        await run.browser.close();
    }
});

it('preserves device pixels for viewport, page and highlighted element captures', async () => {
    const run = await CaptureRun.create({
        url: `${url}/tall`,
        directory: path.join(directory, 'high-resolution'),
        viewport: {width: 1920, height: 1080},
        deviceScaleFactor: 2,
    });
    try {
        const ref = (await run.snapshot()).match(/button "Target" \[ref=([^\]]+)\]/)?.[1];
        expect(ref).toBeTruthy();
        const viewport = await run.screenshot({name: 'viewport'});
        expect(viewport.metadata).toMatchObject({
            pixelWidth: 3840,
            pixelHeight: 2160,
            deviceScaleFactor: 2,
        });
        const png = await fs.readFile(path.join(run.directory, viewport.path));
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([3840, 2160]);
        const full = await run.screenshot({name: 'page', area: 'page', ref, highlight: true});
        expect(full.metadata?.pixelWidth).toBe(3840);
        expect(full.metadata?.pixelHeight).toBeGreaterThan(3000);
        const plain = await run.screenshot({name: 'element', area: 'element', ref});
        const highlighted = await run.screenshot({
            name: 'highlight',
            area: 'element',
            ref,
            highlight: true,
        });
        expect(plain.metadata?.pixelWidth).toBe(400);
        // A fractional CSS position includes up to one extra CSS pixel in the native crop.
        expect(plain.metadata?.pixelHeight).toBeGreaterThanOrEqual(120);
        expect(plain.metadata?.pixelHeight).toBeLessThanOrEqual(122);
        const {original: _plainSource, ...plainGeometry} = plain.metadata ?? {};
        const {
            original: _highlightSource,
            outline: _outline,
            ...highlightGeometry
        } = highlighted.metadata ?? {};
        expect(highlightGeometry).toEqual(plainGeometry);
        expect(highlighted.derivedFrom).toBeDefined();
        const clean = run.manifest.artifacts.find(
            (artifact) => artifact.path === highlighted.derivedFrom?.path,
        );
        expect(clean?.sha256).toBe(highlighted.derivedFrom?.sha256);
        expect(await sha256(path.join(run.directory, clean?.path ?? 'missing'))).toBe(
            clean?.sha256,
        );
        const bounds = plain.metadata?.bounds as {y: number; height: number};
        const target = plain.metadata?.target as {y: number; height: number};
        expect(bounds.y).toBeLessThanOrEqual(target.y);
        expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(target.y + target.height);
        expect(highlighted.sha256).not.toBe(plain.sha256);
        await expect(run.screenshot({area: 'element'})).rejects.toThrow('reference');
        await run.finish();
    } finally {
        await run.browser.close();
    }
});

it('records, highlights, narrates with a custom provider and edits the existing material', async () => {
    const root = path.join(directory, 'video');
    const run = await CaptureRun.create({url, directory: root, video: true});
    try {
        const ref = (await run.snapshot()).match(/button "Create" \[ref=([^\]]+)\]/)?.[1];
        await run.screenshot({name: 'highlight-during-video', ref, highlight: true});
        await run.action('browser_click', {element: 'Create', ref});
        await run.finish();
        const outline = {color: '#00cc88', width: 4, padding: 6, radius: 2, opacity: 0.75};
        const timeline = await run.exportVideo({name: 'montage', highlights: true, outline});
        expect(timeline.annotations).toMatchObject({outline});
        expect(timeline.retainedFramesVerified).toBe(true);
        expect(timeline.annotations.annotations).toHaveLength(1);
        const plain = await run.exportVideo({name: 'plain', highlights: false});
        expect(plain.annotations.annotations).toHaveLength(0);
        const provider = {
            identity: 'synthetic-stereo',
            synthesize: async () => ({
                pcm: Buffer.alloc(19200),
                sampleRate: 48000,
                channels: 2 as const,
            }),
        };
        const voiced = await narrateVideo({
            input: path.join(root, 'montage'),
            output: path.join(root, 'voiced'),
            provider,
            phrases: [{id: 1, text: 'Create the item.', startMs: 0}],
            captions: false,
        });
        await expect(fs.stat(path.join(root, 'voiced', 'captions.vtt'))).rejects.toMatchObject({
            code: 'ENOENT',
        });
        const edited = await editVideo({
            input: path.join(root, 'voiced'),
            output: path.join(root, 'edited'),
            cuts: [{startMs: 600, endMs: 800}],
        });
        expect(edited.outputFrames).toBeLessThan(voiced.outputFrames);
        const editedTimeline = JSON.parse(
            await fs.readFile(path.join(root, 'edited', 'timeline.json'), 'utf8'),
        );
        expect(editedTimeline.annotations.outline).toEqual(outline);
        expect(voiced.annotations).toMatchObject({outline});
        expect(editedTimeline.audioSha256).toBe(edited.audioSha256);
        expect(editedTimeline.audioSha256).not.toBe(voiced.audioSha256);
        expect(editedTimeline).not.toHaveProperty('placements');
        expect(editedTimeline).not.toHaveProperty('captions');
        const parentHash = await sha256(path.join(root, 'voiced', 'video.webm'));
        const clip = await exportClip({
            input: path.join(root, 'voiced'),
            output: path.join(root, 'clip'),
            range: {startMs: 0, endMs: 400},
        });
        expect(
            JSON.parse(await fs.readFile(path.join(root, 'clip', 'timeline.json'), 'utf8'))
                .annotations.outline,
        ).toEqual(outline);
        const clipFrames = await readFrames(path.join(root, 'clip', 'video.webm'), undefined, {
            allowAudio: true,
        });
        expect(clipFrames.hasAudio).toBe(true);
        expect(clipFrames.frames).toHaveLength(clip.outputFrames);
        expect(clip.durationMs).toBeCloseTo(400);
        const gif = await exportClip({
            input: path.join(root, 'montage'),
            output: path.join(root, 'gif'),
            range: {actionIds: [1]},
            format: 'gif',
            fps: 10,
            width: 320,
        });
        const bytes = await fs.readFile(path.join(root, 'gif', gif.file));
        expect(bytes.toString('ascii', 0, 6)).toMatch(/^GIF8[79]a$/);
        expect(bytes.readUInt16LE(6)).toBe(320);
        expect(gif.outputFrames).toBeGreaterThan(0);
        await ffmpeg(['-v', 'error', '-i', path.join(root, 'gif', gif.file), '-f', 'null', '-']);
        await exportClip({
            input: path.join(root, 'montage'),
            output: path.join(root, 'single-frame-gif'),
            range: {startMs: 0, endMs: 1},
            format: 'gif',
            fps: 1,
            width: 64,
        });
        const single = await fs.readFile(path.join(root, 'single-frame-gif', 'clip.gif'));
        expect(single.toString('ascii', 0, 6)).toMatch(/^GIF8[79]a$/);
        expect(single.length).toBeGreaterThan(14);
        await ffmpeg([
            '-v',
            'error',
            '-i',
            path.join(root, 'single-frame-gif', 'clip.gif'),
            '-f',
            'null',
            '-',
        ]);
        expect(await sha256(path.join(root, 'voiced', 'video.webm'))).toBe(parentHash);
        await expect(
            exportClip({
                input: path.join(root, 'montage'),
                output: path.join(root, 'invalid-clip'),
                range: {actionIds: [999]},
            }),
        ).rejects.toThrow('unobserved');
        expect(run.manifest.steps).toEqual([]);
    } finally {
        await run.browser.close();
    }
});

it('produces highlighted PNG and video from launch config without per-call flags or export', async () => {
    const config = path.join(directory, 'outputs.json');
    const outputs = {
        video: {name: 'guide', highlights: true, outline: {color: '#00cc88', opacity: 0.75}},
        screenshots: {highlight: true, outline: {color: '#0000ff', width: 4, padding: 5}},
        narration: {name: 'spoken', captions: true, maxHoldSeconds: 5},
    };
    await fs.writeFile(
        config,
        JSON.stringify({
            version: 1,
            directory: './configured-outputs',
            browser: {url, viewport: {width: 640, height: 480}},
            tts: {module: './test-tts.mjs', options: {}},
            outputs,
        }),
        {mode: 0o600},
    );
    await fs.writeFile(
        path.join(directory, 'test-tts.mjs'),
        'export function createTts() { return {identity:"test-pcm", synthesize:async()=>({pcm: new Uint8Array(9600),sampleRate:48000,channels:1})}; }',
    );
    const runtime = createMcpServer(await loadLaunchOptions({config}));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'configured-outputs-test', version: '1.0.0'});
    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const response = await client.callTool({name, arguments: args});
        expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
        const content = response.content as Array<{type: string; text?: string}>;
        return content.find((item) => item.type === 'text')?.text ?? '{}';
    };
    try {
        const refused = await client.callTool({
            name: 'screencaster_open',
            arguments: {video: false},
        });
        expect(refused.isError).toBe(true);
        const opened = JSON.parse(await call('screencaster_open'));
        expect(opened.outputs).toEqual(outputs);
        const source = JSON.parse(await call('screencaster_source', {text: 'Create an item.'}));
        await call('screencaster_plan', {
            plan: {
                sourceSha256: source.sha256,
                steps: [
                    {
                        id: 1,
                        actionText: 'Create an item.',
                        expectedResult: 'Created appears.',
                        sourceQuote: 'Create an item.',
                    },
                ],
            },
        });
        await call('screencaster_step', {id: 1});
        const ref = (await call('browser_snapshot')).match(/button "Create" \[ref=([^\]]+)\]/)?.[1];
        expect(ref).toBeTruthy();
        const missingTarget = await client.callTool({
            name: 'screencaster_screenshot',
            arguments: {name: 'missing-target'},
        });
        expect(missingTarget.isError).toBe(true);
        const highlighted = JSON.parse(
            await call('screencaster_screenshot', {name: 'target', ref}),
        );
        expect(highlighted.metadata.outline).toMatchObject(outputs.screenshots.outline);
        const overridden = JSON.parse(
            await call('screencaster_screenshot', {
                name: 'custom-target',
                ref,
                outline: {opacity: 0.5},
            }),
        );
        expect(overridden.metadata.outline).toMatchObject({
            ...outputs.screenshots.outline,
            opacity: 0.5,
        });
        expect(highlighted.derivedFrom).toBeDefined();
        expect(highlighted.sha256).not.toBe(highlighted.derivedFrom.sha256);
        const plain = JSON.parse(
            await call('screencaster_screenshot', {name: 'overview', highlight: false}),
        );
        expect(plain.derivedFrom).toBeUndefined();
        await call('browser_action', {name: 'browser_click', arguments: {element: 'Create', ref}});
        await call('browser_action', {name: 'browser_wait_for', arguments: {text: 'Created'}});
        await call('screencaster_step', {status: 'success', evidence: 'Created is visible.'});
        const manifest = JSON.parse(await call('screencaster_finish'));
        expect(manifest.status, manifest.error).toBe('completed');
        expect(manifest.artifacts).toContainEqual(
            expect.objectContaining({kind: 'video', path: 'guide/video.webm'}),
        );
        expect(manifest.artifacts).toContainEqual(expect.objectContaining({kind: 'recording'}));
        expect(manifest.artifacts).toContainEqual(
            expect.objectContaining({kind: 'video', path: 'spoken/video.webm'}),
        );
        const spoken = JSON.parse(
            await fs.readFile(path.join(opened.directory, 'spoken/timeline.json'), 'utf8'),
        );
        expect(spoken.annotations.annotations.length).toBeGreaterThan(0);
        expect(spoken.annotations.outline).toMatchObject(outputs.video.outline);
        expect(spoken.placements).toHaveLength(1);
        expect(
            await fs.readFile(path.join(opened.directory, 'spoken/captions.vtt'), 'utf8'),
        ).toContain('Create an item.');
        expect(
            (
                await readFrames(path.join(opened.directory, 'spoken/video.webm'), undefined, {
                    allowAudio: true,
                })
            ).hasAudio,
        ).toBe(true);
        const timeline = JSON.parse(
            await fs.readFile(path.join(opened.directory, 'guide/timeline.json'), 'utf8'),
        );
        expect(timeline.annotations.annotations.length).toBeGreaterThan(0);
        const frames = await readFrames(path.join(opened.directory, 'guide/video.webm'));
        expect(frames.frames.length).toBeGreaterThan(0);
        for (const artifact of manifest.artifacts) {
            expect(await sha256(path.join(opened.directory, artifact.path))).toBe(artifact.sha256);
        }
        expect(JSON.parse(await call('screencaster_finish'))).toEqual(manifest);
    } finally {
        await client.close();
        await runtime.close();
    }
});

it('retains an unknown receipt and blocks another interaction until explicit resolution', async () => {
    const run = await CaptureRun.create({url, directory: path.join(directory, 'unknown')});
    const original = McpStdioClient.prototype.callTool;
    let dispatches = 0;
    const spy = vi.spyOn(McpStdioClient.prototype, 'callTool').mockImplementation(async function (
        this: McpStdioClient,
        name,
        args,
        timeout,
    ) {
        const response = await original.call(this, name, args, timeout);
        if (name === 'browser_click') {
            dispatches++;
            throw new Error('Simulated loss after the real click');
        }
        return response;
    });
    try {
        const ref = (await run.snapshot()).match(/button "Create" \[ref=([^\]]+)\]/)?.[1];
        await expect(run.action('browser_click', {element: 'Create', ref})).rejects.toMatchObject({
            outcome: 'unknown',
        });
        await expect(run.action('browser_click', {element: 'Create', ref})).rejects.toMatchObject({
            outcome: 'not-dispatched',
        });
        expect(dispatches).toBe(1);
        await run.action('browser_wait_for', {text: 'Created'});
        expect(await run.snapshot()).toContain('Created');
        const unknown = run.manifest.unresolvedActions[0];
        expect(unknown).toBeTruthy();
        await run.resolveAction(unknown.id, 'applied', 'Created is visible in a fresh snapshot.');
        expect((await run.finish()).status).toBe('completed');
    } finally {
        spy.mockRestore();
        await run.browser.close();
    }
});

it('uses the same runtime through an external MCP client and an instruction plan', async () => {
    const config = path.join(directory, 'launch.json');
    await fs.writeFile(
        config,
        JSON.stringify({
            version: 1,
            directory: './mcp',
            browser: {url, viewport: {width: 1440, height: 900}, deviceScaleFactor: 2},
        }),
    );
    const runtime = createMcpServer(await loadLaunchOptions({config}));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'local-agent-test', version: '1.0.0'});
    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const response = await client.callTool({name, arguments: args});
        expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
        const content = response.content as Array<{type: string; text?: string}>;
        return content[0].text;
    };
    try {
        expect(await call('screencaster_help', {topic: 'execute'})).toContain('browser_snapshot');
        await call('screencaster_open');
        const source = JSON.parse(
            (await call('screencaster_source', {text: 'Click Create.'})) ?? '{}',
        );
        await call('screencaster_plan', {
            plan: {
                sourceSha256: source.sha256,
                steps: [
                    {
                        id: 1,
                        actionText: 'Click Create',
                        expectedResult: 'Created is visible',
                        sourceQuote: 'Click Create.',
                    },
                ],
            },
        });
        await call('screencaster_step', {id: 1});
        const ref = (await call('browser_snapshot'))?.match(
            /button "Create" \[ref=([^\]]+)\]/,
        )?.[1];
        const action = JSON.parse(
            (await call('browser_action', {
                name: 'browser_click',
                arguments: {element: 'Create', ref},
            })) ?? '{}',
        );
        expect(action.snapshot).toContain('Fixture');
        expect(action.receipt).not.toContain('Ran Playwright code');
        const settled = JSON.parse(
            (await call('browser_action', {
                name: 'browser_wait_for',
                arguments: {text: 'Created'},
            })) ?? '{}',
        );
        expect(settled.snapshot).toContain('Created');
        await call('screencaster_step', {
            status: 'success',
            evidence: 'Created is visible in the returned snapshot.',
        });
        const screenshot = await client.callTool({
            name: 'screencaster_screenshot',
            arguments: {name: 'mcp-pixels'},
        });
        const parts = screenshot.content as Array<{type: string; text?: string; data?: string}>;
        const artifact = JSON.parse(parts.find((part) => part.type === 'text')?.text ?? '{}');
        expect(artifact.metadata).toMatchObject({pixelWidth: 2880, pixelHeight: 1800});
        const image = Buffer.from(
            parts.find((part) => part.type === 'image')?.data ?? '',
            'base64',
        );
        expect(image.readUInt32BE(16)).toBeLessThanOrEqual(1568);
        expect(image.readUInt32BE(16)).toBe(artifact.preview.width);
        const result = JSON.parse((await call('screencaster_finish')) ?? '{}');
        expect(result.steps[0].status).toBe('success');
        expect(result.artifacts).toHaveLength(1);
        const capturedState = JSON.parse((await call('screencaster_state')) ?? '{}');
        const stored = await fs.readFile(path.join(capturedState.directory, artifact.path));
        expect([stored.readUInt32BE(16), stored.readUInt32BE(20)]).toEqual([2880, 1800]);
        const preview = JSON.parse(
            (await call('screencaster_preview', {
                name: 'cover',
                title: 'Local fixture',
                subtitle: 'Core integration',
            })) ?? '{}',
        );
        expect(preview.kind).toBe('preview');
        const state = JSON.parse((await call('screencaster_state')) ?? '{}');
        expect((await fs.stat(path.join(state.directory, preview.path))).size).toBeGreaterThan(0);
    } finally {
        await client.close();
        await runtime.close();
    }
});

it('still closes the owned browser when the final context observation fails', async () => {
    const run = await CaptureRun.create({
        url,
        directory: path.join(directory, 'close-failure'),
        video: true,
    });
    const original = McpStdioClient.prototype.callTool;
    let closeCalls = 0;
    const calls = vi.spyOn(McpStdioClient.prototype, 'callTool').mockImplementation(function (
        this: McpStdioClient,
        name,
        args,
        timeout,
    ) {
        if (name === 'browser_close') {
            closeCalls++;
        }
        return original.call(this, name, args, timeout);
    });
    const guard = vi
        .spyOn(BrowserContextGuard.prototype, 'check')
        .mockRejectedValue(new Error('Simulated unavailable final observation'));
    try {
        expect((await run.finish()).status).toBe('failed');
        expect(closeCalls).toBe(1);
        await expect(run.browser.close()).rejects.toMatchObject({
            message: 'Browser finalization failed; raw recordings retained',
            errors: [expect.objectContaining({message: 'Simulated unavailable final observation'})],
        });
        expect(closeCalls).toBe(1);
    } finally {
        guard.mockRestore();
        calls.mockRestore();
    }
});

it('exports an observation-only recording without artificial steps or clock markers', async () => {
    const run = await CaptureRun.create({
        url,
        directory: path.join(directory, 'observation-only'),
        video: true,
    });
    try {
        await run.snapshot();
        expect((await run.finish()).status).toBe('completed');
        const timeline = await run.exportVideo({name: 'montage'});
        expect(timeline.protection).toBeDefined();
        for (const segment of timeline.segments) {
            expect(
                timeline.protection?.markers.some(
                    (marker) =>
                        marker.start < segment.sourceEnd && marker.end > segment.sourceStart,
                ),
            ).toBe(false);
        }
        expect(run.manifest.steps).toEqual([]);
    } finally {
        await run.browser.close();
    }
});

it('refreshes its tool catalog after navigation between origins and path permissions', async () => {
    const alternate = http.createServer((_request, response) => {
        response.end('<h1>Second application</h1><button>Action</button>');
    });
    await new Promise<void>((resolve) => alternate.listen(0, '127.0.0.1', resolve));
    const other = `http://127.0.0.1:${(alternate.address() as {port: number}).port}`;
    let run: CaptureRun | undefined;
    try {
        run = await CaptureRun.create({
            url: `${url}/view`,
            directory: path.join(directory, 'catalog'),
            policy: new BrowserPolicy([
                {origin: url, actions: ['read']},
                {origin: url, path: '/edit', actions: ['act']},
                {origin: other, actions: ['read', 'act']},
            ]),
        });
        const browser = run.browser;
        const canAct = async () =>
            (await browser.availableTools()).some((tool) => tool.name === 'browser_click');
        expect(await canAct()).toBe(false);
        await run.action('browser_navigate', {url: `${url}/edit`});
        expect(await canAct()).toBe(true);
        await run.action('browser_navigate', {url: other});
        expect(await canAct()).toBe(true);
        await run.action('browser_navigate', {url: `${url}/view`});
        expect(await canAct()).toBe(false);
        expect((await run.finish()).status).toBe('completed');
    } finally {
        await run?.browser.close();
        await new Promise<void>((resolve) => alternate.close(() => resolve()));
    }
});
