import type InspectPointerObstructionProgram from '../dom/inspect-pointer-obstruction.js';
import type {ScriptPage} from '../types.js';

import domSource1 from '../dom/inspect-pointer-obstruction.js?script';
import {POINTER_READINESS_TIMEOUT_MS} from '../config.js';
export type Input = {
    ref: string;
    method: 'click' | 'dblclick';
    button: 'left' | 'right' | 'middle';
    labels: string[];
};
export default async function script(page: ScriptPage, input: Input) {
    const target = page.locator('aria-ref=' + input.ref);
    if ((await target.count()) !== 1) {
        return {state: 'defer'};
    }
    try {
        await target[input.method]({
            trial: true,
            timeout: POINTER_READINESS_TIMEOUT_MS,
            button: input.button,
        });
        return {state: 'defer'};
    } catch {
        return target
            .evaluate(domSource1 as typeof InspectPointerObstructionProgram, input.labels)
            .catch(() => ({state: 'not-ready'}));
    }
}
