import {expect, it} from 'vitest';

import {readPng, solidPng} from '../../fixtures/images.js';
import {imagePreview} from '../../../src/media/preview/image-preview.js';
import {MAX_PREVIEW_EDGE, MAX_PREVIEW_PIXELS} from '../../../src/media/config.js';

it('reduces only the local model attachment and retains the original pixels', async () => {
    const original = await solidPng(2400, 1200, '#123456');
    const retained = Buffer.from(original);
    const result = await imagePreview(original);
    expect(result.dimensions.width).toBeLessThanOrEqual(MAX_PREVIEW_EDGE);
    expect(result.dimensions.width * result.dimensions.height).toBeLessThanOrEqual(
        MAX_PREVIEW_PIXELS,
    );
    const pixels = await readPng(Buffer.from(result.image.data, 'base64'));
    expect(pixels).toMatchObject(result.dimensions);
    expect(original.equals(retained)).toBe(true);
    expect(await readPng(original)).toMatchObject({width: 2400, height: 1200});
});

it('refuses malformed or non-PNG attachments with a bounded diagnostic', async () => {
    await expect(imagePreview(Buffer.from('private-source-canary'))).rejects.toThrow(
        'bounded local PNG preview',
    );
});
