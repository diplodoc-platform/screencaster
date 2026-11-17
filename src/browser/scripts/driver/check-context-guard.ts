import type {ScriptPage} from '../types.js';
export type Input = {id: string | undefined};
export default async function script(page: ScriptPage, input: Input) {
    return page.context().__docsSessionContextId === input.id
        ? 'CONTEXT_GUARD_SAME'
        : 'CONTEXT_GUARD_LOST';
}
