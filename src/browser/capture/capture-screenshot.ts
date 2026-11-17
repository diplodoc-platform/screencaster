import type {McpResult} from '../../transport/mcp/types.js';
import type {SnapshotResult} from '../types.js';
import type {ScreenshotMetadata, screenshotOptionsSchema} from './screenshot.js';
import type {ScreenshotCapturePolicy} from './capture-policy.js';
import type {z} from 'zod';

import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

import {
    MAX_IMAGE_PIXELS,
    PRIVATE_FILE_MODE,
    SCREENSHOT_OUTLINE_STYLE,
} from '../../shared/config.js';
import {scriptValue} from '../../transport/mcp/result.js';
import {TARGET_HAS_NO_VISIBLE_BOUNDS} from '../messages.js';
import {resolveOutlineStyle} from '../../shared/outline-style.js';
import {renderScreenshotHighlight} from '../../shared/image-renderer.js';
import {registerSecret} from '../../shared/sanitize-for-model.js';

import {screenshotCode, screenshotObservationSchema} from './screenshot.js';
import {PNG_HEIGHT_OFFSET, PNG_SIGNATURE, PNG_WIDTH_OFFSET} from './config.js';
import {prepareScreenshotCapturePolicy} from './capture-policy.js';
import {SCREENSHOT_CAPTURE_FAILED, SCREENSHOT_OUTPUT_EXISTS} from './messages.js';

export type ScreenshotAccess = {
    outputDirectory: string;
    execute: (code: string) => Promise<McpResult>;
    snapshot: () => Promise<SnapshotResult>;
    policy?: ScreenshotCapturePolicy;
};

async function assertAbsent(file: string) {
    try {
        await fs.lstat(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
        throw error;
    }
    throw new Error(SCREENSHOT_OUTPUT_EXISTS);
}

async function writeExclusive(file: string, png: Uint8Array, created: string[]) {
    const handle = await fs.open(file, 'wx', PRIVATE_FILE_MODE);
    created.push(file);
    try {
        await handle.writeFile(png);
        await handle.sync();
    } finally {
        await handle.close();
    }
}

export async function captureScreenshot(
    access: ScreenshotAccess,
    file: string,
    capture: z.output<typeof screenshotOptionsSchema>,
): Promise<ScreenshotMetadata> {
    const policy = prepareScreenshotCapturePolicy(access.policy);
    for (const replacement of policy.redaction?.replacements ?? []) {
        registerSecret(replacement.from);
    }
    const temporary = path.join(access.outputDirectory, `capture-${randomUUID()}.png`);
    const original = capture.highlight ? `${file}.original.png` : file;
    const created: string[] = [];
    await assertAbsent(file);
    if (capture.highlight) {
        await assertAbsent(original);
    }
    try {
        const observed = screenshotObservationSchema.parse(
            scriptValue(
                await access.execute(
                    screenshotCode({
                        file: temporary,
                        ref: capture.ref,
                        area: capture.area,
                        ready: capture.ready,
                        notReady: capture.notReady,
                        timeoutMs: capture.timeoutMs,
                        policy,
                        privacyToken: randomUUID(),
                    }),
                ),
            ),
        );
        const png = await fs.readFile(temporary);
        const pixelWidth = png.readUInt32BE(PNG_WIDTH_OFFSET);
        const pixelHeight = png.readUInt32BE(PNG_HEIGHT_OFFSET);
        if (
            png.readUInt32BE(0) !== PNG_SIGNATURE ||
            !Number.isSafeInteger(pixelWidth) ||
            !Number.isSafeInteger(pixelHeight) ||
            pixelWidth < 1 ||
            pixelHeight < 1 ||
            pixelWidth * pixelHeight > MAX_IMAGE_PIXELS ||
            !Number.isFinite(observed.deviceScaleFactor) ||
            observed.deviceScaleFactor <= 0 ||
            observed.area !== capture.area
        ) {
            throw new Error(SCREENSHOT_CAPTURE_FAILED);
        }
        const metadata: ScreenshotMetadata = {
            viewport: observed.viewport,
            target: observed.target,
            area: observed.area,
            deviceScaleFactor: observed.deviceScaleFactor,
            pixelWidth,
            pixelHeight,
            bounds: {
                ...observed.origin,
                width: pixelWidth / observed.deviceScaleFactor,
                height: pixelHeight / observed.deviceScaleFactor,
            },
            original: {path: original, sha256: createHash('sha256').update(png).digest('hex')},
            privacy: {
                redaction:
                    policy.redaction?.replacements.length || policy.redaction?.hide.length
                        ? 'configured-dom-values-verified'
                        : 'not-configured',
                visualReviewRequired: true,
            },
            readiness: {ready: capture.ready.length, notReady: capture.notReady.length},
        };
        let output: Uint8Array = png;
        if (capture.highlight) {
            if (!metadata.target) {
                throw new Error(TARGET_HAS_NO_VISIBLE_BOUNDS);
            }
            metadata.outline = resolveOutlineStyle(SCREENSHOT_OUTLINE_STYLE, capture.outline);
            output = await renderScreenshotHighlight(
                png,
                {...metadata, target: metadata.target},
                metadata.outline,
            );
        }
        await access.snapshot();
        if (capture.highlight) {
            await writeExclusive(original, png, created);
        }
        await writeExclusive(file, output, created);
        return metadata;
    } catch {
        await Promise.all(created.map((createdFile) => fs.rm(createdFile, {force: true})));
        // Do not forward a transport/Playwright error that could echo host policy values.
        throw new Error(SCREENSHOT_CAPTURE_FAILED);
    } finally {
        await fs.rm(temporary, {force: true});
    }
}
