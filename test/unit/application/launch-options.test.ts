import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';

import {loadLaunchOptions} from '../../../src/application/launch-options.js';

const directories: string[] = [];
afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
        directories.splice(0).map((dir) => fs.rm(dir, {recursive: true, force: true})),
    );
});

async function fixture(config: unknown) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-config-'));
    directories.push(root);
    const directory = path.join(root, 'settings');
    await fs.mkdir(directory);
    const file = path.join(directory, 'launch.json');
    await fs.writeFile(file, JSON.stringify(config), {mode: 0o600});
    return {root, directory, file};
}

it('resolves config paths beside the file and explicit CLI paths from cwd', async () => {
    const {root, directory, file} = await fixture({
        version: 1,
        directory: 'runs',
        storageState: 'robot.json',
        policy: 'policy.json',
        browser: {url: 'https://service.test', viewport: {width: 1440, height: 1000}},
    });
    const configured = await loadLaunchOptions({config: file}, root);
    expect(configured).toMatchObject({
        directory: path.join(directory, 'runs'),
        storageStatePath: path.join(directory, 'robot.json'),
        policyPath: path.join(directory, 'policy.json'),
        runDefaults: {url: 'https://service.test', viewport: {width: 1440, height: 1000}},
    });
    expect(
        await loadLaunchOptions(
            {config: file, directory: 'override', storageState: 'state.json', policy: 'rules.json'},
            root,
        ),
    ).toMatchObject({
        directory: path.join(root, 'override'),
        storageStatePath: path.join(root, 'state.json'),
        policyPath: path.join(root, 'rules.json'),
    });
    expect(await loadLaunchOptions({directory: 'legacy'}, root)).toMatchObject({
        directory: path.join(root, 'legacy'),
    });
});

it('loads trusted providers relative to config, while keeping inline policies on the host', async () => {
    const {root, directory, file} = await fixture({
        version: 1,
        directory: 'runs',
        providers: 'providers.mjs',
        policy: {rules: [{origin: 'https://service.test', actions: ['read']}]},
        screenshotPolicy: {redaction: {hide: ['.account-name']}},
    });
    await fs.writeFile(
        path.join(directory, 'providers.mjs'),
        'export const loader = async () => "instruction";',
    );
    const options = await loadLaunchOptions({config: file}, root);
    expect(options.loader).toBeTypeOf('function');
    const policy = options.policyFactory?.('https://elsewhere.test');
    expect(policy?.allows('https://service.test/page', 'read')).toBe(true);
    expect(policy?.allows('https://elsewhere.test', 'read')).toBe(false);
    expect(policy?.allows('https://service.test', 'act')).toBe(false);
    expect(options.screenshotPolicy?.redaction?.hide).toEqual(['.account-name']);
});

it('requires the configured state variable, but permits an explicit CLI override', async () => {
    const {root, file} = await fixture({
        version: 1,
        directory: 'runs',
        storageState: {env: 'SCREENCASTER_TEST_STATE'},
    });
    vi.stubEnv('SCREENCASTER_TEST_STATE', '');
    await expect(loadLaunchOptions({config: file}, root)).rejects.toThrow('empty or missing');
    expect(
        (await loadLaunchOptions({config: file, storageState: '/tmp/override.json'}, root))
            .storageStatePath,
    ).toBe('/tmp/override.json');
    vi.stubEnv('SCREENCASTER_TEST_STATE', '/tmp/private-state.json');
    expect((await loadLaunchOptions({config: file}, root)).storageStatePath).toBe(
        '/tmp/private-state.json',
    );
});

it.each([
    {password: 'private-marker'},
    {version: 2},
    {browser: {viewport: {width: 0, height: 1000}}},
    {browser: {authentication: {password: 'private-marker'}}},
    {outputs: {video: {name: '../private-marker'}}},
    {outputs: {video: {highlights: 'private-marker'}}},
    {outputs: {screenshots: {highlight: 'private-marker'}}},
    {outputs: {unknown: true}},
    {
        screenshotPolicy: {
            redaction: {replacements: [{from: 'private-marker', to: 'private-marker'}]},
        },
    },
    {policy: {rules: [{origin: 'https://service.test/private-marker', actions: ['read']}]}},
])('rejects unsupported or invalid config without echoing its values: %#', async (invalid) => {
    const {root, file} = await fixture({version: 1, directory: 'runs', ...invalid});
    await expect(loadLaunchOptions({config: file}, root)).rejects.toThrow(
        /^Invalid launch config:/,
    );
});

it('loads output settings and rejects a disabled recorder before authentication', async () => {
    const {file} = await fixture({
        version: 1,
        directory: 'runs',
        outputs: {video: {highlights: true}, screenshots: {highlight: true}},
    });
    expect((await loadLaunchOptions({config: file})).outputs).toEqual({
        video: {name: 'walkthrough', highlights: true},
        screenshots: {highlight: true},
    });
    const conflict = await fixture({
        version: 1,
        directory: 'runs',
        browser: {video: false},
        outputs: {video: {}},
        authentication: {module: 'must-not-be-imported.mjs', options: {}},
    });
    await expect(loadLaunchOptions({config: conflict.file})).rejects.toThrow(
        'Configured video output requires recording',
    );
});

it('refuses duplicate host authentication rather than silently choosing a source', async () => {
    const {root, directory, file} = await fixture({
        version: 1,
        directory: 'runs',
        providers: 'providers.mjs',
        storageState: 'state.json',
    });
    await fs.writeFile(
        path.join(directory, 'providers.mjs'),
        'export const authentication = {allowedOrigins: ["https://service.test"], authenticate: async () => ({status: "challenge", origin: "https://service.test", challenge: "device"})};',
    );
    await expect(loadLaunchOptions({config: file}, root)).rejects.toThrow('conflicting sources');
});

it('loads a config-relative authentication factory without exposing its options as server fields', async () => {
    const {root, directory, file} = await fixture({
        version: 1,
        directory: 'runs',
        authentication: {module: './auth.mjs', options: {password: 'private-test-marker'}},
    });
    await fs.writeFile(
        path.join(directory, 'auth.mjs'),
        `
        export function createAuthentication(options, context) {
            if (options.password !== 'private-test-marker') throw new Error('bad option');
            return {allowedOrigins: ['https://service.test'], authenticate: async () => ({
                status: 'ready', origin: 'https://service.test', storageStatePath: context.baseDirectory + '/state.json'
            })};
        }
    `,
    );
    const options = await loadLaunchOptions({config: file}, root);
    expect(JSON.stringify(options)).not.toContain('private-test-marker');
    expect(
        await options.authentication?.authenticate({
            url: 'https://service.test',
            origin: 'https://service.test',
        }),
    ).toMatchObject({storageStatePath: path.join(directory, 'state.json')});
    await expect(
        loadLaunchOptions({config: file, storageState: 'state.json'}, root),
    ).rejects.toThrow('conflicting sources');
});

it.skipIf(process.platform === 'win32')(
    'rejects readable-by-others authentication configs before importing their module',
    async () => {
        const {root, file} = await fixture({
            version: 1,
            directory: 'runs',
            authentication: {module: 'absent.mjs', options: {}},
        });
        await fs.chmod(file, 0o644);
        await expect(loadLaunchOptions({config: file}, root)).rejects.toThrow('chmod 600');
    },
);

it('suppresses authentication factory exception values', async () => {
    const {root, directory, file} = await fixture({
        version: 1,
        directory: 'runs',
        authentication: {module: 'auth.mjs', options: {}},
    });
    await fs.writeFile(
        path.join(directory, 'auth.mjs'),
        'export function createAuthentication() { throw new Error("private-test-marker"); }',
    );
    await expect(loadLaunchOptions({config: file}, root)).rejects.toThrow(
        /^authentication.options: factory failed or returned an invalid authenticator$/,
    );
});

it('loads a config-relative TTS factory and refuses a second TTS source', async () => {
    const {file, directory} = await fixture({
        version: 1,
        directory: 'runs',
        tts: {module: 'tts.mjs', options: {key: 'private-marker'}},
        outputs: {video: {}, narration: {}},
    });
    await fs.writeFile(
        path.join(directory, 'tts.mjs'),
        'export function createTts(options) { if (!options.key) throw new Error(); return {identity:"test-tts",synthesize:async()=>({pcm:new Uint8Array(2),sampleRate:48000,channels:1})}; }',
    );
    const configured = await loadLaunchOptions({config: file});
    expect(configured.tts?.identity).toBe('test-tts');
    expect(JSON.stringify(configured)).not.toContain('private-marker');
    await fs.writeFile(
        path.join(directory, 'providers.mjs'),
        'export const tts={identity:"other",synthesize:async()=>null};',
    );
    await expect(
        loadLaunchOptions({config: file, providers: path.join(directory, 'providers.mjs')}),
    ).rejects.toThrow('conflicting sources');
});

it('loads built-in SpeechKit without an example module and accepts editor schema metadata', async () => {
    vi.stubEnv('SCREENCASTER_TEST_SPEECH_KEY', 'private-key-marker');
    const {file} = await fixture({
        $schema: './run.config.schema.json',
        version: 1,
        directory: 'runs',
        tts: {provider: 'speechkit', options: {apiKey: {env: 'SCREENCASTER_TEST_SPEECH_KEY'}}},
    });
    const options = await loadLaunchOptions({config: file});
    expect(options.tts?.identity).toContain('speechkit');
    expect(JSON.stringify(options)).not.toContain('private-key-marker');
});

it.each([
    [{apiKey: 'private-marker', speed: 100}, /tts.options.speed:.*limit/],
    [{apiKey: 'private-marker', voice: 'private-marker!'}, /tts.options.voice:.*format/],
    [{apiKey: {env: 'SCREENCASTER_TEST_MISSING'}}, /env value is empty or missing/],
    [{serviceAccountKey: 'private-marker'}, /serviceAccountKey: expected authorized-key JSON/],
    [{apiKey: 'private-marker', iamToken: 'private-marker'}, /exactly one SpeechKit/],
])('reports safe built-in TTS diagnostics: %#', async (options, message) => {
    vi.stubEnv('SCREENCASTER_TEST_MISSING', '');
    const {file} = await fixture({
        version: 1,
        directory: 'runs',
        tts: {provider: 'speechkit', options},
    });
    const error = await loadLaunchOptions({config: file}).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain('private-marker');
});

it('reports known config field paths without echoing arbitrary keys or values', async () => {
    for (const config of [
        {browser: {viewport: {width: -1, height: 100}}},
        {browser: {'private-marker': 'private-marker'}},
    ]) {
        const {file} = await fixture({version: 1, directory: 'runs', ...config});
        const error = await loadLaunchOptions({config: file}).catch((value: unknown) => value);
        expect((error as Error).message).toContain('Invalid launch config: browser');
        expect((error as Error).message).not.toContain('private-marker');
    }
});

it('distinguishes custom module import, export and execution failures without provider details', async () => {
    const {file, directory} = await fixture({
        version: 1,
        directory: 'runs',
        tts: {module: 'absent.mjs', options: {}},
    });
    await expect(loadLaunchOptions({config: file})).rejects.toThrow('tts.module: could not import');
    for (const [name, body, expected] of [
        ['missing', 'export const something = true;', 'expected a createTts export'],
        [
            'throwing',
            'export function createTts() {throw new Error("private-marker");}',
            'factory failed',
        ],
    ]) {
        await fs.writeFile(path.join(directory, `${name}.mjs`), body);
        await fs.writeFile(
            file,
            JSON.stringify({
                version: 1,
                directory: 'runs',
                tts: {module: `${name}.mjs`, options: {}},
            }),
        );
        const error = await loadLaunchOptions({config: file}).catch((value: unknown) => value);
        expect((error as Error).message).toContain(expected);
        expect((error as Error).message).not.toContain('private-marker');
    }
});

it('loads dotenv beside the config before state lookup and custom module imports', async () => {
    vi.stubEnv('SCREENCASTER_TEST_DOTENV_STATE', undefined);
    vi.stubEnv('SCREENCASTER_TEST_DOTENV_KEY', undefined);
    const {file, directory, root} = await fixture({
        version: 1,
        directory: 'runs',
        envFile: '.env',
        storageState: {env: 'SCREENCASTER_TEST_DOTENV_STATE'},
        tts: {module: 'env-tts.mjs', options: {}},
    });
    await fs.writeFile(
        path.join(directory, '.env'),
        'SCREENCASTER_TEST_DOTENV_STATE=session.json\nSCREENCASTER_TEST_DOTENV_KEY=dotenv-private-marker\n',
        {mode: 0o600},
    );
    await fs.writeFile(
        path.join(directory, 'env-tts.mjs'),
        `
        const loaded = process.env.SCREENCASTER_TEST_DOTENV_KEY === 'dotenv-private-marker';
        export function createTts() {
            if (!loaded) throw new Error('env not loaded before import');
            return {identity: 'dotenv-test', synthesize: async () => null};
        }
    `,
    );
    const configured = await loadLaunchOptions({config: file}, root);
    expect(configured.storageStatePath).toBe(path.join(directory, 'session.json'));
    expect(configured.tts?.identity).toBe('dotenv-test');
    expect(JSON.stringify(configured)).not.toContain('dotenv-private-marker');
    expect(configured).not.toHaveProperty('envFile');
});

it('keeps process env precedence, supports quoted multiline values and never evaluates shell text', async () => {
    vi.stubEnv('SCREENCASTER_TEST_DOTENV_EXISTING', 'process-value');
    vi.stubEnv('SCREENCASTER_TEST_DOTENV_EMPTY', '');
    vi.stubEnv('SCREENCASTER_TEST_DOTENV_MULTI', undefined);
    vi.stubEnv('SCREENCASTER_TEST_DOTENV_LITERAL', undefined);
    const {file, directory} = await fixture({version: 1, directory: 'runs', envFile: '.env'});
    await fs.writeFile(
        path.join(directory, '.env'),
        [
            'SCREENCASTER_TEST_DOTENV_EXISTING=file-value',
            'SCREENCASTER_TEST_DOTENV_EMPTY=file-value',
            "SCREENCASTER_TEST_DOTENV_MULTI='first line\nsecond line'",
            "SCREENCASTER_TEST_DOTENV_LITERAL='$(not-a-command) ${SCREENCASTER_TEST_DOTENV_EXISTING}'",
        ].join('\n'),
        {mode: 0o600},
    );
    await loadLaunchOptions({config: file});
    expect(process.env.SCREENCASTER_TEST_DOTENV_EXISTING).toBe('process-value');
    expect(process.env.SCREENCASTER_TEST_DOTENV_EMPTY).toBe('');
    expect(process.env.SCREENCASTER_TEST_DOTENV_MULTI).toBe('first line\nsecond line');
    expect(process.env.SCREENCASTER_TEST_DOTENV_LITERAL).toBe(
        '$(not-a-command) ${SCREENCASTER_TEST_DOTENV_EXISTING}',
    );
});

it('loads no dotenv implicitly and refuses missing, oversized or symlink env files without echoing paths', async () => {
    vi.stubEnv('SCREENCASTER_TEST_DOTENV_UNREQUESTED', undefined);
    const {file, directory} = await fixture({version: 1, directory: 'runs'});
    const envFile = path.join(directory, '.env');
    await fs.writeFile(envFile, 'SCREENCASTER_TEST_DOTENV_UNREQUESTED=private-marker\n', {
        mode: 0o600,
    });
    await loadLaunchOptions({config: file});
    expect(process.env.SCREENCASTER_TEST_DOTENV_UNREQUESTED).toBeUndefined();
    await fs.writeFile(path.join(directory, 'oversized'), 'X'.repeat(65537), {mode: 0o600});
    const names = ['private-marker-missing', 'oversized'];
    if (process.platform !== 'win32') {
        await fs.symlink(envFile, path.join(directory, 'link'));
        names.push('link');
        await fs.writeFile(path.join(directory, 'public'), 'SECRET=private-marker', {mode: 0o644});
        names.push('public');
    }
    for (const env of names) {
        await fs.writeFile(file, JSON.stringify({version: 1, directory: 'runs', envFile: env}));
        const error = await loadLaunchOptions({config: file}).catch((value: unknown) => value);
        expect((error as Error).message).toContain('envFile: expected');
        expect((error as Error).message).not.toContain('private-marker');
    }
});
