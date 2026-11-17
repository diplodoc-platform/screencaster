export const MAX_CAPTURE_LOCATORS = 32;
export const MAX_CAPTURE_MATCHES = 64;
export const MAX_CAPTURE_LOCATOR_CHARS = 512;
export const DEFAULT_CAPTURE_TIMEOUT_MS = 5_000;
export const MAX_CAPTURE_TIMEOUT_MS = 30_000;
export const CAPTURE_READINESS_POLL_MS = 50;
export const MAX_CAPTURE_REPLACEMENTS = 64;
export const MAX_CAPTURE_REPLACEMENT_CHARS = 2_048;
export const MAX_CAPTURE_HIDE_SELECTORS = 32;
export const MAX_CAPTURE_DOM_NODES = 100_000;
export const MAX_CAPTURE_TEXT_CHARS = 2_000_000;
export const CAPTURE_REDACTION_ATTRIBUTES = [
    'placeholder',
    'aria-label',
    'title',
    'alt',
    'value',
    'aria-valuetext',
] as const;
export const CAPTURE_UNSUPPORTED_SURFACES =
    'iframe,frame,canvas,video,object,embed,img,input[type="image"],svg image';

// Generated text/image surfaces supported by the capture verifier.
export const CAPTURE_PSEUDO_ELEMENTS = ['::marker', '::before', '::after'] as const;

export const CAPTURE_IMAGE_STYLE_PROPERTIES = [
    'background-image',
    'mask-image',
    'border-image-source',
    'list-style-image',
] as const;
export const PNG_SIGNATURE = 0x89504e47;
export const PNG_WIDTH_OFFSET = 16;
export const PNG_HEIGHT_OFFSET = 20;
