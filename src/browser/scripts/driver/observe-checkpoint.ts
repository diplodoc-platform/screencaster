import type {PageCheckpoint as RuntimePageCheckpoint} from '../../runtime.js';
import type {ScriptPage} from '../types.js';
export type Input = {
    expected: RuntimePageCheckpoint;
    waitMs_0: boolean;
    waitMs: number;
};
export default async function script(page: ScriptPage, input: Input) {
    const expected = input.expected;
    if (page.url() !== expected.url) {
        return 'CHECKPOINT_MISSING';
    }
    const matches = page.getByRole(expected.role, {name: expected.name, exact: true});
    if (input.waitMs_0) {
        try {
            await matches.waitFor({state: 'visible', timeout: input.waitMs});
        } catch {
            return 'CHECKPOINT_MISSING';
        }
    }
    let visible = 0;
    for (let i = 0; i < (await matches.count()); i++) {
        if (await matches.nth(i).isVisible()) {
            visible++;
        }
    }
    return visible === 1 ? 'CHECKPOINT_OBSERVED' : 'CHECKPOINT_MISSING';
}
