import {z} from 'zod';

import {browserPolicySchema} from '../browser/policy.js';
import {screenshotCapturePolicySchema} from '../browser/capture/capture-policy.js';
import {speechkitOptionsSchema} from '../providers/speechkit-options.js';
import {schemaPropertyNames} from '../shared/schema-diagnostics.js';

import {browserRunSchema} from './run-options.js';
import {outputOptionsSchema} from './output-options.js';
import {ENVIRONMENT_VARIABLE_PATTERN} from './patterns.js';

const filePath = z.string().min(1);
export const launchConfigSchema = z
    .object({
        $schema: z.string().optional(),
        version: z.literal(1),
        directory: filePath.optional(),
        envFile: filePath.optional(),
        providers: filePath.optional(),
        authentication: z
            .object({
                module: filePath,
                options: z.record(z.string(), z.unknown()),
            })
            .strict()
            .optional(),
        tts: z
            .union([
                z
                    .object({provider: z.literal('speechkit'), options: speechkitOptionsSchema})
                    .strict(),
                z.object({module: filePath, options: z.record(z.string(), z.unknown())}).strict(),
            ])
            .optional(),
        storageState: z
            .union([
                filePath,
                z.object({env: z.string().regex(ENVIRONMENT_VARIABLE_PATTERN)}).strict(),
            ])
            .optional(),
        policy: z.union([filePath, browserPolicySchema]).optional(),
        screenshotPolicy: screenshotCapturePolicySchema.optional(),
        browser: browserRunSchema.partial().optional(),
        outputs: outputOptionsSchema.optional(),
    })
    .strict();

export const launchConfigJsonSchema = z.toJSONSchema(launchConfigSchema, {io: 'input'});
export const launchConfigPropertyNames = schemaPropertyNames(launchConfigJsonSchema);
