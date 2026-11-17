import type {ScreenshotCapturePolicy} from '../../src/browser/capture/capture-policy.js';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {type Browser, type Page, chromium} from 'playwright';
import {afterAll, beforeAll, expect, it} from 'vitest';

import {
    type ScreenshotAccess,
    captureScreenshot,
} from '../../src/browser/capture/capture-screenshot.js';
import {screenshotOptionsSchema} from '../../src/browser/capture/screenshot.js';

let browser: Browser;
let directory: string;
beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-privacy-browser-'));
    browser = await chromium.launch({headless: true});
});
afterAll(async () => {
    await browser?.close();
    await fs.rm(directory, {recursive: true, force: true});
});

function access(page: Page, policy?: ScreenshotCapturePolicy): ScreenshotAccess {
    return {
        outputDirectory: directory,
        policy,
        snapshot: async () => ({snapshot: 'Observed', hasDialog: false}),
        execute: async (code) => {
            const run = vm.runInNewContext(`(${code})`, {setTimeout}) as (
                page: Page,
            ) => Promise<unknown>;
            return {
                content: [
                    {type: 'text', text: '### Result\n' + JSON.stringify(await run(page)) + '\n'},
                ],
            };
        },
    };
}

it('redacts visible text, native values, contenteditable, attributes and open shadow roots without firing input events', async () => {
    const page = await browser.newPage({viewport: {width: 640, height: 480}});
    try {
        await page.setContent(
            '<!doctype html><h1>Ready</h1><p title="synthetic-private-value">synthetic-private-value</p><input value="synthetic-private-value"><textarea>synthetic-private-value</textarea><div contenteditable>synthetic-private-value</div><div id="shadow"></div>',
        );
        await page.evaluate(() => {
            const shadow = document.querySelector('#shadow')?.attachShadow({mode: 'open'});
            if (shadow) {
                shadow.innerHTML = '<span>synthetic-private-value</span>';
            }
            document.querySelector('input')?.addEventListener('input', () => {
                document.body.dataset.inputEvent = 'yes';
            });
        });
        const file = path.join(directory, 'redacted.png');
        const metadata = await captureScreenshot(
            access(page, {
                requireRedaction: true,
                redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example value'}]},
            }),
            file,
            screenshotOptionsSchema.parse({
                ready: [{role: 'heading', name: 'Ready'}],
                notReady: [{role: 'progressbar', name: 'Loading'}],
            }),
        );
        expect(metadata.privacy.redaction).toBe('configured-dom-values-verified');
        expect(metadata.readiness).toEqual({ready: 1, notReady: 1});
        const observed = await page.evaluate(() => ({
            text: document.body.innerText,
            input: document.querySelector('input')?.value,
            textarea: document.querySelector('textarea')?.value,
            title: document.querySelector('p')?.title,
            shadow: document.querySelector('#shadow')?.shadowRoot?.textContent,
            fired: document.body.dataset.inputEvent,
        }));
        expect(JSON.stringify(observed)).not.toContain('synthetic-private-value');
        expect(observed).toMatchObject({
            input: 'Example value',
            textarea: 'Example value',
            title: 'Example value',
            shadow: 'Example value',
        });
        expect(observed.fired).toBeUndefined();
        expect((await fs.stat(file)).size).toBeGreaterThan(0);
    } finally {
        await page.close();
    }
});

it('waits for a ready state and refuses a remaining loader or ambiguous target', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent(
            '<h1>Loading</h1><div role="progressbar" aria-label="Loading" style="width:100px;height:20px"></div>',
        );
        await expect(
            captureScreenshot(
                access(page),
                path.join(directory, 'not-ready.png'),
                screenshotOptionsSchema.parse({
                    notReady: [{role: 'progressbar', name: 'Loading'}],
                    timeoutMs: 100,
                }),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        await page.evaluate(() => {
            setTimeout(() => {
                document.querySelector('[role="progressbar"]')?.remove();
                const heading = document.querySelector('h1');
                if (heading) {
                    heading.textContent = 'Ready';
                }
            }, 100);
        });
        await captureScreenshot(
            access(page),
            path.join(directory, 'ready.png'),
            screenshotOptionsSchema.parse({
                ready: [{role: 'heading', name: 'Ready'}],
                notReady: [{role: 'progressbar', name: 'Loading'}],
            }),
        );
        await page.evaluate(() => {
            const heading = document.querySelector('h1');
            if (heading) {
                document.body.append(heading.cloneNode(true));
            }
        });
        await expect(
            captureScreenshot(
                access(page),
                path.join(directory, 'ambiguous.png'),
                screenshotOptionsSchema.parse({
                    ready: [{role: 'heading', name: 'Ready'}],
                    timeoutMs: 100,
                }),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        expect(await fs.readdir(directory)).not.toContain('not-ready.png');
        expect(await fs.readdir(directory)).not.toContain('ambiguous.png');
    } finally {
        await page.close();
    }
});

it('fails closed for visible frames and raster surfaces, allowing an explicitly hidden surface', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent(
            '<h1>Ready</h1><iframe srcdoc="private frame"></iframe><canvas width="100" height="20"></canvas>',
        );
        const policy = {redaction: {replacements: [{from: 'private', to: 'Example'}]}};
        await expect(
            captureScreenshot(
                access(page, policy),
                path.join(directory, 'frame.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        await captureScreenshot(
            access(page, {redaction: {...policy.redaction, hide: ['iframe', 'canvas']}}),
            path.join(directory, 'hidden-frame.png'),
            screenshotOptionsSchema.parse({}),
        );
        expect(await fs.readdir(directory)).not.toContain('frame.png');
    } finally {
        await page.close();
    }
});

it('rejects a closed shadow root without exposing its source content', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent('<h1>Ready</h1><div id="shadow"></div>');
        await page.evaluate(() => {
            const shadow = document.querySelector('#shadow')?.attachShadow({mode: 'closed'});
            if (shadow) {
                shadow.innerHTML = '<span>synthetic-private-value</span>';
            }
        });
        await expect(
            captureScreenshot(
                access(page, {
                    redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example'}]},
                }),
                path.join(directory, 'closed-shadow.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        expect(await fs.readdir(directory)).not.toContain('closed-shadow.png');
    } finally {
        await page.close();
    }
});

it('does not persist a PNG when the DOM changes after redaction and before pixels return', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent('<h1>Ready</h1><p>synthetic-private-value</p>');
        const original = page.screenshot.bind(page);
        page.screenshot = async (options) => {
            await page.evaluate(() => {
                const paragraph = document.querySelector('p');
                if (paragraph) {
                    paragraph.textContent = 'synthetic-private-value';
                }
            });
            return original(options);
        };
        await expect(
            captureScreenshot(
                access(page, {
                    redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example'}]},
                }),
                path.join(directory, 'changed.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        expect(await fs.readdir(directory)).not.toContain('changed.png');
        expect((await fs.readdir(directory)).some((file) => file.startsWith('capture-'))).toBe(
            false,
        );
    } finally {
        await page.close();
    }
});

it('rejects pixels captured after a loader reappears instead of waiting for a later ready state', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent('<h1>Ready</h1>');
        const original = page.screenshot.bind(page);
        page.screenshot = async (options) => {
            await page.evaluate(() => {
                const loader = document.createElement('div');
                loader.setAttribute('role', 'progressbar');
                loader.setAttribute('aria-label', 'Loading');
                loader.style.cssText = 'width:100px;height:20px';
                document.body.append(loader);
            });
            return original(options);
        };
        await expect(
            captureScreenshot(
                access(page),
                path.join(directory, 'late-loader.png'),
                screenshotOptionsSchema.parse({
                    ready: [{role: 'heading', name: 'Ready'}],
                    notReady: [{role: 'progressbar', name: 'Loading'}],
                    timeoutMs: 100,
                }),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        expect(await fs.readdir(directory)).not.toContain('late-loader.png');
    } finally {
        await page.close();
    }
});

it('hides the entire configured subtree despite a descendant visibility override', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent(
            '<h1>Ready</h1><div id="private"><canvas width="200" height="40" style="visibility:visible"></canvas></div>',
        );
        await page.evaluate(() => {
            const context = document.querySelector('canvas')?.getContext('2d');
            context?.fillText('synthetic-private-value', 0, 20);
        });
        await captureScreenshot(
            access(page, {requireRedaction: true, redaction: {hide: ['#private']}}),
            path.join(directory, 'hidden-subtree.png'),
            screenshotOptionsSchema.parse({}),
        );
        expect(await page.locator('canvas').isVisible()).toBe(false);
        expect(
            await page.locator('#private').evaluate((element) => getComputedStyle(element).display),
        ).toBe('none');
    } finally {
        await page.close();
    }
});

it('uses native input accessors so an instance override cannot disguise or intercept private values', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent('<h1>Ready</h1><input>');
        await page.evaluate(() => {
            const input = document.querySelector('input');
            if (!input) {
                throw new Error('Missing fixture input');
            }
            input.value = 'synthetic-private-property';
            Object.defineProperty(input, 'value', {
                get: () => 'safe-looking-instance-accessor',
                set: () => {
                    document.body.dataset.instanceSetter = 'invoked';
                },
            });
        });
        await captureScreenshot(
            access(page, {
                requireRedaction: true,
                redaction: {
                    replacements: [{from: 'synthetic-private-property', to: 'Example value'}],
                },
            }),
            path.join(directory, 'native-values.png'),
            screenshotOptionsSchema.parse({}),
        );
        const observed = await page.evaluate(() => ({
            value: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get?.call(
                document.querySelector('input'),
            ) as unknown,
            instanceSetter: document.body.dataset.instanceSetter,
        }));
        expect(observed.value).toBe('Example value');
        expect(observed.instanceSetter).toBeUndefined();
    } finally {
        await page.close();
    }
});

it('rejects a configured source composed across inline text nodes and open shadow content', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        const policy = {
            requireRedaction: true,
            redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example'}]},
        };
        await page.setContent(
            '<h1>Ready</h1><div style="display:contents"><span>synthetic-</span><span>private-value</span></div>',
        );
        await expect(
            captureScreenshot(
                access(page, policy),
                path.join(directory, 'split-source.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        await page.setContent('<h1>Ready</h1><div id="shadow"></div>');
        await page.evaluate(() => {
            const root = document.querySelector('#shadow')?.attachShadow({mode: 'open'});
            if (root) {
                root.innerHTML = '<span>synthetic-</span><span>private-value</span>';
            }
        });
        await expect(
            captureScreenshot(
                access(page, policy),
                path.join(directory, 'split-shadow-source.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        expect(await fs.readdir(directory)).not.toContain('split-source.png');
        expect(await fs.readdir(directory)).not.toContain('split-shadow-source.png');
    } finally {
        await page.close();
    }
});

it('rejects a generated raster in pseudo content and permits explicitly hiding its host', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        const image = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 40;
            canvas.getContext('2d')?.fillText('synthetic-private-value', 0, 20);
            return canvas.toDataURL();
        });
        await page.setContent(
            `<h1>Ready</h1><style>#box::before{content:url("${image}")}</style><div id="box"></div>`,
        );
        const redaction = {replacements: [{from: 'synthetic-private-value', to: 'Example'}]};
        await expect(
            captureScreenshot(
                access(page, {redaction}),
                path.join(directory, 'pseudo-raster.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        await captureScreenshot(
            access(page, {redaction: {...redaction, hide: ['#box']}}),
            path.join(directory, 'hidden-pseudo-raster.png'),
            screenshotOptionsSchema.parse({}),
        );
        expect(await fs.readdir(directory)).not.toContain('pseudo-raster.png');
    } finally {
        await page.close();
    }
});

it('checks generated text composition and a pseudo element overriding host visibility', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        const policy = {
            requireRedaction: true,
            redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example'}]},
        };
        await page.setContent(
            '<h1>Ready</h1><style>#box::before{content:"synthetic-"}</style><span id="box">private-value</span>',
        );
        await expect(
            captureScreenshot(
                access(page, policy),
                path.join(directory, 'pseudo-text-source.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        const image = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 30;
            canvas.getContext('2d')?.fillText('private', 0, 15);
            return canvas.toDataURL();
        });
        await page.setContent(
            `<h1>Ready</h1><style>#box{visibility:hidden}#box::before{content:url("${image}");visibility:visible}</style><div id="box"></div>`,
        );
        await expect(
            captureScreenshot(
                access(page, policy),
                path.join(directory, 'visible-pseudo-source.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        expect(await fs.readdir(directory)).not.toContain('pseudo-text-source.png');
        expect(await fs.readdir(directory)).not.toContain('visible-pseudo-source.png');
    } finally {
        await page.close();
    }
});

it('rejects a known source split across blockified flex children with no visual gap', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        await page.setContent(
            '<h1>Ready</h1><p style="display:flex;gap:0"><span>synthetic-</span><span>private-value</span></p>',
        );
        await expect(
            captureScreenshot(
                access(page, {
                    requireRedaction: true,
                    redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example'}]},
                }),
                path.join(directory, 'flex-split-source.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        expect(await fs.readdir(directory)).not.toContain('flex-split-source.png');
    } finally {
        await page.close();
    }
});

it('checks generated marker text and images while preserving native placeholder redaction', async () => {
    const page = await browser.newPage({viewport: {width: 320, height: 180}});
    try {
        const policy = {
            requireRedaction: true,
            redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example'}]},
        };
        await page.setContent(
            '<style>li::marker{content:"synthetic-private-value "}</style><ul><li>Item</li></ul>',
        );
        expect(
            await page
                .locator('li')
                .evaluate((element) => getComputedStyle(element, '::marker').content),
        ).toContain('synthetic-private-value');
        expect(await page.locator('body').innerText()).not.toContain('synthetic-private-value');
        await expect(
            captureScreenshot(
                access(page, policy),
                path.join(directory, 'marker-text-source.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        const image = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 30;
            canvas.getContext('2d')?.fillText('private', 0, 15);
            return canvas.toDataURL();
        });
        await page.setContent(
            `<style>li::marker{content:url("${image}")}</style><ul><li>Item</li></ul>`,
        );
        expect(
            await page
                .locator('li')
                .evaluate((element) => getComputedStyle(element, '::marker').content),
        ).toContain('url(');
        await expect(
            captureScreenshot(
                access(page, policy),
                path.join(directory, 'marker-image-source.png'),
                screenshotOptionsSchema.parse({}),
            ),
        ).rejects.toThrow('Screenshot capture failed');
        await captureScreenshot(
            access(page, {...policy, redaction: {...policy.redaction, hide: ['ul']}}),
            path.join(directory, 'hidden-marker.png'),
            screenshotOptionsSchema.parse({}),
        );
        await page.setContent('<h1>Ready</h1><input placeholder="synthetic-private-value">');
        await captureScreenshot(
            access(page, policy),
            path.join(directory, 'redacted-placeholder.png'),
            screenshotOptionsSchema.parse({}),
        );
        expect(await page.locator('input').getAttribute('placeholder')).toBe('Example');
        expect(await fs.readdir(directory)).not.toContain('marker-text-source.png');
        expect(await fs.readdir(directory)).not.toContain('marker-image-source.png');
    } finally {
        await page.close();
    }
});
