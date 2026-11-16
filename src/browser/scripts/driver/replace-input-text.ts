import type InspectEditableInputProgram from '../dom/inspect-editable-input.js';
import type FindEditableHostProgram from '../dom/find-editable-host.js';
import type {Locator as PlaywrightLocator} from 'playwright';
import type ReadEditableSelectionProgram from '../dom/read-editable-selection.js';
import type VerifyEditableTextProgram from '../dom/verify-editable-text.js';
import type {ScriptPage} from '../types.js';

import {NUMBER_PATTERN, NUMBER_WITH_UNIT_PATTERN} from '../patterns.js';
import {
    EDITABLE_HOST_IS_UNAVAILABLE,
    INPUT_VALUE_DOES_NOT_MATCH_REQUESTED_REPLACEMENT,
} from '../messages.js';
import domSource1 from '../dom/inspect-editable-input.js?script';
import domSource2 from '../dom/find-editable-host.js?script';
import domSource3 from '../dom/read-editable-selection.js?script';
import domSource4 from '../dom/verify-editable-text.js?script';
import {MAX_EDITABLE_SELECTION_ATTEMPTS} from '../config.js';
export type Input = {ref: string; text: string; submit: boolean};
export default async function script(page: ScriptPage, args: Input) {
    const input = page.locator('aria-ref=' + args.ref);
    const info = await input.evaluate(domSource1 as typeof InspectEditableInputProgram, undefined);
    if (!info.editable) {
        return 'not-editable';
    }
    // An inherited editable paragraph is not a focusable editing host.
    // Focus and read the host; keep native masked-input handling unchanged.
    const handle = info.richText
        ? await input.evaluateHandle(domSource2 as typeof FindEditableHostProgram, undefined)
        : null;
    try {
        const field: Pick<PlaywrightLocator, 'evaluate' | 'press'> | null = handle
            ? handle.asElement()
            : input;
        if (!field) {
            throw new Error(EDITABLE_HOST_IS_UNAVAILABLE);
        }
        const read = () => field.evaluate((el) => ('value' in el ? el.value : el.textContent));
        const before = await read();
        if (info.richText) {
            let selected = false;
            for (let attempt = 0; attempt < MAX_EDITABLE_SELECTION_ATTEMPTS; attempt++) {
                await field.press('ControlOrMeta+A');
                const selection = await field.evaluate(
                    domSource3 as typeof ReadEditableSelectionProgram,
                    undefined,
                );
                if (selection === 'complete') {
                    selected = true;
                    break;
                }
                if (selection !== 'partial') {
                    break;
                }
            }
            if (!selected) {
                return 'not-editable';
            }
        } else {
            await field.press('ControlOrMeta+A');
        }
        if (args.text.length) {
            if (info.codeEditor) {
                await field.evaluate(function pasteEditorText(
                    el: HTMLElement,
                    text: string,
                ): boolean {
                    const clipboard = new DataTransfer();
                    clipboard.setData('text/plain', text);
                    return !el.dispatchEvent(
                        new ClipboardEvent('paste', {
                            clipboardData: clipboard,
                            bubbles: true,
                            cancelable: true,
                        }),
                    );
                }, args.text);
            } else {
                await page.keyboard.insertText(args.text);
            }
        } else {
            await field.press('Backspace');
        }
        if (info.codeEditor) {
            // Monaco exposes only the current accessibility window in
            // textarea.value. Native Select All expands that readback
            // to the complete selected document without changing it.
            await field.press('ControlOrMeta+A');
        }
        const actual = await read();
        const requested = args.text;
        const unit = !info.richText && String(before).match(NUMBER_WITH_UNIT_PATTERN)?.[1];
        const matches = info.richText
            ? await field.evaluate(domSource4 as typeof VerifyEditableTextProgram, requested)
            : actual === requested ||
              (unit && NUMBER_PATTERN.test(requested) && actual === requested + unit);
        if (!matches) {
            throw new Error(INPUT_VALUE_DOES_NOT_MATCH_REQUESTED_REPLACEMENT);
        }
        if (args.submit) {
            await field.press('Enter');
        }
        return {replacementVerified: true};
    } finally {
        await handle?.dispose();
    }
}
