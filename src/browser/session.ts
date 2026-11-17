import type {BrowserPreferences} from './preferences.js';
import type {McpResult} from '../transport/mcp/types.js';
import type {MediaActivity, MediaClock} from '../media/recording/journal.js';
import type {BrowserObserver} from './observations.js';
import type {BrowserPolicy} from './policy.js';
import type {ScreenshotOptions} from './capture/screenshot.js';
import type {ScreenshotCapturePolicy} from './capture/capture-policy.js';
import type {HostAuthenticator} from './host-auth.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';

import {PRIVATE_FILE_MODE} from '../shared/config.js';
import {
    sanitizeForModel,
    sanitizeSnapshotForModel,
    sanitizeToolResultForModel,
} from '../shared/sanitize-for-model.js';

import {snapshotFragment, snapshotFragmentArgs} from './snapshot/snapshot-fragment.js';
import {ARIA_REF_ARGUMENT_PATTERN as REF_PATTERN} from './patterns.js';
import {READ_TOOLS} from './config.js';
import {
    AMBIGUOUS_HOST_AUTH_STATE,
    A_CAPTURE_SESSION_MAY_BE_STARTED_ONLY_ONCE,
    BROWSER_STORAGE_IS_UNAVAILABLE,
    REDACTION_REQUIRES_NETWORK_GUARD,
    VIDEO_WITH_DOM_REDACTION_UNSUPPORTED,
} from './messages.js';
import {extractUrlFromSnapshot} from './snapshot/url.js';
import {ToolDispatchRejectedError} from './errors/tool-dispatch-rejected-error.js';
import {PartialFormFillError} from './errors/partial-form-fill-error.js';
import {ActionObservationError} from './errors/action-observation-error.js';
import {NavigationDialogPendingError} from './errors/navigation-dialog-pending-error.js';
import {BrowserRuntime} from './runtime.js';
import {browserPreferencesSchema} from './preferences.js';
import {authenticateWithHost} from './host-auth.js';
import {prepareScreenshotCapturePolicy} from './capture/capture-policy.js';
import {HostAuthenticationChallengeError} from './errors/host-auth-challenge-error.js';
import {createBrowserPolicy, createCapturePolicy} from './policy.js';
import {BrowserActionError} from './outcome.js';
import {backgroundClickArgs} from './interaction/background-click.js';
import {inputVerificationArgs} from './interaction/input-evidence.js';

export type BrowserSessionOptions = BrowserPreferences & {
    url: string;
    policy?: BrowserPolicy;
    headless?: boolean;
    storageStatePath?: string;
    screenshotPolicy?: ScreenshotCapturePolicy;
    authentication?: HostAuthenticator;
    signal?: AbortSignal;
    viewport?: {width: number; height: number};
    deviceScaleFactor?: number;
    videoDir?: string;
    observers?: readonly BrowserObserver[];
    onActivity?: (activity?: MediaActivity) => void;
    onClock?: (clock?: MediaClock) => void;
};
export type BrowserObservation = {
    result: NonNullable<McpResult>;
    snapshot: string;
    target?: MediaActivity['target'];
};

// CaptureRun and the consumer use this same runtime. This facade exposes
// structured receipts to local agents; application-specific checks stay outside.
export class BrowserSession extends BrowserRuntime {
    private readonly options: BrowserSessionOptions;
    private started = false;
    private recordingActive = false;
    private aborted = false;
    private activityCount = 0;
    private latestActivity?: MediaActivity;

    constructor(options: BrowserSessionOptions) {
        browserPreferencesSchema.parse({locale: options.locale, colorScheme: options.colorScheme});
        const screenshotPolicy = options.screenshotPolicy
            ? prepareScreenshotCapturePolicy(options.screenshotPolicy)
            : undefined;
        const redaction = Boolean(
            screenshotPolicy?.redaction?.replacements.length ||
            screenshotPolicy?.redaction?.hide.length ||
            screenshotPolicy?.requireRedaction,
        );
        const policy =
            options.policy ??
            (redaction ? createCapturePolicy(options.url) : createBrowserPolicy(options.url));
        if (redaction && !policy.guardOptions) {
            throw new Error(REDACTION_REQUIRES_NETWORK_GUARD);
        }
        super({
            policy,
            observers: options.observers,
            deviceScaleFactor: options.deviceScaleFactor,
            screenshotPolicy,
        });
        this.options = {...options, screenshotPolicy};
        this.setMediaActivityObserver((activity) => {
            if (!this.recordingActive) {
                return;
            }
            if (activity) {
                this.activityCount++;
                this.latestActivity = activity;
            }
            options.onActivity?.(activity);
        });
        this.setMediaClockObserver((clock) => options.onClock?.(clock));
    }

    async start() {
        if (this.started) {
            throw new Error(A_CAPTURE_SESSION_MAY_BE_STARTED_ONLY_ONCE);
        }
        this.started = true;
        if (
            this.options.videoDir &&
            (this.options.screenshotPolicy?.redaction ||
                this.options.screenshotPolicy?.requireRedaction)
        ) {
            throw new Error(VIDEO_WITH_DOM_REDACTION_UNSUPPORTED);
        }
        const signal = this.options.signal;
        signal?.throwIfAborted();
        const abort = () => {
            this.abort().catch(() => {});
        };
        signal?.addEventListener('abort', abort, {once: true});
        let startupAttempted = false;
        try {
            let storageStatePath = this.options.storageStatePath;
            if (this.options.authentication) {
                if (storageStatePath) {
                    throw new Error(AMBIGUOUS_HOST_AUTH_STATE);
                }
                const result = await authenticateWithHost({
                    targetUrl: this.options.url,
                    policy: this.policy,
                    authentication: this.options.authentication,
                    signal,
                });
                if (result.status === 'challenge') {
                    throw new HostAuthenticationChallengeError(result);
                }
                storageStatePath = result.storageStatePath;
            }
            signal?.throwIfAborted();
            startupAttempted = true;
            await super.start({
                ...this.options,
                storageStatePath,
                targetUrl: this.options.url,
                locale: this.options.locale,
            });
            signal?.throwIfAborted();
            await this.goto(this.options.url);
            signal?.throwIfAborted();
            this.recordingActive = true;
        } catch (error) {
            if (startupAttempted) {
                await this.stop().catch(() => {});
            } else {
                await this.abort().catch(() => {});
            }
            throw error;
        } finally {
            signal?.removeEventListener('abort', abort);
        }
    }

    async availableTools() {
        const currentUrl = extractUrlFromSnapshot((await this.getSnapshot()).snapshot);
        const tools = [
            ...this.tools.map((tool) => {
                if (tool.name === 'browser_snapshot') {
                    return {...tool, inputSchema: z.toJSONSchema(snapshotFragmentArgs)};
                }
                if (tool.name === 'browser_click') {
                    return {
                        ...tool,
                        inputSchema: {
                            anyOf: [tool.inputSchema, z.toJSONSchema(backgroundClickArgs)],
                        },
                    };
                }
                return tool;
            }),
            {
                name: 'browser_verify_inputs',
                description:
                    'Compare requested values without rewriting fields or exposing actual sensitive values.',
                inputSchema: z.toJSONSchema(inputVerificationArgs),
            },
            {
                name: 'browser_scroll_to',
                description: 'Reveal an observed target without clicking.',
                inputSchema: z.toJSONSchema(
                    z.object({ref: z.string().regex(REF_PATTERN)}).strict(),
                ),
            },
        ];
        return tools.flatMap((tool) => {
            if (tool.name === 'browser_take_screenshot' && this.options.screenshotPolicy) {
                return [];
            }
            const permission = this.policy.describeTool(tool.name, currentUrl);
            if (!permission.allowed) {
                return [];
            }
            if (!permission.arguments) {
                return [tool];
            }
            return [
                {
                    ...tool,
                    inputSchema: {
                        allOf: [
                            tool.inputSchema,
                            {
                                anyOf: permission.arguments.map((args) => ({
                                    type: 'object',
                                    properties: {
                                        ...Object.fromEntries(
                                            Object.entries(args).map(([name, value]) => [
                                                name,
                                                {const: value},
                                            ]),
                                        ),
                                        ...('ref' in args ? {element: {type: 'string'}} : {}),
                                    },
                                    required: Object.keys(args),
                                    additionalProperties: false,
                                })),
                            },
                        ],
                    },
                },
            ];
        });
    }

    async snapshot(query: Record<string, unknown> = {}) {
        const parsed = snapshotFragmentArgs.parse(query);
        const {snapshot} = await this.getSnapshot();
        const sanitized = sanitizeSnapshotForModel(snapshot);
        return Object.keys(parsed).length
            ? JSON.stringify(snapshotFragment(sanitized, parsed))
            : sanitized;
    }

    async execute(
        name: string,
        args: Record<string, unknown>,
        signal?: AbortSignal,
    ): Promise<BrowserObservation> {
        signal?.throwIfAborted();
        const before = this.activityCount;
        const dispatchBefore = this.dispatchCount;
        const images: Array<{type: string; data: string; mimeType: string}> = [];
        const abort = () => {
            this.abort().catch(() => {});
        };
        signal?.addEventListener('abort', abort, {once: true});
        try {
            const reply = await this.callTool(name, args, (image) =>
                images.push({type: 'image', ...image}),
            );
            const snapshot = await this.snapshot();
            signal?.throwIfAborted();
            return {
                result: {
                    content: [{type: 'text', text: sanitizeToolResultForModel(reply)}, ...images],
                },
                snapshot,
                ...(this.activityCount > before && this.latestActivity?.target
                    ? {target: this.latestActivity.target}
                    : {}),
            };
        } catch (error) {
            if (error instanceof BrowserActionError) {
                throw error;
            }
            const refused = error instanceof ToolDispatchRejectedError;
            const passive = READ_TOOLS.has(name) || error instanceof NavigationDialogPendingError;
            const outcome = this.dispatches.failure(dispatchBefore, refused, passive);
            let message = 'Observation after dispatch failed; the action was not repeated';
            if (
                refused ||
                error instanceof PartialFormFillError ||
                error instanceof ActionObservationError ||
                error instanceof NavigationDialogPendingError
            ) {
                message = sanitizeForModel(error.message);
            } else if (outcome === 'not-dispatched') {
                message = 'Browser action was not dispatched';
            }
            throw new BrowserActionError(message, outcome, undefined, {cause: error});
        } finally {
            signal?.removeEventListener('abort', abort);
        }
    }

    screenshot(file: string, options: ScreenshotOptions = {}) {
        return this.takeScreenshot(file, options);
    }

    async saveStorageState(file: string) {
        const source = await this.snapshotStorageState();
        if (!source) {
            throw new Error(BROWSER_STORAGE_IS_UNAVAILABLE);
        }
        const destination = await fs.open(file, 'wx', PRIVATE_FILE_MODE);
        try {
            await destination.writeFile(await fs.readFile(source));
        } finally {
            await destination.close();
        }
    }

    async abort() {
        this.aborted = true;
        // The in-flight dispatch can still publish its final receipt after the
        // transport stops. Lifecycle state prevents any subsequent dispatch.
        await super.abort();
    }

    async close(): Promise<string | undefined> {
        if (!this.aborted) {
            await this.stop();
        }
        const file = this.getRecordedVideoFile();
        return this.options.videoDir && file ? path.join(this.options.videoDir, file) : undefined;
    }
}
