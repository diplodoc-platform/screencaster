import {compositeRaster, decodeRaster, drawRaster, encodePng, rasterMetadata} from './raster.js';
import {
    IMAGE_GEOMETRY_SCALE_TOLERANCE,
    MAX_IMAGE_DEVICE_SCALE_FACTOR,
    MAX_IMAGE_PIXELS,
    SCREENSHOT_OUTLINE_STYLE,
} from './config.js';
import {type OutlineStyle, resolveOutlineStyle} from './outline-style.js';
import {INVALID_IMAGE_GEOMETRY} from './messages.js';

export type ImageBox = {x: number; y: number; width: number; height: number};
export type ScreenshotHighlightGeometry = {
    pixelWidth: number;
    pixelHeight: number;
    bounds: ImageBox;
    target: ImageBox;
    deviceScaleFactor: number;
};

// Purely local raster decoration. Browser capture owns the unchanged original.
export async function renderScreenshotHighlight(
    png: Uint8Array,
    geometry: ScreenshotHighlightGeometry,
    outline?: OutlineStyle,
): Promise<Buffer> {
    const {pixelWidth, pixelHeight, bounds, target, deviceScaleFactor} = geometry;
    if (
        !Number.isSafeInteger(pixelWidth) ||
        !Number.isSafeInteger(pixelHeight) ||
        pixelWidth < 1 ||
        pixelHeight < 1 ||
        pixelWidth * pixelHeight > MAX_IMAGE_PIXELS ||
        !Number.isFinite(deviceScaleFactor) ||
        deviceScaleFactor <= 0 ||
        deviceScaleFactor > MAX_IMAGE_DEVICE_SCALE_FACTOR ||
        ![bounds, target].every(
            (box) => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0,
        )
    ) {
        throw new Error(INVALID_IMAGE_GEOMETRY);
    }
    const metadata = rasterMetadata(png);
    if (
        metadata.format !== 'png' ||
        metadata.width !== pixelWidth ||
        metadata.height !== pixelHeight
    ) {
        throw new Error(INVALID_IMAGE_GEOMETRY);
    }
    const sx = pixelWidth / bounds.width;
    const sy = pixelHeight / bounds.height;
    const x = (target.x - bounds.x) * sx;
    const y = (target.y - bounds.y) * sy;
    const width = target.width * sx;
    const height = target.height * sy;
    if (
        ![x, y, width, height, sx, sy].every(Number.isFinite) ||
        Math.abs(sx - deviceScaleFactor) > IMAGE_GEOMETRY_SCALE_TOLERANCE ||
        Math.abs(sy - deviceScaleFactor) > IMAGE_GEOMETRY_SCALE_TOLERANCE ||
        x >= pixelWidth ||
        y >= pixelHeight ||
        x + width <= 0 ||
        y + height <= 0
    ) {
        throw new Error(INVALID_IMAGE_GEOMETRY);
    }
    const style = resolveOutlineStyle(SCREENSHOT_OUTLINE_STYLE, outline);
    const padding = style.padding * sx;
    const overlay = drawRaster(pixelWidth, pixelHeight, (context) => {
        context.strokeStyle = style.color;
        context.globalAlpha = style.opacity;
        context.lineWidth = style.width * sx;
        context.beginPath();
        context.roundRect(
            x - padding,
            y - padding,
            width + padding * 2,
            height + padding * 2,
            Math.min(style.radius * sx, (width + padding * 2) / 2, (height + padding * 2) / 2),
        );
        context.stroke();
    });
    const image = decodeRaster(png);
    compositeRaster(image, overlay);
    return encodePng(image);
}
