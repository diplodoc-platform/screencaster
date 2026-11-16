import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

import {MAX_IMAGE_PIXELS, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE} from '../../shared/config.js';

import {MAX_ILLUSTRATION_BYTES, MAX_ILLUSTRATION_DIMENSION} from './config.js';
import {
    ILLUSTRATION_SOURCE_CHANGED,
    INVALID_ILLUSTRATION_INPUT,
    INVALID_ILLUSTRATION_OUTPUT,
} from './messages.js';

export function digest(value: Uint8Array | string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function digestJson(value: unknown): string {
    return digest(
        JSON.stringify(value, (_key, nested: unknown) => {
            if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
                return Object.fromEntries(
                    Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)),
                );
            }
            return nested;
        }),
    );
}

export async function readImage(source: string, expectedHash?: string) {
    try {
        const information = await fs.lstat(source);
        if (!information.isFile() || information.size > MAX_ILLUSTRATION_BYTES) {
            throw new Error(INVALID_ILLUSTRATION_INPUT);
        }
        const canonical = await fs.realpath(source);
        const bytes = await fs.readFile(canonical);
        if (bytes.length > MAX_ILLUSTRATION_BYTES) {
            throw new Error(INVALID_ILLUSTRATION_INPUT);
        }
        const sha256 = digest(bytes);
        if (expectedHash && sha256 !== expectedHash) {
            throw new Error(ILLUSTRATION_SOURCE_CHANGED);
        }
        const metadata = await sharp(bytes, {limitInputPixels: MAX_IMAGE_PIXELS}).metadata();
        const {width, height, format, pages, orientation} = metadata;
        if (
            !width ||
            !height ||
            !['png', 'jpeg'].includes(format ?? '') ||
            width > MAX_ILLUSTRATION_DIMENSION ||
            height > MAX_ILLUSTRATION_DIMENSION ||
            width * height > MAX_IMAGE_PIXELS ||
            (pages !== undefined && pages !== 1) ||
            (orientation !== undefined && orientation !== 1)
        ) {
            throw new Error(INVALID_ILLUSTRATION_INPUT);
        }
        return {source: canonical, bytes, sha256, width, height};
    } catch (cause) {
        if (cause instanceof Error && cause.message === ILLUSTRATION_SOURCE_CHANGED) {
            throw cause;
        }
        throw new Error(INVALID_ILLUSTRATION_INPUT);
    }
}

export async function newOutputDirectory(directory: string): Promise<string> {
    const absolute = path.resolve(directory);
    try {
        const canonical = path.join(
            await fs.realpath(path.dirname(absolute)),
            path.basename(absolute),
        );
        await fs.mkdir(canonical, {mode: PRIVATE_DIRECTORY_MODE});
        return canonical;
    } catch {
        throw new Error(INVALID_ILLUSTRATION_OUTPUT);
    }
}

export async function writeExclusive(file: string, value: Uint8Array | string): Promise<void> {
    const handle = await fs.open(file, 'wx', PRIVATE_FILE_MODE);
    try {
        await handle.writeFile(value);
        await handle.sync();
    } finally {
        await handle.close();
    }
}

export async function readRegularFile(file: string): Promise<Buffer> {
    const information = await fs.lstat(file);
    if (!information.isFile() || information.size > MAX_ILLUSTRATION_BYTES) {
        throw new Error(INVALID_ILLUSTRATION_INPUT);
    }
    return fs.readFile(file);
}
