import {GEOMETRY_DECIMAL_SCALE, MAX_GEOMETRY_MAGNITUDE} from '../config.js';
import {UNAVAILABLE_GEOMETRY} from '../messages.js';
import {CLIPPING_OVERFLOW_PATTERN, SCROLLABLE_OVERFLOW_PATTERN} from '../patterns.js';

export default (el: SVGElement | HTMLElement) => {
    const parents = scrollAncestors(el);
    const clips = (value: string) => CLIPPING_OVERFLOW_PATTERN.test(value);
    const viewport = () => ({
        left: 0,
        top: 0,
        right: document.documentElement.clientWidth,
        bottom: window.innerHeight,
    });
    const bounds = (parent: Element) => {
        const rect = parent.getBoundingClientRect();
        return {
            left: rect.left + parent.clientLeft,
            top: rect.top + parent.clientTop,
            right: rect.left + parent.clientLeft + parent.clientWidth,
            bottom: rect.top + parent.clientTop + parent.clientHeight,
        };
    };
    const measure = (limit = parents.length) => {
        const view = viewport();
        const capacity = {width: view.right, height: view.bottom};
        const clip = {left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity};
        for (let index = 0; index < parents.length; index++) {
            const parent = parents[index];
            const style = getComputedStyle(parent);
            const box = bounds(parent);
            if (clips(style.overflowX)) {
                capacity.width = Math.min(capacity.width, parent.clientWidth);
                if (index < limit) {
                    clip.left = Math.max(clip.left, box.left);
                    clip.right = Math.min(clip.right, box.right);
                }
            }
            if (clips(style.overflowY)) {
                capacity.height = Math.min(capacity.height, parent.clientHeight);
                if (index < limit) {
                    clip.top = Math.max(clip.top, box.top);
                    clip.bottom = Math.min(clip.bottom, box.bottom);
                }
            }
        }
        return {rect: el.getBoundingClientRect(), clip, capacity, view};
    };
    const keepAxis = (start: number, end: number, low: number, high: number, available: number) => {
        if (high <= low || end <= start || available <= 0) {
            return false;
        }
        if (end - start <= available) {
            return start >= low - 1 && end <= high + 1;
        }
        return Math.min(end, high) - Math.max(start, low) >= available / 2;
    };
    const visible = (measurement = measure()) => {
        const {rect, clip, capacity, view} = measurement;
        return {
            x: keepAxis(
                rect.left,
                rect.right,
                Math.max(clip.left, view.left),
                Math.min(clip.right, view.right),
                capacity.width,
            ),
            y: keepAxis(
                rect.top,
                rect.bottom,
                Math.max(clip.top, view.top),
                Math.min(clip.bottom, view.bottom),
                capacity.height,
            ),
        };
    };
    const initial = measure();
    const keep = visible();
    const oversizedX = initial.rect.width > initial.capacity.width;
    const oversizedY = initial.rect.height > initial.capacity.height;
    const deficit = (start: number, end: number, low: number, high: number, required: number) => {
        if (end - start < required || high - low < required) {
            return 0;
        }
        if (start > high - required) {
            return start - (high - required);
        }
        if (end < low + required) {
            return end - (low + required);
        }
        return 0;
    };
    // Reveal only the missing part, from the innermost scrollport out.
    // Each outer scrollport sees the target clipped by the inner ones.
    for (let index = 0; index <= parents.length; index++) {
        const parent = parents[index];
        const {rect, clip, capacity, view} = measure(index);
        const box = parent ? bounds(parent) : view;
        const style = parent ? getComputedStyle(parent) : null;
        const scrolls = (axis: 'x' | 'y') =>
            !parent ||
            SCROLLABLE_OVERFLOW_PATTERN.test(
                (style ?? getComputedStyle(parent))[axis === 'x' ? 'overflowX' : 'overflowY'],
            );
        const actual = visible();
        const left =
            oversizedX && !keep.x && !actual.x && scrolls('x')
                ? deficit(
                      Math.max(rect.left, clip.left),
                      Math.min(rect.right, clip.right),
                      box.left,
                      box.right,
                      capacity.width / 2,
                  )
                : 0;
        const top =
            oversizedY && !keep.y && !actual.y && scrolls('y')
                ? deficit(
                      Math.max(rect.top, clip.top),
                      Math.min(rect.bottom, clip.bottom),
                      box.top,
                      box.bottom,
                      capacity.height / 2,
                  )
                : 0;
        if (left || top) {
            (parent || window).scrollBy({left, top, behavior: 'instant'});
        }
    }
    const needsNative = (!keep.x && !oversizedX) || (!keep.y && !oversizedY);
    return {
        parents: parents.map((element) => ({
            element,
            left: element.scrollLeft,
            top: element.scrollTop,
        })),
        left: window.scrollX,
        top: window.scrollY,
        keepX: keep.x || oversizedX,
        keepY: keep.y || oversizedY,
        needsNative,
        sufficient: () => {
            const measured = measure();
            const actual = visible(measured);
            const connected = el.isConnected;
            const sufficient = connected && actual.x && actual.y;
            if (sufficient) {
                return {sufficient: true};
            }
            const observations = {
                connected,
                positionXEnough: actual.x,
                positionYEnough: actual.y,
                nativeScrollAttempted: needsNative,
            };
            try {
                const {rect, clip, capacity, view} = measured;
                const bounded = (value: number) => {
                    if (!Number.isFinite(value)) {
                        throw new Error(UNAVAILABLE_GEOMETRY);
                    }
                    return Math.min(
                        MAX_GEOMETRY_MAGNITUDE,
                        Math.max(
                            -MAX_GEOMETRY_MAGNITUDE,
                            Math.round(value * GEOMETRY_DECIMAL_SCALE) / GEOMETRY_DECIMAL_SCALE,
                        ),
                    );
                };
                const rectangle = (value: {
                    left: number;
                    top: number;
                    right: number;
                    bottom: number;
                }) => ({
                    left: bounded(value.left),
                    top: bounded(value.top),
                    right: bounded(value.right),
                    bottom: bounded(value.bottom),
                });
                return {
                    sufficient: false,
                    observations: {
                        ...observations,
                        positionRect: rectangle(rect),
                        positionClip: rectangle({
                            left: Math.max(clip.left, view.left),
                            top: Math.max(clip.top, view.top),
                            right: Math.min(clip.right, view.right),
                            bottom: Math.min(clip.bottom, view.bottom),
                        }),
                        positionCapacity: {
                            width: bounded(capacity.width),
                            height: bounded(capacity.height),
                        },
                        positionViewport: {
                            width: bounded(view.right),
                            height: bounded(view.bottom),
                        },
                    },
                };
            } catch {
                // Optional diagnostics cannot replace the original failure.
                return {sufficient: false, observations};
            }
        },
    };
};

function scrollAncestors(el: Element): Element[] {
    const parents: Element[] = [];
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        parents.push(parent);
    }
    return parents;
}
