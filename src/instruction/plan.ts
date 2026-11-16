import type {InstructionSource} from './source.js';

import {z} from 'zod';

import {
    MAX_EXPECTED_RESULT_CHARS,
    MAX_PLAN_ACTION_CHARS,
    MAX_PLAN_STEPS,
    MAX_SOURCE_QUOTE_CHARS,
} from './config.js';
import {
    PLAN_BELONGS_TO_A_DIFFERENT_INSTRUCTION_SOURCE,
    PLAN_REQUIRES_UNIQUE_STEP_IDS_AND_QUOTES_FROM,
} from './messages.js';
import {SHA256_DIGEST_PATTERN as PLAN_PATTERN} from './patterns.js';

export const instructionPlanSchema = z
    .object({
        sourceSha256: z.string().regex(PLAN_PATTERN),
        steps: z
            .array(
                z
                    .object({
                        id: z.number().int().positive(),
                        actionText: z.string().trim().min(1).max(MAX_PLAN_ACTION_CHARS),
                        expectedResult: z.string().trim().min(1).max(MAX_EXPECTED_RESULT_CHARS),
                        sourceQuote: z.string().trim().min(1).max(MAX_SOURCE_QUOTE_CHARS),
                        condition: z.string().trim().min(1).optional(),
                    })
                    .strict(),
            )
            .min(1)
            .max(MAX_PLAN_STEPS),
    })
    .strict();
export type InstructionPlan = z.infer<typeof instructionPlanSchema>;

export function validatePlan(value: unknown, source: InstructionSource): InstructionPlan {
    const plan = instructionPlanSchema.parse(value);
    if (plan.sourceSha256 !== source.sha256) {
        throw new Error(PLAN_BELONGS_TO_A_DIFFERENT_INSTRUCTION_SOURCE);
    }
    const ids = new Set<number>();
    for (const step of plan.steps) {
        if (ids.has(step.id) || !source.markdown.includes(step.sourceQuote)) {
            throw new Error(PLAN_REQUIRES_UNIQUE_STEP_IDS_AND_QUOTES_FROM);
        }
        ids.add(step.id);
    }
    return plan;
}
