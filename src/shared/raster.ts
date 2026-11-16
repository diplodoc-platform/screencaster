import {ImageData, type SKRSContext2D, createCanvas} from '@napi-rs/canvas';
import {imageSize} from 'image-size';
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';

import {MAX_IMAGE_PIXELS, MAX_JPEG_DECODE_MEMORY_MB, MAX_RASTER_BYTES} from './config.js';
import {INVALID_RASTER_IMAGE} from './messages.js';

export type Raster = {width: number; height: number; data: Buffer};

function assertDimensions(width: number, height: number): void {
    if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        width * height > MAX_IMAGE_PIXELS
    ) {
        throw new Error(INVALID_RASTER_IMAGE);
    }
}

function exifOrientation(bytes: Buffer): number | undefined {
    const little = bytes.toString('ascii', 0, 2) === 'II';
    if (!little && bytes.toString('ascii', 0, 2) !== 'MM') throw new Error(INVALID_RASTER_IMAGE);
    const word = (offset: number) =>
        little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
    const long = (offset: number) =>
        little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    if (word(2) !== 42) throw new Error(INVALID_RASTER_IMAGE);
    const offset = long(4);
    const count = word(offset);
    for (let index = 0; index < count; index++) {
        const entry = offset + 2 + index * 12;
        if (word(entry) !== 0x112) continue;
        if (word(entry + 2) !== 3 || long(entry + 4) !== 1) throw new Error(INVALID_RASTER_IMAGE);
        return word(entry + 8);
    }
    return undefined;
}

function checkPngMetadata(bytes: Buffer): void {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        if (length > bytes.length - offset - 12) throw new Error(INVALID_RASTER_IMAGE);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        const chunk = bytes.subarray(offset + 8, offset + 8 + length);
        if (type === 'acTL' && (length !== 8 || chunk.readUInt32BE(0) !== 1)) {
            throw new Error(INVALID_RASTER_IMAGE);
        }
        if (type === 'eXIf') {
            const orientation = exifOrientation(chunk);
            if (orientation !== undefined && orientation !== 1)
                throw new Error(INVALID_RASTER_IMAGE);
        }
        if (type === 'IEND') return;
        offset += length + 12;
    }
    throw new Error(INVALID_RASTER_IMAGE);
}

export function rasterMetadata(input: Uint8Array) {
    try {
        const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        if (bytes.length > MAX_RASTER_BYTES) throw new Error(INVALID_RASTER_IMAGE);
        const {width, height, type, orientation} = imageSize(bytes);
        if (
            !['png', 'jpg'].includes(type ?? '') ||
            (orientation !== undefined && orientation !== 1)
        ) {
            throw new Error(INVALID_RASTER_IMAGE);
        }
        assertDimensions(width, height);
        if (type === 'png') checkPngMetadata(bytes);
        return {width, height, format: type === 'jpg' ? 'jpeg' : 'png'};
    } catch {
        throw new Error(INVALID_RASTER_IMAGE);
    }
}

export function decodeRaster(input: Uint8Array): Raster {
    try {
        const metadata = rasterMetadata(input);
        const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        const image =
            metadata.format === 'png'
                ? PNG.sync.read(bytes, {checkCRC: true})
                : jpeg.decode(bytes, {
                      formatAsRGBA: true,
                      tolerantDecoding: false,
                      maxResolutionInMP: MAX_IMAGE_PIXELS / 1_000_000,
                      maxMemoryUsageInMB: MAX_JPEG_DECODE_MEMORY_MB,
                  });
        if (image.width !== metadata.width || image.height !== metadata.height)
            throw new Error(INVALID_RASTER_IMAGE);
        return {width: image.width, height: image.height, data: Buffer.from(image.data)};
    } catch {
        throw new Error(INVALID_RASTER_IMAGE);
    }
}

export function encodePng(image: Raster): Buffer {
    assertDimensions(image.width, image.height);
    if (image.data.length !== image.width * image.height * 4) throw new Error(INVALID_RASTER_IMAGE);
    return PNG.sync.write(Object.assign(new PNG(), image), {colorType: 6});
}

export function cropRaster(
    image: Raster,
    box: {x: number; y: number; width: number; height: number},
): Raster {
    assertDimensions(box.width, box.height);
    if (
        !Number.isInteger(box.x) ||
        !Number.isInteger(box.y) ||
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > image.width ||
        box.y + box.height > image.height
    )
        throw new Error(INVALID_RASTER_IMAGE);
    const data = Buffer.alloc(box.width * box.height * 4);
    for (let row = 0; row < box.height; row++) {
        const start = ((box.y + row) * image.width + box.x) * 4;
        image.data.copy(data, row * box.width * 4, start, start + box.width * 4);
    }
    return {width: box.width, height: box.height, data};
}

// Canvas is used only for new artwork and resized previews. Source pixels never
// pass through its premultiplied-alpha representation in production crops.
export function drawRaster(
    width: number,
    height: number,
    draw: (context: SKRSContext2D) => void,
): Raster {
    assertDimensions(width, height);
    const context = createCanvas(width, height).getContext('2d');
    draw(context);
    return {width, height, data: Buffer.from(context.getImageData(0, 0, width, height).data)};
}

export function compositeRaster(base: Raster, overlay: Raster, left = 0, top = 0): void {
    if (
        !Number.isInteger(left) ||
        !Number.isInteger(top) ||
        left < 0 ||
        top < 0 ||
        left + overlay.width > base.width ||
        top + overlay.height > base.height
    )
        throw new Error(INVALID_RASTER_IMAGE);
    for (let row = 0; row < overlay.height; row++) {
        for (let col = 0; col < overlay.width; col++) {
            const source = (row * overlay.width + col) * 4;
            const target = ((top + row) * base.width + left + col) * 4;
            blendPixel(base.data, target, overlay.data, source);
        }
    }
}

function blendPixel(base: Buffer, target: number, overlay: Buffer, source: number) {
    const alpha = overlay[source + 3] / 255;
    if (alpha === 0) return;
    if (alpha === 1) {
        overlay.copy(base, target, source, source + 4);
        return;
    }
    const retained = (base[target + 3] / 255) * (1 - alpha);
    const combined = alpha + retained;
    for (let channel = 0; channel < 3; channel++) {
        base[target + channel] = Math.round(
            (overlay[source + channel] * alpha + base[target + channel] * retained) / combined,
        );
    }
    base[target + 3] = Math.round(combined * 255);
}

export function resizeRaster(image: Raster, width: number, height: number): Raster {
    assertDimensions(width, height);
    const source = createCanvas(image.width, image.height);
    source
        .getContext('2d')
        .putImageData(
            new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
            0,
            0,
        );
    return drawRaster(width, height, (context) => {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, 0, 0, width, height);
    });
}
