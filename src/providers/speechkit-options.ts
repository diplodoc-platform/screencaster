import {z} from 'zod';

import {schemaDiagnostic, schemaPropertyNames} from '../shared/schema-diagnostics.js';

import {environmentValueSchema, resolveSecret, secretSourceSchema} from './secrets.js';
import {MAX_SPEECH_SPEED, MIN_SPEECH_SPEED} from './config.js';
import {SPEECHKIT_VOICE_NAME_PATTERN} from './patterns.js';
import {
    SPEECHKIT_KEY_INVALID,
    SPEECHKIT_OPTIONS_INVALID,
    SPEECHKIT_OPTIONS_PREFIX,
} from './messages.js';

const settings = {
    voice: z.string().regex(SPEECHKIT_VOICE_NAME_PATTERN).optional(),
    speed: z.number().min(MIN_SPEECH_SPEED).max(MAX_SPEECH_SPEED).optional(),
};
const modes = {
    apiKey: z.object({...settings, apiKey: secretSourceSchema}).strict(),
    iamToken: z
        .object({...settings, iamToken: secretSourceSchema, folderId: z.string().min(1).optional()})
        .strict(),
    serviceAccountKey: z.object({...settings, serviceAccountKey: secretSourceSchema}).strict(),
    serviceAccount: z
        .object({
            ...settings,
            serviceAccount: z
                .object({
                    keyId: environmentValueSchema,
                    serviceAccountId: environmentValueSchema,
                    privateKey: secretSourceSchema,
                })
                .strict(),
        })
        .strict(),
};
export const speechkitOptionsSchema = z.union([
    modes.apiKey,
    modes.iamToken,
    modes.serviceAccountKey,
    modes.serviceAccount,
]);
const names = schemaPropertyNames(z.toJSONSchema(speechkitOptionsSchema, {io: 'input'}));

export function speechkitOptionsError(input: Record<string, unknown>) {
    const selected = (Object.keys(modes) as Array<keyof typeof modes>).filter(
        (key) => input[key] !== undefined,
    );
    if (selected.length !== 1) return SPEECHKIT_OPTIONS_INVALID;
    const result = modes[selected[0]].safeParse(input);
    return result.success
        ? SPEECHKIT_OPTIONS_INVALID
        : schemaDiagnostic(result.error, names, SPEECHKIT_OPTIONS_PREFIX, 'tts.options');
}

const authorizedKeySchema = z.object({
    id: z.string().min(1),
    service_account_id: z.string().min(1),
    private_key: z.string().min(1),
});

export async function readServiceAccountKey(
    source: z.infer<typeof secretSourceSchema> | undefined,
    baseDirectory: string,
) {
    const text = await resolveSecret(source ?? '', baseDirectory);
    try {
        return authorizedKeySchema.parse(JSON.parse(text));
    } catch {
        throw new Error(SPEECHKIT_KEY_INVALID);
    }
}
