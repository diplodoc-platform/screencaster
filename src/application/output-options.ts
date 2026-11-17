import {z} from 'zod';

import {
    DEFAULT_NARRATION_EXPORT_NAME,
    DEFAULT_VIDEO_EXPORT_NAME,
    MAX_AUTOMATIC_NARRATION_HOLD_SECONDS,
} from './config.js';
import {ARTIFACT_NAME_PATTERN} from './patterns.js';
import {VIDEO_OUTPUT_REQUIRES_RECORDING} from './messages.js';

export const outputOptionsSchema = z
    .object({
        video: z
            .object({
                name: z.string().regex(ARTIFACT_NAME_PATTERN).default(DEFAULT_VIDEO_EXPORT_NAME),
                highlights: z.boolean().default(false),
            })
            .strict()
            .optional(),
        screenshots: z.object({highlight: z.boolean().optional()}).strict().optional(),
        narration: z
            .object({
                name: z
                    .string()
                    .regex(ARTIFACT_NAME_PATTERN)
                    .default(DEFAULT_NARRATION_EXPORT_NAME),
                captions: z.boolean().default(false),
                maxHoldSeconds: z
                    .number()
                    .min(0)
                    .max(MAX_AUTOMATIC_NARRATION_HOLD_SECONDS)
                    .default(MAX_AUTOMATIC_NARRATION_HOLD_SECONDS),
            })
            .strict()
            .optional(),
    })
    .strict()
    .refine(
        (value) =>
            !value.narration || Boolean(value.video && value.video.name !== value.narration.name),
    );

export type OutputOptions = z.input<typeof outputOptionsSchema>;
export type PreparedOutputOptions = z.output<typeof outputOptionsSchema>;

export function recordingEnabled(video: boolean | undefined, outputs: OutputOptions) {
    if (outputs.video && video === false) {
        throw new Error(VIDEO_OUTPUT_REQUIRES_RECORDING);
    }
    return outputs.video ? true : video;
}
