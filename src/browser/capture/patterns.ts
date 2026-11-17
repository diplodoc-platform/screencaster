export const CAPTURE_WHITESPACE_PATTERN = /\s+/g;
export const CAPTURE_ZERO_WIDTH_PATTERN = /[\u200b-\u200d\ufeff]/g;
export const CAPTURE_BLOCK_DISPLAY_PATTERN = /^(?:block|flow-root|flex|grid|list-item|table)/;
export const CAPTURE_GENERATED_IMAGE_PATTERN =
    /(?:url|image|(?:-webkit-)?image-set|paint|(?:-webkit-)?cross-fade)\s*\(/i;

export const CAPTURE_CONTENT_LITERALS_PATTERN =
    /^(?:"[^"\\]*"|'[^'\\]*')(?:\s+(?:"[^"\\]*"|'[^'\\]*'))*$/;
export const CAPTURE_CONTENT_LITERAL_PATTERN = /"([^"\\]*)"|'([^'\\]*)'/g;
