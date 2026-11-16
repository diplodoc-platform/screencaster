import type {Input as CheckInteractionReadinessInput} from '../driver/check-interaction-readiness.js';

import {INTERSECTION_TIMEOUT_MS} from '../config.js';

import codeEditorOwnsTextReceiver from './code-editor-text-receiver.js';
import coveringLabels from './covering-branch-labels.js';
export default async function inspectInteractionReadiness(
    el: SVGElement | HTMLElement,
    scriptArguments: {
        value: string[];
        input: CheckInteractionReadinessInput;
    },
) {
    const {value: allowedLabels, input} = scriptArguments;
    const defer = {state: 'defer'};
    const view = el.ownerDocument.defaultView;
    // Document hit-testing retargets shadow descendants to their host.
    // Preserve native action handling rather than calling that host an obstruction.
    if (!el.isConnected || !view || view !== view.top || el.getRootNode() !== el.ownerDocument) {
        return defer;
    }
    const entry = await observeIntersection(el, view);
    if (!entry) {
        return defer;
    }
    const style = view.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (!hasInteractionGeometry(el, view, style, rect, x, y)) {
        return defer;
    }
    const clip = entry.intersectionRect;
    const observed = entry.boundingClientRect;
    if (!matchesObservedBounds(el, rect, observed)) {
        return defer;
    }
    // Hover was already scrolled into view. Other interactions retain
    // native scrolling, including text entry into partially exposed fields.
    if (
        !entry.isIntersecting ||
        x < clip.left ||
        x >= clip.right ||
        y < clip.top ||
        y >= clip.bottom
    ) {
        return input.interaction ? {state: 'not-ready'} : defer;
    }
    const hit = el.ownerDocument.elementFromPoint(x, y);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) {
        return defer;
    }
    // Native text replacement can use an exposed portion even when a fixed
    // footer covers its center. Pointer actions retain the center guard.
    if (hasExposedTextEntry(el, hit, clip, input.textEntry)) {
        return defer;
    }
    if (hasAssociatedDecoration(el, hit)) {
        return defer;
    }
    return {state: 'blocked', blockerLabels: coveringLabels(el, hit, allowedLabels)};
}

function observeIntersection(
    el: Element,
    view: Window & typeof globalThis,
): Promise<IntersectionObserverEntry | null> {
    return new Promise<IntersectionObserverEntry | null>((resolve) => {
        let observer: IntersectionObserver | undefined;
        let settled = false;
        const timeout: {id?: number} = {};
        const finish = (observation: IntersectionObserverEntry | null) => {
            if (settled) {
                return;
            }
            settled = true;
            view.clearTimeout(timeout.id);
            if (observer) {
                observer.disconnect();
            }
            resolve(observation);
        };
        timeout.id = view.setTimeout(() => finish(null), INTERSECTION_TIMEOUT_MS);
        try {
            observer = new view.IntersectionObserver(([observation]) =>
                finish(observation || null),
            );
            observer.observe(el);
        } catch {
            finish(null);
        }
    });
}

function hasInteractionGeometry(
    el: Element,
    view: Window & typeof globalThis,
    style: CSSStyleDeclaration,
    rect: DOMRect,
    x: number,
    y: number,
): boolean {
    if (
        style.visibility !== 'visible' ||
        style.display === 'none' ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        el.getClientRects().length !== 1 ||
        x < 0 ||
        y < 0 ||
        x >= el.ownerDocument.documentElement.clientWidth ||
        y >= view.innerHeight
    ) {
        return false;
    }
    return true;
}

function hasExposedTextEntry(
    el: SVGElement | HTMLElement,
    hit: Element,
    clip: DOMRectReadOnly,
    textEntry: boolean,
): boolean {
    const nativeTextEntry =
        el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' &&
            ['text', 'search', 'url', 'tel', 'email', 'password'].includes(
                (el as HTMLInputElement).type,
            )) ||
        (el as HTMLElement).isContentEditable;
    if (!textEntry || !nativeTextEntry) return false;
    if (codeEditorOwnsTextReceiver(el, hit)) {
        return true;
    }
    const insetX = Math.min(2, clip.width / 4);
    const insetY = Math.min(2, clip.height / 4);
    const xs = [clip.left + insetX, (clip.left + clip.right) / 2, clip.right - insetX];
    const ys = [clip.top + insetY, (clip.top + clip.bottom) / 2, clip.bottom - insetY];
    for (let ix = 0; ix < xs.length; ix++) {
        for (let iy = 0; iy < ys.length; iy++) {
            if (ix === 1 && iy === 1) {
                continue;
            }
            const portionHit = el.ownerDocument.elementFromPoint(xs[ix], ys[iy]);
            if (portionHit === el || (portionHit && el.contains(portionHit))) {
                return true;
            }
        }
    }
    return false;
}

function hasAssociatedDecoration(el: Element, hit: Element): boolean {
    const labels =
        el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)
            ? Array.from((el as HTMLInputElement).labels || []).filter(
                  (label) => label.control === el,
              )
            : [];
    const interactive =
        'a[href], button, input, textarea, select, [contenteditable="true"], ' +
        '[tabindex]:not([tabindex="-1"]), ' +
        '[role]:not([role="none"]):not([role="presentation"]):not([role="img"])';
    const decoration = labels.some((label) => {
        if (hit !== label && !label.contains(hit)) {
            return false;
        }
        for (
            let node: Element | null = hit;
            node && node !== label.parentElement;
            node = node.parentElement
        ) {
            if (node.matches(interactive)) {
                return false;
            }
        }
        return true;
    });

    return decoration;
}

function matchesObservedBounds(el: Element, rect: DOMRect, observed: DOMRectReadOnly): boolean {
    if (
        !el.isConnected ||
        Math.abs(rect.left - observed.left) > 1 ||
        Math.abs(rect.top - observed.top) > 1 ||
        Math.abs(rect.width - observed.width) > 1 ||
        Math.abs(rect.height - observed.height) > 1
    ) {
        return false;
    }
    return true;
}
