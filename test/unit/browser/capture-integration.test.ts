import {afterEach, expect, it, vi} from 'vitest';

import {BrowserRuntime} from '../../../src/browser/runtime.js';
import {BrowserSession} from '../../../src/browser/session.js';
import {createCapturePolicy} from '../../../src/browser/policy.js';
import {McpStdioClient} from '../../../src/transport/mcp/client.js';
import {sanitizeForModel} from '../../../src/shared/sanitize-for-model.js';

afterEach(() => vi.restoreAllMocks());
const url = 'https://capture.example.test/';
const screenshotPolicy = {
    requireRedaction: true,
    redaction: {replacements: [{from: 'synthetic-person-canary', to: 'Example person'}]},
};

it('masks known source strings before the first observation and refuses native screenshot bypasses', async () => {
    class PrivateRuntime extends BrowserRuntime {
        constructor() {
            super({policy: createCapturePolicy(url), screenshotPolicy});
            this.lifecycle.start(true);
            this.lifecycle.ready();
        }
    }
    const runtime = new PrivateRuntime();
    const dispatch = vi.spyOn(McpStdioClient.prototype, 'callTool');
    expect(sanitizeForModel('synthetic-person-canary')).not.toContain('synthetic-person-canary');
    await expect(runtime.callTool('browser_take_screenshot', {})).rejects.toThrow('policy-checked');
    expect(dispatch).not.toHaveBeenCalled();
});

it('rejects raw video with a DOM screenshot policy at both public startup boundaries', async () => {
    const start = vi.spyOn(McpStdioClient.prototype, 'start');
    const runtime = new BrowserRuntime({policy: createCapturePolicy(url), screenshotPolicy});
    await expect(runtime.start({videoDir: '/tmp/unused-private-video'})).rejects.toThrow(
        'cannot protect',
    );
    const session = new BrowserSession({
        url,
        screenshotPolicy,
        videoDir: '/tmp/unused-private-video',
    });
    await expect(session.start()).rejects.toThrow('cannot protect');
    expect(start).not.toHaveBeenCalled();
});
