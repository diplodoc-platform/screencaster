export const MIX_SAMPLE_RATE = 22050;
export const DRAFT_TOOLS = new Set([
    'browser_click',
    'browser_hover',
    'browser_navigate',
    'browser_type',
    'browser_fill_form',
    'input_focus',
    'browser_press_key',
]);
export const MAX_CLOSED_STATE_RANGES = 8;
export const MAX_PREVIEW_EDGE = 1568;
export const MAX_PREVIEW_PIXELS = 1.15 * 1024 * 1024;
export const MAX_MEDIA_ACTIVITIES = 50000;
export const TARGET_HOLD_SECONDS = 0.9;
export const FINAL_FRAME_HOLD_SECONDS = 1;
export const OUTLINE_STYLE = {color: '#5282FF', width: 5, padding: 15.5, radius: 18};
export const FFMPEG_ERRORS = {
    timeout: 'FFmpeg processing timed out; partial export and raw retained',
    start: 'FFmpeg could not start; configure FFMPEG_PATH',
    process: 'FFmpeg failed; input and raw recordings were retained',
    pixels: 'Invalid video pixel stream',
    timeline: 'Invalid video frame timeline',
};
export const ACTIVITY_GUARD_SECONDS = 0.35;
export const MAX_FRAMES = 1_000_000;

export const FFMPEG_TIMEOUT_MS = 30 * 60_000;
export const FFMPEG_STDERR_TAIL_CHARS = 4096;
export const FFMPEG_BINARY = 'ffmpeg';
export const MAX_VIDEO_FPS = 120;
export const MAX_TIMELINE_SEGMENTS = 100_000;
export const MAX_CAPTION_CHARS = 4000;
export const MAX_PREVIEW_TEXT_CHARS = 1000;
export const MAX_SPEECH_DURATION_MS = 60_000;
export const PCM_COPY_BUFFER_BYTES = 65_536;
export const VIDEO_ENCODER = 'libvpx-vp9';
export const VIDEO_PIXEL_FORMAT = 'yuv420p';
export const VIDEO_ENCODER_THREADS = 2;
export const AUDIO_ENCODER = 'libopus';
export const OPUS_SAMPLE_RATE = 48_000;
export const OPUS_BITRATE = '96k';
export const PREVIEW_VIEWPORT = {width: 1280, height: 720};

export const MAX_SPEECH_TEXT_CHARS = 1000;
export const MIN_AUDIO_SAMPLE_RATE = 8000;
export const MAX_AUDIO_SAMPLE_RATE = 192_000;
export const MAX_AUDIO_TRACK_SECONDS = 3600;
export const MAX_EDIT_REASON_CHARS = 500;
export const MAX_JOURNAL_CLOCKS = 1000;
export const MAX_JOURNAL_TOOL_CHARS = 200;
export const MAX_JOURNAL_TARGET_CHARS = 500;
export const MAX_JOURNAL_STEP_CHARS = 20_000;
export const MAX_JOURNAL_STEPS = 200;
export const MAX_NARRATION_PHRASES = 1000;
export const MAX_EDITORIAL_CUTS = 1000;
export const NARRATION_PADDING_SECONDS = 0.2;
export const MAX_CLOCK_SPREAD_SECONDS = 0.5;
export const MIN_ACTIVITY_GUARD_SECONDS = 0.25;
export const MAX_ACTIVITY_GUARD_SECONDS = 5;
export const MARKER_BRIGHT_CHANNEL_MIN = 210;
export const MARKER_DARK_CHANNEL_MAX = 45;
export const MARKER_DETECTION_FILTER = 'crop=64:32:0:0,format=rgb24,scale=2:1:flags=neighbor';

export const FRAME_HASH_BYTES = 16;
export const FRAME_TABLE_CHUNK_SIZE = 4096;
