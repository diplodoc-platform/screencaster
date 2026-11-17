import type {McpResult} from '../../transport/mcp/types.js';

import {z} from 'zod';

import {MAX_CONTROL_HINT_CHARS, MAX_HINT_CONTROLS, MAX_LABEL_CHARS} from '../config.js';
import {INVALID_CONTROL_OBSERVATION} from '../messages.js';
import {
    ANONYMOUS_CONTROL_NODE_PATTERN,
    CHECKABLE_ROLE_PATTERN,
    INDENTATION_PATTERN,
    CONTROL_HINTS_MCP_RESULT_BLOCK_PATTERN as MCP_RESULT_BLOCK_PATTERN,
    NAMABLE_CONTROL_ROLE_PATTERN,
    CONTROL_HINTS_REF_ATTRIBUTE_PATTERN as REF_ATTRIBUTE_PATTERN,
    TRAILING_COLON_PATTERN,
} from '../patterns.js';
import {driverScript} from '../scripts/driver-script.js';
import {snapshotNodes} from '../../shared/snapshot/parser.js';
import {extractText} from '../../transport/mcp/result.js';
import {sanitizeForModel} from '../../shared/sanitize-for-model.js';
import {SnapshotObservationError} from '../errors/snapshot-observation-error.js';

const attributes = [
    'class',
    'title',
    'aria-label',
    'aria-haspopup',
    'type',
    'placeholder',
    'name',
    'data-testid',
    'data-qa',
];
const maxControls = MAX_HINT_CONTROLS;
const maxHintLength = MAX_CONTROL_HINT_CHARS;
const hintSchema = z
    .object({
        ref: z.string(),
        attributes: z.record(z.string(), z.string().max(MAX_LABEL_CHARS)),
        editable: z.literal(true).optional(),
        state: z
            .object({
                source: z.enum(['native', 'aria']),
                value: z.union([z.boolean(), z.literal('mixed')]),
            })
            .strict()
            .optional(),
    })
    .strict();

const checkableRole = (role: string) => CHECKABLE_ROLE_PATTERN.test(role);
type Control = {ref: string; index: number; role: string};

function observedControl(
    hint: z.infer<typeof hintSchema>,
    controls: Control[],
    seen: Set<string>,
): Control {
    const control = controls.find(({ref}) => ref === hint.ref);
    if (
        !control ||
        seen.has(hint.ref) ||
        Object.keys(hint.attributes).some((key) => !attributes.includes(key)) ||
        (hint.editable &&
            (control.role !== 'paragraph' || hint.state || Object.keys(hint.attributes).length)) ||
        (hint.state &&
            (!checkableRole(control.role) ||
                Object.keys(hint.attributes).length > 0 ||
                (hint.state.value === 'mixed' && control.role !== 'checkbox')))
    ) {
        throw new Error(INVALID_CONTROL_OBSERVATION);
    }
    seen.add(hint.ref);
    return control;
}

// Read observations only. Attribute values never become selectors or action rules.
export async function addControlHints(
    snapshot: string,
    read: (code: string) => Promise<McpResult>,
): Promise<string> {
    const lines = snapshot.split('\n');
    const nodes = snapshotNodes(lines);
    const controls = [
        ...nodes.filter(
            ({index, role}) =>
                checkableRole(role) ||
                (NAMABLE_CONTROL_ROLE_PATTERN.test(role) &&
                    ANONYMOUS_CONTROL_NODE_PATTERN.test(lines[index])),
        ),
        ...nodes.filter(({role}) => role === 'paragraph'),
    ]
        .map(({index, role, attributes: nodeAttributes}) => {
            const ref = REF_ATTRIBUTE_PATTERN.exec(nodeAttributes)?.[1];
            return ref ? {ref, index, role} : undefined;
        })
        .filter((control): control is Control => Boolean(control))
        .slice(0, maxControls);
    if (!controls.length) {
        return snapshot;
    }
    const refs = controls.map(({ref}) => ref);
    const roles = Object.fromEntries(controls.map(({ref, role}) => [ref, role]));
    const response = await read(
        driverScript('read-control-hints', {roles: roles, refs: refs, attributes: attributes}),
    );
    let hints: z.infer<typeof hintSchema>[];
    if (!response || response.isError) {
        throw new SnapshotObservationError('Invalid control observation', 'mcp-error');
    }
    try {
        const payload = MCP_RESULT_BLOCK_PATTERN.exec(extractText(response))?.[1];
        hints = z
            .array(hintSchema)
            .max(maxControls)
            .parse(JSON.parse(payload ?? 'null'));
    } catch {
        throw new SnapshotObservationError('Invalid control observation', 'invalid-response');
    }
    const seen = new Set<string>();
    for (const hint of hints) {
        const control = observedControl(hint, controls, seen);
        lines[control.index] = applyControlHint(lines[control.index], control, hint);
    }
    return lines.join('\n');
}

function applyControlHint(line: string, control: Control, hint: z.infer<typeof hintSchema>) {
    if (hint.editable) {
        const end = line.indexOf(']', line.indexOf(`[ref=${control.ref}]`)) + 1;
        return line.slice(0, end) + ' [contenteditable=true]' + line.slice(end);
    }
    if (checkableRole(control.role)) {
        return hint.state
            ? appendAnnotation(
                  line,
                  `DOM checked: ${hint.state.value}; source: ${hint.state.source}`,
              )
            : line;
    }
    const text = sanitizeForModel(JSON.stringify(hint.attributes));
    if (text.length > maxHintLength) return line;
    if (control.role === 'button') return appendAnnotation(line, `DOM attributes: ${text}`);
    const indent = INDENTATION_PATTERN.exec(line)?.[0] ?? '';
    return `${indent}DOM attributes for [ref=${control.ref}]: ${text}\n` + line;
}

function appendAnnotation(line: string, text: string) {
    return (
        line.replace(TRAILING_COLON_PATTERN, '') + ` [${text}]` + (line.endsWith(':') ? ':' : '')
    );
}
