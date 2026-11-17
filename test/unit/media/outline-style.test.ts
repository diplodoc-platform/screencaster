import {expect, it} from 'vitest';
import {Ajv2020} from 'ajv/dist/2020.js';

import {outlineStyleSchema} from '../../../src/shared/outline-style.js';
import {renderScreenshotHighlight} from '../../../src/shared/image-renderer.js';
import {outlineGraph} from '../../../src/media/timeline/outline.js';
import {
    launchConfigJsonSchema,
    launchConfigSchema,
} from '../../../src/application/launch-schema.js';
import {readPng, solidPng} from '../../fixtures/images.js';

const validate = new Ajv2020({strict: false, validateFormats: false}).compile(
    launchConfigJsonSchema,
);

it.each([
    {color: 'red'},
    {color: '#fff'},
    {color: '#000000;movie=secret'},
    {width: 0},
    {width: 257},
    {padding: -1},
    {radius: Infinity},
    {opacity: -0.1},
    {opacity: 1.1},
    {unknown: true},
])('rejects invalid outline values in runtime and editor configuration: %j', (outline) => {
    expect(outlineStyleSchema.safeParse(outline).success).toBe(false);
    for (const output of ['screenshots', 'video']) {
        const config = {version: 1, outputs: {[output]: {outline}}};
        expect(launchConfigSchema.safeParse(config).success).toBe(false);
        expect(validate(config)).toBe(false);
    }
});

it.each([1, 2])(
    'renders configured color, padding, width and opacity at DPR %s without changing source pixels',
    async (dpr) => {
        const source = solidPng(100 * dpr, 80 * dpr, '#ffffff');
        const retained = Buffer.from(source);
        const geometry = {
            pixelWidth: 100 * dpr,
            pixelHeight: 80 * dpr,
            bounds: {x: 0, y: 0, width: 100, height: 80},
            target: {x: 20, y: 20, width: 40, height: 30},
            deviceScaleFactor: dpr,
        };
        const output = await renderScreenshotHighlight(source, geometry, {
            color: '#0000ff',
            width: 4,
            padding: 5,
            radius: 0,
            opacity: 0.5,
        });
        const image = await readPng(output);
        const pixel = (x: number, y: number) => [
            ...image.data.subarray(
                (y * dpr * image.width + x * dpr) * 4,
                (y * dpr * image.width + x * dpr) * 4 + 3,
            ),
        ];
        const stroke = pixel(30, 15);
        expect(stroke[0]).toBeGreaterThanOrEqual(126);
        expect(stroke[0]).toBeLessThanOrEqual(128);
        expect(stroke[1]).toBe(stroke[0]);
        expect(stroke[2]).toBe(255);
        expect(pixel(30, 20)).toEqual([255, 255, 255]);
        expect(pixel(30, 11)).toEqual([255, 255, 255]);
        expect(source).toEqual(retained);
        const transparent = await readPng(
            await renderScreenshotHighlight(source, geometry, {opacity: 0}),
        );
        expect(transparent.data).toEqual((await readPng(source)).data);
    },
);

it('builds a bounded video filter with configured color and alpha and rejects injection', () => {
    const box = {x: 20, y: 20, width: 40, height: 30};
    const viewport = {width: 100, height: 80};
    const graph = outlineGraph('picture', 'decorated', box, 1, viewport, undefined, {
        color: '#1234ab',
        width: 4,
        padding: 0,
        radius: 0,
        opacity: 0.25,
    });
    expect(graph).toContain('geq=r=18:g=52:b=171');
    expect(graph).toContain('255*0.25*clip(2.5');
    expect(graph).toContain('overlay=x=17:y=17');
    expect(() =>
        outlineGraph('picture', 'decorated', box, 1, viewport, undefined, {
            color: 'red;movie=secret',
        }),
    ).toThrow();
});
