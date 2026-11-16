import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

import {MAX_UPLOAD_BYTES} from '../config.js';
import {SHA256_DIGEST_PATTERN as SHA256_PATTERN} from '../patterns.js';
import {REGISTERED_INPUT_FILE_CHANGED_OR_IS_NOT_A} from '../messages.js';

export type BrowserInputFile = {path: string; sha256: string};
export type FileInputTarget = {element: string; ref: string; representation?: 'file' | 'base64'};

// Only files explicitly registered by trusted host code can reach the native
// chooser. The model never supplies a filesystem path.
export function assertInputFile(file: BrowserInputFile): void {
    const stat = fs.lstatSync(file.path);
    if (
        !path.isAbsolute(file.path) ||
        !stat.isFile() ||
        stat.size > MAX_UPLOAD_BYTES ||
        !fs.lstatSync(path.dirname(file.path)).isDirectory() ||
        !SHA256_PATTERN.test(file.sha256) ||
        createHash('sha256').update(fs.readFileSync(file.path)).digest('hex') !== file.sha256
    ) {
        throw new Error(REGISTERED_INPUT_FILE_CHANGED_OR_IS_NOT_A);
    }
}
