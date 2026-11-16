import {driverScript} from '../scripts/driver-script.js';

export function revealTargetCode(ref: string, allowedBlockerLabels: string[]): string {
    return driverScript('reveal-target', {ref: ref, allowedBlockerLabels: allowedBlockerLabels});
}
