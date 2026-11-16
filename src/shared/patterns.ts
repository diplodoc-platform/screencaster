export const CRLF_PATTERN = /\r\n/g;
export const SNAPSHOT_SECTION_PATTERN = /^### Snapshot\n/m;
export const MODAL_STATE_SECTION_PATTERN = /^### Modal state\n([\s\S]*?)(?=^### |(?![\s\S]))/m;
export const NATIVE_DIALOG_PATTERN =
    /^- \["(alert|confirm|prompt|beforeunload)" dialog with message "[\s\S]*?"\]: can be handled by (?:the "browser_handle_dialog" tool|browser_handle_dialog)(?:\n|$)/m;
export const PAGE_HEADER_END_PATTERN = /^### (?:Snapshot|Modal state)\n/m;
export const PAGE_SECTION_PATTERN = /^### Page\n([\s\S]*?)(?=^### |(?![\s\S]))/m;
export const REPORTED_PAGE_URL_PATTERN = /^- Page URL: (\S+)$/m;
export const OPEN_TABS_SECTION_PATTERN = /^### Open tabs\n([\s\S]*?)(?=^### |(?![\s\S]))/m;
export const CURRENT_TAB_PATTERN = /^- (\d+): \(current\) \[([^\n]*)\]\(([^\n]*)\)$/gm;
export const INDENTATION_PATTERN = /^\s*/;
export const SNAPSHOT_NODE_PATTERN = /^(\s*)- ([\w-]+)\b/;
export const YAML_BLOCK_SCALAR_PATTERN = /^\s*- .*:\s*[|>](?:[+-]?[1-9]?|[1-9][+-]?)\s*$/;
export const REF_ANNOTATION_PATTERN = / \[ref=[^\]]+\]/g;
export const ACTIVE_ANNOTATION_PATTERN = / \[active\]/g;
export const ARIA_REF_VALUE_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const NODE_LABEL_PATTERN = /^- [\w-]+(?: "(?:[^"\\]|\\.)*"| '(?:[^']|'')*')?/;
export const REF_ATTRIBUTE_PATTERN = /\[ref=([^\]]+)\]/;
export const ADDRESSABLE_REF_PATTERN = /\[ref=[a-zA-Z0-9_-]+\]/;
export const SNAPSHOT_NODE_PREFIX_PATTERN = /^\s*- /;
export const PAGE_METADATA_NODE_PATTERN = /^\s*- Page (?:URL|Title):/i;
export const NODE_INDENTATION_PATTERN = /^(\s*)/;
export const NODE_HEADER =
    /^\s*- [\w-]+(?: "(?:[^"\\]|\\.)*"| '(?:[^']|'')*')?((?: \[[\w-]+(?:=[^\]\s]+)?\])*)/;
export const AUTHORIZATION_VALUE_PATTERN = /\b(Bearer|Api-Key)\s+[^\s"'<>]+/gi;
export const PRIVATE_HEADER_VALUE_PATTERN =
    /\b(authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*[^\r\n]+/gi;
export const PRIVATE_JSON_VALUE_PATTERN =
    /("(?:token|access_token|refresh_token|password|secret|api_key)"\s*:\s*)"[^"]*"/gi;
export const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
export const INPUT_VALUE_NODE_PATTERN = /^\s*-\s*(?:textbox|searchbox|combobox|spinbutton)\b/i;
export const PARAGRAPH_NODE_PATTERN = /^\s*-\s*paragraph\b/;
export const INPUT_VALUE_PREFIX_PATTERN = /^(\s*-\s*\/?(?:text|value):)\s*/i;
export const INPUT_METADATA_OR_EMPTY_LINE_PATTERN = /^\s*$|^\s*-\s*\/[\w-]+:/;
export const INPUT_VALUE_SEPARATOR_PATTERN = /:\s*/;
export const DOM_ATTRIBUTES_ANNOTATION_PATTERN = /\[DOM attributes: (\{.*\})\]:?$/;
