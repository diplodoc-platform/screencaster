import associatedInput from './associated-input.js';
import inspectFillTarget from './inspect-fill-target.js';
export default function isLabelNotInput(el: HTMLElement, resolveLabel = true) {
    if (!el) {
        return 'no-element';
    }

    const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
    const EDITABLE_ROLES = new Set(['textbox', 'combobox', 'searchbox']);

    function focusField(field: Element): boolean {
        let host = field as HTMLElement;
        while (host.isContentEditable && host.parentElement?.isContentEditable) {
            host = host.parentElement;
        }
        // focus() silently does nothing for hidden or disabled fields. Never
        // substitute a previously focused, unrelated field for this target.
        host.focus();
        let active = host.ownerDocument.activeElement;
        while (active) {
            if (active === host) {
                return true;
            }
            active = active.shadowRoot?.activeElement ?? null;
        }
        return false;
    }

    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();

    const isEditable = EDITABLE_TAGS.has(tag) || (el as HTMLElement).isContentEditable;
    if (isEditable) {
        return inspectFillTarget(el) === 'fillable' ? 'is-input' : 'not-editable';
    }
    const associated = associatedInput(el);
    if (associated) {
        if (inspectFillTarget(associated.field) !== 'fillable') {
            return 'not-editable';
        }
        if (!resolveLabel) {
            return 'not-label';
        }
        return focusField(associated.field) ? associated.resolution : 'not-editable';
    }

    return EDITABLE_ROLES.has(role) ? 'not-editable' : 'not-label';
}
