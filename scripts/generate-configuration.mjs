import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import prettier from 'prettier';

import {launchConfigJsonSchema, launchConfigSchema} from '../build/application/launch-schema.js';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const config = await prettier.resolveConfig(fileURLToPath(new URL('README.md', root)));
const format = (text, parser) => prettier.format(text, {...config, parser});
const read = (name) => fs.readFile(new URL(name, root), 'utf8');
const sample = JSON.parse(await read('run.config.example.json'));
if (!sample.authentication || sample.storageState) {
    throw new Error(
        'Keep authentication in the main sample; document storageState as a replacement',
    );
}
if (!launchConfigSchema.safeParse(sample).success) {
    throw new Error('The launch sample must conform to the runtime configuration schema');
}
const source = await read('docs/configuration.md');
const example = `<!-- config-example:start -->\n\n\`\`\`json\n${JSON.stringify(sample, null, 2)}\n\`\`\`\n\n<!-- config-example:end -->`;
const examplePattern = /<!-- config-example:start -->[\s\S]*?<!-- config-example:end -->/;
if (!examplePattern.test(source)) throw new Error('Missing configuration example markers');
const reference = await format(source.replace(examplePattern, example), 'markdown');
const section = reference.replace(/^(#+) /gm, '#$1 ');
const readme = await read('README.md');
const sectionPattern =
    /<!-- launch-configuration:start -->[\s\S]*?<!-- launch-configuration:end -->/;
if (!sectionPattern.test(readme)) throw new Error('Missing README configuration markers');
const generatedNotice =
    '<!-- Generated from docs/configuration.md; run npm run docs:generate. -->\n\n';
const outputs = new Map([
    ['docs/configuration.md', reference],
    [
        'README.md',
        await format(
            readme.replace(
                sectionPattern,
                `<!-- launch-configuration:start -->\n\n${generatedNotice}${section}\n<!-- launch-configuration:end -->`,
            ),
            'markdown',
        ),
    ],
    [
        '.agents/skills/screencaster/references/configuration.md',
        await format(generatedNotice + reference, 'markdown'),
    ],
    ['run.config.schema.json', await format(JSON.stringify(launchConfigJsonSchema), 'json')],
]);
const stale = [];
for (const [name, content] of outputs) {
    const existing = await read(name).catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    });
    if (existing === content) continue;
    if (check) stale.push(name);
    else await fs.writeFile(new URL(name, root), content);
}
if (stale.length) {
    process.stderr.write(
        `Configuration artifacts are stale: ${stale.join(', ')}. Run npm run docs:generate.\n`,
    );
    process.exitCode = 1;
} else
    process.stdout.write(
        check ? 'Configuration artifacts are current.\n' : 'Configuration artifacts generated.\n',
    );
