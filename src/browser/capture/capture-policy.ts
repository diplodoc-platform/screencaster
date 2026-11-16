import {z} from 'zod';

import {MIN_SECRET_LENGTH} from '../../shared/config.js';

import {
    MAX_CAPTURE_HIDE_SELECTORS,
    MAX_CAPTURE_LOCATOR_CHARS,
    MAX_CAPTURE_REPLACEMENTS,
    MAX_CAPTURE_REPLACEMENT_CHARS,
} from './config.js';
import {INVALID_SCREENSHOT_CAPTURE_POLICY} from './messages.js';

const replacementSchema = z
    .object({
        from: z.string().min(MIN_SECRET_LENGTH).max(MAX_CAPTURE_REPLACEMENT_CHARS),
        to: z.string().max(MAX_CAPTURE_REPLACEMENT_CHARS),
    })
    .strict();

// This host-only contract is never part of a model-facing screenshot tool schema.
export const screenshotCapturePolicySchema = z
    .object({
        redaction: z
            .object({
                replacements: z.array(replacementSchema).max(MAX_CAPTURE_REPLACEMENTS).default([]),
                hide: z
                    .array(z.string().min(1).max(MAX_CAPTURE_LOCATOR_CHARS))
                    .max(MAX_CAPTURE_HIDE_SELECTORS)
                    .default([]),
            })
            .strict()
            .optional(),
        requireRedaction: z.boolean().default(false),
    })
    .strict()
    .superRefine((policy, context) => {
        const replacements = policy.redaction?.replacements ?? [];
        if (
            (policy.requireRedaction && !replacements.length && !policy.redaction?.hide.length) ||
            new Set(replacements.map((replacement) => replacement.from)).size !==
                replacements.length ||
            replacements.some((replacement) => replacement.to.includes(replacement.from))
        ) {
            context.addIssue({code: 'custom', message: INVALID_SCREENSHOT_CAPTURE_POLICY});
        }
    });

export type ScreenshotCapturePolicy = z.input<typeof screenshotCapturePolicySchema>;
export type PreparedScreenshotCapturePolicy = z.output<typeof screenshotCapturePolicySchema>;

export function prepareScreenshotCapturePolicy(
    value?: ScreenshotCapturePolicy,
): PreparedScreenshotCapturePolicy {
    const parsed = screenshotCapturePolicySchema.safeParse(value ?? {});
    if (!parsed.success) {
        // Zod errors must not expose the host's source values to the caller/model.
        throw new Error(INVALID_SCREENSHOT_CAPTURE_POLICY);
    }
    return parsed.data;
}
