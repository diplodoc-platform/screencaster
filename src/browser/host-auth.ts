import type {BrowserPolicy} from './policy.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';

import {PRIVATE_FILE_MODE} from '../shared/config.js';

import {canonicalNavigationUrl, exactOrigin} from './network-guard-options.js';
import {
    HOST_AUTH_FAILED,
    HOST_AUTH_STATE_INVALID,
    HOST_AUTH_TARGET_REFUSED,
} from './policy-messages.js';

export type HostAuthTarget = {url: string; origin: string; signal?: AbortSignal};
const hostAuthResultSchema = z.discriminatedUnion('status', [
    z
        .object({
            status: z.literal('ready'),
            origin: z.string(),
            storageStatePath: z.string(),
            expiresAt: z.number().finite().optional(),
        })
        .strict(),
    z
        .object({
            status: z.literal('challenge'),
            origin: z.string(),
            challenge: z.enum(['captcha', 'mfa', 'webauthn', 'device']),
        })
        .strict(),
]);
export type HostAuthResult = z.infer<typeof hostAuthResultSchema>;
export type HostAuthenticator = {
    allowedOrigins: readonly string[];
    authenticate: (target: HostAuthTarget) => Promise<HostAuthResult>;
};

// This is a trusted host boundary. Only metadata, never credential/state contents,
// enters the package. A challenge requires an explicit host manual-continuation flow.
export async function authenticateWithHost(options: {
    targetUrl: string;
    policy: BrowserPolicy;
    authentication: HostAuthenticator;
    signal?: AbortSignal;
}): Promise<HostAuthResult> {
    options.signal?.throwIfAborted();
    const url = canonicalNavigationUrl(options.targetUrl);
    const origin = new URL(url).origin;
    try {
        options.policy.assertUrl(url, 'read');
        if (!options.authentication.allowedOrigins.map(exactOrigin).includes(origin)) {
            throw new Error();
        }
    } catch {
        throw new Error(HOST_AUTH_TARGET_REFUSED);
    }
    let raw: unknown;
    try {
        raw = await options.authentication.authenticate({url, origin, signal: options.signal});
    } catch {
        options.signal?.throwIfAborted();
        throw new Error(HOST_AUTH_FAILED);
    }
    options.signal?.throwIfAborted();
    const parsed = hostAuthResultSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error(HOST_AUTH_STATE_INVALID);
    }
    const result = parsed.data;
    if (result.origin !== origin) {
        throw new Error(HOST_AUTH_STATE_INVALID);
    }
    if (result.status === 'challenge') {
        return result;
    }
    if (
        !path.isAbsolute(result.storageStatePath) ||
        (result.expiresAt !== undefined && result.expiresAt <= Date.now())
    ) {
        throw new Error(HOST_AUTH_STATE_INVALID);
    }
    try {
        const info = await fs.lstat(result.storageStatePath);
        if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            info.size === 0 ||
            (process.platform !== 'win32' && info.mode % 0o1000 !== PRIVATE_FILE_MODE)
        ) {
            throw new Error();
        }
    } catch {
        throw new Error(HOST_AUTH_STATE_INVALID);
    }
    return {
        status: 'ready',
        origin,
        storageStatePath: result.storageStatePath,
        ...(result.expiresAt === undefined ? {} : {expiresAt: result.expiresAt}),
    };
}
