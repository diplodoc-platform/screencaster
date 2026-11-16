import type ObserveTargetVisibilityProgram from '../dom/observe-target-visibility.js';
import type ObserveFullIntersectionProgram from '../dom/observe-full-intersection.js';
import type MeasureScrollPositionProgram from '../dom/measure-scroll-position.js';
import type ObserveIntersectionProgram from '../dom/observe-intersection.js';
import type {ScriptPage} from '../types.js';

import {MAX_GEOMETRY_MAGNITUDE} from '../config.js';
import domSource1 from '../dom/observe-target-visibility.js?script';
import domSource2 from '../dom/observe-full-intersection.js?script';
import domSource3 from '../dom/measure-scroll-position.js?script';
import domSource4 from '../dom/observe-intersection.js?script';
export type Input = {ref: string; allowedBlockerLabels: string[]};
export default async function script(page: ScriptPage, input: Input) {
    const pageUrl = page.url();
    const target = page.locator('aria-ref=' + input.ref);
    const targetCount = await target.count();
    const failure = (reason: string, observations = {}) => ({
        visible: false,
        reason,
        observations: {
            ...(targetCount === undefined
                ? {}
                : {targetCount: Math.min(MAX_GEOMETRY_MAGNITUDE, targetCount)}),
            ...observations,
        },
    });
    if (targetCount === 0 && page.url() === pageUrl) {
        return failure('absent-ref');
    }
    // Geometric intersection does not account for sibling overlays. This
    // read-only sample is conservative; it is not a pixel-visibility proof.
    const unobscured = () =>
        target.evaluate(domSource1 as typeof ObserveTargetVisibilityProgram, {
            value: targetCount,
            input,
        });
    // DOM ancestry does not always imply clipping: a fixed portal can
    // escape an overflow ancestor. Trust native full intersection first.
    const nativeFullIntersection = () =>
        target.evaluate(domSource2 as typeof ObserveFullIntersectionProgram, undefined);
    if (await nativeFullIntersection()) {
        return await unobscured();
    }
    const position = await target.evaluateHandle(
        domSource3 as typeof MeasureScrollPositionProgram,
        undefined,
    );
    let revealed;
    try {
        if (await position.evaluate((state) => state.needsNative)) {
            await target.scrollIntoViewIfNeeded();
            await position.evaluate((state) => {
                for (const saved of state.parents) {
                    if (saved.element.isConnected) {
                        saved.element.scrollTo({
                            left: state.keepX ? saved.left : saved.element.scrollLeft,
                            top: state.keepY ? saved.top : saved.element.scrollTop,
                            behavior: 'instant',
                        });
                    }
                }
                window.scrollTo({
                    left: state.keepX ? state.left : window.scrollX,
                    top: state.keepY ? state.top : window.scrollY,
                    behavior: 'instant',
                });
            });
        }
        revealed = await position.evaluate((state) => state.sufficient());
    } finally {
        await position.dispose();
    }
    if (!revealed.sufficient) {
        // Scrolling can reveal a fixed portal that escapes a DOM ancestor's
        // clipping bounds. Recheck native geometry once before rejecting it;
        // full intersection still does not establish unobscured content.
        if (await nativeFullIntersection()) {
            return await unobscured();
        }
        return failure('not-revealed', revealed.observations);
    }
    const intersects = await target.evaluate(
        domSource4 as typeof ObserveIntersectionProgram,
        undefined,
    );
    if (!intersects) {
        return failure('not-intersecting', {intersection: false});
    }
    return await unobscured();
}
