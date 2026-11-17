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
