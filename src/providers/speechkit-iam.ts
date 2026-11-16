import {constants, createPrivateKey, sign} from 'node:crypto';

import {registerSecret} from '../shared/sanitize-for-model.js';

import {
    IAM_JWT_LIFETIME_SECONDS,
    IAM_REFRESH_MARGIN_MS,
    IAM_REQUEST_TIMEOUT_MS,
    IAM_TOKEN_ENDPOINT,
} from './config.js';
import {SPEECHKIT_IAM_FAILED, SPEECHKIT_PEM_INVALID} from './messages.js';

export function serviceAccountToken(options: {
    keyId: string;
    serviceAccountId: string;
    privateKey: string;
}) {
    let key: ReturnType<typeof createPrivateKey>;
    try {
        key = createPrivateKey(options.privateKey);
    } catch {
        throw new Error(SPEECHKIT_PEM_INVALID);
    }
    let token: string | undefined;
    let expiresAt = 0;
    let pending:
        {promise: Promise<string>; controller: AbortController; subscribers: number} | undefined;
    const exchange = async (signal: AbortSignal) => {
        try {
            const now = Math.floor(Date.now() / 1000);
            const encode = (value: unknown) =>
                Buffer.from(JSON.stringify(value)).toString('base64url');
            const unsigned = `${encode({alg: 'PS256', typ: 'JWT', kid: options.keyId})}.${encode({aud: IAM_TOKEN_ENDPOINT, iss: options.serviceAccountId, iat: now, exp: now + IAM_JWT_LIFETIME_SECONDS})}`;
            const signature = sign('sha256', Buffer.from(unsigned), {
                key,
                padding: constants.RSA_PKCS1_PSS_PADDING,
                saltLength: 32,
            });
            const jwt = `${unsigned}.${signature.toString('base64url')}`;
            registerSecret(jwt);
            const response = await fetch(IAM_TOKEN_ENDPOINT, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.any([AbortSignal.timeout(IAM_REQUEST_TIMEOUT_MS), signal]),
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({jwt}),
            });
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error(SPEECHKIT_IAM_FAILED);
            }
            const result = (await response.json()) as {iamToken?: unknown; expiresAt?: unknown};
            if (
                typeof result.iamToken !== 'string' ||
                !result.iamToken.trim() ||
                typeof result.expiresAt !== 'string'
            ) {
                throw new Error(SPEECHKIT_IAM_FAILED);
            }
            const expiry = Date.parse(result.expiresAt);
            if (!Number.isFinite(expiry) || expiry <= Date.now() + IAM_REFRESH_MARGIN_MS) {
                throw new Error(SPEECHKIT_IAM_FAILED);
            }
            signal.throwIfAborted();
            token = result.iamToken;
            expiresAt = expiry;
            registerSecret(token);
            return token;
        } catch {
            signal.throwIfAborted();
            throw new Error(SPEECHKIT_IAM_FAILED);
        }
    };
    return async (signal?: AbortSignal) => {
        signal?.throwIfAborted();
        if (token && Date.now() < expiresAt - IAM_REFRESH_MARGIN_MS) {
            return token;
        }
        if (!pending) {
            const controller = new AbortController();
            const request = {
                controller,
                subscribers: 0,
                promise: exchange(controller.signal).finally(() => {
                    if (pending === request) pending = undefined;
                }),
            };
            pending = request;
        }
        const request = pending;
        request.subscribers++;
        return new Promise<string>((resolve, reject) => {
            let settled = false;
            const finish = (complete: () => void) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                request.subscribers--;
                if (request.subscribers === 0 && pending === request) {
                    pending = undefined;
                    request.controller.abort();
                }
                complete();
            };
            function onAbort() {
                finish(() => reject(signal?.reason));
            }
            signal?.addEventListener('abort', onAbort, {once: true});
            request.promise.then(
                (value) => finish(() => resolve(value)),
                (error: unknown) => finish(() => reject(error)),
            );
            if (signal?.aborted) onAbort();
        });
    };
}
