import type {AnalyzedIllustrationInput, IllustrationBox} from './contracts.js';

import sharp, {type OverlayOptions} from 'sharp';

import {MAX_IMAGE_PIXELS} from '../../shared/config.js';

import {
    CANVAS_BACKGROUND,
    COLLAGE_GAP_PX,
    COLLAGE_LABEL_HEIGHT_PX,
    COLLAGE_PADDING_PX,
    LABEL_BASELINE_OFFSET_PX,
    LABEL_COLOR,
    LABEL_FONT_SIZE_PX,
    MAX_ILLUSTRATION_DIMENSION,
    PREVIEW_COLUMNS,
    PREVIEW_HEIGHT_PX,
    PREVIEW_WIDTH_PX,
} from './config.js';
import {INVALID_ILLUSTRATION_GEOMETRY} from './messages.js';
import {XML_CHARACTER_PATTERN} from './patterns.js';

export function xmlText(text: string): string {
    const escapes: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
    };
    return text.replace(XML_CHARACTER_PATTERN, (character) => escapes[character]);
}

function contains(outer: IllustrationBox, inner: IllustrationBox) {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

export function validateGeometry(input: AnalyzedIllustrationInput): IllustrationBox {
    const source = {x: 0, y: 0, width: input.sourceWidth, height: input.sourceHeight};
    const crop = input.crop ?? source;
    if (
        !contains(source, crop) ||
        (input.bbox && !contains(crop, input.bbox)) ||
        (input.annotation && !contains(crop, input.annotation.box))
    ) {
        throw new Error(INVALID_ILLUSTRATION_GEOMETRY);
    }
    return crop;
}

export async function renderPanel(
    bytes: Buffer,
    input: AnalyzedIllustrationInput,
): Promise<Buffer> {
    const crop = validateGeometry(input);
    const image = sharp(bytes, {limitInputPixels: MAX_IMAGE_PIXELS}).extract({
        left: crop.x,
        top: crop.y,
        width: crop.width,
        height: crop.height,
    });
    if (input.annotation) {
        const {box, method, color, width, opacity} = input.annotation;
        const x = box.x - crop.x;
        const y = box.y - crop.y;
        const shape =
            method === 'outline'
                ? `<rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" fill="none" stroke="${color}" stroke-width="${width}"/>`
                : `<path d="M0 0H${crop.width}V${crop.height}H0Z M${x} ${y}h${box.width}v${box.height}h-${box.width}Z" fill="#000000" fill-opacity="${opacity}" fill-rule="evenodd"/>`;
        const overlay = Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}">${shape}</svg>`,
        );
        image.composite([{input: overlay}]);
    }
    return image.png().toBuffer();
}

type Panel = {id: string; png: Buffer; width: number; height: number; label?: string};

function labelSvg(width: number, text: string): Buffer {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${COLLAGE_LABEL_HEIGHT_PX}">` +
            `<text x="0" y="${LABEL_FONT_SIZE_PX + LABEL_BASELINE_OFFSET_PX}" font-family="sans-serif" font-size="${LABEL_FONT_SIZE_PX}" fill="${LABEL_COLOR}">${xmlText(text)}</text></svg>`,
    );
}

function canvas(width: number, height: number) {
    if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > MAX_ILLUSTRATION_DIMENSION ||
        height > MAX_ILLUSTRATION_DIMENSION ||
        width * height > MAX_IMAGE_PIXELS
    ) {
        throw new Error(INVALID_ILLUSTRATION_GEOMETRY);
    }
    return sharp({create: {width, height, channels: 4, background: CANVAS_BACKGROUND}});
}

export async function renderCollage(panels: Panel[], vertical: boolean): Promise<Buffer> {
    const width =
        COLLAGE_PADDING_PX * 2 +
        (vertical
            ? Math.max(...panels.map((panel) => panel.width))
            : panels.reduce((total, panel) => total + panel.width, 0) +
              COLLAGE_GAP_PX * (panels.length - 1));
    const height =
        COLLAGE_PADDING_PX * 2 +
        (vertical
            ? panels.reduce((total, panel) => total + panel.height + COLLAGE_LABEL_HEIGHT_PX, 0) +
              COLLAGE_GAP_PX * (panels.length - 1)
            : Math.max(...panels.map((panel) => panel.height)) + COLLAGE_LABEL_HEIGHT_PX);
    const composites: OverlayOptions[] = [];
    let cursor = COLLAGE_PADDING_PX;
    for (const panel of panels) {
        const left = vertical ? COLLAGE_PADDING_PX : cursor;
        const top = vertical ? cursor : COLLAGE_PADDING_PX;
        composites.push({input: labelSvg(panel.width, panel.label ?? panel.id), left, top});
        composites.push({input: panel.png, left, top: top + COLLAGE_LABEL_HEIGHT_PX});
        cursor += vertical
            ? panel.height + COLLAGE_LABEL_HEIGHT_PX + COLLAGE_GAP_PX
            : panel.width + COLLAGE_GAP_PX;
    }
    return canvas(width, height).composite(composites).png().toBuffer();
}

// Contact sheets are explicitly previews. Only this path resamples panels.
export async function renderContactSheet(panels: Panel[]): Promise<Buffer> {
    const columns = Math.min(PREVIEW_COLUMNS, panels.length);
    const rows = Math.ceil(panels.length / columns);
    const cellHeight = PREVIEW_HEIGHT_PX + COLLAGE_LABEL_HEIGHT_PX;
    const composites: OverlayOptions[] = [];
    for (const [index, panel] of panels.entries()) {
        const preview = await sharp(panel.png)
            .resize({
                width: PREVIEW_WIDTH_PX,
                height: PREVIEW_HEIGHT_PX,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .png()
            .toBuffer();
        const left = COLLAGE_PADDING_PX + (index % columns) * (PREVIEW_WIDTH_PX + COLLAGE_GAP_PX);
        const top =
            COLLAGE_PADDING_PX + Math.floor(index / columns) * (cellHeight + COLLAGE_GAP_PX);
        composites.push({input: labelSvg(PREVIEW_WIDTH_PX, panel.label ?? panel.id), left, top});
        composites.push({input: preview, left, top: top + COLLAGE_LABEL_HEIGHT_PX});
    }
    return canvas(
        COLLAGE_PADDING_PX * 2 + columns * PREVIEW_WIDTH_PX + (columns - 1) * COLLAGE_GAP_PX,
        COLLAGE_PADDING_PX * 2 + rows * cellHeight + (rows - 1) * COLLAGE_GAP_PX,
    )
        .composite(composites)
        .png()
        .toBuffer();
}
