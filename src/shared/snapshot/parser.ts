import type {SnapshotResult} from '../../browser/types.js';

import {
    ACTIVE_ANNOTATION_PATTERN,
    ADDRESSABLE_REF_PATTERN,
    ARIA_REF_VALUE_PATTERN,
    INDENTATION_PATTERN,
    NODE_HEADER,
    NODE_INDENTATION_PATTERN,
    NODE_LABEL_PATTERN,
    PAGE_METADATA_NODE_PATTERN,
    REF_ANNOTATION_PATTERN,
    REF_ATTRIBUTE_PATTERN,
    SNAPSHOT_NODE_PATTERN,
    SNAPSHOT_NODE_PREFIX_PATTERN,
    YAML_BLOCK_SCALAR_PATTERN,
} from '../patterns.js';

const nodeHeader = NODE_HEADER;
const nodeAttributes = (line: string): string | undefined => line.match(nodeHeader)?.[1];

// Scalar bodies are page text, even when an example resembles an ARIA node.
export const snapshotNodes = (lines: string[]) => {
    const nodes: Array<{index: number; indent: number; role: string; attributes: string}> = [];
    let scalarIndent: number | undefined;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const indent = line.match(INDENTATION_PATTERN)?.[0].length ?? 0;
        if (scalarIndent !== undefined) {
            if (!line.trim() || indent > scalarIndent) {
                continue;
            }
            scalarIndent = undefined;
        }
        const node = SNAPSHOT_NODE_PATTERN.exec(line);
        if (node) {
            nodes.push({
                index,
                indent: node[1].length,
                role: node[2],
                attributes: nodeAttributes(line) ?? '',
            });
        }
        if (YAML_BLOCK_SCALAR_PATTERN.test(line)) {
            scalarIndent = indent;
        }
    }
    return nodes;
};

export function snapshotWithoutTransientAttributes(snapshot: string): string {
    const lines = snapshot.split('\n');
    for (const node of snapshotNodes(lines)) {
        const line = lines[node.index];
        const header = line.match(nodeHeader);
        if (!header || !header[1]) {
            continue;
        }
        const attributes = header[1]
            .replace(REF_ANNOTATION_PATTERN, '')
            .replace(ACTIVE_ANNOTATION_PATTERN, '');
        lines[node.index] =
            header[0].slice(0, -header[1].length) + attributes + line.slice(header[0].length);
    }
    return lines.join('\n');
}

// Return only the node header, never scalar bodies, child text or input values.
export const extractSnapshotNode = (snapshot: string, ref: string): string | undefined => {
    if (!ARIA_REF_VALUE_PATTERN.test(ref)) {
        return undefined;
    }
    const lines = snapshot.split('\n');
    const node = snapshotNodes(lines).find((candidate) =>
        candidate.attributes.split(' ').includes(`[ref=${ref}]`),
    );
    if (!node) {
        return undefined;
    }
    const label = lines[node.index].trim().match(NODE_LABEL_PATTERN)?.[0];
    return label ? `${label} [ref=${ref}]` : undefined;
};

export const extractFocusedInputRef = (snapshot: string) => {
    const focused = snapshotNodes(snapshot.split('\n')).filter(
        (node) =>
            ['textbox', 'searchbox', 'combobox'].includes(node.role) &&
            node.attributes
                .split(' ')
                .some((attribute) => ['[active]', '[focused]'].includes(attribute)),
    );
    return focused.length === 1
        ? (focused[0].attributes.match(REF_ATTRIBUTE_PATTERN)?.[1] ?? null)
        : null;
};

// Keyboard focus is useful context, but does not prove modality or selection.
export const extractFocusedDialog = (raw: string): string | undefined => {
    const lines = raw.split('\n');
    let start = -1;
    let indent = 0;
    const parents: Array<{start: number; indent: number}> = [];
    for (const node of snapshotNodes(lines)) {
        while (parents.length && parents[parents.length - 1].indent >= node.indent) {
            parents.pop();
        }
        if (node.role === 'dialog') {
            parents.push({start: node.index, indent: node.indent});
        }
        if (parents.length && node.attributes.split(' ').includes('[active]')) {
            const parent = parents[parents.length - 1];
            start = parent.start;
            indent = parent.indent;
        }
    }
    if (start < 0) {
        return undefined;
    }
    let end = start + 1;
    while (
        end < lines.length &&
        (!lines[end].trim() || (lines[end].match(INDENTATION_PATTERN)?.[0].length ?? 0) > indent)
    ) {
        end++;
    }
    return lines.slice(start, end).join('\n');
};

// Addressability is useful for retaining an observed region in a long snapshot.
// It does not establish focus, visibility of every child, or modality.
export const extractAddressableDialogs = (raw: string): string[] => {
    const lines = raw.split('\n');
    const nodes = snapshotNodes(lines);
    const byLine = new Map(nodes.map((node) => [node.index, node]));
    const refs = new Set(
        nodes
            .filter((node) => ADDRESSABLE_REF_PATTERN.test(node.attributes))
            .map((node) => node.index),
    );
    const regions: string[] = [];
    for (let start = 0; start < lines.length; start++) {
        const node = byLine.get(start);
        if (!node || !['dialog', 'alertdialog'].includes(node.role)) {
            continue;
        }
        const indent = node.indent;
        let end = start + 1;
        while (
            end < lines.length &&
            (!lines[end].trim() ||
                (lines[end].match(INDENTATION_PATTERN)?.[0].length ?? 0) > indent)
        ) {
            end++;
        }
        const region = lines.slice(start, end);
        const addressable = region.some((_line, offset) => refs.has(start + offset));
        if (addressable) {
            regions.push(region.join('\n'));
        }
        start = end - 1;
    }
    return regions;
};

// No ref means unavailable addressability evidence, not proven invisibility.
// Preserve the complete text separately; ordinary static content stays in place.
export const splitUnaddressableDialogs = (raw: string): {snapshot: string; reference: string} => {
    const lines = raw.split('\n');
    const nodes = snapshotNodes(lines);
    const byLine = new Map(nodes.map((node) => [node.index, node]));
    const refs = new Set(
        nodes
            .filter((node) => ADDRESSABLE_REF_PATTERN.test(node.attributes))
            .map((node) => node.index),
    );
    const snapshot: string[] = [];
    const reference: string[] = [];
    for (let start = 0; start < lines.length; start++) {
        const node = byLine.get(start);
        if (!node || !['dialog', 'alertdialog'].includes(node.role)) {
            snapshot.push(lines[start]);
            continue;
        }
        const indent = node.indent;
        let end = start + 1;
        while (
            end < lines.length &&
            (!lines[end].trim() ||
                (lines[end].match(INDENTATION_PATTERN)?.[0].length ?? 0) > indent)
        ) {
            end++;
        }
        const region = lines.slice(start, end);
        if (region.some((_line, offset) => refs.has(start + offset))) {
            // Keep the parent, but inspect nested dialogs independently.
            snapshot.push(lines[start]);
        } else {
            reference.push(region.join('\n'));
            start = end - 1;
        }
    }
    return {snapshot: snapshot.join('\n'), reference: reference.join('\n\n')};
};

export const filterTopmostDialog = (raw: string, modalRefs: string[] = []): SnapshotResult => {
    const lines = raw.split('\n');

    let lastDialogIdx = -1;
    let lastDialogIndent = -1;
    for (const node of snapshotNodes(lines)) {
        const ref = node.attributes.match(REF_ATTRIBUTE_PATTERN)?.[1];
        if (node.role === 'dialog' && ref && modalRefs.includes(ref)) {
            lastDialogIdx = node.index;
            lastDialogIndent = node.indent;
        }
    }

    if (lastDialogIdx < 0) {
        return {snapshot: raw, hasDialog: false};
    }

    const meta: string[] = [];
    for (const line of lines) {
        if (SNAPSHOT_NODE_PREFIX_PATTERN.test(line) && !PAGE_METADATA_NODE_PATTERN.test(line)) {
            break;
        }
        meta.push(line);
    }

    const dialogContent: string[] = [];
    for (let i = lastDialogIdx + 1; i < lines.length; i++) {
        const lineIndent = lines[i].match(NODE_INDENTATION_PATTERN)?.[1].length ?? 0;
        const isEmpty = lines[i].trim() === '';
        if (!isEmpty && lineIndent <= lastDialogIndent) {
            break;
        }
        dialogContent.push(lines[i]);
    }

    const filtered = [
        ...meta,
        '[Active modal dialog — interact ONLY with elements inside this dialog]',
        lines[lastDialogIdx],
        ...dialogContent,
    ].join('\n');

    return {snapshot: filtered, hasDialog: true};
};
