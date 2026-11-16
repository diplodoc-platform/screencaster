import type {ScriptPage} from '../types.js';
export type Input = {id: string | undefined};
export default async function script(page: ScriptPage, input: Input) {
    page.context().__docsSessionContextId = input.id;
    return 'CONTEXT_GUARD_READY';
}
