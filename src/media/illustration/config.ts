export const ILLUSTRATION_VERSION = 1;
export const MAX_ILLUSTRATION_INPUTS = 24;
export const MAX_ILLUSTRATION_BYTES = 64 * 1024 * 1024;
export const MAX_ILLUSTRATION_DIMENSION = 16_384;
export const MAX_ILLUSTRATION_TEXT_CHARS = 2000;
export const MAX_ILLUSTRATION_LABEL_CHARS = 120;
export const MAX_ILLUSTRATION_PATH_CHARS = 2048;
export const MAX_ILLUSTRATION_DPR = 8;
export const MAX_ILLUSTRATION_TOTAL_PIXELS = 64_000_000;
export const DEFAULT_OUTLINE_COLOR = '#ff4f4f';
export const DEFAULT_OUTLINE_WIDTH_PX = 3;
export const DEFAULT_DIM_OPACITY = 0.55;
export const COLLAGE_GAP_PX = 24;
export const COLLAGE_PADDING_PX = 24;
export const COLLAGE_LABEL_HEIGHT_PX = 32;
export const PREVIEW_WIDTH_PX = 320;
export const PREVIEW_HEIGHT_PX = 240;
export const PREVIEW_COLUMNS = 4;
export const LABEL_FONT_SIZE_PX = 16;
export const CANVAS_BACKGROUND = '#ffffff';
export const LABEL_COLOR = '#222222';
export const PRODUCTION_MANIFEST_FILE = 'production.json';
export const MACHINE_QA_FILE = 'machine-qa.json';
export const CONTACT_SHEET_FILE = 'contact-sheet.png';
export const COLLAGE_FILE = 'collage.png';
export const PUBLICATION_FILE = 'publication-yfm.md';
export const RESERVED_ILLUSTRATION_IDS = new Set([
    'contact-sheet',
    'collage',
    'production',
    'machine-qa',
    'publication-yfm',
]);

export const MAX_ILLUSTRATION_ID_CHARS = 64;
export const MAX_ILLUSTRATION_LOCALE_CHARS = 64;
export const MAX_ILLUSTRATION_CSS_CLASS_CHARS = 100;
export const MAX_ANNOTATION_WIDTH_PX = 32;
export const MAX_INPUT_LIMITATIONS = 10;
export const MAX_PRODUCTION_LIMITATIONS = 100;
export const LABEL_BASELINE_OFFSET_PX = 3;

export const ANALYSIS_MANIFEST_FILE = 'analysis.json';
