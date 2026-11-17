import {MAX_BLOCKER_LABELS, MAX_OBSTRUCTION_NODES} from '../config.js';
export default function coveringBranchLabels(
    el: Element,
    hit: Element | null,
    allowedLabels: string[],
) {
    if (!hit || hit === el || hit.contains(el) || el.contains(hit)) {
        return [];
    }
    // The covering branch stops below the first ancestor shared with the target.
    let branch = hit;
    while (branch.parentElement && !branch.parentElement.contains(el)) {
        branch = branch.parentElement;
    }
    const matched = new Set<string>();
    if (['BODY', 'HTML'].includes(branch.tagName)) return [];
    const walker = el.ownerDocument.createTreeWalker(branch, 1);
    let node: Element | null = branch;
    for (
        let visited = 0;
        node && visited < MAX_OBSTRUCTION_NODES && matched.size < MAX_BLOCKER_LABELS;
        visited++, node = walker.nextNode() as Element | null
    ) {
        if (
            node.closest(
                'input, textarea, select, code, pre, [contenteditable], [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"], [role="slider"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="code"]',
            )
        ) {
            continue;
        }
        const ownText = Array.from(node.childNodes)
            .filter((child) => child.nodeType === 3)
            .map((child) => child.textContent || '')
            .join('')
            .trim();
        const name = node.getAttribute('aria-label');
        addMatchingLabels(matched, allowedLabels, ownText, name);
    }
    return Array.from(matched);
}

function addMatchingLabels(
    matched: Set<string>,
    allowedLabels: string[],
    ownText: string,
    name: string | null,
) {
    for (const label of allowedLabels) {
        if (label === ownText || label === name) {
            matched.add(label);
            if (matched.size >= MAX_BLOCKER_LABELS) {
                break;
            }
        }
    }
}
