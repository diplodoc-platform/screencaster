import {compositeRaster, decodeRaster, drawRaster, encodePng, rasterMetadata} from './raster.js';
import {
    IMAGE_GEOMETRY_SCALE_TOLERANCE,
    IMAGE_OUTLINE_COLOR,
    IMAGE_OUTLINE_RADIUS_CSS_PX,
    IMAGE_OUTLINE_WIDTH_CSS_PX,
    MAX_IMAGE_DEVICE_SCALE_FACTOR,
    MAX_IMAGE_PIXELS,
} from './config.js';
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
    const overlay = drawRaster(pixelWidth, pixelHeight, (context) => {
        context.strokeStyle = IMAGE_OUTLINE_COLOR;
        context.lineWidth = IMAGE_OUTLINE_WIDTH_CSS_PX * sx;
        context.beginPath();
        context.roundRect(x, y, width, height, IMAGE_OUTLINE_RADIUS_CSS_PX * sx);
        context.stroke();
    });
    const image = decodeRaster(png);
    compositeRaster(image, overlay);
    return encodePng(image);
}
