export default function editableSelectionState(
    el: HTMLElement,
    matchesText: (element: HTMLElement, expected: string) => boolean,
): 'complete' | 'partial' | 'unavailable' {
    let active = el.ownerDocument.activeElement;
    while (active && active !== el) {
        active = active.shadowRoot?.activeElement ?? null;
    }
    const selection = el.ownerDocument.getSelection();
    if (active !== el || selection?.rangeCount !== 1) {
        return 'unavailable';
    }
    const selected = selection.getRangeAt(0);
    if (!el.contains(selected.startContainer) || !el.contains(selected.endContainer)) {
        return 'unavailable';
    }
    const before = el.ownerDocument.createRange();
    before.selectNodeContents(el);
    before.setEnd(selected.startContainer, selected.startOffset);
    const after = el.ownerDocument.createRange();
    after.selectNodeContents(el);
    after.setStart(selected.endContainer, selected.endOffset);
    for (const range of [before, after]) {
        const remainder = el.ownerDocument.createElement('div');
        remainder.append(range.cloneContents());
        if (!matchesText(remainder, '')) {
            return 'partial';
        }
    }
    return 'complete';
}
