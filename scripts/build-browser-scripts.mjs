import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, context} from 'esbuild';

const watch = process.argv.includes('--watch');
const compile = async (options) => {
    if (watch) {
        const task = await context(options);
        await task.watch();
    } else {
        await build(options);
    }
};

const root = new URL('../', import.meta.url);
const directory = new URL('src/browser/scripts/driver/', root);
const entries = (await fs.readdir(directory)).filter((name) => name.endsWith('.ts'));
await Promise.all(
    entries.map((name) =>
        compile({
            absWorkingDir: fileURLToPath(root),
            entryPoints: [path.join(fileURLToPath(directory), name)],
            outfile: fileURLToPath(
                new URL(`build/browser/scripts/generated/${name.replace(/\.ts$/, '.js')}`, root),
            ),
            plugins: [
                {
                    name: 'serialized-browser-functions',
                    setup(builder) {
                        builder.onResolve({filter: /\?script$/}, (args) => ({
                            path: path
                                .relative(
                                    fileURLToPath(root),
                                    path.resolve(
                                        args.resolveDir,
                                        args.path.replace(/\.js\?script$/, '.ts'),
                                    ),
                                )
                                .split(path.sep)
                                .join('/'),
                            namespace: 'browser-function',
                        }));
                        builder.onLoad(
                            {filter: /.*/, namespace: 'browser-function'},
                            async (args) => {
                                const output = await build({
                                    absWorkingDir: fileURLToPath(root),
                                    metafile: true,
                                    entryPoints: [path.resolve(fileURLToPath(root), args.path)],
                                    bundle: true,
                                    write: false,
                                    format: 'iife',
                                    globalName: '__domScript',
                                    target: 'es2022',
                                    platform: 'browser',
                                    legalComments: 'none',
                                });
                                const code = `function(first, second, third) {${output.outputFiles[0].text}\nreturn __domScript.default.call(this, first, second, third);}`;
                                return {
                                    contents: `export default ${code};`,
                                    loader: 'js',
                                    watchFiles: Object.keys(output.metafile.inputs).map((file) =>
                                        path.resolve(fileURLToPath(root), file),
                                    ),
                                };
                            },
                        );
                    },
                },
            ],
            bundle: true,
            format: 'iife',
            globalName: '__driverScript',
            target: 'es2022',
            platform: 'neutral',
            legalComments: 'none',
        }),
    ),
);

const domDirectory = new URL('src/browser/scripts/dom/', root);
const domEntries = (await fs.readdir(domDirectory)).filter((name) => name.endsWith('.ts'));
await Promise.all(
    domEntries.map((name) =>
        compile({
            absWorkingDir: fileURLToPath(root),
            entryPoints: [path.join(fileURLToPath(domDirectory), name)],
            outfile: fileURLToPath(
                new URL(
                    `build/browser/scripts/generated/dom/${name.replace(/\.ts$/, '.js')}`,
                    root,
                ),
            ),
            bundle: true,
            format: 'iife',
            globalName: '__domScript',
            target: 'es2022',
            platform: 'browser',
            legalComments: 'none',
        }),
    ),
);
