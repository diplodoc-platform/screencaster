import type {McpResult} from './types.js';

import {CRLF_PATTERN} from './patterns.js';

// refLocator rejects before the requested callback or single-target action runs.
export function isMissingTargetRef(result: McpResult, ref: string): boolean {
    if (!result?.isError || result.content?.[0]?.type !== 'text') {
        return false;
    }
    const text = result.content[0].text?.replace(CRLF_PATTERN, '\n');
    return (
        text?.split('\n### ', 1)[0] ===
            `### Error\nError: Ref ${ref} not found in the current page snapshot. Try capturing new snapshot.` &&
        !text.includes('\n### Ran Playwright code\n')
    );
}
