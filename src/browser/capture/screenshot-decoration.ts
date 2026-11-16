import {driverScript} from '../scripts/driver-script.js';
export function screenshotDecorationCode(input: {
    png: string;
    width: number;
    height: number;
    bounds: {x: number; y: number; width: number; height: number};
    target: {x: number; y: number; width: number; height: number};
    output: string;
}) {
    return driverScript('decorate-screenshot', {input: input});
}
