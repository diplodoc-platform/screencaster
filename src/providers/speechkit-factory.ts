import type {HostTtsFactory} from '../application/host-providers.js';

import {registerSecret} from '../shared/sanitize-for-model.js';

import {SpeechKitProvider} from './speech-kit.js';
import {resolveSecret} from './secrets.js';
import {
    readServiceAccountKey,
    speechkitOptionsError,
    speechkitOptionsSchema,
} from './speechkit-options.js';
import {serviceAccountToken} from './speechkit-iam.js';
import {SPEECHKIT_OPTIONS_INVALID} from './messages.js';

// Resolve trusted credentials during launch, before opening or mutating the target.
export const createTts: HostTtsFactory = async (input, {baseDirectory}) => {
    const parsed = speechkitOptionsSchema.safeParse(input);
    if (!parsed.success) {
        throw new Error(speechkitOptionsError(input));
    }
    const options = parsed.data;
    const settings = {voice: options.voice, speed: options.speed};
    const serviceAccount = 'serviceAccount' in options ? options.serviceAccount : undefined;
    const serviceAccountKey =
        'serviceAccountKey' in options ? options.serviceAccountKey : undefined;
    if (serviceAccount || serviceAccountKey !== undefined) {
        let account: {keyId: string; serviceAccountId: string; privateKey: string};
        if (serviceAccount) {
            account = {
                keyId: await resolveSecret(serviceAccount.keyId, baseDirectory),
                serviceAccountId: await resolveSecret(
                    serviceAccount.serviceAccountId,
                    baseDirectory,
                ),
                privateKey: await resolveSecret(serviceAccount.privateKey, baseDirectory),
            };
        } else {
            const key = await readServiceAccountKey(serviceAccountKey, baseDirectory);
            account = {
                keyId: key.id,
                serviceAccountId: key.service_account_id,
                privateKey: key.private_key,
            };
            registerSecret(key.private_key);
        }
        return new SpeechKitProvider({...settings, getIamToken: serviceAccountToken(account)});
    }
    if ('apiKey' in options) {
        return new SpeechKitProvider({
            ...settings,
            apiKey: await resolveSecret(options.apiKey, baseDirectory),
        });
    }
    if ('iamToken' in options) {
        return new SpeechKitProvider({
            ...settings,
            iamToken: await resolveSecret(options.iamToken, baseDirectory),
            folderId: options.folderId,
        });
    }
    throw new Error(SPEECHKIT_OPTIONS_INVALID);
};
