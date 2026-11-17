export default function editableTextMatches(el: HTMLElement, expected: string): boolean {
    // Native multiline insertion creates one editing block per line. innerText
    // adds CSS paragraph separators, which are not additional entered characters.
    const textNode = 3;
    const elementNode = 1;
    const inlineTags = new Set(['SPAN', 'A', 'B', 'I', 'STRONG', 'EM', 'U', 'S', 'CODE']);
    const inlineText = (node: Node): string | undefined => {
        if (node.nodeType === textNode) {
            return node.textContent ?? '';
        }
        if (node.nodeType !== elementNode) {
            return undefined;
        }
        const element = node as HTMLElement;
        if (
            element.getAttribute('contenteditable') === 'false' &&
            element.classList.contains('ProseMirror-widget')
        ) {
            return '';
        }
        if (element.tagName === 'IMG' && element.getAttribute('alt') === '') {
            return '';
        }
        if (element.tagName === 'BR') {
            return element.classList.contains('ProseMirror-trailingBreak') ? '' : '\n';
        }
        if (!inlineTags.has(element.tagName)) {
            return undefined;
        }
        const parts = Array.from(node.childNodes, inlineText);
        return parts.every((part) => part !== undefined) ? parts.join('') : undefined;
    };
    const blocks = Array.from(el.childNodes);
    if (!blocks.length) {
        return expected === '';
    }
    if (
        blocks.length &&
        blocks.every(
            (node) => node.nodeType === elementNode && ['P', 'DIV'].includes(node.nodeName),
        )
    ) {
        const lines = blocks.map((block) => {
            const parts = Array.from(block.childNodes, inlineText);
            if (!parts.every((part) => part !== undefined)) {
                return undefined;
            }
            if (
                parts.join('') === '\n' &&
                Array.from(block.childNodes).every(
                    (node, index) => node.nodeName === 'BR' || parts[index] === '',
                )
            ) {
                return '';
            }
            return parts.join('');
        });
        if (lines.every((line) => line !== undefined)) {
            return lines.join('\n') === expected;
        }
    }
    if (el.innerText === expected) {
        return true;
    }
    // Chromium renders a trailing empty editing block as an extra newline.
    const last = el.lastElementChild;
    const emptyBlock = Boolean(
        last &&
        ['DIV', 'P'].includes(last.tagName) &&
        last.childNodes.length === 1 &&
        last.firstElementChild?.tagName === 'BR',
    );
    if (
        expected === '' &&
        el.textContent === '' &&
        el.childNodes.length === 1 &&
        (last?.tagName === 'BR' || emptyBlock)
    ) {
        return true;
    }
    return Boolean(expected.endsWith('\n') && el.innerText === expected + '\n' && emptyBlock);
}
