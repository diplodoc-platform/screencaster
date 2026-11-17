import fs from 'node:fs/promises';
import {chromium} from 'playwright';

import {MAX_PREVIEW_TEXT_CHARS, PREVIEW_VIEWPORT} from '../config.js';
import {PRIVATE_FILE_MODE} from '../../shared/config.js';
import {PREVIEW_REQUIRES_A_BOUNDED_TITLE_AND_SUBTITLE} from '../messages.js';

import {previewDocument} from './templates.js';

export async function generatePreview(options: {
    output: string;
    title: string;
    subtitle?: string;
    viewport?: {width: number; height: number};
}) {
    if (
        !options.title.trim() ||
        options.title.length > MAX_PREVIEW_TEXT_CHARS ||
        (options.subtitle?.length ?? 0) > MAX_PREVIEW_TEXT_CHARS
    ) {
        throw new Error(PREVIEW_REQUIRES_A_BOUNDED_TITLE_AND_SUBTITLE);
    }
    return renderPreview({
        output: options.output,
        viewport: options.viewport,
        html: previewDocument(options.title, options.subtitle),
    });
}

export type PreviewFont = {family: string; weight: string; data: Uint8Array};
// Trusted host templates only. Remote resources are blocked during rendering.
export async function renderPreview(options: {
    output: string;
    html: string;
    viewport?: {width: number; height: number};
    fonts?: PreviewFont[];
}) {
    const browser = await chromium.launch({headless: true});
    try {
        const page = await browser.newPage({
            viewport: options.viewport ?? PREVIEW_VIEWPORT,
            deviceScaleFactor: 1,
        });
        await page.route('**/*', (route) => route.abort());
        await page.setContent(options.html, {waitUntil: 'domcontentloaded'});
        const fonts = (options.fonts ?? []).map((font) => ({
            family: font.family,
            weight: font.weight,
            base64: Buffer.from(font.data).toString('base64'),
        }));
        await page.evaluate(async (entries) => {
            for (const entry of entries) {
                const data = Uint8Array.from(atob(entry.base64), (char) => char.charCodeAt(0));
                const face = new FontFace(entry.family, data, {
                    weight: entry.weight,
                    style: 'normal',
                });
                document.fonts.add(await face.load());
            }
            await document.fonts.ready;
            await Promise.all([...document.images].map((image) => image.decode()));
        }, fonts);
        await fs.writeFile(options.output, await page.screenshot(), {
            mode: PRIVATE_FILE_MODE,
            flag: 'wx',
        });
    } finally {
        await browser.close();
    }
}
