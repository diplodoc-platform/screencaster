import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';

import {registerSecret} from '../shared/sanitize-for-model.js';

import {MAX_LAUNCH_ENV_FILE_BYTES} from './config.js';
import {ENVIRONMENT_VARIABLE_PATTERN} from './patterns.js';
import {INVALID_LAUNCH_ENV_FILE} from './cli-messages.js';

// Explicit host configuration only. Values stay in the server process, not its results.
export async function loadLaunchEnvironment(file: string | undefined, baseDirectory: string) {
    if (file === undefined) return;
    let handle: fs.FileHandle | undefined;
    try {
        const target = path.resolve(baseDirectory, file);
        const entry = await fs.lstat(target);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error();
        handle = await fs.open(target, constants.O_RDONLY + (constants.O_NOFOLLOW ?? 0));
        const info = await handle.stat();
        if (
            !info.isFile() ||
            info.size > MAX_LAUNCH_ENV_FILE_BYTES ||
            (process.platform !== 'win32' && info.mode % 0o1000 !== 0o600)
        ) {
            throw new Error();
        }
        const bytes = Buffer.alloc(MAX_LAUNCH_ENV_FILE_BYTES + 1);
        let length = 0;
        while (length < bytes.length) {
            const read = await handle.read(bytes, length, bytes.length - length, null);
            if (read.bytesRead === 0) break;
            length += read.bytesRead;
        }
        if (length > MAX_LAUNCH_ENV_FILE_BYTES) throw new Error();
        const values = Object.entries(parseEnv(bytes.subarray(0, length).toString('utf8'))).map(
            ([name, value]): [string, string] => {
                if (
                    !ENVIRONMENT_VARIABLE_PATTERN.test(name) ||
                    typeof value !== 'string' ||
                    value.includes('\0')
                ) {
                    throw new Error();
                }
                return [name, value];
            },
        );
        // Existing values, including empty strings, have precedence over the file.
        for (const [name, value] of values) {
            registerSecret(value);
            if (process.env[name] === undefined) process.env[name] = value;
        }
    } catch {
        throw new Error(INVALID_LAUNCH_ENV_FILE);
    } finally {
        await handle?.close();
    }
}
