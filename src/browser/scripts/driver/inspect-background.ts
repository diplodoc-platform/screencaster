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
                const objectId = resolved.object?.objectId;
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
                    exact = !result.exceptionDetails && result.result?.value === true;
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

    type Observation = NonNullable<Awaited<ReturnType<typeof readSurface>>>;
    type MeasuredSurface = {
        locator: ReturnType<ScriptPage['locator']>;
        observation: Observation;
        child: ElementHandle<SVGElement | HTMLElement>;
    };
    const recheckChild = async (entry: MeasuredSurface) => {
        if (
            (await entry.locator.count()) !== 1 ||
            !(await entry.locator.evaluate((el, expected) => el === expected, entry.child)) ||
            !(await entry.child.evaluate(
                (el, root) =>
                    root.isConnected && el.isConnected && el !== root && root.contains(el),
                handle,
            ))
        )
            return false;
        const fresh = await readSurface(entry.child);
        return Boolean(fresh && JSON.stringify(fresh) === JSON.stringify(entry.observation));
    };
    const recheckAncestor = async (
        entry: Omit<MeasuredSurface, 'child'> & {ancestor: MeasuredSurface['child']},
    ) => {
        if (
            expired() ||
            (await entry.locator.count()) !== 1 ||
            !(await entry.locator.evaluate((el, expected) => el === expected, entry.ancestor)) ||
            !(await entry.ancestor.evaluate(
                (el, child) =>
                    el.isConnected && child.isConnected && el !== child && el.contains(child),
                handle,
            ))
        )
            return false;
        const fresh = await readSurface(entry.ancestor);
        return Boolean(fresh && JSON.stringify(fresh) === JSON.stringify(entry.observation));
    };
    const isConnectedDescendant = (el: Element, root: Element) =>
        root.isConnected && el.isConnected && el !== root && root.contains(el);
    const isConnectedAncestor = (el: Element, child: Element) =>
        el.isConnected && child.isConnected && el !== child && el.contains(child);
    const measureCandidate = async (
        ref: string,
        handles: ElementHandle<SVGElement | HTMLElement>[],
        ancestor: boolean,
    ) => {
        if (ancestor && expired()) return null;
        const locator = page.locator('aria-ref=' + ref);
        if ((await locator.count()) !== 1) return null;
        const candidate = await locator.elementHandle();
        if (!candidate) return null;
        handles.push(candidate);
        const relationship = ancestor ? isConnectedAncestor : isConnectedDescendant;
        if (!(await candidate.evaluate(relationship, handle))) return null;
        return {ref, locator, candidate, observation: await readSurface(candidate)};
    };
    const measuredCandidates = async (
        first: NonNullable<Awaited<ReturnType<typeof readSurface>>>,
    ) => {
        const retained = [];
        const handles: ElementHandle<SVGElement | HTMLElement>[] = [];
        try {
            if (!candidateRefs.length || page.url() !== originalUrl) {
                return [];
            }
            for (const ref of candidateRefs) {
                const entry = await measureCandidate(ref, handles, false);
                if (!entry) return [];
                if (entry.observation?.points.length) {
                    retained.push({
                        ...entry,
                        child: entry.candidate,
                        observation: entry.observation,
                    });
                }
            }
            // Suggestions are observations only. Recheck every retained exact handle before reporting it.
            for (const entry of retained) {
                if (!(await recheckChild(entry))) return [];
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
        const handles: ElementHandle<SVGElement | HTMLElement>[] = [];
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
                const entry = await measureCandidate(ref, handles, true);
                if (!entry) return empty();
                if (entry.observation?.points.length) {
                    measured.push({
                        ...entry,
                        ancestor: entry.candidate,
                        observation: entry.observation,
                    });
                }
            }
            for (const entry of measured) {
                if (!(await recheckAncestor(entry))) return empty();
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
