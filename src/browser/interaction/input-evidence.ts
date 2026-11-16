import type {SnapshotResult} from '../types.js';

import {z} from 'zod';

import {MAX_INPUT_EXPECTATIONS, MAX_INPUT_VALUE_CHARS} from '../config.js';
import {
    DUPLICATE_INPUT_EXPECTATION_REFERENCE,
    INVALID_CHECKABLE_INPUT_EXPECTATION,
    INVALID_INPUT_OBSERVATION_RESULT,
} from '../messages.js';
import {
    ARIA_REF_ARGUMENT_PATTERN,
    CONTROL_HINTS_MCP_RESULT_BLOCK_PATTERN as MCP_RESULT_BLOCK_PATTERN,
} from '../patterns.js';
import {driverScript} from '../scripts/driver-script.js';
import {sanitizeForModel} from '../../shared/sanitize-for-model.js';

const expectationSchema = z.object({
    ref: z.string().regex(ARIA_REF_ARGUMENT_PATTERN),
    type: z.enum(['textbox', 'checkbox', 'radio', 'combobox', 'slider']),
    value: z.string().max(MAX_INPUT_VALUE_CHARS),
    name: z.string().optional(),
});
const expectationsSchema = z.array(expectationSchema).max(MAX_INPUT_EXPECTATIONS);
export const inputVerificationArgs = z.object({fields: expectationsSchema}).strict();
const observationSchema = z.array(
    z
        .object({
            ref: expectationSchema.shape.ref,
            status: z.enum(['observed', 'unavailable', 'sensitive']),
            matchesRequested: z.boolean().optional(),
        })
        .strict(),
);

export type InputExpectation = z.infer<typeof expectationSchema>;
export type InputEvidence = {
    ref: string;
    status: 'observed' | 'unavailable' | 'sensitive';
    requestedValue?: string;
    matchesRequested?: boolean;
};
export type InputObservation = {
    evidence: InputEvidence[];
    snapshot: SnapshotResult;
};

export function validateInputExpectations(value: InputExpectation[]): InputExpectation[] {
    const parsed = expectationsSchema.parse(value);
    if (new Set(parsed.map((field) => field.ref)).size !== parsed.length) {
        throw new Error(DUPLICATE_INPUT_EXPECTATION_REFERENCE);
    }
    if (
        parsed.some(
            (field) =>
                ['checkbox', 'radio'].includes(field.type) &&
                !['true', 'false'].includes(field.value),
        )
    ) {
        throw new Error(INVALID_CHECKABLE_INPUT_EXPECTATION);
    }
    return parsed;
}

// Fixed trusted observation: never write, focus, blur, select, or return DOM values.
export function inputEvidenceCode(expectations: InputExpectation[]): string {
    return driverScript('verify-input-values', {expectations: expectations});
}

export function parseInputEvidence(
    text: string,
    expectations: InputExpectation[],
): InputEvidence[] {
    const payload = text.match(MCP_RESULT_BLOCK_PATTERN)?.[1];
    const observations = observationSchema.parse(JSON.parse(payload ?? 'null'));
    if (
        observations.length !== expectations.length ||
        observations.some(
            (item, index) =>
                item.ref !== expectations[index].ref ||
                (item.status === 'observed') !== (item.matchesRequested !== undefined),
        )
    ) {
        throw new Error(INVALID_INPUT_OBSERVATION_RESULT);
    }
    return observations.map((item, index) =>
        item.status === 'observed'
            ? {
                  ...item,
                  requestedValue: sanitizeForModel(expectations[index].value),
              }
            : {ref: item.ref, status: item.status},
    );
}
