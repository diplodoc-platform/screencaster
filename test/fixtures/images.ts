import fs from 'node:fs/promises';
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';

function solidPixels(width: number, height: number, color: string) {
    const pixel = Buffer.from(color.slice(1) + 'ff', 'hex');
    return {width, height, data: Buffer.alloc(width * height * 4, pixel)};
}

export function solidPng(width: number, height: number, color: string): Buffer {
    return PNG.sync.write(Object.assign(new PNG(), solidPixels(width, height, color)));
}

export function solidJpeg(width: number, height: number, color: string): Buffer {
    return jpeg.encode(solidPixels(width, height, color), 100).data;
}

export async function readPng(input: string | Buffer) {
    return PNG.sync.read(typeof input === 'string' ? await fs.readFile(input) : input);
}

export async function rgbPixels(input: string | Buffer) {
    const image = await readPng(input);
    const pixels = Buffer.alloc(image.width * image.height * 3);
    for (let index = 0; index < image.width * image.height; index++) {
        image.data.copy(pixels, index * 3, index * 4, index * 4 + 3);
    }
    return pixels;
}
