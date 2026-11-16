import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {constants, generateKeyPairSync, verify} from 'node:crypto';
import {afterEach, expect, it, vi} from 'vitest';

import {createTts} from '../../../src/providers/speechkit-factory.js';
import {serviceAccountToken} from '../../../src/providers/speechkit-iam.js';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

it('rejects missing env values and ambiguous or unsupported secret sources before requests', async () => {
    vi.stubEnv('SPEECH_TEST_MISSING', '');
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    for (const source of [
        {env: 'SPEECH_TEST_MISSING'},
        {env: 'SPEECH_TEST_MISSING', file: 'key.txt'},
        {externalVault: {key: 'api-key'}},
    ]) {
        await expect(createTts({apiKey: source}, {baseDirectory: '.'})).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
});

it('uses env/file secrets without exposing them in provider identity and rejects mixed sources', async () => {
    vi.stubEnv('SPEECH_TEST_API_KEY', 'test-private-marker');
    const provider = await createTts({apiKey: {env: 'SPEECH_TEST_API_KEY'}}, {baseDirectory: '.'});
    expect(JSON.stringify(provider)).not.toContain('test-private-marker');
    await expect(createTts({apiKey: 'a', iamToken: 'b'}, {baseDirectory: '.'})).rejects.toThrow(
        'one SpeechKit',
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-key-test-'));
    try {
        await fs.writeFile(path.join(root, 'key.txt'), 'test-private-marker\n', {mode: 0o600});
        expect(
            (
                await createTts(
                    {iamToken: {file: 'key.txt'}, folderId: 'folder'},
                    {baseDirectory: root},
                )
            ).identity,
        ).toContain('speechkit');
        await fs.symlink(path.join(root, 'key.txt'), path.join(root, 'link.txt'));
        await expect(
            createTts({apiKey: {file: 'link.txt'}}, {baseDirectory: root}),
        ).rejects.toThrow('unavailable');
        await fs.writeFile(path.join(root, 'empty.txt'), '  ', {mode: 0o600});
        await expect(
            createTts({apiKey: {file: 'empty.txt'}}, {baseDirectory: root}),
        ).rejects.toThrow('unavailable');
    } finally {
        await fs.rm(root, {recursive: true, force: true});
    }
});

it('signs a PS256 IAM request, caches the token and refreshes before expiry', async () => {
    const pair = generateKeyPairSync('rsa', {modulusLength: 2048});
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const request = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
        const {jwt} = JSON.parse(String(init?.body));
        const [header, payload, signature] = jwt.split('.');
        expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({
            alg: 'PS256',
            kid: 'key-id',
        });
        expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
            iss: 'account-id',
            aud: 'https://iam.api.cloud.yandex.net/iam/v1/tokens',
        });
        expect(
            verify(
                'sha256',
                Buffer.from(`${header}.${payload}`),
                {key: pair.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32},
                Buffer.from(signature, 'base64url'),
            ),
        ).toBe(true);
        return Response.json({
            iamToken: 'test-iam-marker',
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });
    });
    vi.stubGlobal('fetch', request);
    const getToken = serviceAccountToken({
        keyId: 'key-id',
        serviceAccountId: 'account-id',
        privateKey: pair.privateKey.export({format: 'pem', type: 'pkcs8'}).toString(),
    });
    expect(await Promise.all([getToken(), getToken()])).toEqual([
        'test-iam-marker',
        'test-iam-marker',
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(1_700_000_070_000);
    await getToken();
    expect(request).toHaveBeenCalledTimes(2);
    const aborted = new AbortController();
    aborted.abort();
    await expect(getToken(aborted.signal)).rejects.toThrow();
});

function controlledIam() {
    const pair = generateKeyPairSync('rsa', {modulusLength: 2048});
    const requests: {
        signal: AbortSignal;
        resolve: (response: Response) => void;
        reject: (error: Error) => void;
    }[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(
            (_url: unknown, init: RequestInit) =>
                new Promise<Response>((resolve, reject) => {
                    requests.push({signal: init.signal as AbortSignal, resolve, reject});
                }),
        ),
    );
    return {
        requests,
        getToken: serviceAccountToken({
            keyId: 'key-id',
            serviceAccountId: 'account-id',
            privateKey: pair.privateKey.export({format: 'pem', type: 'pkcs8'}).toString(),
        }),
        response: (iamToken: string) =>
            Response.json({
                iamToken,
                expiresAt: new Date(Date.now() + 120_000).toISOString(),
            }),
    };
}

it.each([0, 1])(
    'cancels IAM subscriber %i without cancelling the other subscriber',
    async (index) => {
        const {getToken, requests, response} = controlledIam();
        const controllers = [new AbortController(), new AbortController()];
        const removals = controllers.map((controller) =>
            vi.spyOn(controller.signal, 'removeEventListener'),
        );
        const tokens = controllers.map((controller) => getToken(controller.signal));
        const cancelled = expect(tokens[index]).rejects.toMatchObject({name: 'AbortError'});
        controllers[index].abort();
        await cancelled;
        expect(requests).toHaveLength(1);
        expect(requests[0].signal.aborted).toBe(false);
        requests[0].resolve(response('shared-token'));
        expect(await tokens[1 - index]).toBe('shared-token');
        expect(await getToken()).toBe('shared-token');
        expect(requests).toHaveLength(1);
        for (const removal of removals) {
            expect(removal).toHaveBeenCalledWith('abort', expect.any(Function));
        }
    },
);

it('abandons an IAM exchange only after all subscribers cancel and ignores its late result', async () => {
    const {getToken, requests, response} = controlledIam();
    const first = new AbortController();
    const second = new AbortController();
    const cancelled = Promise.all([
        expect(getToken(first.signal)).rejects.toMatchObject({name: 'AbortError'}),
        expect(getToken(second.signal)).rejects.toMatchObject({name: 'AbortError'}),
    ]);
    first.abort();
    expect(requests[0].signal.aborted).toBe(false);
    second.abort();
    expect(requests[0].signal.aborted).toBe(true);
    const replacement = getToken();
    expect(requests).toHaveLength(2);
    // Even an upstream response that arrives after cancellation must not populate the cache
    // or clear the replacement exchange while it is still serving subscribers.
    const staleResponse = response('stale-token');
    const parse = vi.spyOn(staleResponse, 'json');
    requests[0].resolve(staleResponse);
    await cancelled;
    await vi.waitFor(() => expect(parse).toHaveResolved());
    const joined = getToken();
    expect(requests).toHaveLength(2);
    requests[1].resolve(response('fresh-token'));
    expect(await Promise.all([replacement, joined])).toEqual(['fresh-token', 'fresh-token']);
    expect(await getToken()).toBe('fresh-token');
    expect(requests).toHaveLength(2);
});

it('clears a failed shared IAM exchange so later callers can retry', async () => {
    const {getToken, requests, response} = controlledIam();
    const failed = Promise.all([
        expect(getToken()).rejects.toThrow('IAM token exchange failed'),
        expect(getToken()).rejects.toThrow('IAM token exchange failed'),
    ]);
    requests[0].reject(new Error('private upstream failure'));
    await failed;
    const retry = getToken();
    expect(requests).toHaveLength(2);
    requests[1].resolve(response('retry-token'));
    expect(await retry).toBe('retry-token');
});

it('withholds IAM failure bodies and supports authorized-key JSON files', async () => {
    const pair = generateKeyPairSync('rsa', {modulusLength: 2048});
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-sa-test-'));
    try {
        await fs.writeFile(
            path.join(root, 'key.json'),
            JSON.stringify({
                id: 'key-id',
                service_account_id: 'sa-id',
                private_key: pair.privateKey.export({format: 'pem', type: 'pkcs8'}).toString(),
            }),
            {mode: 0o600},
        );
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('sensitive-upstream-body', {status: 403})),
        );
        const tts = await createTts({serviceAccountKey: {file: 'key.json'}}, {baseDirectory: root});
        await expect(tts.synthesize('Test')).rejects.toThrow('authentication');
        expect(JSON.stringify(tts)).not.toContain('PRIVATE KEY');
    } finally {
        await fs.rm(root, {recursive: true, force: true});
    }
});

it('resolves separate service-account env fields and signs IAM requests with those IDs', async () => {
    const pair = generateKeyPairSync('rsa', {modulusLength: 2048});
    vi.stubEnv('SPEECH_TEST_ACCOUNT', 'test-account-id');
    vi.stubEnv('SPEECH_TEST_KEY_ID', 'test-key-id');
    vi.stubEnv(
        'SPEECH_TEST_PEM',
        pair.privateKey.export({format: 'pem', type: 'pkcs8'}).toString(),
    );
    const request = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
        const {jwt} = JSON.parse(String(init?.body));
        const [header, payload, signature] = jwt.split('.');
        expect(JSON.parse(Buffer.from(header, 'base64url').toString()).kid).toBe('test-key-id');
        expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss).toBe(
            'test-account-id',
        );
        expect(
            verify(
                'sha256',
                Buffer.from(`${header}.${payload}`),
                {
                    key: pair.publicKey,
                    padding: constants.RSA_PKCS1_PSS_PADDING,
                    saltLength: 32,
                },
                Buffer.from(signature, 'base64url'),
            ),
        ).toBe(true);
        return new Response('private-response-marker', {status: 403});
    });
    vi.stubGlobal('fetch', request);
    const options = {
        serviceAccount: {
            serviceAccountId: {env: 'SPEECH_TEST_ACCOUNT'},
            keyId: {env: 'SPEECH_TEST_KEY_ID'},
            privateKey: {env: 'SPEECH_TEST_PEM'},
        },
    };
    const tts = await createTts(options, {baseDirectory: '.'});
    await expect(tts.synthesize('Test')).rejects.toThrow('authentication');
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tts)).not.toContain('PRIVATE KEY');
    vi.stubEnv('SPEECH_TEST_ACCOUNT', '');
    await expect(createTts(options, {baseDirectory: '.'})).rejects.toThrow(
        'env value is empty or missing',
    );
});
