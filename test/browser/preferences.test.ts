import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

import {loadLaunchOptions} from '../../src/application/launch-options.js';
import {createMcpServer} from '../../src/server/mcp/index.js';
import {readPng} from '../fixtures/images.js';

let server: http.Server;
let url: string;
let directory: string;
beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-preferences-test-'));
    server = http.createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<!doctype html><style>
            body {background: #eeeeee; color: #000;}
            @media (prefers-color-scheme: dark) { body {background: #112233; color: #fff;} }
            </style><h1 id="locale"></h1><h2 id="format"></h2><h2 id="theme"></h2><h2 id="header"></h2>
            <script>
                document.getElementById('locale').textContent = 'Locale ' + navigator.language;
                document.getElementById('format').textContent = 'Formatting ' + new Intl.NumberFormat().resolvedOptions().locale;
                document.getElementById('theme').textContent = 'Theme ' + (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                document.getElementById('header').textContent = 'Header ' + ${JSON.stringify(request.headers['accept-language']?.split(',')[0])};
            </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
});
afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, {recursive: true, force: true});
});

it.each([
    {locale: 'ru-RU', colorScheme: 'dark'},
    {locale: 'en-US', colorScheme: 'light'},
    {locale: 'de-DE', colorScheme: 'no-preference'},
])(
    'applies $locale and $colorScheme from launch config before navigation and capture',
    async (preferences) => {
        const config = path.join(directory, `${preferences.colorScheme}.json`);
        await fs.writeFile(
            config,
            JSON.stringify({
                version: 1,
                directory: './runs',
                browser: {url, ...preferences, viewport: {width: 640, height: 480}},
            }),
        );
        const runtime = createMcpServer(await loadLaunchOptions({config}));
        const client = new Client({name: 'browser-preferences-test', version: '1.0.0'});
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await runtime.server.connect(serverTransport);
        await client.connect(clientTransport);
        const call = async (name: string, args: Record<string, unknown> = {}) => {
            const reply = await client.callTool({name, arguments: args});
            expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
            return (
                (reply.content as Array<{type: string; text?: string}>).find(
                    (item) => item.type === 'text',
                )?.text ?? ''
            );
        };
        try {
            const opened = JSON.parse(await call('screencaster_open'));
            const snapshot = await call('browser_snapshot');
            const dark =
                preferences.colorScheme === 'no-preference'
                    ? snapshot.includes('Theme dark')
                    : preferences.colorScheme === 'dark';
            const check = (snapshot: string) => {
                expect(snapshot).toContain(`Locale ${preferences.locale}`);
                expect(snapshot).toContain(`Formatting ${preferences.locale}`);
                expect(snapshot).toContain(`Header ${preferences.locale}`);
                expect(snapshot).toContain(`Theme ${dark ? 'dark' : 'light'}`);
            };
            check(snapshot);
            const artifact = JSON.parse(
                await call('screencaster_screenshot', {name: 'preferences'}),
            );
            const image = await readPng(path.join(opened.directory, artifact.path));
            expect([...image.data.subarray(-4)]).toEqual(
                dark ? [17, 34, 51, 255] : [238, 238, 238, 255],
            );
            await call('browser_action', {
                name: 'browser_navigate',
                arguments: {url: `${url}/next`},
            });
            check(await call('browser_snapshot'));
            expect(JSON.parse(await call('screencaster_finish')).status).toBe('completed');
        } finally {
            await runtime.close();
            await client.close();
        }
    },
);
