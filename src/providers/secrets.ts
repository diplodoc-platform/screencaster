import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';

import {registerSecret} from '../shared/sanitize-for-model.js';

import {ENVIRONMENT_NAME_PATTERN} from './patterns.js';
import {SPEECH_SECRET_FILE_MAX_BYTES} from './config.js';
import {
    SPEECHKIT_ENV_UNAVAILABLE,
    SPEECHKIT_FILE_UNAVAILABLE,
    SPEECHKIT_SECRET_UNAVAILABLE,
} from './messages.js';

export const environmentValueSchema = z.union([
    z.string().min(1),
    z.object({env: z.string().regex(ENVIRONMENT_NAME_PATTERN)}).strict(),
]);

export const secretSourceSchema = z.union([
    ...environmentValueSchema.options,
    z.object({file: z.string().min(1)}).strict(),
]);

export async function resolveSecret(
    source: z.infer<typeof secretSourceSchema>,
    baseDirectory: string,
): Promise<string> {
    try {
        let value: string | undefined;
        if (typeof source === 'string') {
            value = source;
        } else if ('env' in source) {
            value = process.env[source.env];
        } else {
            const file = path.resolve(baseDirectory, source.file);
            const info = await fs.lstat(file);
            if (
                !info.isFile() ||
                info.isSymbolicLink() ||
                info.size > SPEECH_SECRET_FILE_MAX_BYTES ||
                (process.platform !== 'win32' && info.mode % 0o1000 !== 0o600)
            ) {
                throw new Error(SPEECHKIT_SECRET_UNAVAILABLE);
            }
            value = await fs.readFile(file, 'utf8');
        }
        value = value?.trim();
        if (!value) {
            throw new Error(SPEECHKIT_SECRET_UNAVAILABLE);
        }
        registerSecret(value);
        return value;
    } catch {
        if (typeof source === 'object') {
            throw new Error(
                'file' in source ? SPEECHKIT_FILE_UNAVAILABLE : SPEECHKIT_ENV_UNAVAILABLE,
            );
        }
        throw new Error(SPEECHKIT_SECRET_UNAVAILABLE);
    }
}
