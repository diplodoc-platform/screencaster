import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkoutPaths = [root, await fs.realpath(root)].flatMap((directory) => {
    const native = path.resolve(directory);
    return [native, native.split(path.sep).join('/'), JSON.stringify(native).slice(1, -1)];
});
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-package-'));
const npm = process.env.npm_execpath;
assert(npm, 'Run this check through npm run test:package');
const exec = (command, args, cwd = directory) =>
    execFileSync(command, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
const runNpm = (args, cwd) => exec(process.execPath, [npm, ...args], cwd);
try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const [packed] = JSON.parse(
        runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root),
    );
    const files = new Set(packed.files.map((file) => file.path));
    assert(
        ![...files].some((file) => /\.(test|spec)\./.test(file)),
        'Tests must not enter the package',
    );
    assert(!files.has('run.config.json'), 'Private launch config must not enter the package');
    assert(files.has('.env.example'), 'Credential-free dotenv sample must be packaged');
    assert(
        ![...files].some((file) => {
            const name = path.basename(file);
            return (name === '.env' || name.startsWith('.env.')) && name !== '.env.example';
        }),
        'Private dotenv files must not enter the package',
    );
    assert(
        files.has('run.config.example.json'),
        'The credential-free config sample must be packaged',
    );
    assert(files.has('run.config.schema.json'), 'Editor schema must be packaged');
    assert(files.has('.agents/skills/screencaster/SKILL.md'), 'The agent skill must be packaged');
    assert(
        files.has('examples/host-adapters/synthetic.ts'),
        'Runnable host examples must be packaged',
    );
    assert(
        files.has('examples/host-adapters/providers.ts'),
        'The trusted CLI host module must be packaged',
    );
    assert(
        ![...files].some((file) =>
            /(?:^|\/)(?:private-adapters|robot-[^/]+|corporate\.[^/]+)(?:\/|$)/.test(file),
        ),
        'Organization-specific adapters must not enter the package',
    );
    for (const file of files) {
        if (!/\.(?:js|ts|json|md)$/.test(file)) continue;
        const content = await fs.readFile(path.join(root, file), 'utf8');
        assert(
            !/yandex-team\.ru|ya vault|YAV_TOKEN|SSH_AUTH_SOCK/.test(content),
            `Internal infrastructure reference in package file: ${file}`,
        );
        assert(
            !checkoutPaths.some((checkout) => content.includes(checkout)),
            `Local checkout path in package file: ${file}`,
        );
    }
    await fs.writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({private: true, type: 'module'}),
    );
    runNpm([
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-workspaces',
        path.join(directory, packed.filename),
    ]);
    const specifiers = Object.keys(manifest.exports).map((entry) =>
        entry === '.' ? manifest.name : manifest.name + entry.slice(1),
    );
    await fs.writeFile(
        path.join(directory, 'consumer.mjs'),
        `
        import assert from 'node:assert/strict';
        import {readHarness} from '@diplodoc/screencaster';
        for (const entry of ${JSON.stringify(specifiers)}) await import(entry);
        for (const topic of ['overview', 'decompose', 'execute', 'configuration', 'media', 'illustrations']) assert((await readHarness(topic)).length > 0);
        console.log('Public exports and packaged agent instructions: OK');
    `,
    );
    process.stdout.write(exec(process.execPath, ['consumer.mjs']));
    await fs.writeFile(
        path.join(directory, 'consumer.ts'),
        specifiers
            .map(
                (specifier, index) =>
                    `import * as module${index} from ${JSON.stringify(specifier)};`,
            )
            .join('\n'),
    );
    exec(process.execPath, [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--module',
        'NodeNext',
        '--target',
        'ES2022',
        '--types',
        'node',
        '--typeRoots',
        path.join(root, 'node_modules/@types'),
        'consumer.ts',
    ]);
    const example = path.join(
        directory,
        'node_modules/@diplodoc/screencaster/build/examples/host-adapters/synthetic.js',
    );
    assert.deepEqual(JSON.parse(exec(process.execPath, [example])), {
        authentication: 'ready',
        syntheticFixtureApplied: true,
    });
    const cli = path.join(directory, 'node_modules/@diplodoc/screencaster/build/cli.js');
    assert.match(exec(process.execPath, [cli, '--help']), /Usage: screencaster/);
    assert(files.has('run.config.example.json'));
    assert(!files.has('run.config.json'), 'Private launch config must not enter the package');
    const speechkitAdapter = await import(
        pathToFileURL(
            path.join(
                directory,
                'node_modules/@diplodoc/screencaster/build/examples/host-adapters/speechkit-tts.js',
            ),
        ).href
    );
    assert.equal(typeof speechkitAdapter.createTts, 'function');
    const builtInFactory = await import(
        pathToFileURL(
            path.join(
                directory,
                'node_modules/@diplodoc/screencaster/build/providers/speechkit-factory.js',
            ),
        ).href
    );
    assert.equal(
        speechkitAdapter.createTts,
        builtInFactory.createTts,
        'Legacy wrapper uses the built-in factory',
    );
    const configFile = path.join(directory, 'launch.json');
    await fs.writeFile(
        configFile,
        JSON.stringify({
            version: 1,
            directory: './runs',
            envFile: '.env',
            tts: {provider: 'speechkit', options: {apiKey: {env: 'SCREENCASTER_PACKAGE_TEST_KEY'}}},
            browser: {url: 'https://service.test', viewport: {width: 1440, height: 1000}},
        }),
        {mode: 0o600},
    );
    await fs.writeFile(
        path.join(directory, '.env'),
        'SCREENCASTER_PACKAGE_TEST_KEY=synthetic-package-test-key\n',
        {mode: 0o600},
    );
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cli, '--config', configFile],
        cwd: root,
    });
    const client = new Client({name: 'installed-config-check', version: '1.0.0'});
    try {
        await client.connect(transport);
        const tools = await client.listTools();
        const open = tools.tools.find((tool) => tool.name === 'screencaster_open');
        assert(open);
        assert(!open.inputSchema.required?.includes('url'));
        assert(
            !(await client.callTool({name: 'screencaster_help', arguments: {topic: 'execute'}}))
                .isError,
        );
        const configuration = await client.callTool({
            name: 'screencaster_help',
            arguments: {topic: 'configuration'},
        });
        assert(!configuration.isError);
        assert.match(JSON.stringify(configuration.content), /outputs.video.highlights/);
    } finally {
        await client.close();
        await transport.close();
    }
    process.stdout.write(
        `Installed package: ${files.size} files; imports, declarations, CLI, host examples and agent guidance passed.\n`,
    );
} finally {
    await fs.rm(directory, {recursive: true, force: true});
}
