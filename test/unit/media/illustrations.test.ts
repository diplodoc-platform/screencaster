import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {afterEach, beforeEach, expect, it} from 'vitest';

import {
    analyzeIllustrations,
    produceIllustrations,
    reviewIllustrations,
    verifyIllustrationProduction,
    verifyIllustrationReview,
} from '../../../src/media/illustration/index.js';
import {renderScreenshotHighlight} from '../../../src/shared/image-renderer.js';

let root: string;
let source: string;
let bytes: Buffer;
beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'illustration-test-')));
    source = path.join(root, 'source.png');
    bytes = await sharp({create: {width: 100, height: 80, channels: 3, background: '#c0d0e0'}})
        .png()
        .toBuffer();
    await fs.writeFile(source, bytes);
});
afterEach(async () => fs.rm(root, {recursive: true, force: true}));

function job() {
    return {
        version: 1,
        purpose: 'Open the item [menu]',
        evidence: 'The requested menu is visible in the captured page.',
        result: 'annotated',
        inputs: [
            {
                id: 'menu',
                source,
                dpr: 2,
                viewport: {width: 50, height: 40},
                bbox: {x: 20, y: 20, width: 20, height: 10},
                crop: {x: 10, y: 10, width: 60, height: 40},
                annotation: {method: 'outline', box: {x: 20, y: 20, width: 20, height: 10}},
            },
        ],
        publication: {format: 'yfm', assetDirectory: '_assets/screenshots', width: 800},
    };
}
async function produce(value: unknown = job()) {
    const analysis = await analyzeIllustrations(value, {output: path.join(root, 'analysis')});
    const production = await produceIllustrations(
        {
            analysis,
            confirmation: {
                analysisSha256: analysis.analysisSha256,
                evidence: 'Crop and target verified in the preview.',
            },
        },
        {output: path.join(root, 'production')},
    );
    return {analysis, production, directory: path.join(root, 'production')};
}

it('analyzes and produces confirmed crops without resampling or modifying originals', async () => {
    const originalHash = createHash('sha256').update(bytes).digest('hex');
    const {analysis, production, directory} = await produce();
    expect(analysis.inputs[0]).toMatchObject({
        sourceSha256: originalHash,
        sourceWidth: 100,
        sourceHeight: 80,
        safeCssWidth: 30,
    });
    expect(analysis.preview?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(production.quality).toEqual({
        machineStatus: 'PASS',
        visualStatus: 'PENDING',
        publicationStatus: 'DRAFT',
        overallStatus: 'PENDING_VISUAL_QA',
    });
    expect(await fs.readFile(source)).toEqual(bytes);
    const panel = path.join(directory, 'menu.png');
    expect(await sharp(panel).metadata()).toMatchObject({width: 60, height: 40});
    const pixels = await sharp(panel).removeAlpha().raw().toBuffer();
    expect([...pixels.subarray(0, 3)]).toEqual([192, 208, 224]);
    const yfm = await fs.readFile(path.join(directory, 'publication-yfm.md'), 'utf8');
    expect(yfm).toBe('![Open the item \\[menu\\]](_assets/screenshots/menu.png =30x)\n');
    expect((await verifyIllustrationProduction(directory)).productionSha256).toBe(
        production.productionSha256,
    );
    if (process.platform !== 'win32') {
        expect((await fs.stat(panel)).mode % 0o1000).toBe(0o600);
        expect((await fs.stat(directory)).mode % 0o1000).toBe(0o700);
    }
});

it('rejects unconfirmed changes, source changes and overwritten output directories', async () => {
    const analysis = await analyzeIllustrations(job());
    const confirmed = {
        analysis,
        confirmation: {analysisSha256: analysis.analysisSha256, evidence: 'Reviewed'},
    };
    const changed = structuredClone(confirmed);
    changed.analysis.inputs[0].crop = {x: 0, y: 0, width: 50, height: 50};
    await expect(
        produceIllustrations(changed, {output: path.join(root, 'changed')}),
    ).rejects.toThrow('confirmation');
    await expect(
        produceIllustrations(
            {
                ...confirmed,
                confirmation: {...confirmed.confirmation, analysisSha256: '0'.repeat(64)},
            },
            {output: path.join(root, 'unconfirmed')},
        ),
    ).rejects.toThrow('confirmation');
    const existing = path.join(root, 'existing');
    await fs.mkdir(existing);
    await fs.writeFile(path.join(existing, 'canary'), 'keep');
    await expect(produceIllustrations(confirmed, {output: existing})).rejects.toThrow(
        'new private',
    );
    expect(await fs.readFile(path.join(existing, 'canary'), 'utf8')).toBe('keep');
    await fs.writeFile(
        source,
        await sharp({create: {width: 100, height: 80, channels: 3, background: '#ff0000'}})
            .png()
            .toBuffer(),
    );
    await expect(
        produceIllustrations(confirmed, {output: path.join(root, 'stale')}),
    ).rejects.toThrow('source changed');
});

it.each([1e-20, Number.MIN_VALUE])(
    'rejects a DPR producing an unbounded CSS width before creating outputs: %s',
    async (dpr) => {
        const value = job();
        const output = path.join(root, 'invalid-analysis');
        await expect(
            analyzeIllustrations(
                {
                    ...value,
                    inputs: [{...value.inputs[0], dpr}],
                },
                {output},
            ),
        ).rejects.toThrow('bounded positive integer');
        await expect(fs.stat(output)).rejects.toMatchObject({code: 'ENOENT'});
    },
);

it('records host review separately and invalidates a review when output pixels change', async () => {
    const {production, directory} = await produce();
    const manifestBefore = await fs.readFile(path.join(directory, 'production.json'));
    const review = await reviewIllustrations(directory, {
        productionSha256: production.productionSha256,
        visual: {
            status: 'pass',
            evidence: 'Inspected every edge, label and target at publication size.',
        },
        publication: {renderEvidence: 'Rendered and inspected in the target YFM project.'},
    });
    expect(review.quality).toEqual({
        machineStatus: 'PASS',
        visualStatus: 'PASS',
        publicationStatus: 'READY',
        overallStatus: 'PASS',
    });
    expect(await fs.readFile(path.join(directory, 'production.json'))).toEqual(manifestBefore);
    expect((await verifyIllustrationReview(directory, review.path)).reviewSha256).toBe(
        review.reviewSha256,
    );
    const visualOnly = await reviewIllustrations(directory, {
        productionSha256: production.productionSha256,
        visual: {status: 'pass', evidence: 'Visual inspection only'},
    });
    expect(visualOnly.quality.overallStatus).toBe('PENDING_PUBLICATION');
    const failed = await reviewIllustrations(directory, {
        productionSha256: production.productionSha256,
        visual: {status: 'fail', evidence: 'The caption is clipped'},
    });
    expect(failed.quality.overallStatus).toBe('FAIL');
    await fs.appendFile(path.join(directory, 'menu.png'), 'tampering');
    await expect(verifyIllustrationReview(directory, review.path)).rejects.toThrow(
        'review is invalid',
    );
    await expect(
        reviewIllustrations(directory, {
            productionSha256: production.productionSha256,
            visual: {status: 'pass', evidence: 'Old evidence'},
        }),
    ).rejects.toThrow('review is invalid');
});

it('binds preview bytes to confirmation and checks appended review bytes before reuse', async () => {
    const {analysis, production, directory} = await produce();
    const review = await reviewIllustrations(directory, {
        productionSha256: production.productionSha256,
        visual: {status: 'pass', evidence: 'Reviewed'},
    });
    const serialized = JSON.parse(await fs.readFile(review.path, 'utf8'));
    serialized.quality.overallStatus = 'PASS';
    await fs.writeFile(review.path, JSON.stringify(serialized));
    await expect(verifyIllustrationReview(directory, review.path)).rejects.toThrow(
        'review is invalid',
    );
    expect(analysis.preview).toBeTruthy();
    await fs.appendFile(analysis.preview?.path ?? '', 'changed preview');
    await expect(
        produceIllustrations(
            {
                analysis,
                confirmation: {
                    analysisSha256: analysis.analysisSha256,
                    evidence: 'Old preview reviewed',
                },
            },
            {output: path.join(root, 'stale-preview')},
        ),
    ).rejects.toThrow('source changed');
});

it('does not confuse visual success with a verified publication or unknown DPR', async () => {
    const value = job();
    const {dpr: _dpr, ...input} = value.inputs[0];
    const {production, directory} = await produce({...value, inputs: [input]});
    const review = await reviewIllustrations(directory, {
        productionSha256: production.productionSha256,
        visual: {status: 'pass', evidence: 'Visual inspection passed'},
        publication: {renderEvidence: 'Target rendered'},
    });
    expect(review.quality.publicationStatus).toBe('DRAFT');
    expect(review.quality.overallStatus).toBe('PENDING_PUBLICATION');
    expect(review.limitations.join(' ')).toContain('DPR is unknown');
});

it('makes non-resampled collages with per-input DPR and explicit preview outputs', async () => {
    const second = path.join(root, 'second.jpg');
    await fs.writeFile(
        second,
        await sharp({create: {width: 80, height: 60, channels: 3, background: '#ffffff'}})
            .jpeg()
            .toBuffer(),
    );
    const value = job();
    const {production, directory} = await produce({
        ...value,
        result: 'before-after',
        inputs: [
            {id: 'before', source, dpr: 1, label: '<before>'},
            {id: 'after', source: second, dpr: 2, label: 'after'},
        ],
    });
    expect(await sharp(path.join(directory, 'before.png')).metadata()).toMatchObject({
        width: 100,
        height: 80,
    });
    expect(await sharp(path.join(directory, 'after.png')).metadata()).toMatchObject({
        width: 80,
        height: 60,
    });
    expect(await sharp(path.join(directory, 'collage.png')).metadata()).toMatchObject({
        width: 252,
        height: 160,
    });
    expect(production.artifacts.some((artifact) => artifact.kind === 'contact-sheet')).toBe(true);
    const review = await reviewIllustrations(directory, {
        productionSha256: production.productionSha256,
        visual: {status: 'pass', evidence: 'Inspected'},
        publication: {renderEvidence: 'Rendered'},
    });
    expect(review.quality.publicationStatus).toBe('DRAFT');
    expect(review.limitations.join(' ')).toContain('different DPR');
});

it('rejects unsafe markup paths, cut-off targets, non-raster inputs and symlink sources', async () => {
    const value = job();
    await expect(
        analyzeIllustrations({...value, publication: {format: 'yfm', assetDirectory: '../escape'}}),
    ).rejects.toThrow();
    await expect(
        analyzeIllustrations({
            ...value,
            inputs: [{...value.inputs[0], crop: {x: 0, y: 0, width: 10, height: 10}}],
        }),
    ).rejects.toThrow('outside');
    const svg = path.join(root, 'fake.png');
    await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    await expect(
        analyzeIllustrations({...value, inputs: [{...value.inputs[0], source: svg}]}),
    ).rejects.toThrow('PNG or JPEG');
    const link = path.join(root, 'link.png');
    await fs.symlink(source, link);
    await expect(
        analyzeIllustrations({...value, inputs: [{...value.inputs[0], source: link}]}),
    ).rejects.toThrow('regular');
});

it('decorates capture PNG locally at device resolution and preserves surrounding pixels', async () => {
    const output = await renderScreenshotHighlight(bytes, {
        pixelWidth: 100,
        pixelHeight: 80,
        bounds: {x: 0, y: 0, width: 50, height: 40},
        target: {x: 10, y: 10, width: 20, height: 10},
        deviceScaleFactor: 2,
    });
    expect(await sharp(output).metadata()).toMatchObject({width: 100, height: 80});
    const pixels = await sharp(output).removeAlpha().raw().toBuffer();
    expect([...pixels.subarray(0, 3)]).toEqual([192, 208, 224]);
    expect([...pixels.subarray((20 * 100 + 20) * 3, (20 * 100 + 20) * 3 + 3)]).not.toEqual([
        192, 208, 224,
    ]);
    await expect(
        renderScreenshotHighlight(bytes, {
            pixelWidth: 99,
            pixelHeight: 80,
            bounds: {x: 0, y: 0, width: 50, height: 40},
            target: {x: 10, y: 10, width: 20, height: 10},
            deviceScaleFactor: 2,
        }),
    ).rejects.toThrow('invalid');
});
