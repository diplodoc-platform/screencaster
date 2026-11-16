export const ACTION_TARGET_DEADLINE_MS = 1500;
export const ACTION_TARGET_SAMPLE_INTERVAL_MS = 50;
export const ACTION_TARGET_TOLERANCE_PX = 0.25;
export const VIDEO_STABLE_INTERVAL_MS = 800;
export const ACTION_TARGET_STABLE_MS = VIDEO_STABLE_INTERVAL_MS;
export const POINTER_READINESS_TIMEOUT_MS = 5000;
export const MAX_EDITABLE_SELECTION_ATTEMPTS = 2;

export const MAX_GEOMETRY_MAGNITUDE = 1_000_000;
export const GEOMETRY_DECIMAL_SCALE = 1000;
export const INTERSECTION_TIMEOUT_MS = 1000;
export const BACKGROUND_INSPECTION_TIMEOUT_MS = 1500;
export const BACKGROUND_CLICK_TIMEOUT_MS = 1000;
export const MAX_OBSTRUCTION_NODES = 256;
export const MAX_BLOCKER_LABELS = 4;
export const MEDIA_CLOCK_MARKER_DURATION_MS = 800;

export const MAX_CONTROL_LABEL_CHARS = 200;
export const BACKGROUND_SAMPLE_FRACTIONS = [0.5, 0.2, 0.8];
export const VISIBILITY_SAMPLE_FRACTIONS = [
    [0.5, 0.5],
    [0.1, 0.1],
    [0.9, 0.1],
    [0.1, 0.9],
    [0.9, 0.9],
];
export const BACKGROUND_INTERSECTION_TIMEOUT_MS = 500;
export const BACKGROUND_RECT_TOLERANCE_PX = 0.5;

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const SCREENSHOT_OVERLAY_STYLE =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
export const SCREENSHOT_OUTLINE_COLOR = '#ff4f4f';
export const SCREENSHOT_OUTLINE_WIDTH_PX = 3;
export const SCREENSHOT_OUTLINE_RADIUS_PX = 4;
