import {createHmac, randomBytes} from 'node:crypto';
import {z} from 'zod';

import {snapshotNodes, snapshotWithoutTransientAttributes} from '../snapshot/parser.js';
import {DOM_ATTRIBUTES_ANNOTATION_PATTERN} from '../patterns.js';
export const uiOperationSchema = z.enum([
    'navigation',
    'disclosure',
    'hover',
    'dismissal',
    'unknown',
]);

export type UiOperation = z.infer<typeof uiOperationSchema>;

export function recordedUiOperation(
    tool: string,
    args: Record<string, unknown>,
    snapshot: string,
    ref?: string,
): UiOperation {
    if (tool === 'browser_navigate') {
        return 'navigation';
    }
    if (tool === 'browser_hover' || tool === 'input_focus') {
        return 'hover';
    }
    if (tool === 'browser_press_key' && args.key === 'Escape') {
        return 'dismissal';
    }
    if (
        tool !== 'browser_click' ||
        (args.button !== undefined && args.button !== 'left') ||
        (Array.isArray(args.modifiers) && args.modifiers.length) ||
        args.doubleClick === true
    ) {
        return 'unknown';
    }
    return controlUiOperation(snapshot, ref);
}

function controlUiOperation(snapshot: string, ref?: string): UiOperation {
    const lines = snapshot.split('\n');
    const node = snapshotNodes(lines).find((entry) =>
        entry.attributes.split(' ').includes(`[ref=${ref}]`),
    );
    if (!node) {
        return 'unknown';
    }
    let attributes: Record<string, unknown> = {};
    const observed = lines[node.index].match(DOM_ATTRIBUTES_ANNOTATION_PATTERN)?.[1];
    try {
        attributes = observed ? JSON.parse(observed) : {};
    } catch {
        return 'unknown';
    }
    if (attributes.type === 'submit') {
        return 'unknown';
    }
    if (node.role === 'link') {
        return 'navigation';
    }
    if (
        node.role === 'combobox' ||
        (node.role === 'button' &&
            (node.attributes.includes('[expanded]') ||
                ['true', 'menu', 'listbox', 'tree', 'grid', 'dialog'].includes(
                    String(attributes['aria-haspopup']),
                )))
    ) {
        return 'disclosure';
    }
    return 'unknown';
}

export function createMediaStateHasher() {
    const salt = randomBytes(32);
    return (snapshot: string): string | undefined => {
        if (snapshot.includes('[REDACTED]')) {
            return undefined;
        }
        return createHmac('sha256', salt)
            .update(snapshotWithoutTransientAttributes(snapshot))
            .digest('hex');
    };
}
