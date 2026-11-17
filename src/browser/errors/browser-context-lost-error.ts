import {MAX_CONTEXT_ERROR_CHAIN} from '../config.js';
import {BROWSER_CONTEXT_LOST_MESSAGE} from '../messages.js';
export class BrowserContextLostError extends Error {
    constructor(options?: ErrorOptions) {
        super(BROWSER_CONTEXT_LOST_MESSAGE, options);
        this.name = 'BrowserContextLostError';
    }
}

// Trusted error objects only. Model/MCP text cannot authorize a fresh execution.
export function browserContextLoss(error: unknown): BrowserContextLostError | undefined {
    const pending = [error];
    const seen = new Set<Error>();
    while (pending.length && seen.size < MAX_CONTEXT_ERROR_CHAIN) {
        const value = pending.shift();
        if (!(value instanceof Error) || seen.has(value)) {
            continue;
        }
        if (value instanceof BrowserContextLostError) {
            return value;
        }
        seen.add(value);
        if ('cause' in value) {
            pending.push(value.cause);
        }
        if ('errors' in value && Array.isArray(value.errors)) {
            pending.push(...value.errors.slice(0, MAX_CONTEXT_ERROR_CHAIN));
        }
    }
    return undefined;
}
