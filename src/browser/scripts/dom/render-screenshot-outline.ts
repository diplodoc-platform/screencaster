import type {Input as DecorateScreenshotInput} from '../driver/decorate-screenshot.js';

import {
    SCREENSHOT_OUTLINE_COLOR,
    SCREENSHOT_OUTLINE_RADIUS_PX,
    SCREENSHOT_OUTLINE_WIDTH_PX,
    SCREENSHOT_OVERLAY_STYLE,
    SVG_NAMESPACE,
} from '../config.js';
export default async (input: DecorateScreenshotInput['input']) => {
    const image = document.createElement('img');
    image.src = 'data:image/png;base64,' + input.png;
    document.body.append(image);
    await image.decode();
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('style', SCREENSHOT_OVERLAY_STYLE);
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    const sx = input.width / input.bounds.width;
    const sy = input.height / input.bounds.height;
    for (const [key, value] of Object.entries({
        x: (input.target.x - input.bounds.x) * sx,
        y: (input.target.y - input.bounds.y) * sy,
        width: input.target.width * sx,
        height: input.target.height * sy,
        fill: 'none',
        stroke: SCREENSHOT_OUTLINE_COLOR,
        'stroke-width': SCREENSHOT_OUTLINE_WIDTH_PX * sx,
        rx: SCREENSHOT_OUTLINE_RADIUS_PX * sx,
    })) {
        rect.setAttribute(key, String(value));
    }
    svg.append(rect);
    document.body.append(svg);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
