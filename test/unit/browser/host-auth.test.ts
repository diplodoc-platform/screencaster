import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect, it, vi} from 'vitest';

import {type HostAuthResult, authenticateWithHost} from '../../../src/browser/host-auth.js';
import {createCapturePolicy} from '../../../src/browser/policy.js';

const targetUrl = 'https://docs.test.example/page';
const policy = createCapturePolicy(targetUrl);

it('validates the target before the host can obtain credentials', async () => {
    const authenticate = vi.fn();
    await expect(
        authenticateWithHost({
            targetUrl: 'https://other.test.example/page',
            policy,
            authentication: {allowedOrigins: ['https://docs.test.example'], authenticate},
        }),
    ).rejects.toThrow('outside');
    await expect(
        authenticateWithHost({
            targetUrl,
            policy,
            authentication: {allowedOrigins: ['https://other.test.example'], authenticate},
        }),
    ).rejects.toThrow('outside');
    expect(authenticate).not.toHaveBeenCalled();
});

it('returns manual challenge metadata without retrying a login submission', async () => {
    const authenticate = vi.fn(async () => ({
        status: 'challenge' as const,
        origin: 'https://docs.test.example',
        challenge: 'mfa' as const,
    }));
    expect(
        await authenticateWithHost({
            targetUrl,
            policy,
            authentication: {allowedOrigins: ['https://docs.test.example'], authenticate},
        }),
    ).toEqual({status: 'challenge', origin: 'https://docs.test.example', challenge: 'mfa'});
    expect(authenticate).toHaveBeenCalledTimes(1);
});

it('accepts only a private regular origin-bound unexpired state file without reading its content', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'host-auth-test-'));
    try {
        const state = path.join(directory, 'state.json');
        await fs.writeFile(state, 'opaque credential-bearing state', {mode: 0o600});
        const authenticate = vi.fn(async (): Promise<HostAuthResult> => ({
            status: 'ready',
            origin: 'https://docs.test.example',
            storageStatePath: state,
        }));
        const authentication = {allowedOrigins: ['https://docs.test.example'], authenticate};
        const read = vi.spyOn(fs, 'readFile');
        await expect(
            authenticateWithHost({targetUrl, policy, authentication}),
        ).resolves.toMatchObject({status: 'ready'});
        expect(read).not.toHaveBeenCalled();
        read.mockRestore();
        authenticate.mockResolvedValueOnce({
            status: 'ready',
            origin: 'https://other.test.example',
            storageStatePath: state,
        });
        await expect(authenticateWithHost({targetUrl, policy, authentication})).rejects.toThrow(
            'origin-bound',
        );
        authenticate.mockResolvedValueOnce({
            status: 'ready',
            origin: 'https://docs.test.example',
            storageStatePath: state,
            expiresAt: Date.now() - 1,
        });
        await expect(authenticateWithHost({targetUrl, policy, authentication})).rejects.toThrow(
            'origin-bound',
        );
        const link = path.join(directory, 'state-link.json');
        await fs.symlink(state, link);
        authenticate.mockResolvedValueOnce({
            status: 'ready',
            origin: 'https://docs.test.example',
            storageStatePath: link,
        });
        await expect(authenticateWithHost({targetUrl, policy, authentication})).rejects.toThrow(
            'origin-bound',
        );
        if (process.platform !== 'win32') {
            await fs.chmod(state, 0o644);
            await expect(authenticateWithHost({targetUrl, policy, authentication})).rejects.toThrow(
                'origin-bound',
            );
        }
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

it('rejects malformed adapter results and masks host failures', async () => {
    const authentication = {
        allowedOrigins: ['https://docs.test.example'],
        authenticate: vi.fn(async () => {
            throw new Error('password=synthetic-secret');
        }),
    };
    await expect(authenticateWithHost({targetUrl, policy, authentication})).rejects.toThrow(
        'Host authentication failed',
    );
    authentication.authenticate.mockResolvedValueOnce(null as never);
    await expect(authenticateWithHost({targetUrl, policy, authentication})).rejects.toThrow(
        'origin-bound',
    );
});
