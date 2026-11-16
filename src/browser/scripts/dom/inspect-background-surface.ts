import {
    BACKGROUND_INTERSECTION_TIMEOUT_MS,
    BACKGROUND_RECT_TOLERANCE_PX,
    BACKGROUND_SAMPLE_FRACTIONS,
} from '../config.js';
import {WHITESPACE_PATTERN} from '../patterns.js';
export default async (el: HTMLElement, structuralRoles: string[]) => {
    const view = el.ownerDocument.defaultView;
    if (
        !el.isConnected ||
        !view ||
        view !== view.top ||
        el.getRootNode() !== el.ownerDocument ||
        el.shadowRoot ||
        !(el instanceof view.HTMLElement)
    ) {
        return null;
    }
    if (!supportsBackgroundAncestors(el, view, structuralRoles)) {
        return null;
    }
    const entry = await observeIntersection(el, view);
    if (!entry || !entry.isIntersecting || !el.isConnected) {
        return null;
    }
    const rect = el.getBoundingClientRect();
    const style = view.getComputedStyle(el);
    const clip = entry.intersectionRect;
    if (!hasBackgroundGeometry(el, rect, style, entry)) {
        return null;
    }
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const left = Math.max(clip.left, rect.left + borderLeft, 0) + 2;
    const top = Math.max(clip.top, rect.top + borderTop, 0) + 2;
    const right =
        Math.min(
            clip.right,
            rect.left + borderLeft + el.clientWidth,
            el.ownerDocument.documentElement.clientWidth,
        ) - 2;
    const bottom =
        Math.min(clip.bottom, rect.top + borderTop + el.clientHeight, view.innerHeight) - 2;
    if (right <= left || bottom <= top) {
        return null;
    }
    const points = [];
    for (const yRatio of BACKGROUND_SAMPLE_FRACTIONS) {
        for (const xRatio of BACKGROUND_SAMPLE_FRACTIONS) {
            const x = left + (right - left) * xRatio;
            const y = top + (bottom - top) * yRatio;
            if (el.ownerDocument.elementFromPoint(x, y) === el) {
                points.push({x: x - rect.left - borderLeft, y: y - rect.top - borderTop});
            }
        }
    }
    return {
        rect: [rect.left, rect.top, rect.width, rect.height],
        bounds: [left, top, right, bottom],
        border: [borderLeft, borderTop],
        points,
    };
};

function supportsBackgroundAncestors(
    el: HTMLElement,
    view: Window & typeof globalThis,
    structuralRoles: string[],
): boolean {
    const forbidden =
        'a, button, input, textarea, select, option, label, summary, details, ' +
        'iframe, object, embed, canvas, svg, img, video, audio, [contenteditable]';

    for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
        // A self-hit can still activate an interactive ancestor through event bubbling.
        // Reject foreignObject descendants too: their SVG ancestor is not an HTMLElement.
        const roles = (ancestor.getAttribute('role') || '')
            .trim()
            .split(WHITESPACE_PATTERN)
            .filter(Boolean);
        const style = view.getComputedStyle(ancestor);
        if (
            !(ancestor instanceof view.HTMLElement) ||
            ancestor.matches(forbidden) ||
            ancestor.isContentEditable ||
            ancestor.hasAttribute('disabled') ||
            ancestor.getAttribute('aria-disabled') === 'true' ||
            (ancestor.hasAttribute('tabindex') &&
                !roles.some((role) => ['application', 'region', 'group'].includes(role))) ||
            roles.some((role) => !structuralRoles.includes(role)) ||
            style.transform !== 'none' ||
            style.perspective !== 'none'
        ) {
            return false;
        }
    }
    return true;
}

function observeIntersection(
    el: Element,
    view: Window & typeof globalThis,
): Promise<IntersectionObserverEntry | null> {
    return new Promise<IntersectionObserverEntry | null>((resolve) => {
        let observer: IntersectionObserver | undefined;
        const timer = view.setTimeout(() => {
            if (observer) {
                observer?.disconnect();
            }
            resolve(null);
        }, BACKGROUND_INTERSECTION_TIMEOUT_MS);
        try {
            observer = new view.IntersectionObserver(([value]) => {
                view.clearTimeout(timer);
                observer?.disconnect();
                resolve(value || null);
            });
            observer.observe(el);
        } catch {
            view.clearTimeout(timer);
            resolve(null);
        }
    });
}

function hasBackgroundGeometry(
    el: HTMLElement,
    rect: DOMRect,
    style: CSSStyleDeclaration,
    entry: IntersectionObserverEntry,
): boolean {
    if (
        style.visibility !== 'visible' ||
        style.display === 'none' ||
        style.pointerEvents === 'none' ||
        el.getClientRects().length !== 1 ||
        rect.width < 4 ||
        rect.height < 4 ||
        Math.abs(rect.width - el.offsetWidth) > 1 ||
        Math.abs(rect.height - el.offsetHeight) > 1 ||
        Math.abs(rect.left - entry.boundingClientRect.left) > BACKGROUND_RECT_TOLERANCE_PX ||
        Math.abs(rect.top - entry.boundingClientRect.top) > BACKGROUND_RECT_TOLERANCE_PX
    ) {
        return false;
    }
    return true;
}
