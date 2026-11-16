import type {ServerOptions} from '../server/mcp/index.js';
import type {HostAuthenticationFactory, HostTtsFactory} from './host-providers.js';
import type {z} from 'zod';

import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {BrowserPolicy} from '../browser/policy.js';
import {createTts} from '../providers/speechkit-factory.js';
import {speechkitOptionsError, speechkitOptionsSchema} from '../providers/speechkit-options.js';
import {schemaDiagnostic} from '../shared/schema-diagnostics.js';

import {recordingEnabled} from './output-options.js';
import {loadLaunchEnvironment} from './launch-environment.js';
import {validateHostProviders} from './host-providers.js';
import {launchConfigPropertyNames, launchConfigSchema} from './launch-schema.js';
import {AUTOMATIC_NARRATION_REQUIRES_TTS} from './messages.js';
import {
    AMBIGUOUS_LAUNCH_CAPABILITIES,
    AUTH_FACTORY_FAILED,
    AUTH_FACTORY_MISSING,
    AUTH_MODULE_IMPORT_FAILED,
    HOST_PROVIDERS_LOAD_FAILED,
    INVALID_LAUNCH_CONFIG,
    INVALID_LAUNCH_CONFIG_PREFIX,
    LAUNCH_CONFIG_ENV_MISSING,
    PRIVATE_AUTH_CONFIG_REQUIRED,
    SPECIFY_DIRECTORY_FOR_LOCAL_RUN_ARTIFACTS_USE_HELP,
    TTS_FACTORY_FAILED,
    TTS_FACTORY_MISSING,
    TTS_MODULE_IMPORT_FAILED,
} from './cli-messages.js';

export type LaunchFlags = {
    config?: string;
    directory?: string;
    providers?: string;
    storageState?: string;
    policy?: string;
};

// Only built-in schema keys and fixed reasons can enter initialization errors.
function builtInTtsDiagnostic(input: unknown): string | undefined {
    const tts = input && typeof input === 'object' && 'tts' in input ? input.tts : undefined;
    if (
        tts &&
        typeof tts === 'object' &&
        'provider' in tts &&
        tts.provider === 'speechkit' &&
        'options' in tts &&
        tts.options &&
        typeof tts.options === 'object' &&
        !Array.isArray(tts.options) &&
        !speechkitOptionsSchema.safeParse(tts.options).success
    ) {
        return speechkitOptionsError(tts.options as Record<string, unknown>);
    }
    return undefined;
}

async function readLaunchConfig(file?: string): Promise<z.infer<typeof launchConfigSchema>> {
    if (!file) {
        return {version: 1};
    }
    let input: unknown;
    try {
        input = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        throw new Error(INVALID_LAUNCH_CONFIG);
    }
    const parsed = launchConfigSchema.safeParse(input);
    if (!parsed.success) {
        const diagnostic = builtInTtsDiagnostic(input);
        if (diagnostic) throw new Error(diagnostic);
        throw new Error(
            schemaDiagnostic(parsed.error, launchConfigPropertyNames, INVALID_LAUNCH_CONFIG_PREFIX),
        );
    }
    const config = parsed.data;
    if (config.authentication || config.tts) {
        const info = await fs.lstat(file);
        if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            (process.platform !== 'win32' && info.mode % 0o1000 !== 0o600)
        ) {
            throw new Error(PRIVATE_AUTH_CONFIG_REQUIRED);
        }
    }
    return config;
}

async function configuredAuthentication(
    config: z.infer<typeof launchConfigSchema>['authentication'],
    baseDirectory: string,
) {
    if (!config) {
        return undefined;
    }
    let module;
    try {
        module = await import(pathToFileURL(path.resolve(baseDirectory, config.module)).href);
    } catch {
        throw new Error(AUTH_MODULE_IMPORT_FAILED);
    }
    if (typeof module.createAuthentication !== 'function') throw new Error(AUTH_FACTORY_MISSING);
    try {
        const factory = module.createAuthentication as HostAuthenticationFactory;
        return validateHostProviders({
            authentication: await factory(config.options, {baseDirectory}),
        }).authentication;
    } catch {
        throw new Error(AUTH_FACTORY_FAILED);
    }
}

async function configuredTts(
    config: z.infer<typeof launchConfigSchema>['tts'],
    baseDirectory: string,
) {
    if (!config) {
        return undefined;
    }
    if ('provider' in config) {
        return createTts(config.options, {baseDirectory});
    }
    let module;
    try {
        module = await import(pathToFileURL(path.resolve(baseDirectory, config.module)).href);
    } catch {
        throw new Error(TTS_MODULE_IMPORT_FAILED);
    }
    if (typeof module.createTts !== 'function') throw new Error(TTS_FACTORY_MISSING);
    try {
        const factory = module.createTts as HostTtsFactory;
        return validateHostProviders({tts: await factory(config.options, {baseDirectory})}).tts;
    } catch {
        throw new Error(TTS_FACTORY_FAILED);
    }
}

function statePath(value: z.infer<typeof launchConfigSchema>['storageState']) {
    if (!value || typeof value === 'string') {
        return value;
    }
    const state = process.env[value.env];
    if (!state) {
        throw new Error(LAUNCH_CONFIG_ENV_MISSING);
    }
    return state;
}

function inlinePolicy(value: z.infer<typeof launchConfigSchema>['policy']) {
    if (!value || typeof value === 'string') {
        return undefined;
    }
    try {
        const policy = new BrowserPolicy(
            value.rules,
            value.networkAllowedOrigins,
            value.readOnlyNetwork,
            value.capture,
        );
        return () => policy;
    } catch {
        throw new Error(INVALID_LAUNCH_CONFIG);
    }
}

// Configuration is trusted host input, never a model-facing MCP argument.
function assertHostSources(
    config: z.infer<typeof launchConfigSchema>,
    providers: ReturnType<typeof validateHostProviders>,
    storageStatePath: string | undefined,
    policy: z.infer<typeof launchConfigSchema>['policy'],
) {
    if (
        (policy && providers.policyFactory) ||
        (storageStatePath && (providers.authentication || config.authentication)) ||
        (providers.authentication && config.authentication) ||
        (config.screenshotPolicy && providers.screenshotPolicy) ||
        (config.tts && providers.tts)
    ) {
        throw new Error(AMBIGUOUS_LAUNCH_CAPABILITIES);
    }
}

export async function loadLaunchOptions(
    flags: LaunchFlags,
    cwd = process.cwd(),
): Promise<ServerOptions> {
    const configPath = flags.config ? path.resolve(cwd, flags.config) : undefined;
    const base = configPath ? path.dirname(configPath) : cwd;
    const config = await readLaunchConfig(configPath);
    recordingEnabled(config.browser?.video, config.outputs ?? {});
    const resolveFile = (override: string | undefined, configured: string | undefined) => {
        if (override !== undefined) {
            return path.resolve(cwd, override);
        }
        if (configured !== undefined) {
            return path.resolve(base, configured);
        }
        return undefined;
    };
    const directory = resolveFile(flags.directory, config.directory);
    if (!directory) {
        throw new Error(SPECIFY_DIRECTORY_FOR_LOCAL_RUN_ARTIFACTS_USE_HELP);
    }
    await loadLaunchEnvironment(config.envFile, base);
    const storageStatePath = resolveFile(
        flags.storageState,
        flags.storageState === undefined ? statePath(config.storageState) : undefined,
    );
    const policy = flags.policy ?? config.policy;
    const policyFactory = inlinePolicy(policy);
    const providerPath = resolveFile(flags.providers, config.providers);
    let providers = {} as ReturnType<typeof validateHostProviders>;
    if (providerPath) {
        try {
            providers = validateHostProviders(await import(pathToFileURL(providerPath).href));
        } catch {
            throw new Error(HOST_PROVIDERS_LOAD_FAILED);
        }
    }
    assertHostSources(config, providers, storageStatePath, policy);
    const authentication = await configuredAuthentication(config.authentication, base);
    const tts = await configuredTts(config.tts, base);
    if (config.outputs?.narration && !tts && !providers.tts) {
        throw new Error(AUTOMATIC_NARRATION_REQUIRES_TTS);
    }
    return {
        ...providers,
        directory,
        storageStatePath,
        authentication: authentication ?? providers.authentication,
        tts: tts ?? providers.tts,
        policyPath:
            typeof policy === 'string'
                ? resolveFile(
                      flags.policy,
                      typeof config.policy === 'string' ? config.policy : undefined,
                  )
                : undefined,
        policyFactory: policyFactory ?? providers.policyFactory,
        screenshotPolicy: config.screenshotPolicy ?? providers.screenshotPolicy,
        runDefaults: config.browser,
        outputs: config.outputs,
    };
}
