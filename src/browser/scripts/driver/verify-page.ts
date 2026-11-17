import type {ScriptPage} from '../types.js';
export type Input = {expected: {url: string; heading: string}};
export default async function script(page: ScriptPage, input: Input) {
    const expected = input.expected;
    if (page.url() !== expected.url) {
        return 'PAGE_VERIFICATION_FAILED';
    }
    const headings = page.getByRole('heading', {name: expected.heading, exact: true});
    let visible = 0;
    for (let i = 0; i < (await headings.count()); i++) {
        if (await headings.nth(i).isVisible()) {
            visible++;
        }
    }
    return visible === 1 ? 'PAGE_VERIFIED' : 'PAGE_VERIFICATION_FAILED';
}
