import type {McpResult} from '../transport/mcp/types.js';

import {JPEG_SIGNATURE_BYTES, MAX_IMAGE_BYTES, PNG_SIGNATURE_BYTES} from './config.js';
import {BASE64_IMAGE_PATTERN} from './patterns.js';

export type BrowserImage = {mimeType: 'image/png' | 'image/jpeg'; data: string};

export function forwardBrowserImage(
    tool: string,
    result: McpResult,
    accept?: (image: BrowserImage) => void,
) {
    if (tool !== 'browser_take_screenshot' || !accept || result?.isError) {
        return '';
    }
    for (const part of result?.content ?? []) {
        if (
            part.type !== 'image' ||
            !part.data ||
            !part.mimeType ||
            (part.mimeType !== 'image/png' && part.mimeType !== 'image/jpeg') ||
            part.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
            !BASE64_IMAGE_PATTERN.test(part.data)
        ) {
            continue;
        }
        const bytes = Buffer.from(part.data, 'base64');
        const signature =
            part.mimeType === 'image/png'
                ? Buffer.from(PNG_SIGNATURE_BYTES)
                : Buffer.from(JPEG_SIGNATURE_BYTES);
        if (
            bytes.length <= MAX_IMAGE_BYTES &&
            bytes.subarray(0, signature.length).equals(signature)
        ) {
            accept({mimeType: part.mimeType, data: part.data});
            return '\nRequested screenshot attached.';
        }
    }
    return '\nRequested screenshot is unavailable or exceeds the image limit.';
}
