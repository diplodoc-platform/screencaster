import type {z} from 'zod';

import {SCHEMA_ISSUE_REASONS} from './messages.js';

// Keys come only from the trusted schema, never from input or issue messages.
export function schemaPropertyNames(schema: unknown): Set<string> {
    const names = new Set<string>();
    const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const object = value as Record<string, unknown>;
        if (object.properties && typeof object.properties === 'object') {
            Object.keys(object.properties).forEach((key) => names.add(key));
        }
        Object.values(object).forEach(visit);
    };
    visit(schema);
    return names;
}

export function schemaDiagnostic(
    error: z.ZodError,
    names: Set<string>,
    prefix: string,
    pathPrefix = '',
): string {
    const issue = error.issues[0];
    const parts: string[] = pathPrefix ? [pathPrefix] : [];
    for (const part of issue?.path ?? []) {
        if (typeof part === 'number') parts.push('[]');
        else if (typeof part === 'string' && names.has(part)) parts.push(part);
        else break;
    }
    const location = parts.length ? ` ${parts.join('.')}:` : '';
    const reason = SCHEMA_ISSUE_REASONS[issue?.code ?? 'custom'] ?? SCHEMA_ISSUE_REASONS.custom;
    return `${prefix}:${location} ${reason}`;
}
