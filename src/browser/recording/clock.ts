import type {McpStdioClient} from '../../transport/mcp/client.js';
import type {McpResult} from '../../transport/mcp/types.js';
import type {MediaClock} from '../../media/recording/journal.js';

import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {driverScript} from '../scripts/driver-script.js';
import {MCP_RESULT_LINE_PATTERN} from '../patterns.js';
import {MEDIA_CLOCK_UNAVAILABLE} from '../messages.js';
import {extractText} from '../../transport/mcp/result.js';

// At 25 fps, 500 ms plus two quantized edges gives u <= 370 ms.
// Two u margins and one full frame require 780 ms for targets and final states.
export {VIDEO_STABLE_INTERVAL_MS} from '../config.js';

// Internal recording instrumentation only; never registered as a model tool.
// Host timestamps deliberately do not read the untrusted page's Date object.
export async function captureBrowserClock(
    client: McpStdioClient,
    videoDir: string,
    final: boolean,
): Promise<MediaClock | undefined> {
    const result = (await client.callTool('browser_run_code', {
        code: driverScript('capture-media-clock', {final: final, markerId: randomUUID()}),
    })) as McpResult;
    const payload = MCP_RESULT_LINE_PATTERN.exec(extractText(result))?.[1];
    const encoded: unknown = JSON.parse(payload ?? 'null');
    if (encoded === null && !result?.isError) {
        return undefined;
    }
    const value: unknown = typeof encoded === 'string' ? JSON.parse(encoded) : undefined;
    if (
        !value ||
        typeof value !== 'object' ||
        !('recording' in value) ||
        typeof value.recording !== 'string' ||
        path.dirname(value.recording) !== videoDir ||
        !('startMs' in value) ||
        typeof value.startMs !== 'number' ||
        !('endMs' in value) ||
        typeof value.endMs !== 'number'
    ) {
        throw new Error(MEDIA_CLOCK_UNAVAILABLE);
    }
    return {
        recording: path.basename(value.recording),
        startMs: value.startMs,
        endMs: value.endMs,
    };
}
