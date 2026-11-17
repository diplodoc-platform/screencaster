import {decodeRaster, encodePng, rasterMetadata, resizeRaster} from '../../shared/raster.js';
import {MAX_PREVIEW_EDGE, MAX_PREVIEW_PIXELS} from '../config.js';
import {IMAGE_PREVIEW_FAILED} from '../messages.js';

// Only this model attachment is reduced. Original/production artifacts remain
// untouched, and offline illustration QA never needs another browser process.
export async function imagePreview(png: Buffer) {
    try {
        const metadata = rasterMetadata(png);
        const {width, height} = metadata;
        if (metadata.format !== 'png' || !width || !height) {
            throw new Error(IMAGE_PREVIEW_FAILED);
        }
        const scale = Math.min(
            1,
            MAX_PREVIEW_EDGE / width,
            MAX_PREVIEW_EDGE / height,
            Math.sqrt(MAX_PREVIEW_PIXELS / (width * height)),
        );
        const dimensions = {
            width: Math.max(1, Math.floor(width * scale)),
            height: Math.max(1, Math.floor(height * scale)),
        };
        const preview =
            scale < 1
                ? encodePng(resizeRaster(decodeRaster(png), dimensions.width, dimensions.height))
                : png;
        return {
            dimensions,
            image: {
                type: 'image' as const,
                mimeType: 'image/png',
                data: preview.toString('base64'),
            },
        };
    } catch {
        throw new Error(IMAGE_PREVIEW_FAILED);
    }
}
