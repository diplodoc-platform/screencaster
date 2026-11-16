import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {afterEach, expect, it, vi} from 'vitest';

import {
    type ScreenshotAccess,
    captureScreenshot,
} from '../../../../src/browser/capture/capture-screenshot.js';
import {prepareScreenshotCapturePolicy} from '../../../../src/browser/capture/capture-policy.js';
import {screenshotOptionsSchema} from '../../../../src/browser/capture/screenshot.js';

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((directory) => fs.rm(directory, {recursive: true, force: true})),
    );
});

async function fixture() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-file-test-'));
    directories.push(directory);
    const png = await sharp({create: {width: 100, height: 80, channels: 4, background: '#ffffff'}})
        .png()
        .toBuffer();
    const target = {
        count: async () => 1,
        scrollIntoViewIfNeeded: async () => {},
        boundingBox: async () => ({x: 10, y: 10, width: 40, height: 30}),
    };
    const page = {
        locator: () => target,
        viewportSize: () => ({width: 100, height: 80}),
        evaluate: async () => ({deviceScaleFactor: 1, scrollX: 0, scrollY: 0}),
        screenshot: async (options: {path: string}) => fs.writeFile(options.path, png),
    };
    const access: ScreenshotAccess = {
        outputDirectory: directory,
        snapshot: vi.fn(async () => ({snapshot: 'Observed', hasDialog: false})),
        execute: vi.fn(async (code) => {
            const run = vm.runInNewContext(`(${code})`, {setTimeout}) as (
                page: unknown,
            ) => Promise<unknown>;
            return {
                content: [
                    {type: 'text', text: '### Result\n' + JSON.stringify(await run(page)) + '\n'},
                ],
            };
        }),
    };
    return {directory, png, access, file: path.join(directory, 'capture.png')};
}

it('keeps the exact clean PNG and provenance when rendering an offline highlight', async () => {
    const {directory, png, access, file} = await fixture();
    const metadata = await captureScreenshot(
        access,
        file,
        screenshotOptionsSchema.parse({ref: 'e1', highlight: true}),
    );
    expect(await fs.readFile(metadata.original.path)).toEqual(png);
    expect(metadata.original.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(await fs.readFile(file)).not.toEqual(png);
    expect(await fs.readdir(directory)).toEqual(['capture.png', 'capture.png.original.png']);
    expect(metadata).toMatchObject({
        privacy: {redaction: 'not-configured', visualReviewRequired: true},
        readiness: {ready: 0, notReady: 0},
    });
});

it('preserves the plain screenshot API without creating a duplicate original', async () => {
    const {directory, png, access, file} = await fixture();
    const metadata = await captureScreenshot(access, file, screenshotOptionsSchema.parse({}));
    expect(metadata.original.path).toBe(file);
    expect(await fs.readFile(file)).toEqual(png);
    expect(await fs.readdir(directory)).toEqual(['capture.png']);
});

it('refuses preexisting output before touching the page or replacing an original', async () => {
    const {access, file} = await fixture();
    await fs.writeFile(file + '.original.png', 'existing original');
    await expect(
        captureScreenshot(
            access,
            file,
            screenshotOptionsSchema.parse({ref: 'e1', highlight: true}),
        ),
    ).rejects.toThrow('already exists');
    expect(access.execute).not.toHaveBeenCalled();
    expect(await fs.readFile(file + '.original.png', 'utf8')).toBe('existing original');
});

it('cleans only files created by this call when another writer wins the output race', async () => {
    const {directory, access, file} = await fixture();
    access.snapshot = async () => {
        await fs.writeFile(file, 'other writer', {flag: 'wx'});
        return {snapshot: 'Observed', hasDialog: false};
    };
    await expect(
        captureScreenshot(
            access,
            file,
            screenshotOptionsSchema.parse({ref: 'e1', highlight: true}),
        ),
    ).rejects.toThrow('privacy');
    expect(await fs.readFile(file, 'utf8')).toBe('other writer');
    expect(await fs.readdir(directory)).toEqual(['capture.png']);
});

it('does not expose source values from a failed transport or invalid host policy', async () => {
    const {directory, access, file} = await fixture();
    access.policy = {redaction: {replacements: [{from: 'synthetic-private-value', to: 'Example'}]}};
    access.execute = async () => {
        throw new Error('synthetic-private-value from transport');
    };
    await expect(
        captureScreenshot(access, file, screenshotOptionsSchema.parse({})),
    ).rejects.toThrow('Screenshot capture failed');
    expect(await fs.readdir(directory)).toEqual([]);
    expect(() =>
        prepareScreenshotCapturePolicy({
            redaction: {
                replacements: [{from: 'synthetic-private-value', to: 'synthetic-private-value'}],
            },
        }),
    ).toThrow('Invalid host screenshot capture policy');
    expect(() => prepareScreenshotCapturePolicy({requireRedaction: true})).toThrow('Invalid host');
    expect(screenshotOptionsSchema.safeParse({redaction: {hide: ['body']}}).success).toBe(false);
});
