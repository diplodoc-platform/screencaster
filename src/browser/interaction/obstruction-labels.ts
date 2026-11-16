import {z} from 'zod';

import {MAX_BLOCKER_LABELS, MAX_LABEL_CHARS, MAX_OBSTRUCTION_SNAPSHOT_LABELS} from '../config.js';
import {
    INPUT_VALUE_ROLE_PATTERN,
    MULTILINE_LABEL_PATTERN,
    OBSTRUCTION_LABEL_ROLE_PATTERN,
    PLAIN_NODE_LABEL_PATTERN,
    QUOTED_NODE_LABEL_PATTERN,
    YAML_ESCAPED_SINGLE_QUOTE_PATTERN,
} from '../patterns.js';
import {snapshotNodes} from '../../shared/snapshot/parser.js';
import {sanitizeSnapshotForModel} from '../../shared/sanitize-for-model.js';

export const blockerLabelsSchema = z.array(z.string().max(MAX_LABEL_CHARS)).max(MAX_BLOCKER_LABELS);

export function obstructionSnapshotLabels(snapshot: string): string[] {
    const lines = sanitizeSnapshotForModel(snapshot).split('\n');
    const parents: Array<{indent: number; excluded: boolean}> = [];
    const labels = new Set<string>();
    for (const node of snapshotNodes(lines)) {
        while (parents.length && parents[parents.length - 1].indent >= node.indent) {
            parents.pop();
        }
        const excluded =
            parents.some((parent) => parent.excluded) || INPUT_VALUE_ROLE_PATTERN.test(node.role);
        parents.push({indent: node.indent, excluded});
        if (excluded || !OBSTRUCTION_LABEL_ROLE_PATTERN.test(node.role)) {
            continue;
        }
        const label = readLabel(lines[node.index].trim());
        if (
            label &&
            label.length <= MAX_LABEL_CHARS &&
            label === label.trim() &&
            !MULTILINE_LABEL_PATTERN.test(label)
        ) {
            labels.add(label);
        }
        if (labels.size >= MAX_OBSTRUCTION_SNAPSHOT_LABELS) {
            break;
        }
    }
    return [...labels];
}

function readLabel(line: string): string | undefined {
    const quoted = QUOTED_NODE_LABEL_PATTERN.exec(line)?.[1];
    if (!quoted) return PLAIN_NODE_LABEL_PATTERN.exec(line)?.[1];
    try {
        return quoted.startsWith('"')
            ? JSON.parse(quoted)
            : quoted.slice(1, -1).replace(YAML_ESCAPED_SINGLE_QUOTE_PATTERN, "'");
    } catch {
        return undefined;
    }
}

// Executed only inside an existing trusted hit-test. No DOM text leaves the page
// unless it exactly matches an already sanitized static snapshot label.
