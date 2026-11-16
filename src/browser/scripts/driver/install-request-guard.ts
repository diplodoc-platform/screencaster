import type {Page, Request} from 'playwright';
import type {ScriptPage} from '../types.js';
import type {RequestGuardOptions} from '../../network-guard-options.js';

import {
    NETWORK_CLOSED_PATTERN,
    NETWORK_DNS_PATTERN,
    NETWORK_REFUSED_PATTERN,
    NETWORK_RESET_PATTERN,
    NETWORK_TIMEOUT_PATTERN,
    NETWORK_TLS_PATTERN,
} from '../patterns.js';
export type Input = RequestGuardOptions;
export default async function script(page: ScriptPage, input: Input) {
    const allowedPosts = input.postReads;
    const context = page.context();
    context.__docsRequestGuardFailures = 0;
    const blocked = (context.__docsRequestGuardBlocked = {requests: 0, redirects: 0, sockets: 0});
    context.__docsRequestGuardFailure = undefined;
    const deny = (category: string) => {
        if (input.strictViolations) {
            context.__docsRequestGuardFailures = (context.__docsRequestGuardFailures ?? 0) + 1;
            context.__docsRequestGuardFailure ??= {phase: 'dispatch', category};
        }
    };
    const denied = (url: string) => {
        const parsed = new URL(url);
        const lower = parsed.hostname.toLowerCase();
        const host = lower.endsWith('.') ? lower.slice(0, -1) : lower;
        return (input.deniedHosts ?? []).some(
            (entry) => host === entry || host.endsWith(`.${entry}`),
        );
    };
    const navigationAllowed = (url: string) => {
        if (!input.allowedNavigationUrls) {
            return true;
        }
        const parsed = new URL(url);
        parsed.hash = '';
        return input.allowedNavigationUrls.includes(parsed.href);
    };
    const requestViolation = (request: Request): string | undefined => {
        if (input.blockPopups) {
            try {
                if (request.frame().page() !== page) {
                    return 'policy-popup';
                }
            } catch {
                // The popup opener frame can be inaccessible before the page
                // event fires. Never dispatch an unowned request in that gap.
                return 'policy-popup';
            }
        }

        if (input.deniedHosts?.length && denied(request.url())) {
            return 'policy-host';
        }
        if (input.allowedOrigins) {
            const parsed = new URL(request.url());
            if (
                !['http:', 'https:'].includes(parsed.protocol) ||
                parsed.username ||
                parsed.password ||
                !input.allowedOrigins.includes(parsed.origin)
            ) {
                return 'policy-host';
            }
        }
        if (
            input.allowedNavigationUrls &&
            request.isNavigationRequest() &&
            !navigationAllowed(request.url())
        ) {
            return 'policy-navigation';
        }
        const method = request.method();
        const safe =
            ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
            (method === 'POST' &&
                allowedPosts.some((endpoint) => request.url() === endpoint.origin + endpoint.path));
        return safe ? undefined : 'policy-write';
    };
    const preparePage = (owned: ScriptPage | Page) => {
        if (input.blockDownloads) {
            owned.on('download', (download) => {
                deny('policy-download');
                download.cancel().catch(() => {});
            });
        }
    };
    preparePage(page);
    if (input.blockPopups || input.blockDownloads) {
        context.on('page', (opened) => {
            if (input.blockPopups && opened !== page) {
                deny('policy-popup');
                opened.close().catch(() => {});
            } else {
                preparePage(opened);
            }
        });
    }
    await context.route('**/*', async (route) => {
        let phase = 'dispatch';
        try {
            const request = route.request();
            const method = request.method();
            const violation = requestViolation(request);
            if (violation) {
                blocked.requests++;
                deny(violation);
                await route.abort('blockedbyclient');
                return;
            }
            if (method === 'POST' || input.blockRedirects) {
                // Bound every HTTP hop before dispatch. Redirects are refused in
                // the capture profile; login and canonicalization belong to host setup.
                phase = 'fetch';
                const response = await route.fetch({maxRedirects: 0, maxRetries: 0});
                if (
                    input.blockDownloads &&
                    (response.headers()['content-disposition'] ?? '')
                        .toLowerCase()
                        .includes('attachment')
                ) {
                    blocked.requests++;
                    deny('policy-download');
                    phase = 'abort';
                    await route.abort('blockedbyclient');
                } else if (response.status() >= 300 && response.status() < 400) {
                    phase = 'abort';
                    blocked.redirects++;
                    deny('policy-redirect');
                    await route.abort('blockedbyclient');
                } else {
                    phase = 'fulfill';
                    await route.fulfill({response});
                }
            } else {
                // Preserve MCP's other routes for the legacy read-only guard.
                phase = 'fallback';
                await route.fallback();
            }
        } catch (error) {
            // Playwright errors can contain Cookie/Authorization headers.
            // Never rethrow or log that exception from an event callback.
            context.__docsRequestGuardFailures = (context.__docsRequestGuardFailures ?? 0) + 1;
            // Keep only fixed labels, never the message, URL, or headers.
            // Classify the first line only: subsequent call-log lines may
            // contain arbitrary request headers which resemble error codes.
            const category = errorCategory(error);
            context.__docsRequestGuardFailure ??= {phase, category};
            try {
                await route.abort('failed');
            } catch {
                // The page may have closed; no fallback or retry is safe.
            }
        }
    });
    await context.routeWebSocket('**/*', (socket) => {
        blocked.sockets++;
        deny('policy-socket');
        socket.close();
    });
    return 'REQUEST_GUARD_INSTALLED';
}

// Driver callbacks can receive Error objects created in another Node VM realm.
function firstErrorLine(error: unknown): string {
    if (
        error === null ||
        (typeof error !== 'object' && typeof error !== 'function') ||
        !('message' in error) ||
        typeof error.message !== 'string'
    ) {
        return '';
    }
    return error.message.split('\n')[0];
}

function errorCategory(error: unknown) {
    const firstLine = firstErrorLine(error);
    const patterns = [
        ['reset', NETWORK_RESET_PATTERN],
        ['timeout', NETWORK_TIMEOUT_PATTERN],
        ['dns', NETWORK_DNS_PATTERN],
        ['tls', NETWORK_TLS_PATTERN],
        ['refused', NETWORK_REFUSED_PATTERN],
        ['closed', NETWORK_CLOSED_PATTERN],
    ] as const;
    return patterns.find(([, pattern]) => pattern.test(firstLine))?.[0] ?? 'unknown';
}
