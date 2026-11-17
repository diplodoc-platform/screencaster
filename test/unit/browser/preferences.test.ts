import fs from 'node:fs/promises';
import {afterEach, expect, it, vi} from 'vitest';

import {BrowserRuntime} from '../../../src/browser/runtime.js';
import {BrowserSession} from '../../../src/browser/session.js';
import {BrowserPolicy} from '../../../src/browser/policy.js';
import {McpStdioClient} from '../../../src/transport/mcp/client.js';

const directories: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
        directories.splice(0).map((directory) => fs.rm(directory, {recursive: true, force: true})),
    );
});

it.each([undefined, 'light', 'dark', 'no-preference'] as const)(
    'forwards locale and %s scheme to the owned driver context, preserving omitted defaults',
    async (colorScheme) => {
        let configuration:
            {outputDir: string; browser: {contextOptions: Record<string, unknown>}} | undefined;
        vi.spyOn(McpStdioClient.prototype, 'start').mockImplementation(async (_command, args) => {
            configuration = JSON.parse(
                await fs.readFile(args[args.indexOf('--config') + 1], 'utf8'),
            );
            if (configuration) directories.push(configuration.outputDir);
            throw new Error('fixture stops before driver startup');
        });
        vi.spyOn(McpStdioClient.prototype, 'stop').mockResolvedValue();
        const runtime = new BrowserRuntime({policy: new BrowserPolicy([])});
        const preferences = colorScheme ? {locale: 'ru-RU', colorScheme} : {};
        await expect(runtime.start(preferences)).rejects.toThrow();
        expect(configuration).toBeDefined();
        if (colorScheme) {
            expect(configuration?.browser.contextOptions).toMatchObject(preferences);
        } else {
            expect(configuration?.browser.contextOptions).not.toHaveProperty('colorScheme');
            expect(configuration?.browser.contextOptions).not.toHaveProperty('locale');
        }
    },
);

it('rejects invalid direct API preferences before starting a driver or authenticating', async () => {
    const start = vi.spyOn(McpStdioClient.prototype, 'start');
    const runtime = new BrowserRuntime({policy: new BrowserPolicy([])});
    await expect(runtime.start({locale: ''})).rejects.toThrow();
    expect(runtime.phase).not.toBe('starting');
    expect(() => new BrowserSession({url: 'https://example.test', locale: ''})).toThrow();
    expect(start).not.toHaveBeenCalled();
});
