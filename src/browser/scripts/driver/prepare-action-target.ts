import type {MediaTarget as JournalMediaTarget} from '../../../media/recording/journal.js';
import type {ScriptPage} from '../types.js';

import {
    ACTION_TARGET_DEADLINE_MS,
    ACTION_TARGET_SAMPLE_INTERVAL_MS,
    ACTION_TARGET_STABLE_MS,
    ACTION_TARGET_TOLERANCE_PX,
} from '../config.js';
export type Input = {ref: string; measure: boolean};
export default async function script(page: ScriptPage, input: Input) {
    // MCP supplies a fresh Node VM with page only. Its own Date is trusted;
    // performance is not exposed there, and page clocks are untrusted.
    const now = () => Date.now();
    const deadline = now() + ACTION_TARGET_DEADLINE_MS;
    const remaining = () => Math.max(1, deadline - now());
    const observed: {
        ref: string;
        geometry?: {
            x: number;
            y: number;
            width: number;
            height: number;
            viewportWidth: number;
            viewportHeight: number;
        };
        mediaTarget?: JournalMediaTarget;
    } = {ref: input.ref};
    const target = page.locator('aria-ref=' + input.ref);
    if ((await target.count()) !== 1) {
        return observed;
    }
    try {
        await target.scrollIntoViewIfNeeded({timeout: remaining()});
    } catch {
        return observed;
    }
    if (now() >= deadline) {
        return observed;
    }
    let viewport = page.viewportSize();
    let previous: {x: number; y: number; width: number; height: number} | null;
    try {
        previous = await target.boundingBox({timeout: remaining()});
    } catch {
        return observed;
    }
    if (now() >= deadline || !previous || !viewport || !validGeometry(previous, viewport)) {
        return observed;
    }
    observed.geometry = {
        ...previous,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
    };
    if (outsideViewport(previous, viewport) || !input.measure) {
        return observed;
    }
    // Availability was already observed. Optional video sampling must not erase it.
    try {
        const video = page.video();
        if (!video) {
            return observed;
        }
        const recording = await video.path();
        let atMs = now();
        while (now() < deadline) {
            await page.waitForTimeout(Math.min(ACTION_TARGET_SAMPLE_INTERVAL_MS, remaining()));
            if (now() >= deadline) {
                return observed;
            }
            const current = await target.boundingBox({timeout: remaining()});
            const currentViewport = page.viewportSize();
            const untilMs = now();
            if (!current || !currentViewport || untilMs >= deadline) {
                return observed;
            }
            const stable = geometryStable(previous, current, viewport, currentViewport);
            if (!stable) {
                atMs = untilMs;
                previous = current;
                viewport = currentViewport;
            }
            if (stableIntervalElapsed(stable, atMs, untilMs)) {
                observed.mediaTarget = {
                    ...current,
                    ref: observed.ref,
                    viewportWidth: viewport.width,
                    viewportHeight: viewport.height,
                    atMs,
                    untilMs,
                    recording,
                };
                return observed;
            }
        }
    } catch {
        // No media target is different from a known offscreen pointer target.
    }
    return observed;
}

function validGeometry(
    previous: {x: number; y: number; width: number; height: number},
    viewport: {width: number; height: number},
): boolean {
    return !(
        ![
            previous.x,
            previous.y,
            previous.width,
            previous.height,
            viewport.width,
            viewport.height,
        ].every(Number.isFinite) ||
        previous.width <= 0 ||
        previous.height <= 0 ||
        viewport.width <= 0 ||
        viewport.height <= 0
    );
}

function outsideViewport(
    previous: {x: number; y: number; width: number; height: number},
    viewport: {width: number; height: number},
): boolean {
    return (
        previous.x + previous.width <= 0 ||
        previous.y + previous.height <= 0 ||
        previous.x >= viewport.width ||
        previous.y >= viewport.height
    );
}

type Box = {x: number; y: number; width: number; height: number};
type Viewport = {width: number; height: number};
function geometryStable(
    prior: Box,
    current: Box,
    viewport: Viewport,
    currentViewport: Viewport,
): boolean {
    return (
        (['x', 'y', 'width', 'height'] as const).every(
            (key) => Math.abs(prior[key] - current[key]) < ACTION_TARGET_TOLERANCE_PX,
        ) &&
        viewport.width === currentViewport.width &&
        viewport.height === currentViewport.height
    );
}
function stableIntervalElapsed(stable: boolean, startMs: number, endMs: number): boolean {
    return stable && endMs - startMs >= ACTION_TARGET_STABLE_MS;
}
