import {
    type BrowserPolicy,
    type CapturePolicyOptions,
    type HostAuthResult,
    type HostAuthenticator,
    createCapturePolicy,
} from '@diplodoc/screencaster/browser';

import {FIXTURE_LANGUAGE_PATH, FIXTURE_LOCALES} from './config.ts';
import {FIXTURE_OUTCOME_UNKNOWN, HOST_LOGIN_FAILED, SAFE_EXAMPLE_ERROR} from './messages.ts';

type Locale = 'ru' | 'en';
export type FixtureOperation = {kind: 'account-language'; locale: Locale};
export type FixtureRequest = {origin: string; path: string; method: 'POST'; body: {locale: Locale}};
export type FixtureAuthorization = {
    // This explicit capability is supplied by the host AFTER task authorization.
    authorized: true;
    purpose: string;
    allowedOperations: readonly FixtureOperation['kind'][];
    fixtureOrigin: string;
};
export type FixtureExecutor = (request: FixtureRequest) => Promise<void>;

function validOrigin(value: string) {
    try {
        const parsed = new URL(value);
        if (
            parsed.protocol !== 'https:' ||
            value !== parsed.origin ||
            parsed.username ||
            parsed.password ||
            parsed.hostname.endsWith('.')
        ) {
            throw new Error(SAFE_EXAMPLE_ERROR);
        }
        return parsed.origin;
    } catch {
        throw new Error(SAFE_EXAMPLE_ERROR);
    }
}
function assertAllowedTarget(target: string, allowedOrigins: readonly string[]) {
    try {
        const parsed = new URL(target);
        if (
            parsed.username ||
            parsed.password ||
            !allowedOrigins.map(validOrigin).includes(parsed.origin)
        ) {
            throw new Error(SAFE_EXAMPLE_ERROR);
        }
        return parsed;
    } catch {
        throw new Error(SAFE_EXAMPLE_ERROR);
    }
}

// The host supplies service-specific permissions; this example has no built-in domains.
export function createHostPolicy(
    target: string,
    options: CapturePolicyOptions = {},
): BrowserPolicy {
    return createCapturePolicy(target, options);
}

// A trusted login implementation owns credentials and provider-specific routes.
// It returns an opaque private storage-state path or challenge.
// The allowlist is checked before that implementation can obtain credentials.
export function hostAuthentication(options: {
    allowedOrigins: readonly string[];
    login: (target: {url: string; origin: string; signal?: AbortSignal}) => Promise<HostAuthResult>;
}): HostAuthenticator {
    const origins = options.allowedOrigins.map(validOrigin);
    return {
        allowedOrigins: origins,
        authenticate: async (target) => {
            const parsed = assertAllowedTarget(target.url, origins);
            target.signal?.throwIfAborted();
            try {
                return await options.login({...target, origin: parsed.origin});
            } catch {
                target.signal?.throwIfAborted();
                throw new Error(HOST_LOGIN_FAILED);
            }
        },
    };
}

// These are illustrative TEST FIXTURE routes, not claims about production APIs.
// The host implements execute using its documented fixture API or a bounded
// browser adapter. This helper never grants write access to the capture browser.
export async function applyFixtureOperation(options: {
    targetUrl: string;
    authorization: FixtureAuthorization;
    operation: FixtureOperation;
    execute: FixtureExecutor;
}): Promise<void> {
    const {authorization, operation} = options;
    if (
        authorization.authorized !== true ||
        !authorization.purpose.trim() ||
        operation.kind !== 'account-language' ||
        !authorization.allowedOperations.includes(operation.kind) ||
        !FIXTURE_LOCALES.includes(operation.locale)
    ) {
        throw new Error(SAFE_EXAMPLE_ERROR);
    }
    const origin = validOrigin(authorization.fixtureOrigin);
    const target = assertAllowedTarget(options.targetUrl, [origin]);
    const fixturePath = FIXTURE_LANGUAGE_PATH;
    if (target.pathname !== fixturePath || target.search || target.hash) {
        throw new Error(SAFE_EXAMPLE_ERROR);
    }
    try {
        await options.execute({
            origin: validOrigin(origin),
            path: fixturePath,
            method: 'POST',
            body: {locale: operation.locale},
        });
    } catch {
        // A request may have been applied before the transport failed. No retry.
        throw new Error(FIXTURE_OUTCOME_UNKNOWN);
    }
}
