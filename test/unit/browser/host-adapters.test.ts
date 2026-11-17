import {expect, it, vi} from 'vitest';

import {
    type FixtureAuthorization,
    applyFixtureOperation,
    createHostPolicy,
    hostAuthentication,
} from '../../../examples/host-adapters/host.js';

vi.mock('@diplodoc/screencaster/browser', async () => ({
    ...(await import('../../../src/browser/policy.js')),
    ...(await import('../../../src/browser/host-auth.js')),
}));

const fixtureAuthorization: FixtureAuthorization = {
    authorized: true,
    purpose: 'Test account language fixture',
    allowedOperations: ['account-language'],
    fixtureOrigin: 'https://docs.test.example',
};

it('keeps host-supplied denied hosts and subdomains denied in a host profile', () => {
    for (const target of [
        'https://restricted.test.example/page',
        'https://sub.restricted.test.example/page',
    ]) {
        expect(() =>
            createHostPolicy(target, {deniedHosts: ['restricted.test.example']}),
        ).toThrow();
    }
    expect(
        createHostPolicy('https://docs.test.example/page').allows(
            'https://docs.test.example/page',
            'read',
        ),
    ).toBe(true);
});

it('checks targets before calling the trusted credential provider', async () => {
    const login = vi.fn(async () => ({
        status: 'challenge' as const,
        origin: 'https://docs.test.example',
        challenge: 'mfa' as const,
    }));
    const adapter = hostAuthentication({allowedOrigins: ['https://docs.test.example'], login});
    await expect(
        adapter.authenticate({
            url: 'https://restricted.test.example/page',
            origin: 'https://restricted.test.example',
        }),
    ).rejects.toThrow('rejected');
    expect(login).not.toHaveBeenCalled();
    expect(
        await adapter.authenticate({
            url: 'https://docs.test.example/page',
            origin: 'https://docs.test.example',
        }),
    ).toMatchObject({status: 'challenge', challenge: 'mfa'});
    expect(login).toHaveBeenCalledTimes(1);
});

it('requires prior authorization and the exact bounded fixture target and operation', async () => {
    const execute = vi.fn();
    for (const targetUrl of [
        'https://other.test.example/test-fixtures/account/language',
        'https://docs.test.example/other',
        'https://docs.test.example/test-fixtures/account/language?delete=true',
    ]) {
        await expect(
            applyFixtureOperation({
                targetUrl,
                authorization: fixtureAuthorization,
                operation: {kind: 'account-language', locale: 'en'},
                execute,
            }),
        ).rejects.toThrow('rejected');
    }
    await expect(
        applyFixtureOperation({
            targetUrl: 'https://docs.test.example/test-fixtures/account/language',
            authorization: {
                ...fixtureAuthorization,
                authorized: false,
            } as unknown as FixtureAuthorization,
            operation: {kind: 'account-language', locale: 'en'},
            execute,
        }),
    ).rejects.toThrow('rejected');
    expect(execute).not.toHaveBeenCalled();
});

it('executes only the declared test-fixture request without widening capture permissions', async () => {
    const execute = vi.fn(async () => {});
    await applyFixtureOperation({
        targetUrl: 'https://docs.test.example/test-fixtures/account/language',
        authorization: fixtureAuthorization,
        operation: {kind: 'account-language', locale: 'en'},
        execute,
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith({
        origin: 'https://docs.test.example',
        path: '/test-fixtures/account/language',
        method: 'POST',
        body: {locale: 'en'},
    });
    const policy = createHostPolicy('https://docs.test.example/test-fixtures/account/language');
    expect(() =>
        policy.assertTool(
            'browser_type',
            {ref: 'e1', text: 'unsafe'},
            'https://docs.test.example/test-fixtures/account/language',
        ),
    ).toThrow();
});

it('does not retry a fixture request after an unknown transport outcome or echo its secret', async () => {
    const execute = vi.fn(async () => {
        throw new Error('Cookie: synthetic-secret');
    });
    await expect(
        applyFixtureOperation({
            targetUrl: 'https://docs.test.example/test-fixtures/account/language',
            authorization: fixtureAuthorization,
            operation: {kind: 'account-language', locale: 'ru'},
            execute,
        }),
    ).rejects.toThrow('outcome is unknown');
    expect(execute).toHaveBeenCalledTimes(1);
});
