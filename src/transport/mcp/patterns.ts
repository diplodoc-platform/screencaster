export const CRLF_PATTERN = /\r\n/g;
export const SNAPSHOT_FENCE_PATTERN = /^```yaml\s*$/;
export const CODE_FENCE_PATTERN = /^```(?:js|javascript)\s*$/;
export const MARKDOWN_FENCE_PATTERN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
export const MCP_RESULT_LINE_PATTERN = /^### Result\r?\n([^\r\n]+)(?:\r?\n|$)/m;
