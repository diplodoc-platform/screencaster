import {crc32} from 'node:zlib';
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';
import {expect, it} from 'vitest';

import {MAX_IMAGE_PIXELS} from '../../../src/shared/config.js';
import {
    compositeRaster,
    cropRaster,
    decodeRaster,
    drawRaster,
    encodePng,
    rasterMetadata,
} from '../../../src/shared/raster.js';
import {renderScreenshotHighlight} from '../../../src/shared/image-renderer.js';
import {solidJpeg, solidPng} from '../../fixtures/images.js';

it('preserves every RGBA channel, including hidden RGB, in unmodified pixels and crops', async () => {
    const data = Buffer.alloc(8 * 8 * 4);
    for (let index = 0; index < data.length; index++) data[index] = index % 256;
    const png = PNG.sync.write(Object.assign(new PNG(), {width: 8, height: 8, data}));
    const image = decodeRaster(png);
    expect(image.data).toEqual(data);
    expect(PNG.sync.read(encodePng(image)).data).toEqual(data);
    const crop = cropRaster(image, {x: 1, y: 2, width: 3, height: 2});
    expect(crop.data).toEqual(Buffer.concat([data.subarray(68, 80), data.subarray(100, 112)]));
    const decorated = await renderScreenshotHighlight(png, {
        pixelWidth: 8,
        pixelHeight: 8,
        deviceScaleFactor: 1,
        bounds: {x: 0, y: 0, width: 8, height: 8},
        target: {x: 4, y: 4, width: 2, height: 2},
    });
    expect(PNG.sync.read(decorated).data.subarray(0, 4)).toEqual(data.subarray(0, 4));
});

it('composites alpha without changing pixels outside the overlay', () => {
    const base = {width: 2, height: 1, data: Buffer.from([0, 0, 255, 255, 17, 29, 41, 0])};
    const overlay = {width: 1, height: 1, data: Buffer.from([255, 0, 0, 128])};
    compositeRaster(base, overlay);
    expect([...base.data]).toEqual([128, 0, 127, 255, 17, 29, 41, 0]);
    compositeRaster(base, {width: 1, height: 1, data: Buffer.from([1, 2, 3, 0])}, 1);
    expect([...base.data.subarray(4)]).toEqual([17, 29, 41, 0]);
});

it('decodes JPEG pixels without automatic rotation or resampling', () => {
    const bytes = solidJpeg(13, 7, '#aabbcc');
    expect(rasterMetadata(bytes)).toEqual({width: 13, height: 7, format: 'jpeg'});
    expect(decodeRaster(bytes).data).toEqual(jpeg.decode(bytes).data);
});

function exif(orientation: number) {
    const bytes = Buffer.alloc(26);
    bytes.write('II');
    bytes.writeUInt16LE(42, 2);
    bytes.writeUInt32LE(8, 4);
    bytes.writeUInt16LE(1, 8);
    bytes.writeUInt16LE(0x112, 10);
    bytes.writeUInt16LE(3, 12);
    bytes.writeUInt32LE(1, 14);
    bytes.writeUInt16LE(orientation, 18);
    return bytes;
}

it('rejects rotated JPEG metadata before rendering', () => {
    const original = solidJpeg(10, 20, '#112233');
    const withOrientation = (orientation: number) => {
        const payload = Buffer.concat([Buffer.from('Exif\0\0'), exif(orientation)]);
        const header = Buffer.from([0xff, 0xe1, 0, payload.length + 2]);
        return Buffer.concat([original.subarray(0, 2), header, payload, original.subarray(2)]);
    };
    expect(rasterMetadata(withOrientation(1))).toMatchObject({width: 10, height: 20});
    expect(() => decodeRaster(withOrientation(6))).toThrow('unrotated');
});

it('validates PNG EXIF orientation and bounds before decoding pixels', () => {
    const original = solidPng(10, 20, '#112233');
    const withExif = (payload: Buffer) => {
        const chunk = Buffer.alloc(payload.length + 12);
        chunk.writeUInt32BE(payload.length);
        chunk.write('eXIf', 4);
        payload.copy(chunk, 8);
        chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
        return Buffer.concat([original.subarray(0, 33), chunk, original.subarray(33)]);
    };
    expect(decodeRaster(withExif(exif(1))).data).toEqual(decodeRaster(original).data);
    expect(() => decodeRaster(withExif(exif(6)))).toThrow('unrotated');
    const invalidOffset = exif(1);
    invalidOffset.writeUInt32LE(0xffffffff, 4);
    expect(() => decodeRaster(withExif(invalidOffset))).toThrow('bounded');
});

it('rejects animated PNGs, oversized headers, malformed data and non-raster inputs', () => {
    const png = solidPng(2, 2, '#ffffff');
    const animation = Buffer.alloc(20);
    animation.writeUInt32BE(8, 0);
    animation.write('acTL', 4);
    animation.writeUInt32BE(2, 8);
    expect(() =>
        rasterMetadata(Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)])),
    ).toThrow('single-frame');
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(MAX_IMAGE_PIXELS, 16);
    expect(() => decodeRaster(oversized)).toThrow('bounded');
    expect(() => decodeRaster(png.subarray(0, 40))).toThrow('bounded');
    expect(() => decodeRaster(Buffer.from('<svg width="10" height="10"/>'))).toThrow('PNG or JPEG');
    expect(() => drawRaster(MAX_IMAGE_PIXELS, 2, () => {})).toThrow('bounded');
});

it('rejects crop and composite geometry outside the source', () => {
    const image = decodeRaster(solidPng(2, 2, '#ffffff'));
    expect(() => cropRaster(image, {x: 1, y: 0, width: 2, height: 2})).toThrow('bounded');
    expect(() => compositeRaster(image, image, 1, 0)).toThrow('bounded');
});
