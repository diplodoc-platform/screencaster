import type InspectControlHintsProgram from '../dom/inspect-control-hints.js';
import type {ScriptPage} from '../types.js';

import domSource1 from '../dom/inspect-control-hints.js?script';
export type Input = {roles: Record<string, string>; refs: string[]; attributes: string[]};
export default async function script(page: ScriptPage, input: Input) {
    const results = [];
    const roles = input.roles;
    for (const ref of input.refs) {
        const element = page.locator('aria-ref=' + ref);
        const hint = await element
            .evaluate(domSource1 as typeof InspectControlHintsProgram, {
                keys: input.attributes,
                role: roles[ref],
            })
            .catch(() => null);
        if (hint && (hint.editable || hint.state || Object.keys(hint.attributes).length)) {
            results.push({ref, ...hint});
        }
    }
    return results;
}
