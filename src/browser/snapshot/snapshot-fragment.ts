import {createHash} from 'node:crypto';
import {z} from 'zod';

import {
    CONTEXT_JSON_BUDGET,
    FRAGMENT_MAX_CHARS,
    MAX_SNAPSHOT_QUERY_CHARS,
    MIN_SNAPSHOT_FRAGMENT_CHARS,
    SEARCH_CONTEXT_CHARS,
    TEXT_JSON_BUDGET,
} from '../config.js';
import {FIRST_SNAPSHOT_NODE_PATTERN, SHA256_DIGEST_PATTERN} from '../patterns.js';
import {sanitizeSnapshotForModel} from '../../shared/sanitize-for-model.js';
import {snapshotNodes, splitUnaddressableDialogs} from '../../shared/snapshot/parser.js';

export const snapshotFragmentArgs = z
    .object({
        query: z.string().trim().min(1).max(MAX_SNAPSHOT_QUERY_CHARS).optional(),
        offset: z.number().int().min(0).optional(),
        maxChars: z
            .number()
            .int()
            .min(MIN_SNAPSHOT_FRAGMENT_CHARS)
            .max(FRAGMENT_MAX_CHARS)
            .optional(),
        snapshotId: z.string().regex(SHA256_DIGEST_PATTERN).optional(),
    })
    .strict();

function fragmentAncestors(source: string, start: number, end: number): string[] {
    const lines = source.slice(0, start).split('\n');
    // A partial first line is data, not a complete node header. Keeping its
    // real ancestors also preserves scalar/code context at a page boundary.
    lines.pop();
    const ancestors: Array<{indent: number; text: string}> = [];
    for (const node of snapshotNodes(lines)) {
        while (ancestors.length && ancestors[ancestors.length - 1].indent >= node.indent) {
            ancestors.pop();
        }
        ancestors.push({indent: node.indent, text: lines[node.index]});
    }
    const firstNode = FIRST_SNAPSHOT_NODE_PATTERN.exec(source.slice(start, end));
    if ((start === 0 || source[start - 1] === '\n') && firstNode) {
        while (ancestors.length && ancestors[ancestors.length - 1].indent >= firstNode[1].length) {
            ancestors.pop();
        }
    }
    const context: string[] = [];
    for (const ancestor of ancestors.reverse()) {
        if (JSON.stringify([...context, ancestor.text]).length <= CONTEXT_JSON_BUDGET) {
            context.unshift(ancestor.text);
        }
    }
    return context;
}

function fragmentEnd(source: string, start: number, match: number, maxChars: number): number {
    let end = Math.min(source.length, start + maxChars);
    while (JSON.stringify(source.slice(start, end)).length > TEXT_JSON_BUDGET) {
        end = start + Math.floor((end - start) / 2);
    }
    const lineEnd = source.lastIndexOf('\n', end - 1);
    return end < source.length && lineEnd > start && lineEnd >= match ? lineEnd + 1 : end;
}

// Fragments use the same sanitized source as the default projection, without
// promoting unaddressable reference dialogs into visible, actionable UI.
export function snapshotFragment(raw: string, args: z.infer<typeof snapshotFragmentArgs>) {
    const projected = splitUnaddressableDialogs(sanitizeSnapshotForModel(raw));
    const source =
        projected.snapshot +
        (projected.reference
            ? '\n\nUnaddressable dialog reference text. Visibility is unknown; not evidence of an open panel:\n' +
              projected.reference
            : '');
    const snapshotId = createHash('sha256').update(source).digest('hex');
    if (args.snapshotId && args.snapshotId !== snapshotId) {
        return {
            snapshotId,
            totalChars: source.length,
            changed: true,
            nextOffset: 0,
            reason: 'Page changed; restart the query or pagination with the new snapshotId.',
        };
    }
    const offset = Math.min(args.offset ?? 0, source.length);
    const match = args.query === undefined ? offset : source.indexOf(args.query, offset);
    if (match < 0) {
        return {snapshotId, totalChars: source.length, found: false, searchedFrom: offset};
    }
    const maxChars = args.maxChars ?? FRAGMENT_MAX_CHARS;
    const lineStart = source.lastIndexOf('\n', match - 1) + 1;
    const contextChars = Math.min(SEARCH_CONTEXT_CHARS, maxChars - (args.query?.length ?? 0));
    const start = args.query === undefined ? offset : Math.max(lineStart, match - contextChars);
    const end = fragmentEnd(source, start, match, maxChars);
    return {
        snapshotId,
        totalChars: source.length,
        found: true,
        start,
        end,
        nextOffset: end < source.length ? end : null,
        startsMidLine: start > 0 && source[start - 1] !== '\n',
        endsMidLine: end < source.length && source[end - 1] !== '\n',
        referenceOnly: Boolean(projected.reference) && start >= projected.snapshot.length,
        ancestors: fragmentAncestors(source, start, end),
        text: source.slice(start, end),
        scope: 'Fresh AX fragment; presence does not prove viewport visibility. Offsets belong only to this snapshotId. Missing content is unknown. Use only complete current node refs.',
    };
}
