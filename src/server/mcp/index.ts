import type {InstructionLoader} from '../../instruction/source.js';
import type {TtsProvider} from '../../media/audio/audio.js';
import type {BrowserObserver} from '../../browser/observations.js';
import type {HostAuthenticator} from '../../browser/host-auth.js';
import type {ScreenshotCapturePolicy} from '../../browser/capture/capture-policy.js';
import type {BrowserRunDefaults} from '../../application/run-options.js';
import type {OutputOptions} from '../../application/output-options.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    CallToolResultSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

import {outlineStyleSchema} from '../../shared/outline-style.js';
import {MCP_IDENTITY} from '../../shared/metadata.js';
import {MAX_COMPLETION_EVIDENCE_CHARS} from '../../application/config.js';
import {PRIVATE_DIRECTORY_MODE} from '../../shared/config.js';
import {CaptureRun} from '../../application/capture-run.js';
import {browserRunSchema} from '../../application/run-options.js';
import {outputOptionsSchema, recordingEnabled} from '../../application/output-options.js';
import {instructionPlanSchema} from '../../instruction/plan.js';
import {BrowserActionError} from '../../browser/outcome.js';
import {BrowserPolicy, createBrowserPolicy} from '../../browser/policy.js';
import {narrateVideo} from '../../media/audio/narration.js';
import {editVideo, editorialCutsSchema} from '../../media/export/editorial.js';
import {editProposalSchema} from '../../media/timeline/editing.js';
import {captionSchema, exportCaptions} from '../../media/audio/captions.js';
import {readHarness} from '../../agent/read-harness.js';
import {screenshotOptionsSchema} from '../../browser/capture/screenshot.js';
import {clipOptionsSchema, exportClip} from '../../media/export/clips.js';
import {imagePreview} from '../../media/preview/image-preview.js';
import {summarizeReceipt} from '../../transport/mcp/receipt.js';
import {HostAuthenticationChallengeError} from '../../browser/errors/host-auth-challenge-error.js';
import {
    illustrationJobSchema,
    illustrationProductionSchema,
} from '../../media/illustration/index.js';
import {analyzeRunIllustrations, produceRunIllustrations} from '../../application/illustrations.js';

import {TOOL_DESCRIPTIONS} from './descriptions.js';
import {INDEX_PATTERN} from './patterns.js';
import {
    AMBIGUOUS_HOST_BROWSER_POLICY,
    FINISH_THE_CURRENT_RUN_BEFORE_OPENING_ANOTHER_SESSION,
    INVALID_HOST_BROWSER_POLICY,
    OPEN_A_RUN_FIRST,
    SCREENCASTER_SERVER_CLOSED,
    SPECIFY_AN_ID_TO_BEGIN_OR_STATUS_AND,
    THE_SCREENCASTER_SERVER_IS_CLOSING,
    UNKNOWN_SCREENCASTER_TOOL,
} from './messages.js';

export type ServerOptions = {
    directory: string;
    loader?: InstructionLoader;
    tts?: TtsProvider;
    storageStatePath?: string;
    policyPath?: string;
    observers?: readonly BrowserObserver[];
    policyFactory?: (targetUrl: string) => BrowserPolicy;
    authentication?: HostAuthenticator;
    screenshotPolicy?: ScreenshotCapturePolicy;
    runDefaults?: BrowserRunDefaults;
    outputs?: OutputOptions;
};
const artifactName = z.string().regex(INDEX_PATTERN);

function defineTool<S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.infer<S>, signal: AbortSignal) => unknown,
) {
    return {
        name,
        description,
        inputSchema: z.toJSONSchema(schema),
        invoke: async (args: unknown, signal: AbortSignal) => handler(schema.parse(args), signal),
    };
}

function toolError(error: unknown) {
    let result: Record<string, unknown> = {error: 'Tool failed'};
    if (error instanceof HostAuthenticationChallengeError) {
        result = {
            error: error.message,
            manualContinuation: {origin: error.origin, challenge: error.challenge},
        };
    } else if (error instanceof BrowserActionError) {
        result = {error: error.message, outcome: error.outcome, actionId: error.actionId};
    } else if (error instanceof z.ZodError) {
        result = {error: 'Invalid tool arguments'};
    } else if (error instanceof Error) {
        result = {error: error.message};
    }
    return {isError: true, content: [{type: 'text' as const, text: JSON.stringify(result)}]};
}

export function createMcpServer(options: ServerOptions) {
    const runDefaults = browserRunSchema.partial().parse(options.runDefaults ?? {});
    const outputs = outputOptionsSchema.parse(options.outputs ?? {});
    recordingEnabled(runDefaults.video, outputs);
    if (options.policyFactory && options.policyPath) {
        throw new Error(AMBIGUOUS_HOST_BROWSER_POLICY);
    }
    const server = new Server(MCP_IDENTITY, {capabilities: {tools: {}}});
    let run: CaptureRun | undefined;
    let opening: Promise<CaptureRun> | undefined;
    let closing = false;
    let operation: Promise<unknown> = Promise.resolve();
    let closePromise: Promise<void> | undefined;
    const shutdown = new AbortController();
    const current = () => {
        if (!run) {
            throw new Error(OPEN_A_RUN_FIRST);
        }
        return run;
    };
    const local = (name: string) => path.join(current().directory, artifactName.parse(name));
    const specs = [
        defineTool(
            'screencaster_help',
            TOOL_DESCRIPTIONS.screencaster_help,
            z
                .object({
                    topic: z
                        .enum([
                            'overview',
                            'decompose',
                            'execute',
                            'configuration',
                            'media',
                            'illustrations',
                        ])
                        .optional(),
                })
                .strict(),
            (input) => readHarness(input.topic),
        ),
        defineTool(
            'screencaster_open',
            TOOL_DESCRIPTIONS.screencaster_open,
            runDefaults.url ? browserRunSchema.partial() : browserRunSchema,
            async (input, signal) => {
                if (closing || opening || run?.manifest.status === 'running') {
                    throw new Error(FINISH_THE_CURRENT_RUN_BEFORE_OPENING_ANOTHER_SESSION);
                }
                const runOptions = browserRunSchema.parse({...runDefaults, ...input});
                recordingEnabled(runOptions.video, outputs);
                opening = (async () => {
                    let policy: BrowserPolicy | undefined;
                    if (options.policyFactory) {
                        policy = options.policyFactory(runOptions.url);
                    } else if (options.policyPath) {
                        policy = createBrowserPolicy(runOptions.url, options.policyPath);
                    }
                    if (options.policyFactory && !(policy instanceof BrowserPolicy)) {
                        throw new Error(INVALID_HOST_BROWSER_POLICY);
                    }
                    await fs.mkdir(options.directory, {
                        recursive: true,
                        mode: PRIVATE_DIRECTORY_MODE,
                    });
                    return CaptureRun.create({
                        ...runOptions,
                        directory: path.join(options.directory, randomUUID()),
                        loader: options.loader,
                        observers: options.observers,
                        storageStatePath: options.storageStatePath,
                        policy,
                        authentication: options.authentication,
                        screenshotPolicy: options.screenshotPolicy,
                        outputs,
                        tts: options.tts,
                        signal,
                    });
                })();
                try {
                    run = await opening;
                    if (signal.aborted) {
                        await run.abort();
                        signal.throwIfAborted();
                    }
                    return {directory: run.directory, ...run.manifest};
                } finally {
                    opening = undefined;
                }
            },
        ),
        defineTool(
            'screencaster_source',
            TOOL_DESCRIPTIONS.screencaster_source,
            z.object({text: z.string().optional(), url: z.string().url().optional()}).strict(),
            async (input, signal) => {
                const source = z
                    .union([
                        z.object({text: z.string()}).strict(),
                        z.object({url: z.string().url()}).strict(),
                    ])
                    .parse(input);
                return current().instruction(source, signal);
            },
        ),
        defineTool(
            'screencaster_plan',
            TOOL_DESCRIPTIONS.screencaster_plan,
            z.object({plan: instructionPlanSchema}).strict(),
            async (input) => {
                const result = current().registerPlan(input.plan);
                await current().flush();
                return result;
            },
        ),
        defineTool(
            'screencaster_step',
            TOOL_DESCRIPTIONS.screencaster_step,
            z
                .object({
                    id: z.number().int().positive().optional(),
                    status: z.enum(['success', 'fail', 'skipped']).optional(),
                    evidence: z.string().optional(),
                })
                .strict(),
            async (input) => {
                if (
                    input.id !== undefined &&
                    input.status === undefined &&
                    input.evidence === undefined
                ) {
                    current().beginStep(input.id);
                } else if (input.id === undefined && input.status && input.evidence) {
                    current().completeStep(input.status, input.evidence);
                } else {
                    throw new Error(SPECIFY_AN_ID_TO_BEGIN_OR_STATUS_AND);
                }
                await current().flush();
                return current().manifest.steps;
            },
        ),
        defineTool(
            'browser_snapshot',
            TOOL_DESCRIPTIONS.browser_snapshot,
            z
                .object({
                    query: z.string().optional(),
                    offset: z.number().int().nonnegative().optional(),
                    maxChars: z.number().int().positive().optional(),
                })
                .strict(),
            (input) => current().snapshot(input),
        ),
        defineTool('browser_tools', TOOL_DESCRIPTIONS.browser_tools, z.object({}).strict(), () =>
            current().browser.availableTools(),
        ),
        defineTool(
            'browser_action',
            TOOL_DESCRIPTIONS.browser_action,
            z.object({name: z.string(), arguments: z.record(z.string(), z.unknown())}).strict(),
            async (input, signal) => {
                const action = await current().action(input.name, input.arguments, signal);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                actionId: action.actionId,
                                receipt: summarizeReceipt(
                                    (action.result.content ?? [])
                                        .filter((part) => part.type === 'text')
                                        .map((part) => part.text ?? '')
                                        .join('\n'),
                                ),
                                snapshot: action.snapshot,
                            }),
                        },
                        ...(action.result.content ?? []).filter((part) => part.type === 'image'),
                    ],
                };
            },
        ),
        defineTool(
            'screencaster_screenshot',
            TOOL_DESCRIPTIONS.screencaster_screenshot,
            screenshotOptionsSchema.extend({name: artifactName.optional()}),
            async (input) => {
                const selected = current();
                const artifact = await selected.screenshot(input);
                const png = await fs.readFile(path.join(selected.directory, artifact.path));
                const preview = await imagePreview(png);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({...artifact, preview: preview.dimensions}),
                        },
                        preview.image,
                    ],
                };
            },
        ),
        defineTool(
            'screencaster_finish',
            TOOL_DESCRIPTIONS.screencaster_finish,
            z.object({}).strict(),
            (_input, signal) => current().finish(signal),
        ),
        defineTool(
            'screencaster_resolve',
            TOOL_DESCRIPTIONS.screencaster_resolve,
            z
                .object({
                    id: z.number().int().positive(),
                    outcome: z.enum(['applied', 'not-applied']),
                    evidence: z.string().trim().min(1).max(MAX_COMPLETION_EVIDENCE_CHARS),
                })
                .strict(),
            (input) => current().resolveAction(input.id, input.outcome, input.evidence),
        ),
        defineTool(
            'screencaster_export',
            TOOL_DESCRIPTIONS.screencaster_export,
            z
                .object({
                    name: artifactName,
                    highlights: z.boolean().optional(),
                    outline: outlineStyleSchema.optional(),
                })
                .strict(),
            (input, signal) => current().exportVideo({...input, signal}),
        ),
        defineTool(
            'screencaster_narrate',
            TOOL_DESCRIPTIONS.screencaster_narrate,
            z
                .object({
                    input: artifactName,
                    output: artifactName,
                    phrases: z.array(
                        z
                            .object({
                                id: z.number().int().positive(),
                                text: z.string(),
                                captionText: z.string().optional(),
                                actionId: z.number().int().positive().optional(),
                                startMs: z.number().nonnegative().optional(),
                                holdAtMs: z.number().nonnegative().optional(),
                            })
                            .strict(),
                    ),
                    captions: z.boolean().optional(),
                    outline: outlineStyleSchema.optional(),
                    maxHoldSeconds: z.number().min(0).max(5).optional(),
                })
                .strict(),
            async (input, signal) => {
                const result = await narrateVideo({
                    ...input,
                    input: local(input.input),
                    output: local(input.output),
                    provider: options.tts,
                    signal,
                });
                await current().registerExport(input.output);
                return result;
            },
        ),
        defineTool(
            'screencaster_edit',
            TOOL_DESCRIPTIONS.screencaster_edit,
            z
                .object({
                    input: artifactName,
                    output: artifactName,
                    cuts: editorialCutsSchema,
                    highlights: z.boolean().optional(),
                    outline: outlineStyleSchema.optional(),
                })
                .strict(),
            async (input, signal) => {
                const result = await editVideo({
                    ...input,
                    input: local(input.input),
                    output: local(input.output),
                    signal,
                });
                await current().registerExport(input.output);
                return result;
            },
        ),
        defineTool(
            'screencaster_clip',
            TOOL_DESCRIPTIONS.screencaster_clip,
            clipOptionsSchema.safeExtend({input: artifactName, output: artifactName}),
            async (input, signal) => {
                const selected = current();
                const result = await exportClip({
                    ...input,
                    input: local(input.input),
                    output: local(input.output),
                    signal,
                });
                await selected.registerExport(input.output);
                return result;
            },
        ),
        defineTool(
            'screencaster_edit_proposal',
            TOOL_DESCRIPTIONS.screencaster_edit_proposal,
            z.object({stepId: z.number().int().positive(), proposal: editProposalSchema}).strict(),
            async (input) => {
                const result = current().proposeEdit(input.stepId, input.proposal);
                await current().flush();
                return result;
            },
        ),
        defineTool(
            'screencaster_captions',
            TOOL_DESCRIPTIONS.screencaster_captions,
            z
                .object({input: artifactName, output: artifactName, cues: z.array(captionSchema)})
                .strict(),
            async (input) => {
                const result = await exportCaptions({
                    input: local(input.input),
                    output: local(input.output),
                    cues: input.cues,
                });
                await current().registerExport(input.output);
                return result;
            },
        ),
        defineTool(
            'screencaster_preview',
            TOOL_DESCRIPTIONS.screencaster_preview,
            z
                .object({name: artifactName, title: z.string(), subtitle: z.string().optional()})
                .strict(),
            (input) => current().preview(input),
        ),
        defineTool(
            'screencaster_illustrations_analyze',
            TOOL_DESCRIPTIONS.screencaster_illustrations_analyze,
            z.object({job: illustrationJobSchema, output: artifactName}).strict(),
            async (input, signal) => {
                const analysis = await analyzeRunIllustrations(current(), input, signal);
                const content: Array<
                    {type: 'text'; text: string} | {type: 'image'; mimeType: string; data: string}
                > = [{type: 'text', text: JSON.stringify(analysis)}];
                if (analysis.preview) {
                    content.push(
                        (await imagePreview(await fs.readFile(analysis.preview.path))).image,
                    );
                }
                return {content};
            },
        ),
        defineTool(
            'screencaster_illustrations_produce',
            TOOL_DESCRIPTIONS.screencaster_illustrations_produce,
            z
                .object({
                    analysis: artifactName,
                    output: artifactName,
                    confirmation: illustrationProductionSchema.shape.confirmation,
                })
                .strict(),
            (input, signal) => produceRunIllustrations(current(), input, signal),
        ),
        defineTool(
            'screencaster_state',
            TOOL_DESCRIPTIONS.screencaster_state,
            z.object({}).strict(),
            () => ({directory: current().directory, ...current().manifest}),
        ),
    ];
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: specs.map(({invoke: _invoke, ...spec}) => spec),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        try {
            const spec = specs.find((tool) => tool.name === request.params.name);
            if (!spec) {
                throw new Error(UNKNOWN_SCREENCASTER_TOOL);
            }
            const signal = AbortSignal.any([extra.signal, shutdown.signal]);
            const invoke = () => {
                if (closing) {
                    throw new Error(THE_SCREENCASTER_SERVER_IS_CLOSING);
                }
                signal.throwIfAborted();
                return spec.invoke(request.params.arguments ?? {}, signal);
            };
            // One owned session: state changes and exports finish before the next command starts.
            // Status/help remain available while a long media operation is in progress.
            const passive = ['screencaster_help', 'screencaster_state'].includes(spec.name);
            const resultPromise = passive ? invoke() : operation.then(invoke, invoke);
            if (!passive) {
                operation = resultPromise.catch(() => {});
            }
            const result = await resultPromise;
            if (result && typeof result === 'object' && 'content' in result) {
                return CallToolResultSchema.parse(result);
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result ?? null),
                    },
                ],
            };
        } catch (error) {
            return toolError(error);
        }
    });
    const closeOwnedSession = () => {
        closing = true;
        shutdown.abort(new Error(SCREENCASTER_SERVER_CLOSED));
        closePromise ??= (async () => {
            const abort = run?.manifest.status === 'running' ? run.abort() : undefined;
            const results = await Promise.allSettled([operation, abort]);
            await opening?.catch(() => {});
            if (run?.manifest.status === 'running') {
                await run.abort();
            }
            if (results[1].status === 'rejected') {
                throw results[1].reason;
            }
        })();
        return closePromise;
    };
    server.onclose = () => {
        closeOwnedSession().catch(() => {});
    };
    return {
        server,
        close: async () => {
            try {
                await closeOwnedSession();
            } finally {
                await server.close();
            }
        },
    };
}

export async function serveStdio(options: ServerOptions) {
    const runtime = createMcpServer(options);
    await runtime.server.connect(new StdioServerTransport());
    return runtime;
}
