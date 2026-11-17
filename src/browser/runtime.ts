import type {Cookie} from 'playwright';
import type {McpResult} from '../transport/mcp/types.js';
import type {SnapshotResult, StartSessionParams} from './types.js';
import type {MediaActivity, MediaClock} from '../media/recording/journal.js';
import type {BrowserImage} from './images.js';
import type {BrowserObserver} from './observations.js';
import type {BrowserInputFile, FileInputTarget} from './interaction/input-file.js';
import type {BrowserPolicy} from './policy.js';
import type {ScreenshotCapturePolicy} from './capture/capture-policy.js';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Ajv2020} from 'ajv/dist/2020.js';

import {PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE} from '../shared/config.js';
import {McpStdioClient} from '../transport/mcp/client.js';
import {filterTopmostDialog} from '../shared/snapshot/parser.js';
import {isMissingTargetRef} from '../transport/mcp/native-failure.js';
import {type SnapshotPage, snapshotPage} from '../shared/snapshot/page.js';
import {hasNativeDialog, nativeDialogType} from '../shared/snapshot/modal-state.js';
import {createMediaStateHasher, recordedUiOperation} from '../shared/capture/ui-state.js';
import {McpToolError, extractFocusedInputRef, extractText} from '../transport/mcp/result.js';
import {registerSecret, sanitizeForModel} from '../shared/sanitize-for-model.js';
import {writePrivateJson} from '../shared/private-files.js';
import {summarizeReceipt} from '../transport/mcp/receipt.js';

import {
    BROWSER_CLOSE_TIMEOUT_MS,
    DEFAULT_TIMEOUT,
    MAX_OBSERVATION_DIAGNOSTICS,
    NATIVE_DIALOG_RECOVERY_TIMEOUT_MS,
} from './config.js';
import {snapshotFragment, snapshotFragmentArgs} from './snapshot/snapshot-fragment.js';
import {
    FORM_FILL_PREFLIGHT_JS,
    INJECT_COOKIES_JS,
    INJECT_CURSOR_JS,
    INPUT_PREFLIGHT_JS,
    IS_LABEL_NOT_INPUT_JS,
} from './scripts/index.js';
import {extractUrlFromSnapshot} from './snapshot/url.js';
import {captureBrowserClock} from './recording/clock.js';
import {ActionObservationError} from './errors/action-observation-error.js';
import {EvidenceUnavailableError} from './errors/evidence-unavailable-error.js';
import {PassiveObservationError} from './errors/passive-observation-error.js';
import {NavigationDialogPendingError} from './errors/navigation-dialog-pending-error.js';
import {SnapshotObservationError} from './errors/snapshot-observation-error.js';
import {BrowserContextLostError} from './errors/browser-context-lost-error.js';
import {
    TargetLookupRejectedError,
    ToolDispatchRejectedError,
} from './errors/tool-dispatch-rejected-error.js';
import {PartialFormFillError} from './errors/partial-form-fill-error.js';
import {forwardBrowserImage} from './images.js';
import {driverScript, observerScript} from './scripts/driver-script.js';
import {
    ARIA_REF_ARGUMENT_PATTERN,
    ARIA_REF_VALUE_PATTERN,
    CHECKABLE_NODE_PATTERN,
    CHECKPOINT_OBSERVED_RESULT_PATTERN,
    DIALOG_REF_PATTERN,
    FILE_CHOOSER_MODAL_PATTERN,
    CONTROL_HINTS_MCP_RESULT_BLOCK_PATTERN as MCP_ANYWHERE_RESULT_BLOCK_PATTERN,
    MCP_RESULT_BLOCK_PATTERN as MCP_LEADING_RESULT_BLOCK_PATTERN,
    MCP_LEADING_RESULT_LINE_PATTERN,
    RUNTIME_MCP_RESULT_BLOCK_PATTERN as MCP_RESULT_BLOCK_PATTERN,
    MCP_RESULT_LINE_PATTERN,
    NATIVE_CHECKABLE_ACTION_PATTERN,
    NOT_EDITABLE_RESULT_PATTERN,
    PAGE_VERIFIED_RESULT_PATTERN,
    RUNTIME_REF_ATTRIBUTE_PATTERN as REF_ATTRIBUTE_PATTERN,
    REQUEST_GUARD_FAILURE_RESULT_PATTERN,
    REQUEST_GUARD_HEALTH_RESULT_PATTERN,
    REQUEST_GUARD_READY_RESULT_PATTERN,
    SNAPSHOT_SECTION_PATTERN,
} from './patterns.js';
import {
    A_HIGHLIGHTED_OR_ELEMENT_SCREENSHOT_REQUIRES_AN_EXACT,
    BROWSER_CLOSURE_COULD_NOT_BE_CONFIRMED,
    BROWSER_OBSERVATION_UNAVAILABLE,
    CANNOT_DETERMINE_MODAL_DIALOG_STATE,
    CANNOT_DISMISS_THE_NATIVE_FILE_CHOOSER,
    CONCURRENT_BROWSER_ACTION,
    CONCURRENT_EXAMPLE_FILE_UPLOAD_IS_NOT_ALLOWED,
    CONCURRENT_GENERATED_PASSWORD_FILL_IS_NOT_ALLOWED,
    DEVICE_SCALE_FACTOR_MUST_BE_POSITIVE_AND_FINITE,
    EXAMPLE_UPLOAD_REQUIRES_A_STARTED_BROWSER_SESSION,
    EXAMPLE_UPLOAD_REQUIRES_A_TRUSTED_PREPARED_FILE_AND,
    GENERATED_PASSWORD_FILL_REQUIRES_AN_AUTHORIZED_TARGET_APPLICATION,
    GENERATED_PASSWORD_WAS_NOT_FILLED_IN_AN_EDITABLE,
    INDEPENDENT_PAGE_VERIFICATION_FAILED_URL_OR_VISIBLE_HEADING,
    INPUT_FOCUS_OUTCOME_COULD_NOT_BE_ESTABLISHED,
    INPUT_OBSERVATION_FAILED,
    INVALID_INPUT_REFERENCE_OR_TEXT,
    INVALID_NATIVE_CONTROL_ACTIVATION_RESULT,
    INVALID_SCROLL_TARGET_REFERENCE,
    PAGE_CHANGED_DURING_INPUT_OBSERVATION,
    PAGE_KEPT_CHANGING_WHILE_INSPECTING_DIALOGS_A_STABLE,
    PREPARED_EXAMPLE_FILE_UPLOAD_FAILED,
    READ_ONLY_REQUEST_GUARD_WAS_NOT_INSTALLED,
    RECORDING_IDENTITY_COULD_NOT_BE_CONFIRMED,
    RECORDING_IDENTITY_UNAVAILABLE,
    REDACTION_REQUIRES_NETWORK_GUARD,
    SCREENSHOT_REQUIRES_A_STARTED_BROWSER,
    UNRECOGNIZED_FORM_FILL_INSPECTION_RESULT,
    UPLOAD_CONTROL_DID_NOT_OPEN_A_USABLE_FILE,
    USE_POLICY_CHECKED_SCREENSHOT,
    VIDEO_WITH_DOM_REDACTION_UNSUPPORTED,
} from './messages.js';
import {DEFAULT_VIEWPORT, MCP_NAVIGATION_TIMEOUT_MS} from './constants.js';
import {captureScreenshot} from './capture/capture-screenshot.js';
import {prepareScreenshotCapturePolicy} from './capture/capture-policy.js';
import {ensureDriverBrowserInstalled} from './browser-installation.js';
import {
    type ScreenshotMetadata,
    type ScreenshotOptions,
    screenshotOptionsSchema,
} from './capture/screenshot.js';
import {
    type PreparedActionTarget,
    actionTargetCode,
    decodePreparedActionTarget,
} from './capture/action-target.js';
import {RuntimeState} from './runtime-state.js';
import {DialogState} from './dialog-state.js';
import {DispatchState} from './dispatch-state.js';
import {BrowserContextGuard} from './browser-context-guard.js';
import {
    EvidenceFailureLog,
    EvidenceObservationError,
    decodeEvidenceObservation,
} from './evidence-diagnostics.js';
import {requestGuardScript} from './request-guard.js';
import {addControlHints} from './interaction/control-hints.js';
import {obstructionSnapshotLabels} from './interaction/obstruction-labels.js';
import {rejectBlockedInteraction} from './interaction/interaction-readiness.js';
import {
    backgroundClickCandidates,
    backgroundClickCode,
    backgroundClickRef,
    backgroundClickResult,
} from './interaction/background-click.js';
import {
    type InputEvidence,
    type InputExpectation,
    type InputObservation,
    inputEvidenceCode,
    inputVerificationArgs,
    parseInputEvidence,
    validateInputExpectations,
} from './interaction/input-evidence.js';
import {revealTargetCode} from './interaction/reveal-target.js';
import {BrowserObservations} from './observations.js';
import {type BrowserPreferences, browserPreferencesSchema} from './preferences.js';
import {assertInputFile} from './interaction/input-file.js';

const CANCEL_TRANSITION_DIALOG_HINT = [
    'The URL changed during the verified initiating action: only accept=false is permitted to cancel this transition.',
    'After cancellation inspect a fresh verified page; do not assume the draft was saved or repeat the initiating action.',
].join(' ');

const require = createRequire(import.meta.url);
function hasFileChooser(snapshot: string): boolean {
    return FILE_CHOOSER_MODAL_PATTERN.test(snapshot.split('### Snapshot')[0]);
}
export type PageCheckpoint = {
    id: string;
    url: string;
    role: 'heading' | 'dialog' | 'menu' | 'button' | 'link';
    name: string;
};
export type RuntimeStartOptions = StartSessionParams & BrowserPreferences & {userAgent?: string};
export type BrowserRuntimeOptions = {
    policy: BrowserPolicy;
    artifactDirectory?: string;
    deviceScaleFactor?: number;
    cursor?: boolean;
    blockedOrigins?: string[];
    observers?: readonly BrowserObserver[];
    screenshotPolicy?: ScreenshotCapturePolicy;
};

export class BrowserRuntime {
    protected client: McpStdioClient;
    protected readonly policy: BrowserPolicy;
    protected readonly contextGuard: BrowserContextGuard;
    protected targetUrl: string | undefined;
    protected outputDir: string | undefined;
    protected videoDir: string | undefined;
    protected recordedVideoFile: string | undefined;
    protected mcpStopped = false;
    protected readonly lifecycle = new RuntimeState();
    protected readonly dialogs = new DialogState();
    protected readonly dispatches = new DispatchState();
    protected tools: Array<{
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
    }> = [];
    protected get dispatchCount() {
        return this.dispatches.count;
    }
    private startup?: Promise<void>;
    private abortPromise?: Promise<void>;
    private modelCallActive = false;
    private stopPromise: Promise<void> | undefined;
    private requestGuardObservation = '';
    private exampleUpload: BrowserInputFile | undefined;
    private generatedPassword: string | undefined;
    private fileChooserDismissed = false;
    private readonly observationsFile: string | undefined;
    private observationDiagnostics: Array<Record<string, unknown>> = [];
    private readonly evidenceFailures: EvidenceFailureLog;
    private mediaClockObserver: ((value?: MediaClock) => void) | undefined;
    private mediaActivityObserver: ((activity?: MediaActivity) => void) | undefined;
    private observations?: BrowserObservations;
    private readonly validators = new Map<string, ReturnType<Ajv2020['compile']>>();
    private readonly runtimeOptions: BrowserRuntimeOptions;
    private readonly stateHash = createMediaStateHasher();
    private lastSnapshot = '';
    private actionBeforeSnapshot = '';
    private activities: MediaActivity[] | undefined;

    constructor(options: BrowserRuntimeOptions) {
        if (
            options.deviceScaleFactor !== undefined &&
            (!Number.isFinite(options.deviceScaleFactor) || options.deviceScaleFactor <= 0)
        ) {
            throw new Error(DEVICE_SCALE_FACTOR_MUST_BE_POSITIVE_AND_FINITE);
        }
        const screenshotPolicy = options.screenshotPolicy
            ? prepareScreenshotCapturePolicy(options.screenshotPolicy)
            : undefined;
        if (
            (screenshotPolicy?.redaction?.replacements.length ||
                screenshotPolicy?.redaction?.hide.length ||
                screenshotPolicy?.requireRedaction) &&
            !options.policy.guardOptions
        ) {
            throw new Error(REDACTION_REQUIRES_NETWORK_GUARD);
        }
        for (const replacement of screenshotPolicy?.redaction?.replacements ?? []) {
            registerSecret(replacement.from);
        }
        this.runtimeOptions = {...options, screenshotPolicy};
        this.policy = options.policy;
        this.client = new McpStdioClient({
            onDiagnostic: (event) => this.recordObservationDiagnostic(event),
        });
        this.contextGuard = new BrowserContextGuard(this.client, () =>
            this.lifecycle.loseContext(),
        );
        this.observationsFile = options.artifactDirectory
            ? path.join(options.artifactDirectory, 'browser-observations.json')
            : undefined;
        this.evidenceFailures = new EvidenceFailureLog(
            options.artifactDirectory
                ? path.join(options.artifactDirectory, 'browser-evidence-failures.json')
                : undefined,
        );
    }

    get phase() {
        return this.lifecycle.phase;
    }

    async start(opts: RuntimeStartOptions = {}) {
        browserPreferencesSchema.parse({locale: opts.locale, colorScheme: opts.colorScheme});
        if (
            opts.videoDir &&
            (this.runtimeOptions.screenshotPolicy?.redaction ||
                this.runtimeOptions.screenshotPolicy?.requireRedaction)
        ) {
            throw new Error(VIDEO_WITH_DOM_REDACTION_UNSUPPORTED);
        }
        this.lifecycle.start(this.client.isStopped());
        this.dialogs.invalidate();
        this.stopPromise = undefined;
        this.abortPromise = undefined;
        this.mcpStopped = false;
        this.startup = this.initializeBrowser(opts);
        try {
            await this.startup;
            this.lifecycle.ready();
        } catch (error) {
            if (
                this.phase !== 'stopping' &&
                this.phase !== 'aborting' &&
                this.phase !== 'aborted'
            ) {
                await this.stop().catch(() => {});
                this.lifecycle.settle('failed');
            }
            throw error;
        } finally {
            this.startup = undefined;
        }
    }

    async stop(options: {preserveTemporaryFiles?: boolean} = {}) {
        if (this.abortPromise) {
            return this.abortPromise;
        }
        if (!this.stopPromise) {
            this.lifecycle.stopping();
        }
        this.stopPromise ??= (async () => {
            await this.startup?.catch(() => {});
            try {
                await this.stopBrowser();
                this.lifecycle.settle('stopped');
            } catch (error) {
                this.lifecycle.settle('failed');
                throw error;
            }
        })();
        try {
            await this.stopPromise;
        } finally {
            if (this.mcpStopped && this.outputDir && !options.preserveTemporaryFiles) {
                fs.rmSync(this.outputDir, {recursive: true, force: true});
                this.outputDir = undefined;
            }
        }
    }

    async abort(): Promise<void> {
        if (this.abortPromise) {
            return this.abortPromise;
        }
        this.lifecycle.aborting();
        this.abortPromise ??= (async () => {
            try {
                // A start in progress must settle before the final transport stop;
                // otherwise the client could spawn after a completed early stop.
                await this.client.stop().catch(() => {});
                await this.startup?.catch(() => {});
                await this.stopMcp();
                this.lifecycle.settle('aborted');
            } catch (error) {
                this.lifecycle.settle('failed');
                throw error;
            } finally {
                if (this.mcpStopped && this.outputDir) {
                    fs.rmSync(this.outputDir, {recursive: true, force: true});
                    this.outputDir = undefined;
                }
            }
        })();
        return this.abortPromise;
    }

    getRecordedVideoFile(): string | undefined {
        return this.recordedVideoFile;
    }
    isTargetUrl(url: string, _targetUrl = this.targetUrl): boolean {
        return this.policy.allows(url, 'read');
    }
    async takeScreenshot(
        file: string,
        options: ScreenshotOptions = {},
    ): Promise<ScreenshotMetadata> {
        const capture = screenshotOptionsSchema.parse(options);
        if ((capture.highlight || capture.area === 'element') && !capture.ref) {
            throw new Error(A_HIGHLIGHTED_OR_ELEMENT_SCREENSHOT_REQUIRES_AN_EXACT);
        }
        this.contextGuard.assertKnownContext();
        this.policy.assertTool(
            'browser_take_screenshot',
            {},
            extractUrlFromSnapshot((await this.getSnapshot()).snapshot),
        );
        if (!this.outputDir) {
            throw new Error(SCREENSHOT_REQUIRES_A_STARTED_BROWSER);
        }
        return captureScreenshot(
            {
                outputDirectory: this.outputDir,
                policy: this.runtimeOptions.screenshotPolicy,
                execute: (code) => this.internal(code),
                snapshot: () => this.getSnapshot(),
            },
            file,
            capture,
        );
    }

    async collectObservations(): Promise<void> {
        await this.observations?.collect();
    }

    setMediaClockObserver(observer: (value?: MediaClock) => void) {
        this.mediaClockObserver = observer;
    }

    setMediaActivityObserver(observer: (activity?: MediaActivity) => void) {
        this.mediaActivityObserver = observer;
    }

    async captureMediaClock(final = false) {
        if (!this.videoDir || !this.mediaClockObserver) {
            return;
        }
        this.contextGuard.assertKnownContext();
        try {
            await this.contextGuard.check();
            const value = await captureBrowserClock(this.client, this.videoDir, final);
            if (value) {
                this.recordedVideoFile = value.recording;
                this.recordObservationDiagnostic({kind: 'recording-clock', ...value, final});
                this.mediaClockObserver(value);
            }
        } catch (error) {
            this.mediaClockObserver(undefined);
            if (error instanceof BrowserContextLostError) {
                throw error;
            }
        }
    }

    hasPendingNativeDialog(): boolean {
        return this.dialogs.pending;
    }

    async addCookies(url: string, cookieHeader: string) {
        this.lifecycle.assertUsable();
        this.contextGuard.assertKnownContext();
        const cookies = parseCookieHeader(cookieHeader, url);
        // eslint-disable-next-line new-cap
        const script = INJECT_COOKIES_JS(cookies);
        await this.client.callTool('browser_navigate', {url});
        const res = (await this.client.callTool('browser_evaluate', {
            function: script,
        })) as McpResult;
        return extractText(res) || `ok: ${cookies.length} cookies`;
    }

    async goto(url: string) {
        this.policy.assertUrl(url, 'read');
        await this.track('interaction', 'browser_navigate', () =>
            this.client.callTool('browser_navigate', {url}),
        );
        await this.getSnapshot();
        await this.injectFakeCursor();
        await this.captureMediaClock();
    }

    async verifyPage(expected: {url: string; heading: string}): Promise<void> {
        this.policy.assertUrl(expected.url, 'read');
        await this.getSnapshot();
        const result = await this.client.callTool('browser_run_code', {
            code: driverScript('verify-page', {expected: expected}),
        });
        if (!PAGE_VERIFIED_RESULT_PATTERN.test(extractText(result as McpResult))) {
            throw new Error(INDEPENDENT_PAGE_VERIFICATION_FAILED_URL_OR_VISIBLE_HEADING);
        }
    }

    async observeCheckpoint(expected: PageCheckpoint, waitMs = 0): Promise<boolean> {
        this.policy.assertUrl(expected.url, 'read');
        await this.getSnapshot();
        const result = await this.client.callTool('browser_run_code', {
            code: driverScript('observe-checkpoint', {
                expected: expected,
                waitMs_0: waitMs > 0,
                waitMs: waitMs,
            }),
        });
        return CHECKPOINT_OBSERVED_RESULT_PATTERN.test(extractText(result as McpResult));
    }

    async verifyRequestGuard(): Promise<void> {
        if (!this.policy.guardOptions) {
            return;
        }
        const result = await this.client.callTool('browser_run_code', {
            code: driverScript('check-request-guard'),
        });
        const healthy = REQUEST_GUARD_HEALTH_RESULT_PATTERN.exec(extractText(result as McpResult));
        if (healthy) {
            this.requestGuardObservation = healthy.slice(1).some((count) => Number(count) > 0)
                ? '\n' +
                  '\n' +
                  '### Local network policy observation\n' +
                  'Read-only policy blocked requests=' +
                  `${healthy[1]}` +
                  ', redirects=' +
                  `${healthy[2]}` +
                  ', websockets=' +
                  `${healthy[3]}` +
                  ' since this browser context started. These are local policy decisions, not server errors. They ' +
                  'may concern optional requests or earlier pages and do not alone prove why current content is ' +
                  'unavailable. Do not bypass policy or infer a service outage from a blocked request. Evaluate the ' +
                  'requested content normally.'
                : '';
        } else {
            const diagnostic = REQUEST_GUARD_FAILURE_RESULT_PATTERN.exec(
                extractText(result as McpResult),
            );
            throw new Error(
                'Read-only network guard failed; request aborted (HTTP details withheld)' +
                    (diagnostic ? `; phase=${diagnostic[1]}, category=${diagnostic[2]}` : ''),
            );
        }
    }

    async getSnapshot(): Promise<SnapshotResult> {
        this.contextGuard.assertKnownContext();
        const read = async () => {
            try {
                const snapshot = await this.readSnapshot();
                // MCP blocks run_code while a native dialog/file chooser is pending.
                // Only its dedicated modal tool can proceed; check continuity after it clears.
                if (!hasNativeDialog(snapshot.snapshot) && !hasFileChooser(snapshot.snapshot)) {
                    await this.contextGuard.check();
                }
                this.lastSnapshot = snapshot.snapshot;
                return snapshot;
            } catch (error) {
                return await this.contextGuard.checkAfterFailure(error);
            }
        };
        try {
            return await read();
        } catch (error) {
            if (!(error instanceof SnapshotObservationError)) {
                throw error;
            }
            this.recordObservationDiagnostic({kind: 'snapshot-retry', reason: error.reason});
            return read();
        }
    }

    async fillGeneratedPassword(target: {element: string; ref: string}, value: string) {
        if (this.generatedPassword !== undefined) {
            throw new Error(CONCURRENT_GENERATED_PASSWORD_FILL_IS_NOT_ALLOWED);
        }
        registerSecret(value);
        this.generatedPassword = value;
        try {
            await this.callTool('browser_fill_generated_password', target);
        } catch (error) {
            if (
                error instanceof ActionObservationError ||
                error instanceof BrowserContextLostError
            ) {
                throw error;
            }
            throw new Error(
                sanitizeForModel(error instanceof Error ? error.message : 'Password fill failed'),
            );
        } finally {
            this.generatedPassword = undefined;
        }
    }

    async uploadFile(target: FileInputTarget, file: BrowserInputFile) {
        if (this.exampleUpload) {
            throw new Error(CONCURRENT_EXAMPLE_FILE_UPLOAD_IS_NOT_ALLOWED);
        }
        if (!this.outputDir) {
            throw new Error(EXAMPLE_UPLOAD_REQUIRES_A_STARTED_BROWSER_SESSION);
        }
        assertInputFile(file);
        const directory = fs.mkdtempSync(path.join(this.outputDir, 'example-upload-'));
        fs.chmodSync(directory, PRIVATE_DIRECTORY_MODE);
        try {
            const copied = {...file, path: path.join(directory, path.basename(file.path))};
            fs.copyFileSync(file.path, copied.path);
            fs.chmodSync(copied.path, PRIVATE_FILE_MODE);
            assertInputFile(copied);
            this.exampleUpload = copied;
            if (target.representation === 'base64') {
                const result = await this.callTool('browser_type', {
                    element: target.element,
                    ref: target.ref,
                    text: fs.readFileSync(copied.path).toString('base64'),
                });
                return `Entered base64 of a generated ${'input'} example; sha256=${file.sha256}.\n${result}`;
            }
            const result = await this.callTool('browser_upload_example_file', target);
            return result.split(copied.path).join('[prepared example file]');
        } finally {
            this.exampleUpload = undefined;
            fs.rmSync(directory, {recursive: true, force: true});
        }
    }

    async observeInputs(expectations: InputExpectation[]): Promise<InputObservation> {
        const fields = validateInputExpectations(expectations);
        const before = await this.getSnapshot();
        this.policy.assertTool('browser_snapshot', {}, extractUrlFromSnapshot(before.snapshot));
        if (!fields.length) {
            return {evidence: [], snapshot: before};
        }
        const refs = new Set(
            [...before.snapshot.matchAll(REF_ATTRIBUTE_PATTERN)].map((match) => match[1]),
        );
        const present = fields.filter((field) => refs.has(field.ref));
        let observed: InputEvidence[] = [];
        const remainingRefs = new Set<string>();
        let after = before;
        try {
            if (present.length) {
                const result = (await this.client.callTool(
                    'browser_run_code',
                    {code: inputEvidenceCode(present)},
                    DEFAULT_TIMEOUT,
                )) as McpResult;
                if (!result || result.isError) {
                    throw new Error(INPUT_OBSERVATION_FAILED);
                }
                observed = parseInputEvidence(extractText(result), present);
            }
        } finally {
            after = await this.getSnapshot();
            this.policy.assertTool('browser_snapshot', {}, extractUrlFromSnapshot(after.snapshot));
            for (const match of after.snapshot.matchAll(REF_ATTRIBUTE_PATTERN)) {
                remainingRefs.add(match[1]);
            }
        }
        if (extractUrlFromSnapshot(before.snapshot) !== extractUrlFromSnapshot(after.snapshot)) {
            throw new Error(PAGE_CHANGED_DURING_INPUT_OBSERVATION);
        }
        const byRef = new Map(
            observed.filter((item) => remainingRefs.has(item.ref)).map((item) => [item.ref, item]),
        );
        return {
            evidence: fields.map(
                (field) => byRef.get(field.ref) ?? {ref: field.ref, status: 'unavailable'},
            ),
            snapshot: after,
        };
    }

    async callTool(
        name: string,
        args: Record<string, unknown>,
        onImage?: (image: BrowserImage) => void,
    ) {
        this.lifecycle.assertUsable();
        if (name === 'browser_take_screenshot' && this.runtimeOptions.screenshotPolicy) {
            throw new ToolDispatchRejectedError(USE_POLICY_CHECKED_SCREENSHOT);
        }
        if (this.modelCallActive) {
            throw new ToolDispatchRejectedError(CONCURRENT_BROWSER_ACTION);
        }
        this.contextGuard.assertKnownContext();
        this.validateModelArguments(name, args);
        this.modelCallActive = true;
        this.actionBeforeSnapshot = this.lastSnapshot;
        this.activities = [];
        try {
            await this.observations?.collect();
            return await this.callModelTool(name, args, onImage);
        } catch (error) {
            if (error instanceof NavigationDialogPendingError) {
                // MCP cannot run the continuity probe while the native dialog is
                // pending. The exact initiating page was checked; verify again
                // through the normal observation after the explicit dialog answer.
                throw error;
            }
            return await this.contextGuard.checkAfterFailure(error);
        } finally {
            this.modelCallActive = false;
            const before = this.actionBeforeSnapshot;
            const activities = this.activities ?? [];
            this.activities = undefined;
            for (const activity of activities) {
                this.mediaActivityObserver?.({
                    ...activity,
                    ...(activities.length === 1 && before && this.lastSnapshot
                        ? {
                              beforeState: this.stateHash(before),
                              afterState: this.stateHash(this.lastSnapshot),
                              uiOperation: recordedUiOperation(
                                  name,
                                  args,
                                  before,
                                  typeof args.ref === 'string' ? args.ref : undefined,
                              ),
                          }
                        : {}),
                });
            }
            await this.observations?.collect();
        }
    }

    async snapshotStorageState(): Promise<string | null> {
        if (!this.outputDir) {
            return null;
        }
        const file = path.resolve(this.outputDir, 'agent-storage-state.json');
        try {
            await this.client.callTool('browser_storage_state', {filename: file});
            return fs.existsSync(file) ? file : null;
        } catch {
            this.recordObservationDiagnostic({kind: 'storage-state', failed: true});
            return null;
        }
    }
    protected async afterStart(): Promise<void> {
        // Optional lifecycle hook for host-specific runtime subclasses.
    }
    protected async beforeClose(): Promise<void> {
        // Optional lifecycle hook; the base runtime owns the actual cleanup.
    }
    protected async checkPageContext(raw: string, _attempt: number): Promise<string | undefined> {
        return raw;
    }
    protected verifyApplicationUrl(_url: string): void {
        // Subclasses may impose application-specific checks beyond the browser policy.
    }
    protected isPageCheckError(_error: unknown): boolean {
        return false;
    }
    protected assertRequestedNavigation(url: string) {
        try {
            this.policy.assertUrl(url, 'read');
        } catch {
            throw new ToolDispatchRejectedError(
                'Browser policy rejected navigation before dispatch',
            );
        }
    }
    protected async restoreEntryAfterNavigation(
        _tool: string,
        _args: Record<string, unknown>,
        _entry: string | undefined,
        error: unknown,
    ): Promise<string> {
        throw error;
    }
    protected nativeDialogSnapshot(raw: string, _directReply = false): SnapshotResult | undefined {
        if (!hasNativeDialog(raw)) {
            return undefined;
        }
        this.policy.assertUrl(snapshotPage(raw).page.url, 'read');
        this.dialogs.observeNative(snapshotPage(raw).page);
        return {
            snapshot:
                raw.split(SNAPSHOT_SECTION_PATTERN, 1)[0] +
                '\nNative browser dialog is pending. Only browser_handle_dialog is available until it is resolved. ' +
                (this.dialogs.cancelOnly
                    ? CANCEL_TRANSITION_DIALOG_HINT
                    : 'Inspect the fresh page after answering.'),
            hasDialog: true,
        };
    }

    protected async snapshotText(): Promise<string> {
        const startedAt = Date.now();
        let result: McpResult;
        try {
            result = (await this.client.callTool('browser_snapshot', {})) as McpResult;
        } catch (error) {
            this.recordObservationDiagnostic({
                kind: 'snapshot',
                durationMs: Date.now() - startedAt,
                failure: 'transport',
            });
            if (
                this.isPageCheckError(error) ||
                (error instanceof Error && error.name === 'AbortError')
            ) {
                throw error;
            }
            throw new SnapshotObservationError('Fresh snapshot transport unavailable', 'transport');
        }
        if (!result || result.isError) {
            throw new SnapshotObservationError(
                'Fresh snapshot unavailable; no browser action was repeated',
                'mcp-error',
            );
        }
        let raw: string;
        try {
            raw = extractText(result);
        } catch {
            throw new SnapshotObservationError('Invalid snapshot response', 'invalid-response');
        }
        try {
            const normalized = snapshotPage(raw);
            raw = normalized.snapshot;
            const location = new URL(normalized.page.url);
            this.recordObservationDiagnostic({
                kind: 'snapshot',
                durationMs: Date.now() - startedAt,
                tabIndex: normalized.page.index,
                corrected: normalized.page.corrected,
                protocol: location.protocol,
                origin: location.origin,
                hasSnapshot: raw.includes('### Snapshot'),
            });
        } catch {
            throw new SnapshotObservationError(
                'Active page metadata is invalid',
                'invalid-response',
            );
        }
        if (!extractUrlFromSnapshot(raw)) {
            throw new SnapshotObservationError(
                'Fresh snapshot unavailable; no browser action was repeated',
                'no-http-page',
            );
        }
        return raw;
    }

    protected recordObservationDiagnostic(event: Record<string, unknown>) {
        if (!this.observationsFile) {
            return;
        }
        this.observationDiagnostics.push({at: new Date().toISOString(), ...event});
        this.observationDiagnostics = this.observationDiagnostics.slice(
            -MAX_OBSERVATION_DIAGNOSTICS,
        );
        try {
            writePrivateJson(this.observationsFile, {
                events: this.observationDiagnostics,
            });
        } catch {
            // Optional diagnostics never change the browser operation's outcome.
        }
    }
    private async initializeBrowser(opts: RuntimeStartOptions) {
        this.targetUrl = opts.targetUrl ?? this.targetUrl;
        this.videoDir = opts.videoDir ? path.resolve(opts.videoDir) : undefined;
        this.recordedVideoFile = undefined;
        this.outputDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'screencaster-mcp-'));
        this.outputDir = fs.realpathSync(this.outputDir);
        fs.chmodSync(this.outputDir, PRIVATE_DIRECTORY_MODE);
        const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
        const config = {
            outputDir: this.outputDir,
            timeouts: {navigation: MCP_NAVIGATION_TIMEOUT_MS},
            capabilities: ['storage'],
            browser: {
                isolated: true,
                launchOptions: {
                    headless: opts.headless !== false,
                    args: ['--enable-cursor-compositing'],
                },
                contextOptions: {
                    viewport,
                    deviceScaleFactor: this.runtimeOptions.deviceScaleFactor ?? 1,
                    ...(opts.userAgent ? {userAgent: opts.userAgent} : {}),
                    ...(opts.locale ? {locale: opts.locale} : {}),
                    ...(opts.colorScheme ? {colorScheme: opts.colorScheme} : {}),
                    ...(this.policy.guardOptions ? {serviceWorkers: 'block'} : {}),
                    ...(opts.storageStatePath
                        ? {storageState: path.resolve(opts.storageStatePath)}
                        : {}),
                    ...(this.videoDir ? {recordVideo: {dir: this.videoDir, size: viewport}} : {}),
                },
            },
            network: {
                ...(this.runtimeOptions.blockedOrigins
                    ? {blockedOrigins: this.runtimeOptions.blockedOrigins}
                    : {}),
                ...(this.policy.networkAllowedOrigins
                    ? {allowedOrigins: this.policy.networkAllowedOrigins}
                    : {}),
            },
        };
        const file = path.join(this.outputDir, 'config.json');
        fs.writeFileSync(file, JSON.stringify(config), {mode: PRIVATE_FILE_MODE});
        await this.client.start(
            process.execPath,
            [
                path.resolve(require.resolve('@playwright/mcp/package.json'), '../cli.js'),
                '--browser',
                'chromium',
                '--config',
                file,
            ],
            {cwd: this.outputDir},
        );
        this.lifecycle.assertStarting();
        await ensureDriverBrowserInstalled(this.client);
        this.lifecycle.assertStarting();
        await this.contextGuard.install();
        this.lifecycle.assertStarting();
        if (this.policy.guardOptions) {
            const result = await this.client.callTool('browser_run_code', {
                code: requestGuardScript(this.policy.guardOptions),
            });
            if (!REQUEST_GUARD_READY_RESULT_PATTERN.test(extractText(result as McpResult))) {
                throw new Error(READ_ONLY_REQUEST_GUARD_WAS_NOT_INSTALLED);
            }
        }
        const available = (await this.client.listTools()) as {
            tools: Array<{
                name: string;
                description?: string;
                inputSchema: Record<string, unknown>;
            }>;
        };
        this.tools = available.tools;
        this.validators.clear();
        const ajv = new Ajv2020({strict: false, allErrors: true});
        for (const tool of this.tools) {
            this.validators.set(tool.name, ajv.compile(tool.inputSchema));
        }
        this.observations = new BrowserObservations(this.runtimeOptions.observers ?? [], {
            runCode: (code) => this.runObservationCode(code),
        });
        await this.observations.install();
        if (this.runtimeOptions.cursor) {
            await this.injectFakeCursor();
        }
        this.lifecycle.assertStarting();
        await this.afterStart();
    }

    private async isOnTargetPage(): Promise<boolean> {
        const snapshot = await this.getSnapshot();
        return this.isTargetUrl(extractUrlFromSnapshot(snapshot.snapshot));
    }
    private async runObservationCode(code: string): Promise<unknown> {
        await this.contextGuard.check();
        const result = (await this.client.callTool('browser_run_code', {
            code: observerScript(code),
        })) as McpResult;
        const payload = MCP_RESULT_LINE_PATTERN.exec(extractText(result))?.[1];
        if (!result || result.isError || !payload) {
            throw new Error(BROWSER_OBSERVATION_UNAVAILABLE);
        }
        const decoded = JSON.parse(payload);
        return (typeof decoded === 'string' ? JSON.parse(decoded) : decoded).value;
    }
    private internal(code: string): Promise<McpResult> {
        return this.client.callTool('browser_run_code', {code}) as Promise<McpResult>;
    }

    private async stopBrowser(): Promise<void> {
        const failures: unknown[] = [];
        try {
            await this.beforeClose();
            await this.observations?.collect();
        } catch (error) {
            failures.push(error);
        }
        if (this.videoDir && this.outputDir) {
            try {
                await this.captureMediaClock(true);
                await this.contextGuard.check();
                const result = await this.internal(driverScript('read-recording-path'));
                const file: unknown = JSON.parse(
                    MCP_RESULT_LINE_PATTERN.exec(extractText(result))?.[1] ?? 'null',
                );
                if (result?.isError) {
                    throw new Error(RECORDING_IDENTITY_UNAVAILABLE);
                }
                if (
                    typeof file !== 'string' ||
                    path.dirname(path.resolve(file)) !== this.videoDir ||
                    path.extname(file) !== '.webm'
                ) {
                    throw new Error(RECORDING_IDENTITY_COULD_NOT_BE_CONFIRMED);
                }
                this.recordedVideoFile = path.basename(file);
            } catch (error) {
                failures.push(error);
            }
        }
        try {
            const result = (await this.client.callTool(
                'browser_close',
                {},
                BROWSER_CLOSE_TIMEOUT_MS,
            )) as McpResult;
            if (!result || result.isError) {
                throw new Error(BROWSER_CLOSURE_COULD_NOT_BE_CONFIRMED);
            }
        } catch (error) {
            failures.push(error);
        }
        try {
            await this.stopMcp();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length) {
            this.recordedVideoFile = undefined;
            throw new AggregateError(
                failures,
                'Browser finalization failed; raw recordings retained',
            );
        }
    }

    private validateModelArguments(name: string, args: Record<string, unknown>) {
        const validator = this.validators.get(name);
        const custom =
            name === 'browser_snapshot' ||
            name === 'browser_verify_inputs' ||
            (name === 'browser_click' && args.targetArea !== undefined);
        if (!custom && validator && !validator(args)) {
            throw new ToolDispatchRejectedError('Invalid native browser tool arguments');
        }
    }

    private async callModelTool(
        name: string,
        args: Record<string, unknown>,
        onImage?: (image: BrowserImage) => void,
    ) {
        this.recordObservationDiagnostic({kind: 'tool', tool: name});
        if (name !== 'browser_snapshot') {
            this.fileChooserDismissed = false;
        }

        if (name === 'browser_navigate') {
            this.assertRequestedNavigation(String(args.url));
        }
        if (name === 'browser_verify_inputs') {
            return this.verifyInputValues(args);
        }
        if (name === 'browser_snapshot') {
            const parsed = snapshotFragmentArgs.safeParse(args);
            if (!parsed.success) {
                throw new ToolDispatchRejectedError('Invalid snapshot query, offset or maxChars');
            }
            const {snapshot} = await this.getSnapshot();
            return Object.keys(parsed.data).length
                ? JSON.stringify(snapshotFragment(snapshot, parsed.data))
                : snapshot;
        }
        const currentSnapshot = this.requiresPageSnapshot(name)
            ? (await this.observeBeforeAction(name)).snapshot
            : '';
        const currentUrl = extractUrlFromSnapshot(currentSnapshot);
        try {
            this.policy.assertTool(name, args, currentUrl);
        } catch {
            throw new ToolDispatchRejectedError(
                'Browser policy rejected this tool before dispatch',
            );
        }
        const dialogReply = await this.handleNativeDialogTool(name, args, currentSnapshot);
        if (dialogReply !== undefined) {
            return dialogReply;
        }
        await this.captureMediaClock();
        const helpers: Partial<Record<string, () => Promise<string>>> = {
            browser_click: this.backgroundClickHandler(args, currentSnapshot),
            browser_fill_generated_password: () => this.dispatchGeneratedPassword(args, currentUrl),
            browser_upload_example_file: () => this.dispatchExampleUpload(args),
            browser_scroll_to: () => this.scrollToTarget(args, currentSnapshot),
        };
        const helper = helpers[name];
        if (helper) {
            return helper();
        }

        return this.dispatchModelInteraction(name, args, currentSnapshot, onImage);
    }

    private async dispatchModelInteraction(
        name: string,
        args: Record<string, unknown>,
        currentSnapshot: string,
        onImage?: (image: BrowserImage) => void,
    ) {
        const ref = typeof args.ref === 'string' ? args.ref : undefined;
        const preparedTarget = await this.prepareToolInteraction(name, args, currentSnapshot, ref);
        const target = preparedTarget.mediaTarget;

        if (name === 'browser_click' && ref) {
            const activated = await this.activateCheckableControl(ref, currentSnapshot, target);
            if (activated !== undefined) {
                return this.observeToolReply(name, activated, undefined, true);
            }
        }

        if (name === 'browser_type' && ref) {
            return this.dispatchTextInput(ref, args);
        }

        if (name === 'browser_fill_form' && Array.isArray(args.fields)) {
            return this.dispatchFormFields(args.fields);
        }
        this.assertPointerTarget(name, preparedTarget);
        return this.dispatchObservedTool(name, args, target, onImage);
    }

    private async verifyInputValues(args: Record<string, unknown>) {
        const parsed = inputVerificationArgs.safeParse(args);
        if (!parsed.success) {
            throw new ToolDispatchRejectedError('Invalid input verification fields');
        }
        let fields: InputExpectation[];
        try {
            fields = validateInputExpectations(parsed.data.fields);
        } catch {
            throw new ToolDispatchRejectedError('Invalid input verification expectations');
        }
        try {
            const {evidence} = await this.observeInputs(fields);
            return JSON.stringify({inputEvidence: evidence});
        } catch (error) {
            return this.passiveObservationFailure('browser_verify_inputs', error);
        }
    }

    private async prepareToolInteraction(
        name: string,
        args: Record<string, unknown>,
        snapshot: string,
        ref: string | undefined,
    ): Promise<PreparedActionTarget> {
        // Hover has no non-dispatching native trial. Inspect residual clipping
        // after the same target scrolling used by the eventual pointer action.
        const hoverTarget =
            name === 'browser_hover' ? await this.prepareToolTarget(name, ref) : undefined;
        await rejectBlockedInteraction(
            name,
            snapshot,
            args,
            async (code, timeoutMs) =>
                (await this.client.callTool(
                    'browser_run_code',
                    {code},
                    timeoutMs ?? DEFAULT_TIMEOUT,
                )) as McpResult,
        );
        if (name === 'browser_type' && ref) {
            await this.resolveInputRef(ref);
        }

        return hoverTarget ?? this.prepareToolTarget(name, ref);
    }

    private async observeBeforeAction(tool: string): Promise<SnapshotResult> {
        try {
            const observation = await this.getSnapshot();
            this.actionBeforeSnapshot = observation.snapshot;
            return observation;
        } catch (error) {
            if (
                !(error instanceof SnapshotObservationError) ||
                ['browser_take_screenshot', 'browser_wait_for', 'browser_scroll_to'].includes(tool)
            ) {
                throw error;
            }
            throw new ToolDispatchRejectedError(
                `Pre-action page observation unavailable (${error.reason}); the requested action was not dispatched. Restore the browser session before continuing.`,
                true,
            );
        }
    }

    private async dispatchObservedTool(
        name: string,
        args: Record<string, unknown>,
        target?: MediaActivity['target'],
        onImage?: (image: BrowserImage) => void,
    ) {
        let reply: string;
        const navigationOwner = name === 'browser_navigate' ? this.dialogs.verifiedPage : undefined;
        try {
            const res = await this.dispatchRecordedTool(name, args, target);
            reply = extractText(res) + forwardBrowserImage(name, res, onImage);
        } catch (error) {
            if (
                error instanceof McpToolError &&
                (await this.observeDeferredNavigationDialog(navigationOwner))
            ) {
                throw new NavigationDialogPendingError();
            }
            if (name !== 'browser_take_screenshot') {
                throw error;
            }
            return this.passiveObservationFailure(name, error);
        }
        const entryUrl = this.dialogs.owner?.url;
        const checked = await this.observeToolReply(name, reply, undefined, true).catch(
            (error: unknown) => this.restoreEntryAfterNavigation(name, args, entryUrl, error),
        );
        return (
            checked +
            (this.fileChooserDismissed
                ? '\nNative file chooser was dismissed without uploading files. Use browser_upload_example_file directly on the upload control if example data is allowed.'
                : '')
        );
    }

    private async observeDeferredNavigationDialog(owner: SnapshotPage | undefined) {
        if (!owner) {
            return false;
        }
        let raw: string;
        let page: SnapshotPage;
        try {
            raw = extractText(
                (await this.client.callTool(
                    'browser_snapshot',
                    {},
                    NATIVE_DIALOG_RECOVERY_TIMEOUT_MS,
                )) as McpResult,
            );
            page = snapshotPage(raw).page;
        } catch {
            return false;
        }
        if (
            nativeDialogType(raw) !== 'beforeunload' ||
            page.url !== owner.url ||
            page.index !== owner.index
        ) {
            return false;
        }
        // Only a returned navigation error plus a native protocol observation
        // on the exact known source page can restore its dialog ownership.
        // Transport loss, another page/tab and other tool failures stay unknown.
        this.policy.assertUrl(page.url, 'read');
        this.dialogs.returned(owner);
        return Boolean(this.nativeDialogSnapshot(raw, true));
    }

    private async observeToolReply(
        tool: string,
        reply: string,
        project?: (snapshot: SnapshotResult) => string,
        directReply = false,
    ): Promise<string> {
        let observed: SnapshotResult;
        try {
            if (directReply) {
                this.nativeDialogSnapshot(reply, true);
            }
            observed = await this.getSnapshot();
        } catch (error) {
            this.recordObservationDiagnostic({
                kind: 'post-action-observation',
                returned: {ok: true, tool, result: summarizeReceipt(reply)},
                failure: error instanceof SnapshotObservationError ? error.reason : 'guard-failed',
            });
            if (!(error instanceof SnapshotObservationError)) {
                throw error;
            }
            // Retry only the observation. Never dispatch the completed action again.
            try {
                observed = await this.getSnapshot();
            } catch (retryError) {
                if (!(retryError instanceof SnapshotObservationError)) {
                    throw retryError;
                }
                throw new ActionObservationError(tool, reply);
            }
        }
        return project ? project(observed) : reply;
    }

    private async readSnapshot(): Promise<SnapshotResult> {
        for (let attempt = 0; attempt < 2; attempt++) {
            let raw = await this.snapshotText();
            const nativeDialog = this.nativeDialogSnapshot(raw);
            if (nativeDialog) {
                return nativeDialog;
            }
            this.dialogs.invalidate();
            if (hasFileChooser(raw)) {
                const url = extractUrlFromSnapshot(raw);
                this.policy.assertUrl(url, 'act');
                this.verifyApplicationUrl(url);
                // MCP cannot inspect identity while a native chooser is pending.
                // Cancel without selecting a file, then perform every normal check.
                const cancelled = (await this.client.callTool(
                    'browser_file_upload',
                    {},
                )) as McpResult;
                if (!cancelled || cancelled.isError) {
                    throw new Error(CANNOT_DISMISS_THE_NATIVE_FILE_CHOOSER);
                }
                raw = await this.snapshotText();
                this.fileChooserDismissed = true;
            }
            await this.verifyRequestGuard();
            const checked = await this.checkPageContext(raw, attempt);
            if (checked === undefined) {
                continue;
            }
            raw = checked;
            this.policy.assertUrl(extractUrlFromSnapshot(raw), 'read');
            const modalRefs = await this.readModalRefs(raw);
            if (modalRefs === null) continue;
            const ui = filterTopmostDialog(raw, modalRefs);
            const snapshot = await addControlHints(
                ui.snapshot,
                async (code) =>
                    (await this.client.callTool('browser_run_code', {code})) as McpResult,
            );
            this.dialogs.verify(snapshotPage(raw).page);
            return {
                ...ui,
                snapshot:
                    snapshot +
                    this.requestGuardObservation +
                    (this.fileChooserDismissed
                        ? '\n\nNative file chooser was dismissed without uploading files. If example data is allowed, use browser_upload_example_file directly on the upload control from this snapshot.'
                        : ''),
            };
        }
        throw new Error(PAGE_KEPT_CHANGING_WHILE_INSPECTING_DIALOGS_A_STABLE);
    }

    private async readModalRefs(raw: string): Promise<string[] | null> {
        const refs = [...raw.matchAll(DIALOG_REF_PATTERN)].map((match) => match[1]);
        let modalRefs: string[] = [];
        if (refs.length) {
            const result = extractText(
                (await this.client.callTool('browser_run_code', {
                    code: driverScript('read-modal-dialogs', {refs: refs}),
                })) as McpResult,
            );
            const payload = MCP_RESULT_BLOCK_PATTERN.exec(result)?.[1];
            const parsed: unknown = JSON.parse(payload ?? '{}');
            if (parsed === null) {
                // The page may remove a dialog while identity checks run.
                // Refresh observations once, including policy and identity;
                // never replay the action that caused the transition.
                return null;
            }
            if (
                !Array.isArray(parsed) ||
                parsed.some((ref) => typeof ref !== 'string' || !refs.includes(ref))
            ) {
                throw new Error(CANNOT_DETERMINE_MODAL_DIALOG_STATE);
            }
            modalRefs = parsed;
        }

        return modalRefs;
    }

    private requiresPageSnapshot(name: string): boolean {
        return name !== 'browser_navigate' || this.dialogs.pending;
    }

    private async handleNativeDialogTool(
        name: string,
        args: Record<string, unknown>,
        snapshot: string,
    ): Promise<string | undefined> {
        if (hasNativeDialog(snapshot)) {
            if (name !== 'browser_handle_dialog') {
                throw new ToolDispatchRejectedError(
                    'Native browser dialog is pending. Use browser_handle_dialog with an explicit accept decision before any other action. No action was dispatched.',
                );
            }
            if (this.dialogs.cancelOnly && args.accept !== false) {
                throw new ToolDispatchRejectedError(
                    'Page context changed during the initiating action. Only accept=false is permitted; cancel the dialog and inspect the freshly verified page. No dialog action was dispatched.',
                );
            }
            return this.dispatchObservedTool(name, args);
        }
        if (name === 'browser_handle_dialog') {
            throw new ToolDispatchRejectedError('No native browser dialog is pending');
        }
        return undefined;
    }

    private async dispatchTextInput(ref: string, args: Record<string, unknown>) {
        const resolvedInput = await this.resolveInputRef(ref, true);
        if (resolvedInput) {
            this.recordObservationDiagnostic({kind: 'input-ref', ref, resolvedLabel: true});
            const {snapshot} = await this.getSnapshot();
            const focusedRef = extractFocusedInputRef(snapshot);
            if (focusedRef) {
                this.recordObservationDiagnostic({
                    kind: 'input-ref',
                    ref: focusedRef,
                    focused: true,
                });
                return this.replaceInputText(focusedRef, args);
            }
            throw new ToolDispatchRejectedError(
                'The focused editable field is absent from the fresh snapshot',
            );
        }
        return this.replaceInputText(ref, args);
    }

    private async assertFormFillTargets(fields: unknown[]) {
        for (const field of fields) {
            if (
                !field ||
                typeof field !== 'object' ||
                !('type' in field) ||
                !['textbox', 'slider'].includes(String(field.type))
            ) {
                continue;
            }
            const ref = 'ref' in field && typeof field.ref === 'string' ? field.ref : undefined;
            if (!ref) {
                throw new ToolDispatchRejectedError(
                    'Form fill target has no reference; no form fields were dispatched',
                );
            }
            const state = await this.inspectFormFillTarget(ref);
            if (state !== 'fillable') {
                throw new ToolDispatchRejectedError(
                    `Form target ref=${ref} is ${state}; no form fields were dispatched. Use an observed editable field. If it needs editing mode, activate its observed control and obtain a fresh field reference.`,
                );
            }
        }
    }

    private async inspectFormFillTarget(ref: string) {
        let state: unknown;
        try {
            const inspected = (await this.client.callTool('browser_evaluate', {
                function: FORM_FILL_PREFLIGHT_JS,
                ref,
            })) as McpResult;
            const payload = MCP_LEADING_RESULT_LINE_PATTERN.exec(extractText(inspected))?.[1];
            state = JSON.parse(payload ?? 'null');
            if (
                typeof state !== 'string' ||
                !['fillable', 'not-fillable', 'not-editable', 'unavailable'].includes(state)
            ) {
                throw new Error(UNRECOGNIZED_FORM_FILL_INSPECTION_RESULT);
            }
        } catch (error) {
            if (
                this.isPageCheckError(error) ||
                (error instanceof Error && error.name === 'AbortError')
            ) {
                throw error;
            }
            throw new ToolDispatchRejectedError(
                `Form fill inspection failed before any field dispatch: ${sanitizeForModel(error instanceof Error ? error.message : 'Unknown inspection error')}`,
            );
        }

        return state;
    }

    private async dispatchFormFields(fields: unknown[]) {
        await this.assertFormFillTargets(fields);
        const results: string[] = [];
        for (const field of fields) {
            const ref =
                field &&
                typeof field === 'object' &&
                'ref' in field &&
                typeof field.ref === 'string'
                    ? field.ref
                    : undefined;
            try {
                results.push(await this.dispatchFormField(field, ref));
            } catch (error) {
                if (
                    results.length &&
                    error instanceof ToolDispatchRejectedError &&
                    !error.terminal
                ) {
                    throw new PartialFormFillError(results.length, error.message);
                }
                throw error;
            }
        }
        return this.observeToolReply('browser_fill_form', results.join('\n'));
    }

    private async dispatchFormField(field: unknown, ref: string | undefined) {
        if (
            ref &&
            field &&
            typeof field === 'object' &&
            'type' in field &&
            field.type === 'textbox' &&
            'value' in field
        ) {
            return this.dispatchTextInput(ref, {text: field.value});
        } else {
            const target = ref ? (await this.prepareActionTarget(ref)).mediaTarget : undefined;
            const filled = await this.dispatchRecordedTool(
                'browser_fill_form',
                {fields: [field]},
                target,
            );
            return extractText(filled);
        }
    }

    private notifyMediaActivity(activity?: MediaActivity) {
        try {
            if (activity && this.activities) {
                this.activities.push(activity);
            } else {
                this.mediaActivityObserver?.(activity);
            }
        } catch {
            // Artifact bookkeeping must not replace an action or teardown error.
            try {
                this.mediaActivityObserver?.();
            } catch {}
        }
    }

    private backgroundClickHandler(args: Record<string, unknown>, currentSnapshot: string) {
        if (args.targetArea === undefined) {
            return undefined;
        }
        return async () => {
            backgroundClickRef(args, currentSnapshot);
            const {mediaTarget} = await this.prepareActionTarget(String(args.ref));
            const fresh = (await this.getSnapshot()).snapshot;
            this.policy.assertTool('browser_click', args, extractUrlFromSnapshot(fresh));
            const target = backgroundClickRef(args, fresh);
            const candidates = backgroundClickCandidates(fresh, target);
            const result = await this.track(
                'interaction',
                'browser_click',
                async () =>
                    backgroundClickResult(
                        (await this.client.callTool(
                            'browser_run_code',
                            {code: backgroundClickCode(target, candidates)},
                            DEFAULT_TIMEOUT,
                        )) as McpResult,
                        candidates,
                    ),
                mediaTarget,
            );
            return this.observeToolReply('browser_click', result);
        };
    }

    private beginMediaActivity(
        kind: MediaActivity['kind'],
        tool: string,
        target?: MediaActivity['target'],
    ) {
        if (kind === 'interaction') {
            this.dispatches.begin();
        }
        if (!this.mediaActivityObserver) {
            return (_outcome: MediaActivity['outcome']) => {};
        }
        let startMs: number;
        try {
            startMs = performance.timeOrigin + performance.now();
        } catch {
            this.notifyMediaActivity();
            return (_outcome: MediaActivity['outcome']) => {};
        }
        return (outcome: MediaActivity['outcome']) => {
            try {
                const endMs = performance.timeOrigin + performance.now();
                if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
                    this.notifyMediaActivity();
                    return;
                }
                this.notifyMediaActivity({
                    kind,
                    tool,
                    startMs,
                    endMs,
                    outcome,
                    ...(target ? {target} : {}),
                });
            } catch {
                this.notifyMediaActivity();
            }
        };
    }

    private async track<T>(
        kind: MediaActivity['kind'],
        tool: string,
        actualDispatch: () => Promise<T>,
        target?: MediaActivity['target'],
    ): Promise<T> {
        if (kind === 'interaction') {
            this.lifecycle.assertUsable();
            this.contextGuard.assertKnownContext();
        }
        const owner =
            kind === 'interaction'
                ? this.dialogs.beginDispatch(tool === 'browser_handle_dialog')
                : undefined;
        const finish = this.beginMediaActivity(kind, tool, target);
        let outcome: MediaActivity['outcome'] = 'threw';
        try {
            const result = await actualDispatch();
            if (kind === 'interaction') {
                this.dialogs.returned(owner);
            }
            outcome = 'returned';
            return result;
        } finally {
            if (kind === 'interaction' && outcome === 'threw') {
                this.dialogs.unknown();
            }
            finish(outcome);
        }
    }

    private async dispatchRecordedTool(
        name: string,
        args: Record<string, unknown>,
        target?: MediaActivity['target'],
    ): Promise<McpResult> {
        const dispatch = async () => {
            const result = (await this.client.callTool(name, args)) as McpResult;
            if (
                ['browser_click', 'browser_hover', 'browser_select_option'].includes(name) &&
                typeof args.ref === 'string' &&
                isMissingTargetRef(result, args.ref)
            ) {
                throw new TargetLookupRejectedError(
                    'Target reference is no longer available; action was not dispatched. Choose the required control from the next fresh snapshot.',
                );
            }
            extractText(result);
            return result;
        };
        if (name !== 'browser_wait_for') {
            return this.track('interaction', name, dispatch, target);
        }
        let outcome: MediaActivity['outcome'] = 'threw';
        try {
            const result = await dispatch();
            outcome = 'returned';
            return result;
        } catch (error) {
            return this.passiveObservationFailure(name, error);
        } finally {
            // Preserve the explicit command's end, not its entire idle duration.
            if (this.mediaActivityObserver) {
                try {
                    const time = performance.timeOrigin + performance.now();
                    this.notifyMediaActivity(
                        Number.isFinite(time)
                            ? {kind: 'interaction', tool: name, startMs: time, endMs: time, outcome}
                            : undefined,
                    );
                } catch {
                    this.notifyMediaActivity();
                }
            }
        }
    }

    private async stopMcp(): Promise<void> {
        try {
            await this.client.stop();
            this.mcpStopped = true;
        } finally {
            this.mcpStopped = this.client.isStopped?.() ?? this.mcpStopped;
        }
    }

    private async dispatchGeneratedPassword(args: Record<string, unknown>, currentUrl?: string) {
        if (
            this.generatedPassword === undefined ||
            !currentUrl ||
            !this.targetUrl ||
            !this.isTargetUrl(currentUrl)
        ) {
            throw new Error(GENERATED_PASSWORD_FILL_REQUIRES_AN_AUTHORIZED_TARGET_APPLICATION);
        }
        const password = this.generatedPassword;
        const {mediaTarget: target} = await this.prepareActionTarget(String(args.ref));
        const result = (await this.track(
            'interaction',
            'browser_fill_generated_password',
            () =>
                this.client.callTool('browser_run_code', {
                    code: driverScript('fill-generated-password', {
                        ref: String(args.ref),
                        generatedPassword: password,
                    }),
                }),
            target,
        )) as McpResult;
        if (!result || result.isError) {
            throw new Error(GENERATED_PASSWORD_WAS_NOT_FILLED_IN_AN_EDITABLE);
        }
        const payload = MCP_ANYWHERE_RESULT_BLOCK_PATTERN.exec(extractText(result))?.[1];
        let filled = false;
        try {
            const parsed: unknown = JSON.parse(payload ?? 'null');
            filled =
                typeof parsed === 'object' &&
                parsed !== null &&
                'filled' in parsed &&
                parsed.filled === true;
        } catch {
            // Invalid MCP data must not surface raw code or password values.
        }
        if (!filled) {
            throw new Error(GENERATED_PASSWORD_WAS_NOT_FILLED_IN_AN_EDITABLE);
        }
        return this.observeToolReply(
            'browser_fill_generated_password',
            'Generated password filled and verified; value withheld',
        );
    }

    private async scrollToTarget(args: Record<string, unknown>, snapshot: string) {
        if (typeof args.ref !== 'string' || !ARIA_REF_ARGUMENT_PATTERN.test(args.ref)) {
            throw new Error(INVALID_SCROLL_TARGET_REFERENCE);
        }
        await this.revealTarget({ref: args.ref}, snapshot);
        return `Target ref=${args.ref} intersects the viewport after scrolling; no click or value change requested`;
    }

    private async revealTarget(evidence: {ref: string}, snapshot = ''): Promise<SnapshotResult> {
        const allowedBlockerLabels = obstructionSnapshotLabels(snapshot);
        const diagnosticContext = {
            kind: 'interaction' as const,
            targetKind: 'ref' as const,
            ref: evidence.ref,
        };
        await this.track('interaction', 'browser_scroll_to', async () => {
            const result = (await this.client
                .callTool('browser_run_code', {
                    code: revealTargetCode(evidence.ref, allowedBlockerLabels),
                })
                .catch((error) => {
                    this.evidenceFailures.record(diagnosticContext, {
                        visible: false,
                        reason: 'transport',
                        observations: {},
                    });
                    throw error;
                })) as McpResult;
            let observation;
            try {
                observation = decodeEvidenceObservation(result, allowedBlockerLabels);
            } catch (error) {
                const opaque =
                    error instanceof EvidenceObservationError
                        ? error
                        : new EvidenceObservationError('malformed-result');
                this.evidenceFailures.record(diagnosticContext, {
                    visible: false,
                    reason: opaque.reason,
                    observations: {},
                });
                throw opaque;
            }
            if (observation !== true) {
                this.evidenceFailures.record(diagnosticContext, observation);
                throw new EvidenceUnavailableError(
                    observation.reason,
                    observation.observations.blockerLabels,
                );
            }
        });
        return this.getSnapshot();
    }

    private async activateCheckableControl(
        ref: string,
        snapshot: string,
        target?: MediaActivity['target'],
    ) {
        const checkable = snapshot
            .split('\n')
            .some((line) => CHECKABLE_NODE_PATTERN.test(line) && line.includes(`[ref=${ref}]`));
        if (!checkable) {
            return undefined;
        }
        const finish = this.beginMediaActivity('interaction', 'browser_click', target);
        try {
            const result = (await this.client.callTool('browser_run_code', {
                code: driverScript('activate-checkable-control', {ref: ref}),
            })) as McpResult;
            const payload = MCP_ANYWHERE_RESULT_BLOCK_PATTERN.exec(extractText(result))?.[1];
            const value: unknown = JSON.parse(payload ?? 'null');
            if (value === false) {
                return undefined;
            }
            if (typeof value !== 'string' || !NATIVE_CHECKABLE_ACTION_PATTERN.test(value)) {
                throw new Error(INVALID_NATIVE_CONTROL_ACTIVATION_RESULT);
            }
            finish('returned');
            return `Activated with keyboard: ${value}`;
        } catch (error) {
            finish('threw');
            throw error;
        }
    }

    private async dispatchExampleUpload(args: Record<string, unknown>) {
        const file = this.exampleUpload;
        if (!file || typeof args.element !== 'string' || typeof args.ref !== 'string') {
            throw new Error(EXAMPLE_UPLOAD_REQUIRES_A_TRUSTED_PREPARED_FILE_AND);
        }
        assertInputFile(file);
        const {mediaTarget: target} = await this.prepareActionTarget(args.ref);
        const clicked = (await this.track(
            'interaction',
            'browser_upload_example_file',
            () =>
                this.client.callTool('browser_click', {
                    element: args.element,
                    ref: args.ref,
                }),
            target,
        )) as McpResult;
        if (!clicked || clicked.isError) {
            throw new Error(UPLOAD_CONTROL_DID_NOT_OPEN_A_USABLE_FILE);
        }
        if (!hasFileChooser(extractText(clicked))) {
            return this.observeToolReply(
                'browser_click',
                extractText(clicked),
                ({snapshot}) =>
                    'Click completed, but no native file chooser opened; no file was submitted by this call. Continue ' +
                    'from the current page. If an intermediate dialog opened, use its file-selection control from the ' +
                    'fresh snapshot; do not repeat the opener.\n' +
                    '\n' +
                    snapshot,
            );
        }
        const chooserUrl = extractUrlFromSnapshot(extractText(clicked));
        this.policy.assertTool('browser_upload_example_file', args, chooserUrl);
        this.verifyApplicationUrl(chooserUrl);
        // This is one checked browser action: inspect identity before opening
        // the chooser, upload only the generated file, then inspect again.
        const uploaded = (await this.track('interaction', 'browser_upload_example_file', () =>
            this.client.callTool('browser_file_upload', {
                paths: [file.path],
            }),
        )) as McpResult;
        if (!uploaded || uploaded.isError) {
            throw new Error(PREPARED_EXAMPLE_FILE_UPLOAD_FAILED);
        }
        return this.observeToolReply('browser_upload_example_file', extractText(uploaded));
    }

    private async injectFakeCursor() {
        if (!this.runtimeOptions.cursor) {
            return;
        }
        try {
            await this.client.callTool('browser_evaluate', {function: INJECT_CURSOR_JS});
        } catch {
            // The page may not be ready yet; navigation installs the cursor later.
        }
    }

    private assertPointerTarget(name: string, prepared: PreparedActionTarget) {
        if (['browser_click', 'browser_hover'].includes(name) && prepared.outsideViewport) {
            throw new ToolDispatchRejectedError(
                'Target remains outside the viewport after scrolling; pointer action was not dispatched. Choose a visible target from the fresh snapshot.',
            );
        }
    }

    private async prepareToolTarget(name: string, ref?: string): Promise<PreparedActionTarget> {
        if (ref && ['browser_click', 'browser_select_option', 'browser_hover'].includes(name)) {
            return this.prepareActionTarget(ref);
        }
        return {};
    }

    private async prepareActionTarget(ref: string): Promise<PreparedActionTarget> {
        if (!ARIA_REF_ARGUMENT_PATTERN.test(ref) || !(await this.isOnTargetPage())) {
            return {};
        }
        try {
            const result = (await this.client.callTool('browser_run_code', {
                code: actionTargetCode(ref, Boolean(this.videoDir && this.mediaActivityObserver)),
            })) as McpResult;
            return decodePreparedActionTarget(result, ref, this.videoDir);
        } catch {
            // A failed observation proves neither invisibility nor successful media capture.
            // Native dispatch still enforces actionability when availability is unknown.
            return {};
        }
    }

    private async replaceInputText(ref: string, args: Record<string, unknown>) {
        if (!ARIA_REF_VALUE_PATTERN.test(ref) || typeof args.text !== 'string') {
            throw new Error(INVALID_INPUT_REFERENCE_OR_TEXT);
        }
        const {mediaTarget: target} = await this.prepareActionTarget(ref);
        // Masked inputs may append their old value on locator.fill(). Use real
        // selection/key events; keep this fixed operation behind the tool policy.
        // Do not blur: search suggestions and editors can commit or reset on blur.
        const replacement = (await this.track(
            'interaction',
            'browser_type',
            async () => {
                const result = (await this.client.callTool('browser_run_code', {
                    code: driverScript('replace-input-text', {
                        ref: ref,
                        text: String(args.text),
                        submit: args.submit === true,
                    }),
                })) as McpResult;
                const text = extractText(result);
                if (NOT_EDITABLE_RESULT_PATTERN.test(text)) {
                    await this.getSnapshot();
                    throw new ToolDispatchRejectedError('Target is not an editable input');
                }
                return text;
            },
            target,
        )) as string;
        return this.observeToolReply('browser_type', replacement);
    }

    private async resolveInputRef(ref: string, resolveLabel = false) {
        let text: string;
        const finish = resolveLabel
            ? this.beginMediaActivity('interaction', 'input_focus')
            : undefined;
        try {
            const checkRes = await this.client.callTool('browser_evaluate', {
                function: resolveLabel ? IS_LABEL_NOT_INPUT_JS : INPUT_PREFLIGHT_JS,
                ref,
            });
            if (isMissingTargetRef(checkRes as McpResult, ref)) {
                throw new ToolDispatchRejectedError(
                    'Input reference is no longer available; focus and text entry were not dispatched. Choose the required field from the next fresh snapshot.',
                );
            }
            text = extractText(checkRes as McpResult);
            this.recordObservationDiagnostic({kind: 'input-ref', checked: true});
        } catch (err) {
            finish?.('threw');
            this.recordObservationDiagnostic({kind: 'input-ref', failed: true});
            if (resolveLabel || err instanceof ToolDispatchRejectedError) {
                throw err;
            }
            return false;
        }
        let result: unknown;
        try {
            const payload = MCP_LEADING_RESULT_BLOCK_PATTERN.exec(text)?.[1];
            result = JSON.parse(payload ?? 'null');
        } catch {
            finish?.('threw');
            if (resolveLabel) {
                throw new Error(INPUT_FOCUS_OUTCOME_COULD_NOT_BE_ESTABLISHED);
            }
            return false;
        }
        if (result === 'not-editable') {
            throw new ToolDispatchRejectedError('Target is not an editable input');
        }
        const resolved = ['resolved-for', 'resolved-inner', 'resolved-parent-label'].includes(
            String(result),
        );
        if (
            resolveLabel &&
            !resolved &&
            !['is-input', 'not-label', 'no-element'].includes(String(result))
        ) {
            finish?.('threw');
            throw new Error(INPUT_FOCUS_OUTCOME_COULD_NOT_BE_ESTABLISHED);
        }
        if (resolved) {
            finish?.('returned');
        }
        return resolved;
    }
    private passiveObservationFailure(tool: string, error: unknown): never {
        if (
            this.isPageCheckError(error) ||
            error instanceof ToolDispatchRejectedError ||
            (error instanceof Error && error.name === 'AbortError')
        ) {
            throw error;
        }
        throw new PassiveObservationError(
            error instanceof Error ? error.message : String(error),
            tool,
        );
    }
}
function parseCookieHeader(cookieHeader: string, url: string): Partial<Cookie>[] {
    const parsedUrl = new URL(url);
    return cookieHeader
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((pair) => {
            const eq = pair.indexOf('=');
            const name = eq >= 0 ? pair.slice(0, eq).trim() : pair.trim();
            const value = eq >= 0 ? pair.slice(eq + 1).trim() : '';
            return {
                name,
                value,
                domain: parsedUrl.hostname,
                path: '/',
                secure: parsedUrl.protocol === 'https:',
            };
        });
}
