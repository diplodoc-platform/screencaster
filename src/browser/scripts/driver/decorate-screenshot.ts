import type RenderScreenshotOutlineProgram from '../dom/render-screenshot-outline.js';
import type {ScriptPage} from '../types.js';

import {SCREENSHOT_DECORATION_REQUIRES_THE_OWNED_BROWSER} from '../messages.js';
import domSource1 from '../dom/render-screenshot-outline.js?script';
export type Input = {
    input: {
        png: string;
        width: number;
        height: number;
        bounds: {x: number; y: number; width: number; height: number};
        target: {x: number; y: number; width: number; height: number};
        output: string;
    };
};
export default async function script(page: ScriptPage, args: Input) {
    const input = args.input;
    const browser = page.context().browser();
    if (!browser) {
        throw new Error(SCREENSHOT_DECORATION_REQUIRES_THE_OWNED_BROWSER);
    }
    const context = await browser.newContext({
        viewport: {width: input.width, height: input.height},
        deviceScaleFactor: 1,
    });
    try {
        const renderer = await context.newPage();
        await renderer.setContent(
            '<!doctype html><style>html,body{margin:0;padding:0;overflow:hidden}</style>',
        );
        await renderer.evaluate(domSource1 as typeof RenderScreenshotOutlineProgram, input);
        await renderer.screenshot({path: input.output, type: 'png', scale: 'device'});
        return null;
    } finally {
        await context.close();
    }
}
