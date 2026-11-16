import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import sharp from 'sharp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

import {type Artifact, CaptureRun} from '../../../src/application/capture-run.js';
import {sha256} from '../../../src/media/recording/recording.js';
import {narrateVideo} from '../../../src/media/audio/narration.js';
import {type ServerOptions, createMcpServer} from '../../../src/server/mcp/index.js';

vi.mock('../../../src/media/audio/narration.js', () => ({narrateVideo: vi.fn()}));

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) {
        await close();
    }
    vi.restoreAllMocks();
});

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}

async function fixture(options: Partial<ServerOptions> = {}) {
    const directory = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'core-server-test-')),
    );
    cleanup.push(() => fs.rm(directory, {recursive: true, force: true}));
    const registrations: string[] = [];
    const create = vi.spyOn(CaptureRun, 'create').mockImplementation(async (options) => {
        await fs.mkdir(options.directory);
        const manifest = {status: 'running', artifacts: [] as Artifact[], steps: []};
        return {
            directory: options.directory,
            manifest,
            finish: async () => {
                manifest.status = 'completed';
                return manifest;
            },
            abort: async () => {
                manifest.status = 'aborted';
            },
            registerExport: async (name: string) => {
                registrations.push(options.directory);
                const output = path.join(options.directory, name);
                if (await fs.stat(output).catch(() => undefined)) {
                    for (const file of await fs.readdir(output)) {
                        manifest.artifacts.push({
                            path: path.join(name, file),
                            kind: 'media-data',
                            sha256: await sha256(path.join(output, file)),
                        });
                    }
                }
            },
        } as unknown as CaptureRun;
    });
    const runtime = createMcpServer({...options, directory});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'core-contract-test', version: '1.0.0'});
    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
        await runtime.close();
        await client.close();
    });
    const call = (name: string, args: Record<string, unknown> = {}) =>
        client.callTool({name, arguments: args});
    const first = await call('screencaster_open', {url: 'https://example.test'});
    const opened = JSON.parse((first.content as Array<{text: string}>)[0].text);
    await call('screencaster_finish');
    return {runtime, call, create, registrations, firstDirectory: opened.directory, client};
}

it('opens from host defaults, accepts explicit browser overrides and excludes host capabilities from MCP', async () => {
    const {call, create, client} = await fixture({
        runDefaults: {
            url: 'https://service.test',
            video: false,
            headless: true,
            viewport: {width: 1440, height: 1000},
            deviceScaleFactor: 2,
            locale: 'ru-RU',
        },
        storageStatePath: '/tmp/private-state.json',
    });
    const listed = await client.listTools();
    const schema = listed.tools.find((tool) => tool.name === 'screencaster_open')?.inputSchema;
    expect(schema?.required ?? []).not.toContain('url');
    expect(schema?.properties).not.toHaveProperty('storageStatePath');
    expect((await call('screencaster_open')).isError).not.toBe(true);
    expect(create.mock.lastCall?.[0]).toMatchObject({
        url: 'https://service.test',
        viewport: {width: 1440, height: 1000},
        deviceScaleFactor: 2,
        locale: 'ru-RU',
        headless: true,
        storageStatePath: '/tmp/private-state.json',
    });
    await call('screencaster_finish');
    expect(
        (
            await call('screencaster_open', {
                url: 'https://service.test/other',
                headless: false,
                viewport: {width: 800, height: 600},
            })
        ).isError,
    ).not.toBe(true);
    expect(create.mock.lastCall?.[0]).toMatchObject({
        url: 'https://service.test/other',
        headless: false,
        viewport: {width: 800, height: 600},
        locale: 'ru-RU',
    });
    await call('screencaster_finish');
    expect((await call('screencaster_open', {storageStatePath: '/tmp/forged.json'})).isError).toBe(
        true,
    );
});

it('still requires a URL when the host has not configured one', async () => {
    const {call, create, client} = await fixture();
    const listed = await client.listTools();
    expect(
        listed.tools.find((tool) => tool.name === 'screencaster_open')?.inputSchema.required,
    ).toContain('url');
    expect((await call('screencaster_open')).isError).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
});

it('finishes export registration in its run before opening the next, while status remains readable', async () => {
    const {call, create, registrations, firstDirectory} = await fixture();
    const entered = deferred();
    const release = deferred();
    vi.mocked(narrateVideo).mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        return undefined as never;
    });
    const narration = call('screencaster_narrate', {
        input: 'montage',
        output: 'voice',
        phrases: [{id: 1, text: 'Synthetic speech', startMs: 0}],
    });
    await entered.promise;
    const next = call('screencaster_open', {url: 'https://example.test/next'});
    try {
        const state = await call('screencaster_state');
        expect(JSON.parse((state.content as Array<{text: string}>)[0].text).directory).toBe(
            firstDirectory,
        );
        expect(create).toHaveBeenCalledTimes(1);
    } finally {
        release.resolve();
    }
    expect((await narration).isError).not.toBe(true);
    expect((await next).isError).not.toBe(true);
    expect(registrations).toEqual([firstDirectory]);
    expect(create).toHaveBeenCalledTimes(2);
});

it('closing aborts active media, waits for it and does not dispatch a queued browser opening', async () => {
    const {runtime, call, create, registrations} = await fixture();
    const entered = deferred();
    let activeSignal: AbortSignal | undefined;
    vi.mocked(narrateVideo).mockImplementation(async (options) => {
        activeSignal = options.signal;
        return new Promise((_, reject) => {
            options.signal?.addEventListener(
                'abort',
                () => reject(new Error('Synthetic cancellation')),
                {once: true},
            );
            entered.resolve();
        });
    });
    const narration = call('screencaster_narrate', {
        input: 'montage',
        output: 'voice',
        phrases: [{id: 1, text: 'Synthetic speech', startMs: 0}],
    }).catch(() => undefined);
    await entered.promise;
    const next = call('screencaster_open', {url: 'https://example.test/next'}).catch(
        () => undefined,
    );
    await runtime.close();
    await Promise.all([narration, next]);
    expect(activeSignal?.aborted).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(registrations).toEqual([]);
});

it('exposes hash-confirmed illustration production and attaches its preview without a visual PASS endpoint', async () => {
    const {call, create, client, firstDirectory} = await fixture();
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'screencaster_illustrations_analyze')).toBe(
        true,
    );
    expect(
        tools.tools.some((tool) => /^screencaster_illustrations_(review|approve)/.test(tool.name)),
    ).toBe(false);
    const run = (await create.mock.results[0].value) as CaptureRun;
    const source = path.join(firstDirectory, 'source.png');
    await sharp({create: {width: 20, height: 10, channels: 3, background: '#ffffff'}})
        .png()
        .toFile(source);
    run.manifest.artifacts.push({
        path: 'source.png',
        kind: 'screenshot',
        sha256: await sha256(source),
    });
    const analyzed = await call('screencaster_illustrations_analyze', {
        output: 'analysis',
        job: {
            version: 1,
            purpose: 'Show a synthetic screen',
            evidence: 'Synthetic source inspected',
            result: 'single',
            inputs: [{id: 'panel', source: 'source.png', dpr: 1}],
            publication: {format: 'yfm', assetDirectory: 'assets'},
        },
    });
    expect(analyzed.isError).not.toBe(true);
    const parts = analyzed.content as Array<{type: string; text?: string; data?: string}>;
    const analysis = JSON.parse(parts.find((part) => part.type === 'text')?.text ?? '{}');
    expect(parts.find((part) => part.type === 'image')?.data).toBeTruthy();
    const produced = await call('screencaster_illustrations_produce', {
        analysis: 'analysis',
        output: 'panels',
        confirmation: {
            analysisSha256: analysis.analysisSha256,
            evidence: 'Inspected complete source and preview',
        },
    });
    expect(produced.isError).not.toBe(true);
    const result = JSON.parse((produced.content as Array<{text: string}>)[0].text);
    expect(result.quality).toMatchObject({
        machineStatus: 'PASS',
        visualStatus: 'PENDING',
        publicationStatus: 'DRAFT',
    });
    const forged = await call('screencaster_illustrations_produce', {
        analysis: 'analysis',
        output: 'bad',
        confirmation: {analysisSha256: '0'.repeat(64), evidence: 'Unrelated confirmation'},
    });
    expect(forged.isError).toBe(true);
    const openArgs = await call('screencaster_open', {
        url: 'https://example.test',
        authentication: {},
    });
    expect(openArgs.isError).toBe(true);
});
