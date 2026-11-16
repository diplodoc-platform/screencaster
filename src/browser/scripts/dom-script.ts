import fs from 'node:fs';

const sources = new Map<string, string>();

// Read a self-contained DOM function, optionally binding its data argument.
export function domScript(name: string, input?: unknown): string {
    let source = sources.get(name);
    if (!source) {
        source = fs.readFileSync(
            new URL(`../../../build/browser/scripts/generated/dom/${name}.js`, import.meta.url),
            'utf8',
        );
        sources.set(name, source);
    }
    return input === undefined
        ? `(first, second) => {${source}\nreturn __domScript.default(first, second);}`
        : `() => {${source}\nreturn __domScript.default(${JSON.stringify(input)});}`;
}
