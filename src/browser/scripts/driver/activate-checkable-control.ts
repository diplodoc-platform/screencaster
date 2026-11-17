import type {ScriptPage} from '../types.js';

import {
    NATIVE_CONTROL_COULD_NOT_RECEIVE_KEYBOARD_FOCUS,
    NATIVE_CONTROL_IS_DISABLED,
    NATIVE_CONTROL_STATE_DID_NOT_MATCH_ACTIVATION,
} from '../messages.js';
export type Input = {ref: string};
export default async function script(page: ScriptPage, input: Input) {
    const control = page.locator('aria-ref=' + input.ref);
    const info = await control.evaluate((el) => ({
        native: el.tagName === 'INPUT',
        type: (el as HTMLInputElement).type,
        disabled: (el as HTMLInputElement).disabled,
    }));
    if (
        !info.native ||
        !['checkbox', 'radio'].includes(info.type) ||
        !(await control.isVisible())
    ) {
        return false;
    }
    if (info.disabled) {
        throw new Error(NATIVE_CONTROL_IS_DISABLED);
    }
    const before = await control.isChecked();
    await control.focus();
    if (!(await control.evaluate((el) => el.matches(':focus')))) {
        throw new Error(NATIVE_CONTROL_COULD_NOT_RECEIVE_KEYBOARD_FOCUS);
    }
    await control.press('Space');
    const after = await control.isChecked();
    if (after !== (info.type === 'checkbox' ? !before : true)) {
        throw new Error(NATIVE_CONTROL_STATE_DID_NOT_MATCH_ACTIVATION);
    }
    return 'native-' + info.type + '-' + (after ? 'checked' : 'unchecked');
}
