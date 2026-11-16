import type {McpResult} from './types.js';

import {sanitizeToolResultForModel} from '../../shared/sanitize-for-model.js';

import {MCP_RESULT_LINE_PATTERN as RESULT_PATTERN} from './patterns.js';
import {
    BROWSER_OBSERVATION_FAILED,
    MCP_RESULT_HAS_NO_CONTENT,
    MISSING_BROWSER_OBSERVATION,
} from './messages.js';

// A returned MCP error is distinct from a transport exception with no native reply.
export class McpToolError extends Error {
    constructor(text: string) {
        super(`MCP tool failed: ${sanitizeToolResultForModel(text)}`);
        this.name = 'McpToolError';
    }
}

export const extractText = (mcpResult: McpResult) => {
    if (!mcpResult?.content) {
        throw new Error(MCP_RESULT_HAS_NO_CONTENT);
    }
    const textParts = mcpResult.content.filter((c) => c.type === 'text').map((c) => c.text ?? '');
    const text = textParts.join('\n');
    if (mcpResult.isError) {
        throw new McpToolError(text);
    }
    return text;
};

export const extractImageBase64 = (mcpResult: McpResult) => {
    if (!mcpResult?.content) {
        return null;
    }
    const img = mcpResult.content.find((c) => c.type === 'image');
    return img?.data ?? null;
};

export {extractFocusedInputRef} from '../../shared/snapshot/parser.js';

export function scriptValue(result: McpResult): unknown {
    if (result?.isError) {
        throw new Error(BROWSER_OBSERVATION_FAILED);
    }
    const match = RESULT_PATTERN.exec(extractText(result));
    if (!match) {
        throw new Error(MISSING_BROWSER_OBSERVATION);
    }
    const value: unknown = JSON.parse(match[1]);
    return typeof value === 'string' ? JSON.parse(value) : value;
}
