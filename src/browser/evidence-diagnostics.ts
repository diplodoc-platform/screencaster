import type {McpResult} from '../transport/mcp/types.js';

import fs from 'node:fs';
import {z} from 'zod';

import {extractText} from '../transport/mcp/result.js';
import {writePrivateJson} from '../shared/private-files.js';
import {sanitizeForModel} from '../shared/sanitize-for-model.js';

import {
    MAX_EVIDENCE_COUNT,
    MAX_EVIDENCE_EVENTS,
    MAX_EVIDENCE_FILE_BYTES,
    MAX_EVIDENCE_REPLY_CHARS,
    MAX_GEOMETRY_MAGNITUDE,
} from './config.js';
import {ARIA_REF_ARGUMENT_PATTERN, MCP_RESULT_BLOCK_PATTERN} from './patterns.js';
import {blockerLabelsSchema} from './interaction/obstruction-labels.js';

const count = z.number().int().min(0).max(MAX_EVIDENCE_COUNT);
const dimension = z.number().finite().min(0).max(MAX_GEOMETRY_MAGNITUDE);
const coordinate = z.number().finite().min(-MAX_GEOMETRY_MAGNITUDE).max(MAX_GEOMETRY_MAGNITUDE);
const positionRect = z
    .object({left: coordinate, top: coordinate, right: coordinate, bottom: coordinate})
    .strict();
const positionSize = z.object({width: dimension, height: dimension}).strict();
const observationsSchema = z
    .object({
        targetCount: count.optional(),
        positionXEnough: z.boolean().optional(),
        positionYEnough: z.boolean().optional(),
        nativeScrollAttempted: z.boolean().optional(),
        positionRect: positionRect.optional(),
        positionClip: positionRect.optional(),
        positionCapacity: positionSize.optional(),
        positionViewport: positionSize.optional(),
        connected: z.boolean().optional(),
        tag: z
            .enum(['a', 'button', 'input', 'select', 'textarea', 'span', 'div', 'svg', 'other'])
            .optional(),
        role: z
            .enum([
                'button',
                'combobox',
                'checkbox',
                'radio',
                'switch',
                'textbox',
                'link',
                'img',
                'generic',
                'none',
                'presentation',
                'other',
            ])
            .optional(),
        childCount: count.optional(),
        isEditable: z.boolean().optional(),
        insideInteractive: z.boolean().optional(),
        ownInteractive: z.boolean().optional(),
        pointerEventsNone: z.boolean().optional(),
        intersection: z.boolean().optional(),
        fullContainment: z.boolean().optional(),
        boxWidth: dimension.optional(),
        boxHeight: dimension.optional(),
        intersectionWidth: dimension.optional(),
        intersectionHeight: dimension.optional(),
        intersectionRatio: z.number().finite().min(0).max(1).optional(),
        rangeEligible: z.boolean().optional(),
        textRectsCount: count.optional(),
        glyphsContained: z.boolean().optional(),
        usedTextRects: z.boolean().optional(),
        fragmentCount: count.optional(),
        sampleCount: count.optional(),
        targetHits: count.optional(),
        descendantHits: count.optional(),
        ancestorHits: count.optional(),
        associatedHits: count.optional(),
        otherHits: count.optional(),
        blockerLabels: blockerLabelsSchema.optional(),
        nullHits: count.optional(),
    })
    .strict();

const reasonSchema = z.enum([
    'absent-ref',
    'disconnected',
    'frame-boundary',
    'not-revealed',
    'not-intersecting',
    'empty-intersection',
    'occluded',
    'predicate-false',
    'mcp-error',
    'malformed-result',
    'transport',
]);
const failureSchema = z
    .object({
        visible: z.literal(false),
        reason: reasonSchema,
        observations: observationsSchema,
    })
    .strict();
const predicateFailureSchema = failureSchema.extend({
    reason: z.enum([
        'absent-ref',
        'disconnected',
        'frame-boundary',
        'not-revealed',
        'not-intersecting',
        'empty-intersection',
        'occluded',
        'predicate-false',
    ]),
});
const eventSchema = failureSchema.omit({visible: true}).extend({
    kind: z.literal('interaction'),
    targetKind: z.literal('ref'),
    ref: z.string().regex(ARIA_REF_ARGUMENT_PATTERN).optional(),
});
const batchSchema = z
    .object({events: z.array(eventSchema).max(MAX_EVIDENCE_EVENTS), omitted: count})
    .strict();

export type EvidenceFailure = z.infer<typeof failureSchema>;
export type EvidenceFailureReason = EvidenceFailure['reason'];
type EventContext = Pick<z.infer<typeof eventSchema>, 'kind' | 'targetKind' | 'ref'>;

export class EvidenceObservationError extends Error {
    readonly reason: 'mcp-error' | 'malformed-result';

    constructor(reason: 'mcp-error' | 'malformed-result') {
        super(`Scroll target observation failed (${reason})`);
        this.name = 'EvidenceObservationError';
        this.reason = reason;
    }
}

export function decodeEvidenceObservation(
    result: McpResult,
    allowedLabels: readonly string[] = [],
): true | EvidenceFailure {
    if (result?.isError) {
        throw new EvidenceObservationError('mcp-error');
    }
    let payload: string | undefined;
    try {
        payload = MCP_RESULT_BLOCK_PATTERN.exec(extractText(result))?.[1];
    } catch {
        throw new EvidenceObservationError('malformed-result');
    }
    if (payload?.trim() === 'true') {
        return true;
    }
    if (payload?.trim() === 'false') {
        return {visible: false, reason: 'predicate-false', observations: {}};
    }
    if (payload && payload.length <= MAX_EVIDENCE_REPLY_CHARS) {
        try {
            const parsed = predicateFailureSchema.safeParse(JSON.parse(payload));
            if (parsed.success) {
                const labels = parsed.data.observations.blockerLabels;
                if (
                    labels?.length &&
                    (parsed.data.reason !== 'occluded' ||
                        !parsed.data.observations.otherHits ||
                        labels.some((label) => !allowedLabels.includes(label)))
                ) {
                    throw new EvidenceObservationError('malformed-result');
                }
                return parsed.data;
            }
        } catch {
            // The opaque protocol error below never echoes an upstream payload.
        }
    }
    throw new EvidenceObservationError('malformed-result');
}

export class EvidenceFailureLog {
    private batch: z.infer<typeof batchSchema> = {events: [], omitted: 0};
    private readonly file?: string;

    constructor(file?: string) {
        this.file = file;
        if (file) {
            try {
                if (fs.statSync(file).size <= MAX_EVIDENCE_FILE_BYTES) {
                    this.batch = batchSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
                }
            } catch {
                // Missing or invalid diagnostics cannot replace a browser failure.
            }
        }
    }

    record(context: EventContext, failure: EvidenceFailure) {
        try {
            const ref = context.ref === undefined ? undefined : sanitizeForModel(context.ref);
            const event = eventSchema.parse({
                ...context,
                ref: ref && ARIA_REF_ARGUMENT_PATTERN.test(ref) ? ref : undefined,
                reason: failure.reason,
                observations: failure.observations,
            });
            if (this.batch.events.length < MAX_EVIDENCE_EVENTS) {
                this.batch.events.push(event);
            } else {
                this.batch.omitted = Math.min(MAX_EVIDENCE_COUNT, this.batch.omitted + 1);
            }
            if (this.file) {
                writePrivateJson(this.file, this.batch);
            }
        } catch {
            // Best-effort diagnostics never change the original outcome.
        }
    }
}

// Serialized only into the trusted browser reader. Every returned string is a
// token from these fixed maps; raw tag/role/attribute values never leave the DOM.
