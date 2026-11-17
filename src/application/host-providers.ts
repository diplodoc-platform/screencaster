import type {ServerOptions} from '../server/mcp/index.js';
import type {HostAuthenticator} from '../browser/host-auth.js';
import type {TtsProvider} from '../media/audio/audio.js';

import {PROVIDER_MODULE_MUST_EXPORT_LOADER_AND_OR_TTS} from './cli-messages.js';

export type HostProviders = Pick<
    ServerOptions,
    'loader' | 'tts' | 'policyFactory' | 'authentication' | 'screenshotPolicy'
>;

export type HostAuthenticationFactory = (
    options: Record<string, unknown>,
    context: {baseDirectory: string},
) => HostAuthenticator | Promise<HostAuthenticator>;

export type HostTtsFactory = (
    options: Record<string, unknown>,
    context: {baseDirectory: string},
) => TtsProvider | Promise<TtsProvider>;

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

function optional(value: unknown, predicate: (candidate: unknown) => boolean) {
    return value === undefined || predicate(value);
}

export function validateHostProviders(value: unknown): HostProviders {
    if (!object(value)) {
        throw new Error(PROVIDER_MODULE_MUST_EXPORT_LOADER_AND_OR_TTS);
    }
    const capabilities = ['loader', 'tts', 'policyFactory', 'authentication', 'screenshotPolicy'];
    const callable = (candidate: unknown) => typeof candidate === 'function';
    if (
        !capabilities.some((name) => value[name] !== undefined) ||
        !optional(value.loader, callable) ||
        !optional(value.policyFactory, callable) ||
        !optional(
            value.tts,
            (candidate) =>
                object(candidate) &&
                callable(candidate.synthesize) &&
                typeof candidate.identity === 'string',
        ) ||
        !optional(
            value.authentication,
            (candidate) =>
                object(candidate) &&
                callable(candidate.authenticate) &&
                Array.isArray(candidate.allowedOrigins),
        ) ||
        !optional(value.screenshotPolicy, object)
    ) {
        throw new Error(PROVIDER_MODULE_MUST_EXPORT_LOADER_AND_OR_TTS);
    }
    // The module is explicitly trusted by the host; this validates capability
    // shape without wrapping callbacks or exposing any host-owned values.
    return value as HostProviders;
}
