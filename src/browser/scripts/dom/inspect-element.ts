import {GEOMETRY_DECIMAL_SCALE, MAX_GEOMETRY_MAGNITUDE} from '../config.js';
export default function inspectElement(
    el: Element,
    entry: IntersectionObserverEntry | undefined,
    interactive: string,
) {
    const tags: Record<string, string> = {
        A: 'a',
        BUTTON: 'button',
        INPUT: 'input',
        SELECT: 'select',
        TEXTAREA: 'textarea',
        SPAN: 'span',
        DIV: 'div',
        svg: 'svg',
        SVG: 'svg',
    };
    const roles: Record<string, string> = {
        button: 'button',
        combobox: 'combobox',
        checkbox: 'checkbox',
        radio: 'radio',
        switch: 'switch',
        textbox: 'textbox',
        link: 'link',
        img: 'img',
        generic: 'generic',
        none: 'none',
        presentation: 'presentation',
    };
    const view = el.ownerDocument.defaultView;
    if (!view) {
        throw new Error('Element has no document window');
    }
    const rawRole = el.getAttribute('role');
    const number = (value: number) =>
        Number.isFinite(value)
            ? Math.min(
                  MAX_GEOMETRY_MAGNITUDE,
                  Math.max(0, Math.round(value * GEOMETRY_DECIMAL_SCALE) / GEOMETRY_DECIMAL_SCALE),
              )
            : undefined;
    const rect = entry?.boundingClientRect || el.getBoundingClientRect();
    const intersection = entry?.intersectionRect;
    const role = rawRole && Object.hasOwn(roles, rawRole) ? roles[rawRole] : 'other';
    return {
        connected: el.isConnected,
        tag: Object.hasOwn(tags, el.tagName) ? tags[el.tagName] : 'other',
        role: rawRole ? role : 'none',
        childCount: Math.min(MAX_GEOMETRY_MAGNITUDE, el.childElementCount),
        isEditable: (el as HTMLElement).isContentEditable === true,
        insideInteractive: Boolean(el.closest(interactive)),
        ownInteractive: el.matches(interactive),
        pointerEventsNone: view.getComputedStyle(el).pointerEvents === 'none',
        boxWidth: number(rect.width),
        boxHeight: number(rect.height),
        ...(entry && intersection
            ? {
                  intersection: entry.isIntersecting,
                  intersectionWidth: number(intersection.width),
                  intersectionHeight: number(intersection.height),
                  intersectionRatio: Math.min(1, Math.max(0, entry.intersectionRatio)),
                  fullContainment:
                      intersection.width > 0 &&
                      intersection.height > 0 &&
                      intersection.width >= rect.width - 1 &&
                      intersection.height >= rect.height - 1,
              }
            : {}),
    };
}
