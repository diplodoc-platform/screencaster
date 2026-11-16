import coveringLabels from './covering-branch-labels.js';
export default (el: SVGElement | HTMLElement, allowedLabels: string[]) => {
    const rect = el.getBoundingClientRect();
    const hit = el.ownerDocument.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
    );
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) {
        return {state: 'not-ready'};
    }

    return {state: 'blocked', blockerLabels: coveringLabels(el, hit, allowedLabels)};
};
