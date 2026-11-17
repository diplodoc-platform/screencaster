import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {rasterMetadata} from '../../shared/raster.js';

import {
    ANALYSIS_MANIFEST_FILE,
    COLLAGE_FILE,
    CONTACT_SHEET_FILE,
    ILLUSTRATION_VERSION,
    MACHINE_QA_FILE,
    MAX_ILLUSTRATION_DIMENSION,
    MAX_ILLUSTRATION_TOTAL_PIXELS,
    PRODUCTION_MANIFEST_FILE,
    PUBLICATION_FILE,
} from './config.js';
import {
    type AnalyzedIllustrationInput,
    type IllustrationAnalysis,
    type IllustrationArtifact,
    type IllustrationProductionManifest,
    type IllustrationQuality,
    illustrationAnalysisSchema,
    illustrationJobSchema,
    illustrationProductionManifestSchema,
    illustrationProductionSchema,
    illustrationReviewManifestSchema,
    illustrationReviewSchema,
} from './contracts.js';
import {
    digest,
    digestJson,
    newOutputDirectory,
    readImage,
    readRegularFile,
    writeExclusive,
} from './files.js';
import {
    ILLUSTRATION_JOB_TOO_LARGE,
    ILLUSTRATION_SOURCE_CHANGED,
    INVALID_ILLUSTRATION_CSS_WIDTH,
    INVALID_ILLUSTRATION_GEOMETRY,
    INVALID_ILLUSTRATION_PRODUCTION,
    PENDING_RENDER_LIMITATION,
    PENDING_VISUAL_LIMITATION,
    UNCONFIRMED_ILLUSTRATION_ANALYSIS,
    UNKNOWN_DPR_LIMITATION,
} from './messages.js';
import {publicationLimitations, yfmPublication} from './publication.js';
import {renderCollage, renderContactSheet, renderPanel, validateGeometry} from './render.js';
import {REVIEW_FILE_PATTERN} from './patterns.js';

type Panel = {id: string; png: Buffer; width: number; height: number; label?: string};

function analysisHash(analysis: IllustrationAnalysis): string {
    const {analysisSha256: _hash, ...body} = analysis;
    return digestJson(body);
}

function checkAnalysis(analysis: IllustrationAnalysis): void {
    if (analysisHash(analysis) !== analysis.analysisSha256) {
        throw new Error(UNCONFIRMED_ILLUSTRATION_ANALYSIS);
    }
    // Revalidate cross-input invariants after parsing an untrusted serialized analysis.
    illustrationJobSchema.parse({
        version: analysis.version,
        purpose: analysis.purpose,
        evidence: analysis.evidence,
        result: analysis.result,
        publication: analysis.publication,
        inputs: analysis.inputs.map(
            ({
                sourceWidth: _width,
                sourceHeight: _height,
                safeCssWidth: _safe,
                limitations: _limits,
                ...input
            }) => input,
        ),
    });
    if (
        analysis.inputs.reduce(
            (total, input) => total + input.sourceWidth * input.sourceHeight,
            0,
        ) > MAX_ILLUSTRATION_TOTAL_PIXELS
    ) {
        throw new Error(ILLUSTRATION_JOB_TOO_LARGE);
    }
    for (const input of analysis.inputs) {
        const crop = validateGeometry(input);
        if (input.safeCssWidth !== Math.floor(crop.width / (input.dpr ?? 1))) {
            throw new Error(INVALID_ILLUSTRATION_GEOMETRY);
        }
    }
}

async function normalizeInput(
    input: ReturnType<typeof illustrationJobSchema.parse>['inputs'][number],
): Promise<AnalyzedIllustrationInput> {
    const source = await readImage(input.source, input.sourceSha256);
    const crop = input.crop ?? {x: 0, y: 0, width: source.width, height: source.height};
    const safeCssWidth = Math.floor(crop.width / (input.dpr ?? 1));
    if (
        !Number.isSafeInteger(safeCssWidth) ||
        safeCssWidth < 1 ||
        safeCssWidth > MAX_ILLUSTRATION_DIMENSION
    ) {
        throw new Error(INVALID_ILLUSTRATION_CSS_WIDTH);
    }
    const normalized: AnalyzedIllustrationInput = {
        ...input,
        source: source.source,
        sourceSha256: source.sha256,
        sourceWidth: source.width,
        sourceHeight: source.height,
        safeCssWidth,
        limitations: input.dpr === undefined ? [UNKNOWN_DPR_LIMITATION] : [],
    };
    validateGeometry(normalized);
    return normalized;
}

async function panelsForAnalysis(analysis: IllustrationAnalysis): Promise<Panel[]> {
    const panels: Panel[] = [];
    for (const input of analysis.inputs) {
        const source = await readImage(input.source, input.sourceSha256);
        if (source.width !== input.sourceWidth || source.height !== input.sourceHeight) {
            throw new Error(ILLUSTRATION_SOURCE_CHANGED);
        }
        const crop = validateGeometry(input);
        panels.push({
            id: input.id,
            png: await renderPanel(source.bytes, input),
            width: crop.width,
            height: crop.height,
            label: input.label,
        });
    }
    return panels;
}

async function verifySources(analysis: IllustrationAnalysis): Promise<void> {
    for (const input of analysis.inputs) {
        await readImage(input.source, input.sourceSha256);
    }
    if (
        analysis.preview &&
        digest(await readRegularFile(analysis.preview.path)) !== analysis.preview.sha256
    ) {
        throw new Error(ILLUSTRATION_SOURCE_CHANGED);
    }
}

export async function analyzeIllustrations(
    value: unknown,
    options: {output?: string} = {},
): Promise<IllustrationAnalysis> {
    const job = illustrationJobSchema.parse(value);
    const inputs: AnalyzedIllustrationInput[] = [];
    for (const input of job.inputs) {
        inputs.push(await normalizeInput(input));
    }
    let analysis: IllustrationAnalysis = {...job, inputs, analysisSha256: ''};
    if (
        inputs.reduce((total, input) => total + input.sourceWidth * input.sourceHeight, 0) >
        MAX_ILLUSTRATION_TOTAL_PIXELS
    ) {
        throw new Error(ILLUSTRATION_JOB_TOO_LARGE);
    }
    if (options.output) {
        const root = await newOutputDirectory(options.output);
        const preview = await renderContactSheet(await panelsForAnalysis(analysis));
        const file = path.join(root, CONTACT_SHEET_FILE);
        await writeExclusive(file, preview);
        analysis = {...analysis, preview: {path: file, sha256: digest(preview)}};
    }
    analysis = illustrationAnalysisSchema.parse({
        ...analysis,
        analysisSha256: analysisHash(analysis),
    });
    if (options.output) {
        await writeExclusive(
            path.join(path.resolve(options.output), ANALYSIS_MANIFEST_FILE),
            JSON.stringify(analysis, null, 2),
        );
    }
    await verifySources(analysis);
    return analysis;
}

async function writeArtifact(
    root: string,
    file: string,
    kind: IllustrationArtifact['kind'],
    id: string,
    bytes: Buffer | string,
    geometry: {width?: number; height?: number; safeCssWidth?: number} = {},
): Promise<IllustrationArtifact> {
    await writeExclusive(path.join(root, file), bytes);
    return {id, path: file, kind, sha256: digest(bytes), ...geometry};
}

export async function produceIllustrations(
    value: unknown,
    options: {output: string},
): Promise<IllustrationProductionManifest> {
    const {analysis, confirmation} = illustrationProductionSchema.parse(value);
    checkAnalysis(analysis);
    if (confirmation.analysisSha256 !== analysis.analysisSha256) {
        throw new Error(UNCONFIRMED_ILLUSTRATION_ANALYSIS);
    }
    await verifySources(analysis);
    const panels = await panelsForAnalysis(analysis);
    const root = await newOutputDirectory(options.output);
    const artifacts: IllustrationArtifact[] = [];
    for (const [index, panel] of panels.entries()) {
        artifacts.push(
            await writeArtifact(root, `${panel.id}.png`, 'panel', panel.id, panel.png, {
                width: panel.width,
                height: panel.height,
                safeCssWidth: analysis.inputs[index].safeCssWidth,
            }),
        );
    }
    if (['before-after', 'variants', 'sequence'].includes(analysis.result)) {
        const png = await renderCollage(panels, analysis.result === 'sequence');
        const {width, height} = rasterMetadata(png);
        const dpr =
            new Set(analysis.inputs.map((input) => input.dpr)).size === 1
                ? (analysis.inputs[0].dpr ?? 1)
                : 1;
        artifacts.push(
            await writeArtifact(root, COLLAGE_FILE, 'collage', 'collage', png, {
                width,
                height,
                safeCssWidth: Math.floor((width ?? 1) / dpr),
            }),
        );
    }
    const contact = await renderContactSheet(panels);
    const contactMetadata = rasterMetadata(contact);
    artifacts.push(
        await writeArtifact(root, CONTACT_SHEET_FILE, 'contact-sheet', 'contact-sheet', contact, {
            width: contactMetadata.width,
            height: contactMetadata.height,
        }),
    );
    const publication = yfmPublication(analysis, artifacts);
    if (publication) {
        artifacts.push(
            await writeArtifact(
                root,
                PUBLICATION_FILE,
                'publication',
                'publication-yfm',
                publication,
            ),
        );
    }
    const quality: IllustrationQuality = {
        machineStatus: 'PASS',
        visualStatus: 'PENDING',
        publicationStatus: 'DRAFT',
        overallStatus: 'PENDING_VISUAL_QA',
    };
    const limitations = [
        ...publicationLimitations(analysis),
        PENDING_VISUAL_LIMITATION,
        PENDING_RENDER_LIMITATION,
    ];
    artifacts.push(
        await writeArtifact(
            root,
            MACHINE_QA_FILE,
            'machine-qa',
            'machine-qa',
            JSON.stringify(
                {quality, limitations, analysisSha256: analysis.analysisSha256},
                null,
                2,
            ),
        ),
    );
    await verifySources(analysis);
    const body = {
        version: ILLUSTRATION_VERSION,
        analysis,
        confirmation,
        artifacts,
        quality,
        limitations,
    };
    const result = {...body, productionSha256: digestJson(body)};
    const validated = illustrationProductionManifestSchema.parse(result);
    await writeExclusive(
        path.join(root, PRODUCTION_MANIFEST_FILE),
        JSON.stringify(validated, null, 2),
    );
    return validated;
}

export async function verifyIllustrationProduction(
    directory: string,
): Promise<IllustrationProductionManifest> {
    try {
        if (!(await fs.lstat(directory)).isDirectory()) {
            throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
        }
        const root = await fs.realpath(directory);
        const production = illustrationProductionManifestSchema.parse(
            JSON.parse(
                (await readRegularFile(path.join(root, PRODUCTION_MANIFEST_FILE))).toString('utf8'),
            ),
        );
        const {productionSha256, ...body} = production;
        if (
            digestJson(body) !== productionSha256 ||
            production.confirmation.analysisSha256 !== production.analysis.analysisSha256
        ) {
            throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
        }
        checkAnalysis(production.analysis);
        for (const artifact of production.artifacts) {
            if (digest(await readRegularFile(path.join(root, artifact.path))) !== artifact.sha256) {
                throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
            }
        }
        await verifySources(production.analysis);
        return production;
    } catch {
        throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
    }
}

// Host-only attestation API. Do not expose this as a model's automatic PASS.
export async function reviewIllustrations(directory: string, value: unknown) {
    const request = illustrationReviewSchema.parse(value);
    const production = await verifyIllustrationProduction(directory);
    if (request.productionSha256 !== production.productionSha256) {
        throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
    }
    const limitations = publicationLimitations(production.analysis);
    if (!request.publication) {
        limitations.push(PENDING_RENDER_LIMITATION);
    }
    const visualStatus = request.visual.status === 'pass' ? ('PASS' as const) : ('FAIL' as const);
    const ready = visualStatus === 'PASS' && limitations.length === 0;
    let overallStatus: IllustrationQuality['overallStatus'] = 'PENDING_PUBLICATION';
    if (visualStatus === 'FAIL') {
        overallStatus = 'FAIL';
    } else if (ready) {
        overallStatus = 'PASS';
    }
    const quality: IllustrationQuality = {
        machineStatus: 'PASS',
        visualStatus,
        publicationStatus: ready ? 'READY' : 'DRAFT',
        overallStatus,
    };
    const body = {
        version: ILLUSTRATION_VERSION,
        productionSha256: production.productionSha256,
        artifacts: production.artifacts,
        review: request,
        quality,
        limitations,
    };
    const review = illustrationReviewManifestSchema.parse({
        ...body,
        reviewSha256: digestJson(body),
    });
    await verifyIllustrationProduction(directory);
    const file = path.join(await fs.realpath(directory), `review-${randomUUID()}.json`);
    await writeExclusive(file, JSON.stringify(review, null, 2));
    return {...review, path: file};
}

export async function verifyIllustrationReview(directory: string, reviewFile: string) {
    try {
        const production = await verifyIllustrationProduction(directory);
        const root = await fs.realpath(directory);
        const file = path.resolve(root, reviewFile);
        if (path.dirname(file) !== root || !REVIEW_FILE_PATTERN.test(path.basename(file))) {
            throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
        }
        const review = illustrationReviewManifestSchema.parse(
            JSON.parse((await readRegularFile(file)).toString('utf8')),
        );
        const {reviewSha256, ...body} = review;
        if (
            digestJson(body) !== reviewSha256 ||
            review.productionSha256 !== production.productionSha256 ||
            review.review.productionSha256 !== production.productionSha256 ||
            digestJson(review.artifacts) !== digestJson(production.artifacts)
        ) {
            throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
        }
        return {...review, path: file};
    } catch {
        throw new Error(INVALID_ILLUSTRATION_PRODUCTION);
    }
}
