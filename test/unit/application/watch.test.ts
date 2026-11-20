import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {expect, it} from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

it.skipIf(process.platform === 'win32')(
    'rebuilds changed host examples and stops its child watchers on shutdown',
    async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-watch-'));
        let child: ReturnType<typeof spawn> | undefined;
        let closed: Promise<number | null> | undefined;
        try {
            await Promise.all(
                ['src', 'examples', 'scripts'].map((name) => fs.mkdir(path.join(directory, name))),
            );
            await fs.writeFile(path.join(directory, 'src/main.ts'), 'export const main = true;');
            await fs.writeFile(
                path.join(directory, 'examples/adapter.ts'),
                'export const revision = "before";',
            );
            for (const [file, source, output] of [
                ['tsconfig.json', 'src', 'build'],
                ['examples/tsconfig.build.json', '.', '../build/examples'],
            ]) {
                await fs.writeFile(
                    path.join(directory, file),
                    JSON.stringify({
                        compilerOptions: {target: 'ES2022', types: [], outDir: output},
                        include: [`${source}/*.ts`],
                    }),
                );
            }
            // The browser builder is independent; keep a worker alive to exercise shutdown.
            await fs.writeFile(
                path.join(directory, 'scripts/build-browser-scripts.mjs'),
                'setInterval(() => {}, 1000);',
            );
            child = spawn(process.execPath, [path.join(root, 'scripts/watch.mjs')], {
                cwd: directory,
                stdio: 'ignore',
            });
            closed = new Promise((resolve, reject) => {
                child?.once('error', reject);
                child?.once('close', resolve);
            });
            const output = path.join(directory, 'build/examples/adapter.js');
            const waitFor = async (marker: string) => {
                const deadline = Date.now() + 10_000;
                while (Date.now() < deadline) {
                    if ((await fs.readFile(output, 'utf8').catch(() => '')).includes(marker))
                        return;
                    await delay(100);
                }
                throw new Error('Example watcher did not emit the expected revision');
            };
            await waitFor('before');
            await fs.writeFile(
                path.join(directory, 'examples/adapter.ts'),
                'export const revision = "after";',
            );
            await waitFor('after');
            child.kill('SIGTERM');
            expect(await closed).toBe(0);
        } finally {
            child?.kill('SIGTERM');
            await closed;
            await fs.rm(directory, {recursive: true, force: true});
        }
    },
    20_000,
);
