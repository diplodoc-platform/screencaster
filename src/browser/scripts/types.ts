import type {BrowserContext, Page} from 'playwright';

export type GuardFailure = {phase: string; category: string};
export type ScriptContext = BrowserContext & {
    __docsSessionContextId?: string;
    __docsRequestGuardFailures?: number;
    __docsRequestGuardBlocked?: {requests: number; redirects: number; sockets: number};
    __docsRequestGuardFailure?: GuardFailure;
};

export type ScriptPage = Omit<Page, 'context'> & {
    context(): ScriptContext;
    __docsMediaClock?: boolean;
};
