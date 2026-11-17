export const MASK = '***';
export const MIN_SECRET_LENGTH = 3;
export const SENSITIVE_KEYS = new Set([
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'api_key',
    'password',
    'passwd',
    'secret',
    'session',
    'session_id',
    'code',
    'cookie',
    'authorization',
]);
export const SENSITIVE_JSON_KEYS = new Set([
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'api_key',
    'password',
    'passwd',
    'secret',
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
]);

export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const MILLISECONDS_PER_SECOND = 1000;
export const MILLISECONDS_PER_MINUTE = 60_000;
export const MILLISECONDS_PER_HOUR = 3_600_000;

export const MCP_SERVICE_NAME = 'diplodoc-screencaster';

export const MAX_IMAGE_PIXELS = 64_000_000;
export const MAX_RASTER_BYTES = 64 * 1024 * 1024;
export const MAX_JPEG_DECODE_MEMORY_MB = 512;
export const IMAGE_OUTLINE_COLOR = '#ff4f4f';
export const IMAGE_OUTLINE_WIDTH_CSS_PX = 3;
export const IMAGE_OUTLINE_RADIUS_CSS_PX = 4;

export const MAX_IMAGE_DEVICE_SCALE_FACTOR = 8;
export const IMAGE_GEOMETRY_SCALE_TOLERANCE = 0.000001;

export const MAX_OUTLINE_SIZE_CSS_PX = 256;
export const SCREENSHOT_OUTLINE_STYLE = {
    color: IMAGE_OUTLINE_COLOR,
    width: IMAGE_OUTLINE_WIDTH_CSS_PX,
    padding: 0,
    radius: IMAGE_OUTLINE_RADIUS_CSS_PX,
    opacity: 1,
};
