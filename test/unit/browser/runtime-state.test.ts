import type {MediaActivity} from '../../../src/media/recording/journal.js';

import {afterEach, expect, it, vi} from 'vitest';

import {RuntimeState} from '../../../src/browser/runtime-state.js';
import {DialogState} from '../../../src/browser/dialog-state.js';
import {DispatchState} from '../../../src/browser/dispatch-state.js';
import {BrowserRuntime} from '../../../src/browser/runtime.js';
import {BrowserPolicy} from '../../../src/browser/policy.js';
import {McpStdioClient} from '../../../src/transport/mcp/client.js';
import {BrowserContextLostError} from '../../../src/browser/errors/browser-context-lost-error.js';
import {BrowserContextGuard} from '../../../src/browser/browser-context-guard.js';
import {BrowserSession} from '../../../src/browser/session.js';

afterEach(() => vi.restoreAllMocks());

it('prevents startup reentry, use after shutdown and resurrection after context loss', () => {
    const state = new RuntimeState();
    expect(() => state.assertUsable()).toThrow();
    state.start(true);
    expect(() => state.start(true)).toThrow();
    state.ready();
    state.stopping();
    expect(() => state.assertUsable()).toThrow();
    state.settle('stopped');
    state.start(true);
    state.ready();
    state.loseContext();
    state.stopping();
    state.settle('stopped');
    expect(() => state.start(true)).toThrow(BrowserContextLostError);
    expect(() => state.assertUsable()).toThrow(BrowserContextLostError);
});

it('does not let successful startup or graceful close override cancellation', () => {
    const state = new RuntimeState();
    state.start(true);
    state.aborting();
    expect(() => state.ready()).toThrow();
    state.settle('stopped');
    expect(state.phase).toBe('aborted');
    expect(() => state.start(true)).toThrow();
});

it('keeps exact dialog ownership, cancels changed-page transitions and clears unknown ownership', () => {
    const dialogs = new DialogState();
    const page = {url: 'https://example.test/draft', index: 0, corrected: false};
    dialogs.verify(page);
    const owner = dialogs.beginDispatch(false);
    expect(dialogs.verifiedPage).toBeUndefined();
    dialogs.returned(owner);
    dialogs.observeNative(page);
    expect(dialogs.pending).toBe(true);
    expect(dialogs.cancelOnly).toBe(false);
    dialogs.observeNative({...page, url: 'https://example.test/other'});
    expect(dialogs.cancelOnly).toBe(true);
    dialogs.observeNative(page);
    expect(dialogs.cancelOnly).toBe(true);
    expect(dialogs.beginDispatch(true)).toBe(page);
    dialogs.unknown();
    expect(dialogs.owner).toBeUndefined();
    expect(dialogs.pending).toBe(false);
    dialogs.verify({...page, index: 1});
    dialogs.returned(dialogs.beginDispatch(false));
    dialogs.observeNative(page);
    expect(dialogs.cancelOnly).toBe(true);
});

it('classifies refusals, passive failure and unknown mutations without resetting receipts', () => {
    const state = new DispatchState();
    const before = state.count;
    expect(state.failure(before, false, false)).toBe('not-dispatched');
    state.begin();
    expect(state.failure(before, false, false)).toBe('unknown');
    expect(state.failure(before, true, false)).toBe('not-dispatched');
    expect(state.failure(before, false, true)).toBe('observation-failed');
});

it('joins cancellation during initialization and never publishes a ready runtime', async () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
        release = resolve;
    });
    vi.spyOn(McpStdioClient.prototype, 'start').mockImplementation(() => started);
    const stop = vi.spyOn(McpStdioClient.prototype, 'stop').mockResolvedValue();
    const call = vi.spyOn(McpStdioClient.prototype, 'callTool');
    const runtime = new BrowserRuntime({policy: new BrowserPolicy([])});
    const starting = runtime.start();
    const rejection = expect(starting).rejects.toThrow('interrupted');
    const aborting = runtime.abort();
    release();
    await rejection;
    await aborting;
    expect(runtime.phase).toBe('aborted');
    expect(stop).toHaveBeenCalledTimes(2);
    expect(call).not.toHaveBeenCalled();
    await expect(runtime.callTool('browser_click', {})).rejects.toThrow('not active');
    await expect(runtime.addCookies('https://example.test', 'a=b')).rejects.toThrow('not active');
    const permissive = new BrowserRuntime({
        policy: new BrowserPolicy([{origin: 'https://example.test', actions: ['read', 'act']}]),
    });
    await permissive.abort();
    await expect(permissive.goto('https://example.test')).rejects.toThrow('not active');
    expect(call).not.toHaveBeenCalled();
    await runtime.stop();
    await runtime.abort();
    expect(runtime.phase).toBe('aborted');
});

it('makes detected context replacement terminal and does not retry the failed mutation', async () => {
    const client = new McpStdioClient();
    const call = vi.spyOn(client, 'callTool');
    const result = (value: string) => ({
        content: [{type: 'text', text: `### Result\n"CONTEXT_GUARD_${value}"\n`}],
    });
    call.mockResolvedValueOnce(result('READY')).mockResolvedValueOnce(result('LOST'));
    const lost = vi.fn();
    const guard = new BrowserContextGuard(client, lost);
    await guard.install();
    await expect(
        guard.checkAfterFailure(new Error('Mutation transport failed')),
    ).rejects.toBeInstanceOf(BrowserContextLostError);
    await expect(guard.check()).rejects.toBeInstanceOf(BrowserContextLostError);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(2);
});

it('preserves an in-flight dispatch receipt delivered after cancellation stops the transport', async () => {
    vi.spyOn(BrowserRuntime.prototype, 'start').mockResolvedValue();
    vi.spyOn(BrowserRuntime.prototype, 'goto').mockResolvedValue();
    vi.spyOn(McpStdioClient.prototype, 'stop').mockResolvedValue();
    let deliver: ((activity?: MediaActivity) => void) | undefined;
    vi.spyOn(BrowserRuntime.prototype, 'setMediaActivityObserver').mockImplementation(
        (observer) => {
            deliver = observer;
        },
    );
    const onActivity = vi.fn();
    const session = new BrowserSession({url: 'https://example.test', onActivity});
    await session.start();
    await session.abort();
    const receipt: MediaActivity = {
        kind: 'interaction',
        tool: 'browser_click',
        outcome: 'threw',
        startMs: 1,
        endMs: 2,
    };
    deliver?.(receipt);
    expect(onActivity).toHaveBeenCalledWith(receipt);
    expect(session.phase).toBe('aborted');
});
