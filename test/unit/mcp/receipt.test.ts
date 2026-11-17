import {describe, expect, it} from 'vitest';

import {readHarness} from '../../../src/agent/read-harness.js';
import {summarizeReceipt} from '../../../src/transport/mcp/receipt.js';

describe('local agent context', () => {
    it('keeps the receipt while omitting old snapshots and generated native code', () => {
        const text = [
            '### Result',
            'Clicked',
            '### Ran Playwright code',
            '```js',
            'await page.click();',
            '```',
            '### Snapshot',
            '```yaml',
            '- button "Earlier"',
            '```',
        ].join('\n');
        expect(summarizeReceipt(text)).toBe('### Result\nClicked');
    });

    it('preserves example data, masks sensitive fields and bounds large receipts', () => {
        const example = '````markdown\n### Snapshot\n```yaml\nexample\n```\n````';
        expect(summarizeReceipt(example)).toBe(example);
        expect(summarizeReceipt('{"token":"synthetic-value"}')).not.toContain('synthetic-value');
        expect(summarizeReceipt('a'.repeat(20000)).length).toBeLessThanOrEqual(16000);
    });

    it('loads the bundled guidance without accepting arbitrary paths', async () => {
        expect(await readHarness('decompose')).toContain('sourceQuote');
        expect(await readHarness('configuration')).toContain('outputs.video.highlights');
        await expect(readHarness('../package.json' as never)).rejects.toThrow('Unknown harness');
    });
});
