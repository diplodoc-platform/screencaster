export const ARIA_REF_ARGUMENT_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/;
export const MCP_RESULT_LINE_PATTERN = /^### Result\r?\n([^\r\n]+)(?:\r?\n|$)/m;
export const REF_ATTRIBUTE_PATTERN = /(?:^| )\[ref=([a-zA-Z0-9_-]{1,200})\](?: |$)/;
export const BACKGROUND_CONTAINER_ROLE_PATTERN = /^(generic|group|region|application)$/;
export const MCP_RESULT_BLOCK_PATTERN = /^### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/;
export const GUARD_READY_PATTERN = /^### Result\r?\n"CONTEXT_GUARD_READY"(?:\r?\n|$)/m;
export const GUARD_STATE_PATTERN = /^### Result\r?\n"CONTEXT_GUARD_(SAME|LOST)"(?:\r?\n|$)/m;
export const SNAPSHOT_URL_REGEXP = /Page URL:\s*(https?:\/\/\S+)/i;
export const DIALOG_REGEXP = /^(\s*)- dialog/;
export const CHECKABLE_ROLE_PATTERN = /^(checkbox|radio|switch)$/;
export const NAMABLE_CONTROL_ROLE_PATTERN = /^(?:button|textbox|searchbox|combobox|spinbutton)$/;
export const ANONYMOUS_CONTROL_NODE_PATTERN = /^\s*- [\w-]+(?: \[[^\]\n]+\])+(?::.*)?$/;
export const CONTROL_HINTS_REF_ATTRIBUTE_PATTERN = /\[ref=([a-zA-Z0-9_-]+)\]/;
export const CONTROL_HINTS_MCP_RESULT_BLOCK_PATTERN =
    /(?:^|\r?\n)### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/;
export const TRAILING_COLON_PATTERN = /:$/;
export const INDENTATION_PATTERN = /^\s*/;
export const BASE64_IMAGE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
export const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const CHECKABLE_NODE_PATTERN = /^\s*- (?:checkbox|radio|switch)\b/;
export const TEXTBOX_NODE_PATTERN = /^\s*- textbox\b/;
export const OBSERVER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const INPUT_VALUE_ROLE_PATTERN =
    /^(textbox|searchbox|combobox|spinbutton|slider|checkbox|radio|switch|option|code)$/;
export const OBSTRUCTION_LABEL_ROLE_PATTERN = /^(heading|button|generic|text|dialog|alertdialog)$/;
export const QUOTED_NODE_LABEL_PATTERN = /^- [\w-]+ ("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')/;
export const YAML_ESCAPED_SINGLE_QUOTE_PATTERN = /''/g;
export const PLAIN_NODE_LABEL_PATTERN = /^- [\w-]+(?: \[[^\]\r\n]+\])*: (.+)$/;
export const MULTILINE_LABEL_PATTERN = /[\r\n\t]/;
export const FILE_CHOOSER_MODAL_PATTERN =
    /^### Modal state\r?\n- \[File chooser\]: can be handled by browser_file_upload(?:\r?\n|$)/m;
export const REQUEST_GUARD_READY_RESULT_PATTERN =
    /^### Result\r?\n"REQUEST_GUARD_INSTALLED"(?:\r?\n|$)/m;
export const PAGE_VERIFIED_RESULT_PATTERN = /^### Result\r?\n"PAGE_VERIFIED"(?:\r?\n|$)/m;
export const CHECKPOINT_OBSERVED_RESULT_PATTERN =
    /^### Result\r?\n"CHECKPOINT_OBSERVED"(?:\r?\n|$)/m;
export const REQUEST_GUARD_HEALTH_RESULT_PATTERN =
    /^### Result\r?\n"REQUEST_GUARD_HEALTHY:(\d+):(\d+):(\d+)"(?:\r?\n|$)/m;
export const REQUEST_GUARD_FAILURE_RESULT_PATTERN =
    /^### Result\r?\n"REQUEST_GUARD_FAILED:(dispatch|fetch|fulfill|fallback|abort|unknown):(reset|timeout|dns|tls|refused|closed|policy-write|policy-navigation|policy-popup|policy-download|policy-host|policy-redirect|policy-socket|unknown)"(?:\r?\n|$)/m;
export const RUNTIME_REF_ATTRIBUTE_PATTERN = /\[ref=([a-zA-Z0-9_-]+)\]/g;
export const DIALOG_REF_PATTERN = /- (?:alertdialog|dialog)\b[^\n]*\[ref=([a-zA-Z0-9_-]+)\]/g;
export const RUNTIME_MCP_RESULT_BLOCK_PATTERN = /^### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/m;
export const SNAPSHOT_SECTION_PATTERN = /^### Snapshot\n/m;
export const MCP_LEADING_RESULT_LINE_PATTERN = /^### Result\r?\n([^\r\n]+)(?:\r?\n|$)/;
export const NATIVE_CHECKABLE_ACTION_PATTERN = /^native-(checkbox|radio)-(checked|unchecked)$/;
export const ARIA_REF_VALUE_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const NOT_EDITABLE_RESULT_PATTERN = /^### Result\r?\n"not-editable"(?:\r?\n### |\s*$)/;
export const FIRST_SNAPSHOT_NODE_PATTERN = /^(\s*)- [\w-]+\b/;
