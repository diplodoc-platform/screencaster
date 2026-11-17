import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {authenticateWithHost} from '@diplodoc/screencaster/browser';

import {applyFixtureOperation, createHostPolicy, hostAuthentication} from './host.ts';

// Offline example: no network, credentials, personal browser profile or secret-store access.
const targetUrl = 'https://docs.test.example/page';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-host-example-'));
try {
    const state = path.join(directory, 'state.json');
    const authentication = hostAuthentication({
        allowedOrigins: ['https://docs.test.example'],
        login: async ({origin}) => {
            await fs.writeFile(state, JSON.stringify({cookies: [], origins: []}), {
                mode: 0o600,
                flag: 'wx',
            });
            return {status: 'ready', origin, storageStatePath: state};
        },
    });
    const session = await authenticateWithHost({
        targetUrl,
        policy: createHostPolicy(targetUrl),
        authentication,
    });
    if (session.status !== 'ready') {
        throw new Error('Manual host challenge must finish before capture starts');
    }
    let applied = false;
    await applyFixtureOperation({
        targetUrl: 'https://docs.test.example/test-fixtures/account/language',
        authorization: {
            authorized: true,
            purpose: 'Synthetic documentation fixture',
            allowedOperations: ['account-language'],
            fixtureOrigin: 'https://docs.test.example',
        },
        operation: {kind: 'account-language', locale: 'en'},
        execute: async (request) => {
            applied = request.body.locale === 'en';
        },
    });
    process.stdout.write(
        JSON.stringify({authentication: session.status, syntheticFixtureApplied: applied}) + '\n',
    );
} finally {
    await fs.rm(directory, {recursive: true, force: true});
}
