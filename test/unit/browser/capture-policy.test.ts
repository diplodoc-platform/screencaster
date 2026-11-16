import {expect, it} from 'vitest';

import {
    BrowserPolicy,
    createBrowserPolicy,
    createCapturePolicy,
} from '../../../src/browser/policy.js';

const target = 'https://docs.test.example/page';

it('keeps the existing general policy and opts into capture constraints explicitly', () => {
    expect(() =>
        createBrowserPolicy(target).assertTool('browser_click', {ref: 'e1'}, target),
    ).not.toThrow();
    const policy = createCapturePolicy(target);
    expect(() => policy.assertTool('browser_snapshot', {}, target)).not.toThrow();
    expect(() => policy.assertTool('browser_navigate', {url: target})).not.toThrow();
    for (const tool of [
        'browser_click',
        'browser_type',
        'browser_fill_form',
        'browser_upload_example_file',
        'browser_evaluate',
    ]) {
        expect(() => policy.assertTool(tool, {ref: 'e1'}, target)).toThrow();
    }
    expect(() =>
        policy.assertTool('browser_navigate', {url: 'https://docs.test.example/other'}),
    ).toThrow();
    expect(policy.allows('https://docs.test.example/other', 'read')).toBe(false);
    expect(policy.allows(target + '?changed=true', 'read')).toBe(false);
    expect(policy.guardOptions).toMatchObject({
        allowedOrigins: ['https://docs.test.example'],
        blockPopups: true,
        blockDownloads: true,
        blockRedirects: true,
        strictViolations: true,
    });
});

it('binds host-reviewed read-only interactions to exact origin, path, ref and operation', () => {
    const policy = createCapturePolicy(target, {
        readOnlyActions: [
            {origin: 'https://docs.test.example', path: '/page', ref: 'e1', tool: 'browser_click'},
        ],
    });
    expect(() => policy.assertTool('browser_click', {ref: 'e1'}, target)).not.toThrow();
    expect(() => policy.assertTool('browser_click', {ref: 'e2'}, target)).toThrow();
    expect(() =>
        policy.assertTool('browser_click', {ref: 'e1'}, 'https://docs.test.example/other'),
    ).toThrow();
    expect(() => policy.assertTool('browser_type', {ref: 'e1', text: 'changed'}, target)).toThrow();
    expect(() =>
        policy.assertTool('browser_click', {ref: 'e1', targetArea: 'background'}, target),
    ).toThrow();
});

it('does not let declarations override denied hosts or grant broad write/evaluation rights', () => {
    expect(() =>
        createCapturePolicy('https://restricted.test.example/page', {
            deniedHosts: ['restricted.test.example'],
        }),
    ).toThrow();
    const policy = createCapturePolicy(target, {deniedHosts: ['restricted.test.example']});
    expect(policy.allows('https://sub.restricted.test.example/page', 'read')).toBe(false);
    expect(() =>
        createCapturePolicy(target, {
            postReads: [{origin: 'https://other.test.example', path: '/read'}],
        }),
    ).toThrow();
    expect(() =>
        createCapturePolicy(target, {
            postReads: [{origin: 'https://docs.test.example', path: '/read?write=true'}],
        }),
    ).toThrow();
    expect(
        () =>
            new BrowserPolicy(
                [{origin: 'https://docs.test.example', actions: ['act']}],
                undefined,
                undefined,
                {},
            ),
    ).toThrow();
    expect(() =>
        createCapturePolicy(target, {deniedHosts: ['restricted.test.example:443']}),
    ).toThrow();
});

it('clones caller rule arrays and reviewed endpoint declarations', () => {
    const rules = [
        {origin: 'https://docs.test.example', actions: ['read'] as Array<'read' | 'act'>},
    ];
    const policy = new BrowserPolicy(rules);
    rules[0].actions.push('act');
    expect(policy.allows(target, 'act')).toBe(false);
});

it('discovers exact reviewed actions and a page-bound Escape grant without a fictitious ref', () => {
    const policy = createCapturePolicy(target, {
        readOnlyActions: [
            {origin: 'https://docs.test.example', path: '/page', ref: 'e1', tool: 'browser_click'},
            {
                origin: 'https://docs.test.example',
                path: '/page',
                tool: 'browser_press_key',
                key: 'Escape',
            },
        ],
    });
    expect(policy.describeTool('browser_click', target)).toEqual({
        allowed: true,
        arguments: [{ref: 'e1'}],
    });
    expect(policy.describeTool('browser_press_key', target)).toEqual({
        allowed: true,
        arguments: [{key: 'Escape'}],
    });
    expect(policy.describeTool('browser_type', target).allowed).toBe(false);
    expect(policy.describeTool('browser_navigate', target)).toEqual({
        allowed: true,
        arguments: [{url: target}],
    });
    expect(() => policy.assertTool('browser_press_key', {key: 'Escape'}, target)).not.toThrow();
    expect(() => policy.assertTool('browser_press_key', {key: 'Enter'}, target)).toThrow();
    expect(() =>
        policy.assertTool('browser_press_key', {key: 'Escape', ref: 'e1'}, target),
    ).toThrow();
    expect(() =>
        policy.assertTool('browser_click', {ref: 'e1', button: 'right'}, target),
    ).toThrow();
    expect(createBrowserPolicy(target).describeTool('browser_click', target)).toEqual({
        allowed: true,
    });
});
