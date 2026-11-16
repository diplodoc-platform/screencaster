import {OUTLINE_STYLE} from '../config.js';
export type OutlineBox = {x: number; y: number; width: number; height: number};

// CSS units from the original documentation SVG, scaled with the viewport.
export {OUTLINE_STYLE} from '../config.js';

export function outlineGraph(
    input: string,
    output: string,
    box: OutlineBox,
    scale: number,
    viewport: {width: number; height: number},
    enable?: string,
): string {
    const padding = OUTLINE_STYLE.padding * scale;
    const stroke = OUTLINE_STYLE.width * scale;
    const radius = OUTLINE_STYLE.radius * scale;
    const x = Math.max(0, Math.floor(box.x - padding - stroke / 2 - 1));
    const y = Math.max(0, Math.floor(box.y - padding - stroke / 2 - 1));
    const width = box.width + padding * 2;
    const height = box.height + padding * 2;
    const maskWidth = Math.min(
        viewport.width - x,
        Math.ceil(box.x + box.width + padding + stroke / 2 + 1 - x),
    );
    const maskHeight = Math.min(
        viewport.height - y,
        Math.ceil(box.y + box.height + padding + stroke / 2 + 1 - y),
    );
    const r = Math.min(radius, width / 2, height / 2);
    const [red, green, blue] = [1, 3, 5].map((offset) =>
        Number.parseInt(OUTLINE_STYLE.color.slice(offset, offset + 2), 16),
    );
    const alpha = [
        `st(0,abs(X+0.5-${box.x + box.width / 2 - x})-${width / 2 - r})`,
        `st(1,abs(Y+0.5-${box.y + box.height / 2 - y})-${height / 2 - r})`,
        `st(2,hypot(max(ld(0),0),max(ld(1),0))+min(max(ld(0),ld(1)),0)-${r})`,
        `255*clip(${stroke / 2 + 0.5}-abs(ld(2)),0,1)`,
    ].join(';');
    const mask = `${output}Mask`;
    return (
        `nullsrc=s=${maskWidth}x${maskHeight}:r=1:d=1,format=rgba,` +
        `geq=r=${red}:g=${green}:b=${blue}:a='${alpha}',trim=end_frame=1[${mask}];` +
        `[${input}][${mask}]overlay=x=${x}:y=${y}:format=auto` +
        (enable ? `:enable='${enable}'` : '') +
        `[${output}]`
    );
}
