import type {ResolvedOutlineStyle} from '../../shared/outline-style.js';
import type {PreparedScreenshotCapturePolicy} from './capture-policy.js';

import {z} from 'zod';

import {outlineStyleSchema} from '../../shared/outline-style.js';
import {ARIA_REF_ARGUMENT_PATTERN as SCREENSHOT_REF_PATTERN} from '../patterns.js';
import {driverScript} from '../scripts/driver-script.js';

import {
    DEFAULT_CAPTURE_TIMEOUT_MS,
    MAX_CAPTURE_LOCATORS,
    MAX_CAPTURE_LOCATOR_CHARS,
    MAX_CAPTURE_TIMEOUT_MS,
} from './config.js';

export const captureLocatorSchema = z.union([
    z.object({ref: z.string().regex(SCREENSHOT_REF_PATTERN)}).strict(),
    z
        .object({
            role: z.enum([
                'alert',
                'button',
                'checkbox',
                'combobox',
                'dialog',
                'heading',
                'link',
                'list',
                'listitem',
                'menu',
                'menuitem',
                'progressbar',
                'radio',
                'region',
                'status',
                'switch',
                'tab',
                'tabpanel',
                'textbox',
            ]),
            name: z.string().min(1).max(MAX_CAPTURE_LOCATOR_CHARS),
        })
        .strict(),
]);
export type CaptureLocator = z.infer<typeof captureLocatorSchema>;

export const screenshotOptionsSchema = z
    .object({
        ref: z.string().regex(SCREENSHOT_REF_PATTERN).optional(),
        highlight: z.boolean().optional(),
        outline: outlineStyleSchema.optional(),
        area: z.enum(['viewport', 'page', 'element']).default('viewport'),
        ready: z.array(captureLocatorSchema).max(MAX_CAPTURE_LOCATORS).default([]),
        notReady: z.array(captureLocatorSchema).max(MAX_CAPTURE_LOCATORS).default([]),
        timeoutMs: z
            .number()
            .int()
            .min(1)
            .max(MAX_CAPTURE_TIMEOUT_MS)
            .default(DEFAULT_CAPTURE_TIMEOUT_MS),
    })
    .strict();

export type ScreenshotOptions = z.input<typeof screenshotOptionsSchema>;
export type ScreenshotBox = {x: number; y: number; width: number; height: number};
export type ScreenshotMetadata = {
    viewport: {width: number; height: number};
    target: ScreenshotBox | null;
    bounds: ScreenshotBox;
    deviceScaleFactor: number;
    area: 'viewport' | 'page' | 'element';
    pixelWidth: number;
    pixelHeight: number;
    original: {path: string; sha256: string};
    outline?: ResolvedOutlineStyle;
    privacy: {
        redaction: 'not-configured' | 'configured-dom-values-verified';
        visualReviewRequired: true;
    };
    readiness: {ready: number; notReady: number};
};

const screenshotBoxSchema = z
    .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().positive().finite(),
        height: z.number().positive().finite(),
    })
    .strict();
export const screenshotObservationSchema = z
    .object({
        viewport: z
            .object({width: z.number().positive().finite(), height: z.number().positive().finite()})
            .strict(),
        target: screenshotBoxSchema.nullable(),
        origin: z.object({x: z.number().finite(), y: z.number().finite()}).strict(),
        deviceScaleFactor: z.number().positive().finite(),
        area: z.enum(['viewport', 'page', 'element']),
    })
    .strict();

// Only library-owned paths and validated options enter this trusted browser script.
export function screenshotCode(input: {
    file: string;
    ref?: string;
    area: ScreenshotMetadata['area'];
    ready: CaptureLocator[];
    notReady: CaptureLocator[];
    timeoutMs: number;
    policy: PreparedScreenshotCapturePolicy;
    privacyToken: string;
}) {
    return driverScript('take-screenshot', {input: input});
}
