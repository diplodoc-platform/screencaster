import {MAX_CONTROL_LABEL_CHARS} from '../config.js';
import {CHECKABLE_ROLE_PATTERN} from '../patterns.js';

type ControlHint = {
    attributes: Record<string, string>;
    editable?: boolean;
    state?: {source: string; value: string | boolean};
};

export default (
    el: SVGElement | HTMLElement,
    options: {keys: string[]; role: string},
): ControlHint | null => {
    if (!el.isConnected) {
        return null;
    }
    const attributes: Record<string, string> = {};
    if (options.role === 'paragraph') {
        return (el as HTMLElement).isContentEditable ? {attributes, editable: true} : null;
    }
    if (CHECKABLE_ROLE_PATTERN.test(options.role)) {
        return checkableHint(el, options.role, attributes);
    }
    for (const key of options.keys) {
        const value = el.getAttribute(key);
        if (value && value.length <= MAX_CONTROL_LABEL_CHARS) {
            attributes[key] = value;
        }
    }
    return {attributes};
};

function checkableHint(
    el: SVGElement | HTMLElement,
    role: string,
    attributes: Record<string, string>,
): ControlHint | null {
    const native =
        el instanceof HTMLInputElement &&
        ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio');
    const actualRole = el.getAttribute('role') || (native ? (el as HTMLInputElement).type : '');
    if (actualRole !== role) {
        return null;
    }
    if (native) {
        if (el.indeterminate && role !== 'checkbox') {
            return null;
        }
        return {
            attributes,
            state: {
                source: 'native',
                value: el.indeterminate ? 'mixed' : el.checked,
            },
        };
    }
    const checked = el.getAttribute('aria-checked');
    if (checked === 'true' || checked === 'false' || (checked === 'mixed' && role === 'checkbox')) {
        return {
            attributes,
            state: {
                source: 'aria',
                value: checked === 'mixed' ? 'mixed' : checked === 'true',
            },
        };
    }
    return null;
}
