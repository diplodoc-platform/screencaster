import type {InputExpectation as InputEvidenceInputExpectation} from '../../interaction/input-evidence.js';
import type InspectInputValueProgram from '../dom/inspect-input-value.js';
import type {ScriptPage} from '../types.js';

import domSource1 from '../dom/inspect-input-value.js?script';
export type Input = {
    expectations: InputEvidenceInputExpectation[];
};
export default async function script(page: ScriptPage, input: Input) {
    const observations = [];
    for (const field of input.expectations) {
        const handles = await page.locator('aria-ref=' + field.ref).elementHandles();
        try {
            if (handles.length !== 1 || !(await handles[0].isVisible())) {
                observations.push({ref: field.ref, status: 'unavailable'});
                continue;
            }
            const result = await handles[0].evaluate(
                domSource1 as typeof InspectInputValueProgram,
                field,
            );
            observations.push({ref: field.ref, ...result});
        } finally {
            await Promise.all(handles.map((handle) => handle.dispose()));
        }
    }
    return observations;
}
