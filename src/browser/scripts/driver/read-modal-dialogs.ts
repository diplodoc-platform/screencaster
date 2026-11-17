import type InspectModalDialogProgram from '../dom/inspect-modal-dialog.js';
import type {ScriptPage} from '../types.js';

import domSource1 from '../dom/inspect-modal-dialog.js?script';
export type Input = {refs: string[]};
export default async function script(page: ScriptPage, input: Input) {
    const modal = [];
    for (const ref of input.refs) {
        const elements = await page.locator('aria-ref=' + ref).elementHandles();
        try {
            if (elements.length !== 1) {
                return null;
            }
            const state = await elements[0].evaluate(
                domSource1 as typeof InspectModalDialogProgram,
                undefined,
            );
            if (!state.connected) {
                return null;
            }
            if (state.modal) {
                modal.push(ref);
            }
        } finally {
            for (const element of elements) {
                await element.dispose();
            }
        }
    }
    return modal;
}
