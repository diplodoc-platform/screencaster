import type {ScriptPage} from '../../../src/browser/scripts/types.js';
import type {RequestGuardOptions} from '../../../src/browser/network-guard-options.js';

import {expect, it, vi} from 'vitest';

import installGuard from '../../../src/browser/scripts/driver/install-request-guard.js';
import checkGuard from '../../../src/browser/scripts/driver/check-request-guard.js';

function fixture(options: Partial<RequestGuardOptions> = {}) {
    let route: (value: unknown) => Promise<void> = async () => {
        throw new Error('Guard route was not installed');
    };
    let socket: (value: unknown) => void | Promise<void>;
    const contextEvents = new Map<string, (value: unknown) => void>();
    const pageEvents = new Map<string, (value: unknown) => void>();
    const context = {
        route: async (_: string, callback: typeof route) => {
            route = callback;
        },
        routeWebSocket: async (_: string, callback: typeof socket) => {
            socket = callback;
        },
        on: (event: string, callback: (value: unknown) => void) =>
            contextEvents.set(event, callback),
    };
    const page = {
        context: () => context,
        on: (event: string, callback: (value: unknown) => void) => pageEvents.set(event, callback),
    };
    return {
        context,
        contextEvents,
        pageEvents,
        install: () =>
            installGuard(page as unknown as ScriptPage, {
                postReads: [],
                allowedOrigins: ['https://docs.test.example'],
                allowedNavigationUrls: ['https://docs.test.example/page'],
                blockPopups: true,
                blockDownloads: true,
                blockRedirects: true,
                strictViolations: true,
                ...options,
            }),
        intercept: async (input: {
            url?: string;
            method?: string;
            status?: number;
            navigation?: boolean;
            disposition?: string;
        }) => {
            const abort = vi.fn();
            const fetch = vi.fn(async () => ({
                status: () => input.status ?? 200,
                headers: () => ({'content-disposition': input.disposition}),
            }));
            const fulfill = vi.fn();
            await route({
                request: () => ({
                    method: () => input.method ?? 'GET',
                    url: () => input.url ?? 'https://docs.test.example/page',
                    isNavigationRequest: () => input.navigation ?? false,
                    frame: () => ({page: () => page}),
                }),
                fetch,
                fulfill,
                fallback: vi.fn(),
                abort,
            });
            return {fetch, fulfill, abort};
        },
        health: () => checkGuard(page as unknown as ScriptPage),
        socket: (value: unknown) => socket(value),
    };
}

it('permits exact reviewed read RPCs but refuses writes and query-string substitutions', async () => {
    const guard = fixture({postReads: [{origin: 'https://docs.test.example', path: '/read'}]});
    await guard.install();
    const read = await guard.intercept({url: 'https://docs.test.example/read', method: 'POST'});
    expect(read.fetch).toHaveBeenCalledWith({maxRedirects: 0, maxRetries: 0});
    expect(read.fulfill).toHaveBeenCalledTimes(1);
    const write = await guard.intercept({
        url: 'https://docs.test.example/read?write=true',
        method: 'POST',
    });
    expect(write.fetch).not.toHaveBeenCalled();
    expect(write.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(await guard.health()).toBe('REQUEST_GUARD_FAILED:dispatch:policy-write');
});

it('does not fetch redirect targets or denied subresources, including exact-host subdomains', async () => {
    const guard = fixture({deniedHosts: ['mcp.example']});
    await guard.install();
    const redirected = await guard.intercept({status: 302});
    expect(redirected.fetch).toHaveBeenCalledTimes(1);
    expect(redirected.fulfill).not.toHaveBeenCalled();
    expect(redirected.abort).toHaveBeenCalledTimes(1);
    for (const host of ['mcp.example', 'sub.mcp.example', 'mcp.example.']) {
        const denied = await guard.intercept({url: `https://${host}/sensitive`});
        expect(denied.fetch).not.toHaveBeenCalled();
    }
    const navigation = await guard.intercept({
        url: 'https://docs.test.example/other',
        navigation: true,
    });
    expect(navigation.fetch).not.toHaveBeenCalled();
    expect(await guard.health()).toBe('REQUEST_GUARD_FAILED:dispatch:policy-redirect');
    expect(JSON.stringify(guard.context)).not.toContain('sensitive');
});

it('closes popup pages and cancels downloads for the entire owned context', async () => {
    const guard = fixture();
    await guard.install();
    const close = vi.fn(async () => {});
    guard.contextEvents.get('page')?.({close});
    expect(close).toHaveBeenCalledTimes(1);
    expect(await guard.health()).toBe('REQUEST_GUARD_FAILED:dispatch:policy-popup');
    const cancel = vi.fn(async () => {});
    guard.pageEvents.get('download')?.({cancel});
    expect(cancel).toHaveBeenCalledTimes(1);
    const download = await guard.intercept({disposition: 'attachment; filename=private.csv'});
    expect(download.fulfill).not.toHaveBeenCalled();
    expect(download.abort).toHaveBeenCalledTimes(1);
});

it('records a failed WebSocket close without exposing transport errors', async () => {
    const guard = fixture({strictViolations: false});
    await guard.install();
    const closing = Promise.reject(new Error('Cookie: private-socket-canary'));
    // Observe the test-owned rejection even if the guard fails to handle it.
    closing.catch(() => {});

    await guard.socket({close: () => closing});

    expect(await guard.health()).toBe('REQUEST_GUARD_FAILED:dispatch:policy-socket');
    expect(JSON.stringify(guard.context)).not.toContain('private-socket-canary');
});

it('preserves the legacy guard behavior without requiring popup/download APIs', async () => {
    let route: (value: unknown) => Promise<void> = async () => {
        throw new Error('Guard route was not installed');
    };
    const context = {
        route: async (_: string, callback: typeof route) => {
            route = callback;
        },
        routeWebSocket: async () => {},
    };
    await installGuard({context: () => context} as unknown as ScriptPage, {postReads: []});
    const fallback = vi.fn();
    await route({request: () => ({method: () => 'GET'}), fallback});
    expect(fallback).toHaveBeenCalledTimes(1);
});
