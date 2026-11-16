import type {MediaActivity} from '../../media/recording/journal.js';
import type {McpResult} from '../../transport/mcp/types.js';

import path from 'node:path';
import {z} from 'zod';

import {MAX_GEOMETRY_MAGNITUDE} from '../config.js';
import {driverScript} from '../scripts/driver-script.js';
import {ARIA_REF_ARGUMENT_PATTERN, MCP_RESULT_LINE_PATTERN} from '../patterns.js';
import {INVALID_ACTION_TARGET_REFERENCE} from '../messages.js';
import {VIDEO_STABLE_INTERVAL_MS} from '../recording/clock.js';
import {extractText} from '../../transport/mcp/result.js';

const coordinate = z.number().finite().min(-MAX_GEOMETRY_MAGNITUDE).max(MAX_GEOMETRY_MAGNITUDE);
const dimension = z.number().finite().positive().max(MAX_GEOMETRY_MAGNITUDE);
// Shared with final-state capture; browserClock derives the stable interval
// from the clock spread, quantized marker edges and a full-frame exposure.
export const ACTION_TARGET_STABLE_MS = VIDEO_STABLE_INTERVAL_MS;
const refSchema = z.string().regex(ARIA_REF_ARGUMENT_PATTERN);
const geometrySchema = z.object({
    x: coordinate,
    y: coordinate,
    width: dimension,
    height: dimension,
    viewportWidth: dimension,
    viewportHeight: dimension,
});
const targetSchema = geometrySchema.extend({
    ref: refSchema,
    atMs: z.number().finite().positive(),
    untilMs: z.number().finite().positive(),
    recording: z.string().min(1),
});
export type PreparedActionTarget = {
    outsideViewport?: true;
    mediaTarget?: MediaActivity['target'];
};

function outsideViewport(box: z.infer<typeof geometrySchema>): boolean {
    return (
        box.x + box.width <= 0 ||
        box.y + box.height <= 0 ||
        box.x >= box.viewportWidth ||
        box.y >= box.viewportHeight
    );
}

// Exact snapshot refs only. Scrolling is useful without media too; measuring
// must never insert a presentation overlay or change which element is acted on.
export function actionTargetCode(ref: string, measure: boolean): string {
    if (!ARIA_REF_ARGUMENT_PATTERN.test(ref)) {
        throw new Error(INVALID_ACTION_TARGET_REFERENCE);
    }
    return driverScript('prepare-action-target', {ref: ref, measure: measure});
}

export function decodePreparedActionTarget(
    result: McpResult,
    expectedRef: string,
    videoDir?: string,
): PreparedActionTarget {
    const prepared: PreparedActionTarget = {};
    if (!result || result.isError) {
        return prepared;
    }
    try {
        const payload = extractText(result).match(MCP_RESULT_LINE_PATTERN)?.[1];
        const observation = z
            .object({
                ref: refSchema,
                geometry: z.unknown().optional(),
                mediaTarget: z.unknown().optional(),
            })
            .strict()
            .parse(JSON.parse(payload ?? 'null'));
        if (observation.ref !== expectedRef) {
            return prepared;
        }
        const geometry = geometrySchema.safeParse(observation.geometry);
        if (geometry.success && outsideViewport(geometry.data)) {
            prepared.outsideViewport = true;
        }
        if (!videoDir) {
            return prepared;
        }
        const parsed = targetSchema.safeParse(observation.mediaTarget);
        if (!parsed.success || parsed.data.ref !== expectedRef) {
            return prepared;
        }
        const target = parsed.data;
        if (
            path.dirname(path.resolve(target.recording)) !== path.resolve(videoDir) ||
            path.extname(target.recording) !== '.webm' ||
            target.untilMs < target.atMs ||
            outsideViewport(target)
        ) {
            return prepared;
        }
        prepared.mediaTarget = {...target, recording: path.basename(target.recording)};
        return prepared;
    } catch {
        return prepared;
    }
}
