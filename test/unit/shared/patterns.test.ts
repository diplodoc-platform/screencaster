import {performance} from 'node:perf_hooks';
import {expect, it} from 'vitest';

import {NUMBER_WITH_UNIT_PATTERN} from '../../../src/browser/scripts/patterns.js';
import {MARKDOWN_FENCE_PATTERN} from '../../../src/transport/mcp/patterns.js';

it('preserves numeric suffixes and Markdown fence delimiters', () => {
    expect(NUMBER_WITH_UNIT_PATTERN.exec('-12,5 kg')?.[1]).toBe(' kg');
    expect(NUMBER_WITH_UNIT_PATTERN.exec('+12.5  %')?.[1]).toBe('  %');
    expect(NUMBER_WITH_UNIT_PATTERN.exec('12  ')?.[1]).toBe('  ');
    expect(NUMBER_WITH_UNIT_PATTERN.test('12 ')).toBe(false);
    expect(NUMBER_WITH_UNIT_PATTERN.test('12 kg2')).toBe(false);
    expect(MARKDOWN_FENCE_PATTERN.exec('  ````markdown')?.slice(1)).toEqual([
        '  ',
        '````',
        'markdown',
    ]);
    expect(MARKDOWN_FENCE_PATTERN.exec('~~~js')?.slice(1)).toEqual(['', '~~~', 'js']);
    expect(MARKDOWN_FENCE_PATTERN.test('    ```')).toBe(false);
    expect(MARKDOWN_FENCE_PATTERN.test('```\u2028text')).toBe(false);
});

it('rejects long near-matches without quadratic backtracking', () => {
    const unit = '1' + ' '.repeat(100_000) + '2';
    const fence = '`'.repeat(100_000) + '\u2028text';
    const start = performance.now();
    expect(NUMBER_WITH_UNIT_PATTERN.test(unit)).toBe(false);
    expect(MARKDOWN_FENCE_PATTERN.test(fence)).toBe(false);
    // The old expressions took seconds on these inputs; linear matching takes milliseconds.
    expect(performance.now() - start).toBeLessThan(1000);
});
