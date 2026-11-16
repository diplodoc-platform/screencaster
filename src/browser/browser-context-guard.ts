import type {McpStdioClient} from '../transport/mcp/client.js';
import type {McpResult} from '../transport/mcp/types.js';

import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

import {extractText} from '../transport/mcp/result.js';

import {CONTEXT_CHECK_ATTEMPTS, CONTEXT_CHECK_RETRY_BASE_MS, GUARD_TIMEOUT_MS} from './config.js';
import {driverScript} from './scripts/driver-script.js';
import {GUARD_READY_PATTERN, GUARD_STATE_PATTERN} from './patterns.js';
import {
    BROWSER_CONTEXT_CONTINUITY_COULD_NOT_BE_VERIFIED,
    BROWSER_CONTEXT_GUARD_COULD_NOT_BE_INSTALLED,
} from './messages.js';
import {BrowserContextLostError} from './errors/browser-context-lost-error.js';

// This property lives on the driver-side BrowserContext, outside the page JS world.
export class BrowserContextGuard {
    private id: string | undefined;
    private lost = false;

    private readonly client: McpStdioClient;

    private readonly onLost?: () => void;

    constructor(client: McpStdioClient, onLost?: () => void) {
        this.onLost = onLost;
        this.client = client;
    }

    async install(): Promise<void> {
        const id = randomUUID();
        const result = (await this.client.callTool('browser_run_code', {
            code: driverScript('install-context-guard', {id: id}),
        })) as McpResult;
        if (
            !result ||
            result.isError ||
            !GUARD_READY_PATTERN.test(extractText(result as McpResult))
        ) {
            throw new Error(BROWSER_CONTEXT_GUARD_COULD_NOT_BE_INSTALLED);
        }
        this.id = id;
        this.lost = false;
    }

    assertKnownContext(): void {
        if (this.lost) {
            throw new BrowserContextLostError();
        }
    }

    async check(): Promise<void> {
        this.assertKnownContext();
        if (!this.id) {
            return;
        }
        for (let attempt = 0; attempt < CONTEXT_CHECK_ATTEMPTS; attempt++) {
            let state: string | undefined;
            try {
                const result = (await this.client.callTool(
                    'browser_run_code',
                    {
                        code: driverScript('check-context-guard', {id: this.id}),
                    },
                    GUARD_TIMEOUT_MS,
                )) as McpResult;
                state =
                    result && !result.isError
                        ? extractText(result).match(GUARD_STATE_PATTERN)?.[1]
                        : undefined;
            } catch {
                // Context teardown may still be settling. Only this read-only probe is retried.
            }
            if (state === 'LOST') {
                this.lost = true;
                this.onLost?.();
                throw new BrowserContextLostError();
            }
            if (state === 'SAME') {
                return;
            }
            if (attempt < CONTEXT_CHECK_ATTEMPTS - 1) {
                await delay(CONTEXT_CHECK_RETRY_BASE_MS * 2 ** attempt);
            }
        }
        throw new Error(BROWSER_CONTEXT_CONTINUITY_COULD_NOT_BE_VERIFIED);
    }

    async checkAfterFailure(error: unknown): Promise<never> {
        try {
            await this.check();
        } catch (observationError) {
            if (observationError instanceof BrowserContextLostError) {
                throw observationError;
            }
            // A failed probe is not proof of a replaced context. Preserve the original failure.
        }
        throw error;
    }
}
