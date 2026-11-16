import type {Artifact, CaptureRun} from './capture-run.js';
import type {IllustrationAnalysis, IllustrationJob} from '../media/illustration/index.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';

import {
    analyzeIllustrations,
    illustrationAnalysisSchema,
    illustrationJobSchema,
    produceIllustrations,
} from '../media/illustration/index.js';
import {sha256} from '../media/recording/recording.js';
import {ANALYSIS_MANIFEST_FILE} from '../media/illustration/config.js';

import {ARTIFACT_NAME_PATTERN} from './patterns.js';
import {A_REGISTERED_ARTIFACT_CHANGED, ILLUSTRATION_INPUT_MUST_BE_REGISTERED} from './messages.js';

const directoryName = z.string().regex(ARTIFACT_NAME_PATTERN);
const screenshotGeometry = z.object({
    deviceScaleFactor: z.number().positive(),
    viewport: z.object({width: z.number().positive(), height: z.number().positive()}),
    bounds: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
    }),
    target: z
        .object({
            x: z.number(),
            y: z.number(),
            width: z.number().positive(),
            height: z.number().positive(),
        })
        .nullable(),
    pixelWidth: z.number().int().positive(),
    pixelHeight: z.number().int().positive(),
});

async function registeredFile(
    run: CaptureRun,
    relative: string,
    signal?: AbortSignal,
): Promise<{file: string; artifact: Artifact}> {
    signal?.throwIfAborted();
    const artifact = run.manifest.artifacts.find((entry) => entry.path === relative);
    if (!artifact) {
        throw new Error(ILLUSTRATION_INPUT_MUST_BE_REGISTERED);
    }
    const file = path.resolve(run.directory, artifact.path);
    const fromRoot = path.relative(run.directory, file);
    if (
        fromRoot.startsWith('..') ||
        path.isAbsolute(fromRoot) ||
        (await fs.realpath(file)) !== file ||
        !(await fs.lstat(file)).isFile()
    ) {
        throw new Error(ILLUSTRATION_INPUT_MUST_BE_REGISTERED);
    }
    if ((await sha256(file, signal)) !== artifact.sha256) {
        throw new Error(A_REGISTERED_ARTIFACT_CHANGED);
    }
    return {file, artifact};
}

function measuredInput(input: IllustrationJob['inputs'][number], artifact: Artifact) {
    const geometry = screenshotGeometry.safeParse(artifact.metadata);
    if (!geometry.success) {
        return input;
    }
    const {
        deviceScaleFactor: dpr,
        viewport,
        target,
        bounds,
        pixelWidth,
        pixelHeight,
    } = geometry.data;
    // The browser's device-pixel measurements take precedence over model guesses.
    let bbox: IllustrationJob['inputs'][number]['bbox'];
    if (target) {
        const x = Math.max(0, Math.floor((target.x - bounds.x) * dpr));
        const y = Math.max(0, Math.floor((target.y - bounds.y) * dpr));
        const endX = Math.min(pixelWidth, Math.ceil((target.x + target.width - bounds.x) * dpr));
        const endY = Math.min(pixelHeight, Math.ceil((target.y + target.height - bounds.y) * dpr));
        if (endX > x && endY > y) {
            bbox = {x, y, width: endX - x, height: endY - y};
        }
    }
    return {...input, dpr, viewport, ...(bbox ? {bbox} : {})};
}

export async function analyzeRunIllustrations(
    run: CaptureRun,
    options: {job: unknown; output: string},
    signal?: AbortSignal,
): Promise<IllustrationAnalysis> {
    const job = illustrationJobSchema.parse(options.job);
    const inputs: IllustrationJob['inputs'] = [];
    for (const input of job.inputs) {
        const {file, artifact} = await registeredFile(run, input.source, signal);
        if (input.sourceSha256 && input.sourceSha256 !== artifact.sha256) {
            throw new Error(A_REGISTERED_ARTIFACT_CHANGED);
        }
        inputs.push(
            measuredInput({...input, source: file, sourceSha256: artifact.sha256}, artifact),
        );
    }
    signal?.throwIfAborted();
    const analysis = await analyzeIllustrations(
        {...job, inputs},
        {output: path.join(run.directory, directoryName.parse(options.output))},
    );
    signal?.throwIfAborted();
    await run.registerExport(options.output);
    return analysis;
}

export async function produceRunIllustrations(
    run: CaptureRun,
    options: {
        analysis: string;
        output: string;
        confirmation: {analysisSha256: string; evidence: string};
    },
    signal?: AbortSignal,
) {
    const analysisPath = path.join(directoryName.parse(options.analysis), ANALYSIS_MANIFEST_FILE);
    const {file} = await registeredFile(run, analysisPath, signal);
    const analysis = illustrationAnalysisSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    // Serialized absolute paths are accepted only when they still name registered
    // files in this run. A model cannot use a forged analysis to read host files.
    for (const input of analysis.inputs) {
        await registeredFile(run, path.relative(run.directory, input.source), signal);
    }
    if (analysis.preview) {
        await registeredFile(run, path.relative(run.directory, analysis.preview.path), signal);
    }
    signal?.throwIfAborted();
    const result = await produceIllustrations(
        {analysis, confirmation: options.confirmation},
        {output: path.join(run.directory, directoryName.parse(options.output))},
    );
    signal?.throwIfAborted();
    await run.registerExport(options.output);
    return result;
}
