export default function associatedInput(el: Element) {
    if (!['LABEL', 'SPAN', 'DIV', 'P'].includes(el.tagName)) {
        return undefined;
    }
    if (
        el.tagName !== 'LABEL' &&
        el.closest('a, button, [role=button], [role=checkbox], [role=radio]')
    ) {
        return undefined;
    }
    const label = el.closest('label');
    if (!label) {
        return undefined;
    }
    const field =
        label.control ??
        label.querySelector<HTMLElement>(
            'input, textarea, select, [role="textbox"], [contenteditable="true"]',
        );
    if (!field) {
        return undefined;
    }
    let resolution = 'resolved-parent-label';
    if (el === label) {
        resolution = label.control ? 'resolved-for' : 'resolved-inner';
    }
    return {field, resolution};
}
