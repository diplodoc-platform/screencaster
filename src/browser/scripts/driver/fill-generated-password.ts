import type {ScriptPage} from '../types.js';
export type Input = {ref: string; generatedPassword: string};
export default async function script(page: ScriptPage, input: Input) {
    const field = page.locator('aria-ref=' + input.ref);
    if ((await field.getAttribute('type')) !== 'password' || !(await field.isEditable())) {
        return {filled: false};
    }
    const value = input.generatedPassword;
    await field.fill(value);
    await field.press('Tab');
    if ((await field.getAttribute('type')) !== 'password') {
        await field.fill('');
        return {filled: false};
    }
    return {filled: (await field.inputValue()) === value};
}
