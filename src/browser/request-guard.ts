import type {RequestGuardOptions} from './network-guard-options.js';

import {driverScript} from './scripts/driver-script.js';
// This code runs only as a trusted MCP browser_run_code call, before navigation.
// It is never exposed as a model tool. The surrounding origin policy still applies.
export function requestGuardScript(
    options: RequestGuardOptions | Array<{origin: string; path: string}>,
): string {
    return driverScript(
        'install-request-guard',
        Array.isArray(options) ? {postReads: options} : options,
    );
}
