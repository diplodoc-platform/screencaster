import fs from 'node:fs';
import vm from 'node:vm';
import {expect, it} from 'vitest';

import {driverScript} from '../../../src/browser/scripts/driver-script.js';
import {domScript} from '../../../src/browser/scripts/dom-script.js';

it('serializes browser data without interpreting it as executable source', async () => {
    const heading = 'A "quote", `backtick`, ${expression}, and\na new line';
    const source = driverScript('verify-page', {expected: {url: 'https://example.com', heading}});
    const run = vm.runInNewContext(`(${source})`) as (page: unknown) => Promise<string>;
    let observed: unknown;
    const result = await run({
        url: () => 'https://example.com',
        getByRole: (role: string, options: unknown) => {
            observed = {role, options};
            return {count: async () => 1, nth: () => ({isVisible: async () => true})};
        },
    });
    expect(result).toBe('PAGE_VERIFIED');
    expect(observed).toEqual({role: 'heading', options: {name: heading, exact: true}});
});

it('produces valid self-contained DOM functions for every bundled program', () => {
    const directory = new URL('../../../build/browser/scripts/generated/dom/', import.meta.url);
    for (const name of fs.readdirSync(directory).filter((file) => file.endsWith('.js'))) {
        expect(() => new vm.Script(`(${domScript(name.slice(0, -3))})`), name).not.toThrow();
    }
});

it('passes a callable to Playwright element evaluation', async () => {
    const source = driverScript('replace-input-text', {
        ref: 'field',
        text: 'requested',
        submit: false,
    });
    const run = vm.runInNewContext(`(${source})`) as (page: unknown) => Promise<string>;
    const result = await run({
        locator: () => ({
            evaluate: (program: unknown) => {
                expect(typeof program).toBe('function');
                return {editable: false};
            },
        }),
    });
    expect(result).toBe('not-editable');
});

it('classifies a foreign-realm route error without recording its message or headers', async () => {
    const source = driverScript('install-request-guard', {postReads: []});
    const run = vm.runInNewContext(`(${source})`) as (page: unknown) => Promise<string>;
    let intercept: ((route: unknown) => Promise<void>) | undefined;
    const context = {
        route: (_pattern: string, handler: (route: unknown) => Promise<void>) => {
            intercept = handler;
        },
        routeWebSocket: () => {},
    };
    expect(await run({context: () => context})).toBe('REQUEST_GUARD_INSTALLED');
    const aborts: string[] = [];
    if (!intercept) {
        throw new Error('Route was not registered');
    }
    await intercept({
        request: () => ({method: () => 'GET'}),
        fallback: () => {
            throw new Error('ECONNREFUSED\nAuthorization: Bearer synthetic-secret');
        },
        abort: (reason: string) => {
            aborts.push(reason);
        },
    });
    expect(context).toMatchObject({
        __docsRequestGuardFailures: 1,
        __docsRequestGuardFailure: {phase: 'fallback', category: 'refused'},
    });
    expect(aborts).toEqual(['failed']);
    expect(JSON.stringify(context)).not.toContain('synthetic-secret');
});
