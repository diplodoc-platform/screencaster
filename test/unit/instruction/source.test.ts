import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';

import {fetchMarkdown, loadInstruction} from '../../../src/instruction/source.js';
import {validatePlan} from '../../../src/instruction/plan.js';

describe('instruction contracts', () => {
    it('retains exact source bytes and identifies them by hash', async () => {
        const markdown = '\n# Open the editor\n';
        const source = await loadInstruction({text: markdown});
        expect(source.markdown).toBe(markdown);
        expect(source.sha256).toBe(createHash('sha256').update(markdown).digest('hex'));
    });

    it('lets a consumer resolve an HTML URL into Markdown', async () => {
        const loader = vi.fn(async () => ({
            markdown: '# Custom source',
            url: 'https://docs.example.org/raw',
        }));
        const source = await loadInstruction({url: 'https://docs.example.org/article'}, {loader});
        expect(loader).toHaveBeenCalledOnce();
        expect(source).toMatchObject({
            markdown: '# Custom source',
            requestedUrl: 'https://docs.example.org/article',
            url: 'https://docs.example.org/raw',
        });
    });

    it('rejects HTML in the default loader without a site-specific fallback', async () => {
        vi.stubGlobal(
            'fetch',
            async () => new Response('<html>Page</html>', {headers: {'Content-Type': 'text/html'}}),
        );
        try {
            await expect(fetchMarkdown({url: 'https://docs.example.org/article'})).rejects.toThrow(
                'custom Markdown loader',
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('validates source identity, quotes and unique step IDs independently of a model', async () => {
        const source = await loadInstruction({text: 'Open the editor. Save the document.'});
        const step = {
            id: 1,
            actionText: 'Open editor',
            expectedResult: 'Editor is visible',
            sourceQuote: 'Open the editor.',
        };
        const plan = {sourceSha256: source.sha256, steps: [step]};
        expect(validatePlan(plan, source).steps).toHaveLength(1);
        expect(() => validatePlan({...plan, sourceSha256: '0'.repeat(64)}, source)).toThrow(
            'different instruction',
        );
        expect(() => validatePlan({...plan, steps: [step, step]}, source)).toThrow('unique');
        expect(() =>
            validatePlan({...plan, steps: [{...step, sourceQuote: 'Invented operation'}]}, source),
        ).toThrow('quotes');
    });

    it('honors cancellation before invoking a custom loader', async () => {
        const loader = vi.fn();
        await expect(
            loadInstruction(
                {url: 'https://docs.example.org'},
                {loader, signal: AbortSignal.abort()},
            ),
        ).rejects.toThrow();
        expect(loader).not.toHaveBeenCalled();
    });
});
