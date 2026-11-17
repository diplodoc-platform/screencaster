import {z} from 'zod';

import {MAX_OUTLINE_SIZE_CSS_PX} from './config.js';
import {OUTLINE_COLOR_PATTERN} from './patterns.js';

export const outlineStyleSchema = z
    .object({
        color: z.string().regex(OUTLINE_COLOR_PATTERN).optional(),
        width: z.number().positive().max(MAX_OUTLINE_SIZE_CSS_PX).optional(),
        padding: z.number().nonnegative().max(MAX_OUTLINE_SIZE_CSS_PX).optional(),
        radius: z.number().nonnegative().max(MAX_OUTLINE_SIZE_CSS_PX).optional(),
        opacity: z.number().min(0).max(1).optional(),
    })
    .strict();

export type OutlineStyle = z.infer<typeof outlineStyleSchema>;
export type ResolvedOutlineStyle = Required<OutlineStyle>;

export function resolveOutlineStyle(
    defaults: ResolvedOutlineStyle,
    input?: OutlineStyle,
): ResolvedOutlineStyle {
    const parsed = outlineStyleSchema.parse(input ?? {});
    return {
        color: parsed.color ?? defaults.color,
        width: parsed.width ?? defaults.width,
        padding: parsed.padding ?? defaults.padding,
        radius: parsed.radius ?? defaults.radius,
        opacity: parsed.opacity ?? defaults.opacity,
    };
}
