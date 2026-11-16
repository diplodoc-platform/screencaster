import type {DriverScripts} from './registry.js';

import fs from 'node:fs';

const sourceCache = new Map<keyof DriverScripts, string>();

type InputArguments<Name extends keyof DriverScripts> =
    Parameters<DriverScripts[Name]> extends [unknown, infer Input] ? [input: Input] : [];

// Serialize a bundled trusted program and JSON data for the MCP execution VM.
export function driverScript<Name extends keyof DriverScripts>(
    name: Name,
    ...args: InputArguments<Name>
): string {
    let source = sourceCache.get(name);
    if (!source) {
        // Both src/ and build/ modules have the same depth in the package.
        source = fs.readFileSync(
            new URL(`../../../build/browser/scripts/generated/${name}.js`, import.meta.url),
            'utf8',
        );
        sourceCache.set(name, source);
    }
    return `async page => {${source}\nreturn __driverScript.default(page, ${JSON.stringify(args[0] ?? null)});}`;
}

// Preserve the trusted host observer extension point behind the internal MCP boundary.
export function observerScript(code: string): string {
    return `async page => JSON.stringify({value: await (${code})(page)})`;
}
