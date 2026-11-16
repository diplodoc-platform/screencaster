import type InspectInteractionReadinessProgram from '../dom/inspect-interaction-readiness.js';
import type {ScriptPage} from '../types.js';

import domSource1 from '../dom/inspect-interaction-readiness.js?script';
export type Input = {ref: string; interaction: boolean; textEntry: boolean; labels: string[]};
export default async function script(page: ScriptPage, input: Input) {
    const target = page.locator('aria-ref=' + input.ref);
    if ((await target.count()) !== 1) {
        return {state: 'defer'};
    }
    return target.evaluate(domSource1 as typeof InspectInteractionReadinessProgram, {
        value: input.labels,
        input,
    });
}
