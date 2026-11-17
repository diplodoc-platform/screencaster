export const GUARD_TIMEOUT_MS = 5000;
export const DEFAULT_VIEWPORT = {width: 1280, height: 720};
export const MCP_NAVIGATION_TIMEOUT_MS = 60000;
export const MCP_RPC_GRACE_MS = 30000;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const NATIVE_DIALOG_RECOVERY_TIMEOUT_MS = 5000;
export const DEFAULT_TIMEOUT = 10_000;
export const MAX_OBSERVATION_DIAGNOSTICS = 128;
export const READ_TOOLS = new Set([
    'browser_snapshot',
    'browser_verify_inputs',
    'browser_take_screenshot',
    'browser_wait_for',
    'browser_navigate',
]);
export const TEXT_JSON_BUDGET = 8000;
export const CONTEXT_JSON_BUDGET = 2000;
export const FRAGMENT_MAX_CHARS = 4000;
export const SEARCH_CONTEXT_CHARS = 128;

export const CONTEXT_CHECK_ATTEMPTS = 4;
export const CONTEXT_CHECK_RETRY_BASE_MS = 200;
export const MAX_CONTEXT_ERROR_CHAIN = 32;
export const BROWSER_CLOSE_TIMEOUT_MS = 60_000;
export const MAX_OBSTRUCTION_SNAPSHOT_LABELS = 64;
export const MAX_SAFE_ERROR_CHARS = 1000;
export const MAX_READINESS_PAYLOAD_CHARS = 4096;
export const BACKGROUND_ANCESTOR_TIMEOUT_MS = 2500;
export const MAX_BACKGROUND_REPLY_CHARS = 1024;
export const MAX_INPUT_VALUE_CHARS = 64_000;
export const MAX_INPUT_EXPECTATIONS = 100;
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_HINT_CONTROLS = 40;
export const MAX_CONTROL_HINT_CHARS = 500;
export const MAX_EVIDENCE_REPLY_CHARS = 16_384;
export const MAX_EVIDENCE_FILE_BYTES = 32_768;
export const MAX_EVIDENCE_EVENTS = 8;
export const MAX_EVIDENCE_COUNT = 1_000_000;
export const MAX_SNAPSHOT_QUERY_CHARS = 200;
export const MIN_SNAPSHOT_FRAGMENT_CHARS = 256;
export const PNG_SIGNATURE_BYTES = [137, 80, 78, 71, 13, 10, 26, 10];
export const JPEG_SIGNATURE_BYTES = [255, 216, 255];

export {
    MAX_GEOMETRY_MAGNITUDE,
    VIDEO_STABLE_INTERVAL_MS,
    MAX_BLOCKER_LABELS,
    MAX_CONTROL_LABEL_CHARS as MAX_LABEL_CHARS,
} from './scripts/config.js';
