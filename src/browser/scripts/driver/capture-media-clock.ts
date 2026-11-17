import type {ScriptPage} from '../types.js';

import {MEDIA_CLOCK_MARKER_DURATION_MS, VIDEO_STABLE_INTERVAL_MS} from '../config.js';
export type Input = {final: boolean; markerId: string};
export default async function script(page: ScriptPage, input: Input) {
    const video = page.video();
    if (!video || (!input.final && page.__docsMediaClock)) {
        return null;
    }
    if (input.final) {
        await page.waitForTimeout(VIDEO_STABLE_INTERVAL_MS);
    }
    const id = 'docs-media-clock-' + input.markerId;
    await page.evaluate((id) => {
        const element = document.createElement('div');
        element.id = id;
        element.style.cssText =
            'position:fixed;left:0;top:0;width:64px;height:64px;background:linear-gradient(to right,rgb(255,0,255) 50%,rgb(0,255,0) 50%);z-index:2147483647;pointer-events:none';
        document.documentElement.append(element);
    }, id);
    const startMs = Date.now();
    let endMs;
    try {
        await page.waitForTimeout(MEDIA_CLOCK_MARKER_DURATION_MS);
    } finally {
        await page.evaluate((id) => {
            document.getElementById(id)?.remove();
        }, id);
        endMs = Date.now();
    }
    page.__docsMediaClock = true;
    return JSON.stringify({recording: await video.path(), startMs, endMs});
}
