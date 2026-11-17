import {z} from 'zod';

import {SHA256_DIGEST_PATTERN} from '../patterns.js';

import {
    DEFAULT_DIM_OPACITY,
    DEFAULT_OUTLINE_COLOR,
    DEFAULT_OUTLINE_WIDTH_PX,
    ILLUSTRATION_VERSION,
    MAX_ANNOTATION_WIDTH_PX,
    MAX_ILLUSTRATION_CSS_CLASS_CHARS,
    MAX_ILLUSTRATION_DIMENSION,
    MAX_ILLUSTRATION_DPR,
    MAX_ILLUSTRATION_ID_CHARS,
    MAX_ILLUSTRATION_INPUTS,
    MAX_ILLUSTRATION_LABEL_CHARS,
    MAX_ILLUSTRATION_LOCALE_CHARS,
    MAX_ILLUSTRATION_PATH_CHARS,
    MAX_ILLUSTRATION_TEXT_CHARS,
    MAX_INPUT_LIMITATIONS,
    MAX_PRODUCTION_LIMITATIONS,
    RESERVED_ILLUSTRATION_IDS,
} from './config.js';
import {
    ARTIFACT_FILE_PATTERN,
    ASSET_DIRECTORY_PATTERN,
    CSS_CLASS_PATTERN,
    HEX_COLOR_PATTERN,
    ILLUSTRATION_ID_PATTERN,
} from './patterns.js';

const digest = z.string().regex(SHA256_DIGEST_PATTERN);
const evidence = z.string().trim().min(1).max(MAX_ILLUSTRATION_TEXT_CHARS);
const dimension = z.number().int().positive().max(MAX_ILLUSTRATION_DIMENSION);
const id = z
    .string()
    .max(MAX_ILLUSTRATION_ID_CHARS)
    .regex(ILLUSTRATION_ID_PATTERN)
    .refine((value) => !RESERVED_ILLUSTRATION_IDS.has(value));
const imagePath = z.string().min(1).max(MAX_ILLUSTRATION_PATH_CHARS);

export const illustrationBoxSchema = z
    .object({
        x: z.number().int().nonnegative().max(MAX_ILLUSTRATION_DIMENSION),
        y: z.number().int().nonnegative().max(MAX_ILLUSTRATION_DIMENSION),
        width: dimension,
        height: dimension,
    })
    .strict();

export const illustrationAnnotationSchema = z
    .object({
        method: z.enum(['outline', 'dim']),
        box: illustrationBoxSchema,
        color: z.string().regex(HEX_COLOR_PATTERN).default(DEFAULT_OUTLINE_COLOR),
        width: z
            .number()
            .int()
            .positive()
            .max(MAX_ANNOTATION_WIDTH_PX)
            .default(DEFAULT_OUTLINE_WIDTH_PX),
        opacity: z.number().min(0).max(1).default(DEFAULT_DIM_OPACITY),
    })
    .strict();

const inputSchema = z
    .object({
        id,
        source: imagePath,
        sourceSha256: digest.optional(),
        dpr: z.number().positive().max(MAX_ILLUSTRATION_DPR).optional(),
        viewport: z.object({width: dimension, height: dimension}).strict().optional(),
        bbox: illustrationBoxSchema.optional(),
        crop: illustrationBoxSchema.optional(),
        annotation: illustrationAnnotationSchema.optional(),
        locale: z.string().min(1).max(MAX_ILLUSTRATION_LOCALE_CHARS).optional(),
        label: z.string().max(MAX_ILLUSTRATION_LABEL_CHARS).optional(),
    })
    .strict();

const publicationSchema = z
    .object({
        format: z.enum(['generic', 'yfm']).default('generic'),
        assetDirectory: z
            .string()
            .max(MAX_ILLUSTRATION_PATH_CHARS)
            .regex(ASSET_DIRECTORY_PATTERN)
            .refine((value) => value.split('/').every((part) => part !== '.' && part !== '..'))
            .optional(),
        width: dimension.optional(),
        cssClass: z
            .string()
            .max(MAX_ILLUSTRATION_CSS_CLASS_CHARS)
            .regex(CSS_CLASS_PATTERN)
            .optional(),
    })
    .strict();

export const illustrationJobSchema = z
    .object({
        version: z.literal(ILLUSTRATION_VERSION),
        purpose: evidence,
        evidence,
        result: z.enum(['single', 'annotated', 'before-after', 'variants', 'sequence']),
        inputs: z.array(inputSchema).min(1).max(MAX_ILLUSTRATION_INPUTS),
        publication: publicationSchema.default({format: 'generic'}),
    })
    .strict()
    .superRefine((job, context) => {
        if (new Set(job.inputs.map((input) => input.id)).size !== job.inputs.length) {
            context.addIssue({code: 'custom', message: 'Illustration IDs must be unique'});
        }
        if (['single', 'annotated'].includes(job.result) && job.inputs.length !== 1) {
            context.addIssue({code: 'custom', message: 'Single results require one input'});
        }
        if (job.result === 'before-after' && job.inputs.length !== 2) {
            context.addIssue({code: 'custom', message: 'Before-after requires exactly two inputs'});
        }
        if (job.result === 'annotated' && !job.inputs[0]?.annotation) {
            context.addIssue({code: 'custom', message: 'Annotated results require an annotation'});
        }
    });

export const analyzedIllustrationInputSchema = inputSchema
    .extend({
        sourceSha256: digest,
        sourceWidth: dimension,
        sourceHeight: dimension,
        safeCssWidth: dimension,
        limitations: z
            .array(z.string().max(MAX_ILLUSTRATION_TEXT_CHARS))
            .max(MAX_INPUT_LIMITATIONS),
    })
    .strict();

export const illustrationAnalysisSchema = z
    .object({
        version: z.literal(ILLUSTRATION_VERSION),
        purpose: evidence,
        evidence,
        result: z.enum(['single', 'annotated', 'before-after', 'variants', 'sequence']),
        inputs: z.array(analyzedIllustrationInputSchema).min(1).max(MAX_ILLUSTRATION_INPUTS),
        publication: publicationSchema,
        preview: z.object({path: imagePath, sha256: digest}).strict().optional(),
        analysisSha256: digest,
    })
    .strict();

export const illustrationProductionSchema = z
    .object({
        analysis: illustrationAnalysisSchema,
        confirmation: z.object({analysisSha256: digest, evidence}).strict(),
    })
    .strict();

export const illustrationReviewSchema = z
    .object({
        productionSha256: digest,
        visual: z.object({status: z.enum(['pass', 'fail']), evidence}).strict(),
        publication: z.object({renderEvidence: evidence}).strict().optional(),
    })
    .strict();

export const illustrationQualitySchema = z
    .object({
        machineStatus: z.literal('PASS'),
        visualStatus: z.enum(['PENDING', 'PASS', 'FAIL']),
        publicationStatus: z.enum(['DRAFT', 'READY']),
        overallStatus: z.enum(['PENDING_VISUAL_QA', 'PENDING_PUBLICATION', 'PASS', 'FAIL']),
    })
    .strict();

export const illustrationArtifactSchema = z
    .object({
        id: z.string().min(1).max(MAX_ILLUSTRATION_ID_CHARS),
        path: z.string().regex(ARTIFACT_FILE_PATTERN),
        sha256: digest,
        kind: z.enum(['panel', 'collage', 'contact-sheet', 'publication', 'machine-qa']),
        width: dimension.optional(),
        height: dimension.optional(),
        safeCssWidth: dimension.optional(),
    })
    .strict();

export const illustrationProductionManifestSchema = z
    .object({
        version: z.literal(ILLUSTRATION_VERSION),
        analysis: illustrationAnalysisSchema,
        confirmation: z.object({analysisSha256: digest, evidence}).strict(),
        artifacts: z
            .array(illustrationArtifactSchema)
            .min(1)
            .max(MAX_ILLUSTRATION_INPUTS + 4),
        quality: illustrationQualitySchema,
        limitations: z
            .array(z.string().max(MAX_ILLUSTRATION_TEXT_CHARS))
            .max(MAX_PRODUCTION_LIMITATIONS),
        productionSha256: digest,
    })
    .strict();

export const illustrationReviewManifestSchema = z
    .object({
        version: z.literal(ILLUSTRATION_VERSION),
        productionSha256: digest,
        artifacts: z
            .array(illustrationArtifactSchema)
            .min(1)
            .max(MAX_ILLUSTRATION_INPUTS + 4),
        review: illustrationReviewSchema,
        quality: illustrationQualitySchema,
        limitations: z
            .array(z.string().max(MAX_ILLUSTRATION_TEXT_CHARS))
            .max(MAX_PRODUCTION_LIMITATIONS),
        reviewSha256: digest,
    })
    .strict();

export type IllustrationBox = z.infer<typeof illustrationBoxSchema>;
export type IllustrationAnnotation = z.infer<typeof illustrationAnnotationSchema>;
export type IllustrationJob = z.infer<typeof illustrationJobSchema>;
export type IllustrationAnalysis = z.infer<typeof illustrationAnalysisSchema>;
export type AnalyzedIllustrationInput = z.infer<typeof analyzedIllustrationInputSchema>;
export type IllustrationProductionRequest = z.infer<typeof illustrationProductionSchema>;
export type IllustrationReviewRequest = z.infer<typeof illustrationReviewSchema>;
export type IllustrationQuality = z.infer<typeof illustrationQualitySchema>;
export type IllustrationArtifact = z.infer<typeof illustrationArtifactSchema>;
export type IllustrationProductionManifest = z.infer<typeof illustrationProductionManifestSchema>;
export type IllustrationReviewManifest = z.infer<typeof illustrationReviewManifestSchema>;
