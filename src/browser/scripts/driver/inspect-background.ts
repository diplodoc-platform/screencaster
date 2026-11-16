import type InspectBackgroundSurfaceProgram from '../dom/inspect-background-surface.js';
import type IsStableBackgroundTargetProgram from '../dom/is-stable-background-target.js';
import type {CDPSession, ElementHandle} from 'playwright';
import type {ScriptPage} from '../types.js';

import exactHitSource from '../dom/exact-background-hit.js?script';
import {BACKGROUND_CLICK_TIMEOUT_MS, BACKGROUND_INSPECTION_TIMEOUT_MS} from '../config.js';
import observeSource from '../dom/inspect-background-surface.js?script';
import domSource1 from '../dom/is-stable-background-target.js?script';

export type Input = {
    ref: string;
    candidateRefs: string[];
    inspectionUrl: string | null;
    structuralRoles: string[];
};
export default async function script(page: ScriptPage, input: Input) {
    const target = page.locator('aria-ref=' + input.ref);
    const candidateRefs = input.candidateRefs;
    const refused = (reason: string) => ({state: 'refused', reason});
    if ((await target.count()) !== 1) {
        return refused('target-unavailable');
    }
    const handle = await target.elementHandle();
    if (!handle) {
        return refused('target-unavailable');
    }
    const originalUrl = page.url();
    const inspectionUrl = input.inspectionUrl;
    const deadline =
        inspectionUrl === null ? Infinity : Date.now() + BACKGROUND_INSPECTION_TIMEOUT_MS;
    const expired = () => inspectionUrl !== null && Date.now() >= deadline;
    let cdp: CDPSession | undefined;
    const readSurface = async (surface: ElementHandle<SVGElement | HTMLElement>) => {
        const session = cdp;
        if (!session) {
            return null;
        }
        try {
            if (expired()) {
                return null;
            }
            const observed = await surface.evaluate(
                observeSource as typeof InspectBackgroundSurfaceProgram,
                input.structuralRoles,
            );
            if (!observed || page.url() !== originalUrl) {
                return null;
            }
            const points = [];
            for (const point of observed.points) {
                if (expired()) {
                    return null;
                }
                const x = observed.rect[0] + observed.border[0] + point.x;
                const y = observed.rect[1] + observed.border[1] + point.y;
                // DOM hit-testing retargets closed shadow descendants to their host.
                // Chromium's deepest hit must agree before a point is eligible.
                const hit = await session.send('DOM.getNodeForLocation', {
                    x: Math.floor(x),
                    y: Math.floor(y),
                    includeUserAgentShadowDOM: true,
                    ignorePointerEventsNone: false,
                });
                if (!hit.backendNodeId) {
                    return null;
                }
                const resolved = await session.send('DOM.resolveNode', {
                    backendNodeId: hit.backendNodeId,
                });
                const objectId = resolved.object && resolved.object.objectId;
                if (!objectId) {
                    return null;
                }
                let exact = false;
                try {
                    const result = await session.send('Runtime.callFunctionOn', {
                        objectId,
                        functionDeclaration: String(exactHitSource),
                        arguments: [{value: x}, {value: y}],
                        returnByValue: true,
                    });
                    exact =
                        !result.exceptionDetails && result.result && result.result.value === true;
                } finally {
                    await session.send('Runtime.releaseObject', {objectId});
                }
                if (exact) {
                    points.push(point);
                }
            }
            // Retain the original handle and recheck after CDP, including points that
            // were excluded. This bounds the observation window; it is not atomic.
            const fresh = await surface.evaluate(
                observeSource as typeof InspectBackgroundSurfaceProgram,
                input.structuralRoles,
            );
            if (
                !fresh ||
                JSON.stringify(fresh) !== JSON.stringify(observed) ||
                expired() ||
                page.url() !== originalUrl
            ) {
                return null;
            }
            return {...observed, points};
        } catch {
            // No click has started; unavailable deepest-hit evidence is a refusal.
            return null;
        }
    };

    const stableTarget = async () =>
        page.url() === originalUrl &&
        (await target.count()) === 1 &&
        (await target.evaluate((el, expected) => el === expected, handle));

    const measuredCandidates = async (
        first: NonNullable<Awaited<ReturnType<typeof readSurface>>>,
    ) => {
        const retained = [];
        const handles = [];
        try {
            if (!candidateRefs.length || page.url() !== originalUrl) {
                return [];
            }
            for (const ref of candidateRefs) {
                const locator = page.locator('aria-ref=' + ref);
                if ((await locator.count()) !== 1) {
                    return [];
                }
                const child = await locator.elementHandle();
                if (!child) {
                    return [];
                }
                handles.push(child);
                if (
                    !(await child.evaluate(
                        (el, root) =>
                            root.isConnected && el.isConnected && el !== root && root.contains(el),
                        handle,
                    ))
                ) {
                    return [];
                }
                const observation = await readSurface(child);
                if (observation && observation.points.length) {
                    retained.push({ref, locator, child, observation});
                }
            }
            // Suggestions are observations only. Recheck every retained exact handle before reporting it.
            for (const entry of retained) {
                if (
                    (await entry.locator.count()) !== 1 ||
                    !(await entry.locator.evaluate(
                        (el, expected) => el === expected,
                        entry.child,
                    )) ||
                    !(await entry.child.evaluate(
                        (el, root) =>
                            root.isConnected && el.isConnected && el !== root && root.contains(el),
                        handle,
                    ))
                ) {
                    return [];
                }
                const fresh = await readSurface(entry.child);
                if (!fresh || JSON.stringify(fresh) !== JSON.stringify(entry.observation)) {
                    return [];
                }
            }
            if (!(await stableTarget())) {
                return [];
            }
            const parentNow = await readSurface(handle);
            if (!parentNow || JSON.stringify(parentNow) !== JSON.stringify(first)) {
                return [];
            }
            return retained.map((entry) => entry.ref);
        } catch {
            // This path performs observations only; unavailable observations never become suggestions.
            return [];
        } finally {
            for (const child of handles) {
                await child.dispose();
            }
        }
    };
    const inspectAncestors = async () => {
        const handles = [];
        const measured = [];
        const empty = () => ({state: 'inspected', candidateRefs: []});
        const stableTarget = async () =>
            !expired() &&
            page.url() === inspectionUrl &&
            (await target.count()) === 1 &&
            (await target.evaluate(domSource1 as typeof IsStableBackgroundTargetProgram, handle));
        try {
            if (!(await stableTarget())) {
                return empty();
            }
            for (const ref of candidateRefs) {
                if (expired()) {
                    return empty();
                }
                const locator = page.locator('aria-ref=' + ref);
                if ((await locator.count()) !== 1) {
                    return empty();
                }
                const ancestor = await locator.elementHandle();
                if (!ancestor) {
                    return empty();
                }
                handles.push(ancestor);
                if (
                    !(await ancestor.evaluate(
                        (el, child) =>
                            el.isConnected &&
                            child.isConnected &&
                            el !== child &&
                            el.contains(child),
                        handle,
                    ))
                ) {
                    return empty();
                }
                const observation = await readSurface(ancestor);
                if (observation && observation.points.length) {
                    measured.push({ref, locator, ancestor, observation});
                }
            }
            for (const entry of measured) {
                if (
                    expired() ||
                    (await entry.locator.count()) !== 1 ||
                    !(await entry.locator.evaluate(
                        (el, expected) => el === expected,
                        entry.ancestor,
                    )) ||
                    !(await entry.ancestor.evaluate(
                        (el, child) =>
                            el.isConnected &&
                            child.isConnected &&
                            el !== child &&
                            el.contains(child),
                        handle,
                    ))
                ) {
                    return empty();
                }
                const fresh = await readSurface(entry.ancestor);
                if (!fresh || JSON.stringify(fresh) !== JSON.stringify(entry.observation)) {
                    return empty();
                }
            }
            return (await stableTarget())
                ? {state: 'inspected', candidateRefs: measured.map((entry) => entry.ref)}
                : empty();
        } catch {
            return empty();
        } finally {
            for (const ancestor of handles) {
                await ancestor.dispose();
            }
        }
    };
    try {
        try {
            cdp = await page.context().newCDPSession(page);
        } catch {
            return refused('unsupported-container');
        }
        if (inspectionUrl !== null) {
            return await inspectAncestors();
        }
        const first = await readSurface(handle);
        if (!first) {
            return refused('unsupported-container');
        }
        if (!first.points.length) {
            const candidates = await measuredCandidates(first);
            return {...refused('no-background-point'), candidateRefs: candidates};
        }
        const point = first.points[0];
        // Retain the exact DOM handle; never remap a stale ref onto a replacement node.
        if (
            page.url() !== originalUrl ||
            (await target.count()) !== 1 ||
            !(await target.evaluate((el, expected) => el === expected, handle))
        ) {
            return refused('target-changed');
        }
        const fresh = await readSurface(handle);
        if (
            !fresh ||
            JSON.stringify(first.rect) !== JSON.stringify(fresh.rect) ||
            JSON.stringify(first.bounds) !== JSON.stringify(fresh.bounds) ||
            !fresh.points.some((candidate) => candidate.x === point.x && candidate.y === point.y) ||
            page.url() !== originalUrl
        ) {
            return refused('target-changed');
        }
        // No catches/retries after click starts: a native failure has an unknown dispatch outcome.
        await handle.click({position: point, button: 'left', timeout: BACKGROUND_CLICK_TIMEOUT_MS});
        return {state: 'clicked'};
    } finally {
        try {
            if (cdp) {
                await cdp.detach();
            }
        } finally {
            await handle.dispose();
        }
    }
}
