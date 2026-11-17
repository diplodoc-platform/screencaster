import type {AnalyzedIllustrationInput, IllustrationBox} from './contracts.js';

import {
    type Raster,
    compositeRaster,
    cropRaster,
    decodeRaster,
    drawRaster,
    encodePng,
    resizeRaster,
} from '../../shared/raster.js';
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
    const image = cropRaster(decodeRaster(bytes), crop);
    if (input.annotation) {
        const {box, method, color, width, opacity} = input.annotation;
        const x = box.x - crop.x;
        const y = box.y - crop.y;
        const overlay = drawRaster(crop.width, crop.height, (context) => {
            context.beginPath();
            if (method === 'outline') {
                context.strokeStyle = color;
                context.lineWidth = width;
                context.rect(x, y, box.width, box.height);
                context.stroke();
            } else {
                context.fillStyle = '#000000';
                context.globalAlpha = opacity;
                context.rect(0, 0, crop.width, crop.height);
                context.rect(x, y, box.width, box.height);
                context.fill('evenodd');
            }
        });
        compositeRaster(image, overlay);
    }
    return encodePng(image);
}

type Panel = {id: string; png: Buffer; width: number; height: number; label?: string};

function labelRaster(width: number, text: string): Raster {
    return drawRaster(width, COLLAGE_LABEL_HEIGHT_PX, (context) => {
        context.fillStyle = LABEL_COLOR;
        context.font = `${LABEL_FONT_SIZE_PX}px sans-serif`;
        context.fillText(text, 0, LABEL_FONT_SIZE_PX + LABEL_BASELINE_OFFSET_PX);
    });
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
    return drawRaster(width, height, (context) => {
        context.fillStyle = CANVAS_BACKGROUND;
        context.fillRect(0, 0, width, height);
    });
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
    const image = canvas(width, height);
    let cursor = COLLAGE_PADDING_PX;
    for (const panel of panels) {
        const left = vertical ? COLLAGE_PADDING_PX : cursor;
        const top = vertical ? cursor : COLLAGE_PADDING_PX;
        compositeRaster(image, labelRaster(panel.width, panel.label ?? panel.id), left, top);
        compositeRaster(image, decodeRaster(panel.png), left, top + COLLAGE_LABEL_HEIGHT_PX);
        cursor += vertical
            ? panel.height + COLLAGE_LABEL_HEIGHT_PX + COLLAGE_GAP_PX
            : panel.width + COLLAGE_GAP_PX;
    }
    return encodePng(image);
}

// Contact sheets are explicitly previews. Only this path resamples panels.
export async function renderContactSheet(panels: Panel[]): Promise<Buffer> {
    const columns = Math.min(PREVIEW_COLUMNS, panels.length);
    const rows = Math.ceil(panels.length / columns);
    const cellHeight = PREVIEW_HEIGHT_PX + COLLAGE_LABEL_HEIGHT_PX;
    const image = canvas(
        COLLAGE_PADDING_PX * 2 + columns * PREVIEW_WIDTH_PX + (columns - 1) * COLLAGE_GAP_PX,
        COLLAGE_PADDING_PX * 2 + rows * cellHeight + (rows - 1) * COLLAGE_GAP_PX,
    );
    for (const [index, panel] of panels.entries()) {
        const source = decodeRaster(panel.png);
        const scale = Math.min(
            1,
            PREVIEW_WIDTH_PX / source.width,
            PREVIEW_HEIGHT_PX / source.height,
        );
        const preview = resizeRaster(
            source,
            Math.max(1, Math.round(source.width * scale)),
            Math.max(1, Math.round(source.height * scale)),
        );
        const left = COLLAGE_PADDING_PX + (index % columns) * (PREVIEW_WIDTH_PX + COLLAGE_GAP_PX);
        const top =
            COLLAGE_PADDING_PX + Math.floor(index / columns) * (cellHeight + COLLAGE_GAP_PX);
        compositeRaster(image, labelRaster(PREVIEW_WIDTH_PX, panel.label ?? panel.id), left, top);
        compositeRaster(image, preview, left, top + COLLAGE_LABEL_HEIGHT_PX);
    }
    return encodePng(image);
}
