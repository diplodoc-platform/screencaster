import {expect, it, vi} from 'vitest';
import {Ajv2020} from 'ajv/dist/2020.js';

import {BrowserSession} from '../../../src/browser/session.js';
import {BrowserPolicy, createCapturePolicy} from '../../../src/browser/policy.js';

const origin = 'https://docs.example.test';
const otherOrigin = 'https://app.example.test';
const policy = new BrowserPolicy([
    {origin, actions: ['read']},
    {origin, path: '/edit', actions: ['act']},
    {origin: otherOrigin, actions: ['read', 'act']},
]);

class CatalogSession extends BrowserSession {
    constructor() {
        super({url: `${origin}/view`, policy});
        this.tools = ['browser_snapshot', 'browser_click', 'browser_run_code'].map((name) => ({
            name,
            inputSchema: {type: 'object'},
        }));
    }
}

it('discovers tools for the freshly observed page across paths and origins', async () => {
    const session = new CatalogSession();
    const snapshot = vi.spyOn(session, 'getSnapshot');
    for (const [url, canAct] of [
        [`${origin}/view`, false],
        [`${origin}/edit`, true],
        [`${otherOrigin}/`, true],
        [`${origin}/view`, false],
    ] as const) {
        snapshot.mockResolvedValueOnce({
            snapshot: `### Page\n- Page URL: ${url}\n`,
            hasDialog: false,
        });
        const names = (await session.availableTools()).map((tool) => tool.name);
        expect(names.includes('browser_click')).toBe(canAct);
        expect(names.includes('browser_scroll_to')).toBe(canAct);
        expect(names).toContain('browser_snapshot');
        expect(names).not.toContain('browser_run_code');
    }
    expect(snapshot).toHaveBeenCalledTimes(4);
});

it('does not return a stale catalog when the current page cannot be observed', async () => {
    const session = new CatalogSession();
    vi.spyOn(session, 'getSnapshot').mockRejectedValue(new Error('Page unavailable'));
    await expect(session.availableTools()).rejects.toThrow('Page unavailable');
});

it('discovers exact host-approved read-only actions with schemas that refuse behavioral extras', async () => {
    class CaptureCatalog extends BrowserSession {
        constructor() {
            super({
                url: `${origin}/view`,
                policy: createCapturePolicy(`${origin}/view`, {
                    readOnlyActions: [
                        {origin, path: '/view', tool: 'browser_click', ref: 'e7'},
                        {origin, path: '/view', tool: 'browser_press_key', key: 'Escape'},
                    ],
                }),
            });
            this.tools = [
                {
                    name: 'browser_click',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            ref: {type: 'string'},
                            element: {type: 'string'},
                            button: {type: 'string'},
                        },
                        required: ['ref'],
                    },
                },
                {
                    name: 'browser_press_key',
                    inputSchema: {
                        type: 'object',
                        properties: {key: {type: 'string'}},
                        required: ['key'],
                    },
                },
            ];
        }
    }
    const session = new CaptureCatalog();
    vi.spyOn(session, 'getSnapshot').mockResolvedValue({
        snapshot: `### Page\n- Page URL: ${origin}/view\n`,
        hasDialog: false,
    });
    const tools = await session.availableTools();
    const ajv = new Ajv2020({strict: false});
    const click = tools.find((tool) => tool.name === 'browser_click');
    const key = tools.find((tool) => tool.name === 'browser_press_key');
    expect(click).toBeDefined();
    expect(key).toBeDefined();
    const clickArgs = ajv.compile(click?.inputSchema ?? {});
    const keyArgs = ajv.compile(key?.inputSchema ?? {});
    expect(clickArgs({ref: 'e7', element: 'Reviewed menu'})).toBe(true);
    expect(clickArgs({ref: 'e8'})).toBe(false);
    expect(clickArgs({ref: 'e7', button: 'right'})).toBe(false);
    expect(keyArgs({key: 'Escape'})).toBe(true);
    expect(keyArgs({key: 'Enter'})).toBe(false);
});
