import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {CANNOT_READ_JSON_FILE_EXPECTED_A_REGULAR_FILE} from './messages.js';
import {PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE} from './config.js';

export function readJson(file: string): unknown {
    try {
        if (!fs.lstatSync(file).isFile()) {
            throw new Error(CANNOT_READ_JSON_FILE_EXPECTED_A_REGULAR_FILE);
        }
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error(CANNOT_READ_JSON_FILE_EXPECTED_A_REGULAR_FILE);
    }
}

export function writePrivateJson(file: string, value: unknown): void {
    const directory = path.dirname(path.resolve(file));
    fs.mkdirSync(directory, {recursive: true, mode: PRIVATE_DIRECTORY_MODE});
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    try {
        const fd = fs.openSync(temporary, 'wx', PRIVATE_FILE_MODE);
        try {
            fs.writeFileSync(fd, JSON.stringify(value, null, 2));
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, file);
        if (process.platform !== 'win32') {
            const parent = fs.openSync(directory, 'r');
            try {
                fs.fsyncSync(parent);
            } finally {
                fs.closeSync(parent);
            }
        }
    } finally {
        fs.rmSync(temporary, {force: true});
    }
}
