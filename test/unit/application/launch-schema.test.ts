import fs from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
import {expect, it} from 'vitest';

import {
    launchConfigJsonSchema,
    launchConfigSchema,
} from '../../../src/application/launch-schema.js';

const ajv = new Ajv2020({strict: false, validateFormats: false});
const validate = ajv.compile(launchConfigJsonSchema);

it('validates the shipped sample and rejects ambiguous TTS credentials in the editor schema', async () => {
    const sample = JSON.parse(
        await fs.readFile(new URL('../../../run.config.example.json', import.meta.url), 'utf8'),
    );
    expect(validate(sample)).toBe(true);
    expect(launchConfigSchema.safeParse(sample).success).toBe(true);
    for (const tts of [
        {provider: 'speechkit', options: {apiKey: 'test', iamToken: 'test'}},
        {provider: 'speechkit', module: 'module.mjs', options: {apiKey: 'test'}},
        {provider: 'speechkit', options: {apiKey: 'test', speed: 4}},
        {provider: 'speechkit', options: {apiKey: {env: 'KEY', file: 'key.txt'}}},
        {provider: 'unknown', options: {}},
    ]) {
        const config = {version: 1, directory: 'runs', tts};
        expect(validate(config)).toBe(false);
        expect(launchConfigSchema.safeParse(config).success).toBe(false);
    }
    expect(
        validate({version: 1, tts: {module: 'custom.mjs', options: {customSetting: true}}}),
    ).toBe(true);
});

it.each(['light', 'dark', 'no-preference'])(
    'accepts browser language and %s theme in both configuration schemas',
    (colorScheme) => {
        const config = {version: 1, browser: {locale: 'ru-RU', colorScheme}};
        expect(validate(config)).toBe(true);
        expect(launchConfigSchema.parse(config).browser).toEqual(config.browser);
    },
);

it.each([{colorScheme: 'system'}, {colorScheme: null}, {locale: ''}, {locale: 123}])(
    'rejects invalid browser preferences in both schemas: %j',
    (browser) => {
        const config = {version: 1, browser};
        expect(validate(config)).toBe(false);
        expect(launchConfigSchema.safeParse(config).success).toBe(false);
    },
);
