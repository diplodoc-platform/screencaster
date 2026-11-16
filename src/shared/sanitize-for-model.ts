import {MASK, MIN_SECRET_LENGTH, SENSITIVE_JSON_KEYS, SENSITIVE_KEYS} from './config.js';
import {
    AUTHORIZATION_VALUE_PATTERN,
    HTTP_URL_PATTERN,
    INPUT_METADATA_OR_EMPTY_LINE_PATTERN,
    INPUT_VALUE_NODE_PATTERN,
    INPUT_VALUE_PREFIX_PATTERN,
    INPUT_VALUE_SEPARATOR_PATTERN,
    PARAGRAPH_NODE_PATTERN,
    PRIVATE_HEADER_VALUE_PATTERN,
    PRIVATE_JSON_VALUE_PATTERN,
} from './patterns.js';
import {snapshotNodes} from './snapshot/parser.js';

const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
    if (value && value.length >= MIN_SECRET_LENGTH) {
        secrets.add(value);
    }
}

function maskRegisteredSecrets(input: string): string {
    let out = input;
    for (const secret of secrets) {
        out = out.split(secret).join(MASK);
    }
    return out;
}

// Unlike a URL's OAuth code, a structured code field can be a public error code.

function sanitizeUrl(raw: string): string {
    try {
        const url = new URL(raw);
        let changed = false;
        for (const key of url.searchParams.keys()) {
            if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                url.searchParams.set(key, '[REDACTED]');
                changed = true;
            }
        }
        if (url.hash.includes('=')) {
            const fragment = new URLSearchParams(url.hash.slice(1));
            for (const key of fragment.keys()) {
                if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                    fragment.set(key, '[REDACTED]');
                    changed = true;
                }
            }
            url.hash = fragment.toString();
        }
        if (url.username || url.password) {
            url.username = '[REDACTED]';
            url.password = '[REDACTED]';
            changed = true;
        }
        // Preserve public text verbatim: fallback matches can contain JSON escapes.
        // Sensitive URLs still use the full conservative match for masking.
        return changed ? url.toString() : raw;
    } catch {
        return raw;
    }
}

export function sanitizeForModel(input: string): string {
    return sanitizeJson(input, sanitizeForModel) ?? sanitizeText(input);
}

function sanitizeJson(input: string, sanitizeString: (text: string) => string): string | undefined {
    const first = input.trimStart()[0];
    if (first === '{' || first === '[' || first === '"') {
        try {
            const parsed: unknown = JSON.parse(input);
            const sanitized = JSON.stringify(sanitizeStructuredValue(parsed, sanitizeString));
            return sanitized === JSON.stringify(parsed) ? input : sanitized;
        } catch {
            // Plain text and incomplete JSON still need best-effort masking.
        }
    }
    return undefined;
}

function sanitizeText(input: string): string {
    return maskRegisteredSecrets(input)
        .replace(AUTHORIZATION_VALUE_PATTERN, '$1 [REDACTED]')
        .replace(PRIVATE_HEADER_VALUE_PATTERN, '$1: [REDACTED]')
        .replace(PRIVATE_JSON_VALUE_PATTERN, '$1"[REDACTED]"')
        .replace(HTTP_URL_PATTERN, sanitizeUrl);
}

export function sanitizeSnapshotForModel(snapshot: string): string {
    const structured = sanitizeJson(snapshot, sanitizeSnapshotForModel);
    if (structured !== undefined) {
        return structured;
    }
    // MCP can emit input properties as sibling lines, without extra indentation.
    let inInputField = false;
    const lines = sanitizeText(snapshot).split('\n');
    const editableParagraphs = new Set(
        snapshotNodes(lines)
            .filter(
                (node) =>
                    node.role === 'paragraph' &&
                    node.attributes.split(' ').includes('[contenteditable=true]'),
            )
            .map(({index}) => index),
    );
    return lines
        .map((line, index) => {
            const role =
                INPUT_VALUE_NODE_PATTERN.exec(line) ??
                (editableParagraphs.has(index) ? PARAGRAPH_NODE_PATTERN.exec(line) : null);
            if (!role) {
                const value = INPUT_VALUE_PREFIX_PATTERN.exec(line);
                if (inInputField && value) {
                    return `${value[1]} [REDACTED]`;
                }
                if (!INPUT_METADATA_OR_EMPTY_LINE_PATTERN.test(line)) {
                    inInputField = false;
                }
                return line;
            }
            inInputField = true;
            const afterLabel = inputLabelEnd(line, role[0].length);
            const separator = INPUT_VALUE_SEPARATOR_PATTERN.exec(line.slice(afterLabel));
            if (!separator || separator.index === undefined) {
                return line;
            }
            return `${line.slice(0, afterLabel + separator.index)}: [REDACTED]`;
        })
        .join('\n');
}

function sanitizeStructuredValue(
    value: unknown,
    sanitizeString: (text: string) => string,
): unknown {
    if (typeof value === 'string') {
        return sanitizeString(value);
    }
    if (Array.isArray(value)) {
        return value.map((nested) => sanitizeStructuredValue(nested, sanitizeString));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [
                sanitizeText(key),
                SENSITIVE_JSON_KEYS.has(key.toLowerCase())
                    ? '[REDACTED]'
                    : sanitizeStructuredValue(nested, sanitizeString),
            ]),
        );
    }
    return value;
}

export function sanitizeToolResultForModel(input: string): string {
    return sanitizeSnapshotForModel(input);
}

function inputLabelEnd(line: string, offset: number) {
    let afterLabel = offset;
    const refStart = line.indexOf('[ref=', afterLabel);
    if (refStart === -1) {
        const nameStart = line.indexOf('"', afterLabel);
        const nameEnd = nameStart === -1 ? -1 : line.indexOf('"', nameStart + 1);
        if (nameEnd !== -1) {
            afterLabel = nameEnd + 1;
        }
    } else {
        const refEnd = line.indexOf(']', refStart);
        if (refEnd !== -1) {
            afterLabel = refEnd + 1;
        }
    }

    return afterLabel;
}
