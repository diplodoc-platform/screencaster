import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// npm run watch builds first, so example imports can resolve package declarations.
const tsc = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
const commands = [
    [tsc, '-p', 'tsconfig.json', '--watch'],
    ['scripts/build-browser-scripts.mjs', '--watch'],
    [tsc, '-p', 'examples/tsconfig.build.json', '--watch'],
];
let stopping = false;
const children = commands.map((args) => spawn(process.execPath, args, {stdio: 'inherit'}));
function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill();
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
for (const child of children) {
    child.once('error', () => stop(1));
    child.once('close', (code) => stop(code ?? 1));
}
