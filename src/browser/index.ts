export {BrowserSession} from './session.js';
export type {BrowserSessionOptions, BrowserObservation} from './session.js';
export type {ScreenshotOptions, ScreenshotMetadata} from './capture/screenshot.js';
export {BrowserRuntime} from './runtime.js';
export type {BrowserRuntimeOptions, RuntimeStartOptions, PageCheckpoint} from './runtime.js';
export type {SnapshotResult, Viewport, StartSessionParams} from './types.js';
export type {McpResult} from '../transport/mcp/types.js';
export {snapshotPage} from '../shared/snapshot/page.js';
export type {SnapshotPage} from '../shared/snapshot/page.js';
export {hasNativeDialog, nativeDialogType} from '../shared/snapshot/modal-state.js';
export {extractUrlFromSnapshot} from './snapshot/url.js';
export type {BrowserImage} from './images.js';
export type {BrowserInputFile, FileInputTarget} from './interaction/input-file.js';
export {assertInputFile} from './interaction/input-file.js';
export {BrowserContextLostError, browserContextLoss} from './errors/browser-context-lost-error.js';
export {ActionObservationError} from './errors/action-observation-error.js';
export {NavigationDialogPendingError} from './errors/navigation-dialog-pending-error.js';
export {PartialFormFillError} from './errors/partial-form-fill-error.js';
export {PassiveObservationError} from './errors/passive-observation-error.js';
export {EvidenceUnavailableError} from './errors/evidence-unavailable-error.js';
export {SnapshotObservationError} from './errors/snapshot-observation-error.js';
export {
    ToolDispatchRejectedError,
    TargetLookupRejectedError,
} from './errors/tool-dispatch-rejected-error.js';
export {
    McpToolError,
    extractText,
    extractImageBase64,
    extractFocusedInputRef,
} from '../transport/mcp/result.js';
export {
    registerSecret,
    sanitizeForModel,
    sanitizeSnapshotForModel,
    sanitizeToolResultForModel,
} from '../shared/sanitize-for-model.js';
export {BrowserPolicy, createBrowserPolicy, createCapturePolicy} from './policy.js';
export type {CapturePolicyOptions, BrowserToolPermission} from './policy.js';
export {authenticateWithHost} from './host-auth.js';
export type {HostAuthenticator, HostAuthResult, HostAuthTarget} from './host-auth.js';
export {HostAuthenticationChallengeError} from './errors/host-auth-challenge-error.js';
export {screenshotCapturePolicySchema} from './capture/capture-policy.js';
export type {ScreenshotCapturePolicy} from './capture/capture-policy.js';
export {BrowserActionError} from './outcome.js';
export {McpStdioClient} from '../transport/mcp/client.js';

export type {McpDiagnostic} from '../transport/mcp/client.js';
export {BrowserObservations} from './observations.js';
export type {
    BrowserObserver,
    BrowserObserverResult,
    BrowserObservationAccess,
} from './observations.js';

export type {CaptureLocator} from './capture/screenshot.js';

export type {BrowserPreferences} from './preferences.js';
