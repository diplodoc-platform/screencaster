import sharp from 'sharp';

import {MAX_IMAGE_PIXELS} from '../../shared/config.js';
import {MAX_PREVIEW_EDGE, MAX_PREVIEW_PIXELS} from '../config.js';
import {IMAGE_PREVIEW_FAILED} from '../messages.js';

// Only this model attachment is reduced. Original/production artifacts remain
// untouched, and offline illustration QA never needs another browser process.
export async function imagePreview(png: Buffer) {
    try {
        const metadata = await sharp(png, {limitInputPixels: MAX_IMAGE_PIXELS}).metadata();
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
                ? await sharp(png, {limitInputPixels: MAX_IMAGE_PIXELS})
                      .resize(dimensions.width, dimensions.height, {fit: 'fill'})
                      .png()
                      .toBuffer()
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
