import fs from 'node:fs/promises';

import {UNKNOWN_HARNESS_TOPIC} from './messages.js';

const topics = {
    overview: 'SKILL.md',
    decompose: 'references/decompose.md',
    execute: 'references/execute.md',
    configuration: 'references/configuration.md',
    media: 'references/media.md',
    illustrations: 'references/illustrations.md',
} as const;

export type HarnessTopic = keyof typeof topics;

export async function readHarness(topic: HarnessTopic = 'overview'): Promise<string> {
    if (!Object.hasOwn(topics, topic)) {
        throw new Error(UNKNOWN_HARNESS_TOPIC);
    }
    return fs.readFile(
        new URL(`../../.agents/skills/screencaster/${topics[topic]}`, import.meta.url),
        'utf8',
    );
}
