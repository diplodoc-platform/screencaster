export const INVALID_ACTION_TARGET_REFERENCE = 'Invalid action target reference';
export const BACKGROUND_CANDIDATE_CANNOT_BE_THE_REQUESTED_TARGET =
    'Background candidate cannot be the requested target';
export const BACKGROUND_CLICK_OUTCOME_UNAVAILABLE_ACTION_MUST_NOT_BE =
    'Background click outcome unavailable; action must not be repeated blindly';
export const UNREQUESTED_BACKGROUND_CANDIDATE = 'Unrequested background candidate';
export const BROWSER_CONTEXT_GUARD_COULD_NOT_BE_INSTALLED =
    'Browser context guard could not be installed';
export const BROWSER_CONTEXT_CONTINUITY_COULD_NOT_BE_VERIFIED =
    'Browser context continuity could not be verified';
export const INVALID_CONTROL_OBSERVATION = 'Invalid control observation';
export const DUPLICATE_INPUT_EXPECTATION_REFERENCE = 'Duplicate input expectation reference';
export const INVALID_CHECKABLE_INPUT_EXPECTATION = 'Invalid checkable input expectation';
export const INVALID_INPUT_OBSERVATION_RESULT = 'Invalid input observation result';
export const REGISTERED_INPUT_FILE_CHANGED_OR_IS_NOT_A =
    'Registered input file changed or is not a regular file';
export const BROWSER_OBSERVERS_REQUIRE_UNIQUE_BOUNDED_IDS =
    'Browser observers require unique bounded IDs';
export const BROWSER_OBSERVERS_ARE_INSTALLED_ONCE_PER_OWNED_CONTEXT =
    'Browser observers are installed once per owned context';
export const BROWSER_POLICY_PATH_REQUIRES_AN_EXACT_NORMALIZED_PATH =
    'Browser policy path requires an exact normalized path without pathPrefix, query or fragment';
export const POST_READ_ORIGIN_MUST_BE_ALLOWED_BY_NETWORK_ALLOWED_ORIGINS =
    'POST read origin must be allowed by networkAllowedOrigins';
export const POST_READ_REQUIRES_AN_EXACT_NORMALIZED_PATH_WITHOUT =
    'POST read requires an exact normalized path without query or fragment';
export const MEDIA_CLOCK_UNAVAILABLE = 'Media clock unavailable';
export const DEVICE_SCALE_FACTOR_MUST_BE_POSITIVE_AND_FINITE =
    'Device scale factor must be positive and finite';
export const THE_OWNED_BROWSER_IS_ALREADY_RUNNING = 'The owned browser is already running';
export const READ_ONLY_REQUEST_GUARD_WAS_NOT_INSTALLED =
    'Read-only request guard was not installed';
export const A_HIGHLIGHTED_OR_ELEMENT_SCREENSHOT_REQUIRES_AN_EXACT =
    'A highlighted or element screenshot requires an exact target reference';
export const SCREENSHOT_REQUIRES_A_STARTED_BROWSER = 'Screenshot requires a started browser';
export const TARGET_HAS_NO_VISIBLE_BOUNDS = 'Target has no visible bounds';
export const INDEPENDENT_PAGE_VERIFICATION_FAILED_URL_OR_VISIBLE_HEADING =
    'Independent page verification failed (URL or visible heading)';
export const CONCURRENT_GENERATED_PASSWORD_FILL_IS_NOT_ALLOWED =
    'Concurrent generated password fill is not allowed';
export const CONCURRENT_EXAMPLE_FILE_UPLOAD_IS_NOT_ALLOWED =
    'Concurrent example file upload is not allowed';
export const EXAMPLE_UPLOAD_REQUIRES_A_STARTED_BROWSER_SESSION =
    'Example upload requires a started browser session';
export const INPUT_OBSERVATION_FAILED = 'Input observation failed';
export const PAGE_CHANGED_DURING_INPUT_OBSERVATION = 'Page changed during input observation';
export const BROWSER_OBSERVATION_UNAVAILABLE = 'Browser observation unavailable';
export const RECORDING_IDENTITY_UNAVAILABLE = 'Recording identity unavailable';
export const RECORDING_IDENTITY_COULD_NOT_BE_CONFIRMED =
    'Recording identity could not be confirmed';
export const BROWSER_CLOSURE_COULD_NOT_BE_CONFIRMED = 'Browser closure could not be confirmed';
export const CANNOT_DISMISS_THE_NATIVE_FILE_CHOOSER = 'Cannot dismiss the native file chooser';
export const CANNOT_DETERMINE_MODAL_DIALOG_STATE = 'Cannot determine modal dialog state';
export const PAGE_KEPT_CHANGING_WHILE_INSPECTING_DIALOGS_A_STABLE =
    'Page kept changing while inspecting dialogs; a stable snapshot is required';
export const UNRECOGNIZED_FORM_FILL_INSPECTION_RESULT = 'Unrecognized form fill inspection result';
export const GENERATED_PASSWORD_FILL_REQUIRES_AN_AUTHORIZED_TARGET_APPLICATION =
    'Generated password fill requires an authorized target application';
export const GENERATED_PASSWORD_WAS_NOT_FILLED_IN_AN_EDITABLE =
    'Generated password was not filled in an editable password input';
export const INVALID_SCROLL_TARGET_REFERENCE = 'Invalid scroll target reference';
export const INVALID_NATIVE_CONTROL_ACTIVATION_RESULT = 'Invalid native control activation result';
export const EXAMPLE_UPLOAD_REQUIRES_A_TRUSTED_PREPARED_FILE_AND =
    'Example upload requires a trusted prepared file and a current control';
export const UPLOAD_CONTROL_DID_NOT_OPEN_A_USABLE_FILE =
    'Upload control did not open a usable file chooser';
export const PREPARED_EXAMPLE_FILE_UPLOAD_FAILED = 'Prepared example file upload failed';
export const INVALID_INPUT_REFERENCE_OR_TEXT = 'Invalid input reference or text';
export const INPUT_FOCUS_OUTCOME_COULD_NOT_BE_ESTABLISHED =
    'Input focus outcome could not be established';
export const BROWSER_OBSERVATION_FAILED = 'Browser observation failed';
export const MISSING_BROWSER_OBSERVATION = 'Missing browser observation';
export const A_CAPTURE_SESSION_MAY_BE_STARTED_ONLY_ONCE =
    'A capture session may be started only once';
export const BROWSER_STORAGE_IS_UNAVAILABLE = 'Browser storage is unavailable';

export const ACTION_OBSERVATION_FAILED_MESSAGE =
    'A browser action returned, but the following page observation remains unavailable. ' +
    'The enclosing tool may be incomplete. Do not repeat it or its completed actions.';

export const BROWSER_CONTEXT_LOST_MESSAGE =
    'The original browser context was lost; the last action must not be replayed.';

export const NAVIGATION_DIALOG_PENDING_MESSAGE =
    'Navigation has not completed. A fresh native beforeunload dialog belongs to the same ' +
    'previously verified page. Inspect the next snapshot and explicitly choose ' +
    'browser_handle_dialog; no automatic acceptance or navigation retry occurred. ' +
    'This does not establish failure of any Save/Create or authorize repeating it.';

export const partialFormFillMessage = (completedFields: number, reason: string): string =>
    'Form fill partially applied: the first ' +
    `${completedFields}` +
    ' fields completed. The current field was refused and later fields were not dispatched. Do not ' +
    'repeat the whole batch; inspect fresh values and continue only the unmet fields. ' +
    `${reason}`;

export const passiveObservationMessage = (tool: string, detail: string): string =>
    'Inspect the next fresh snapshot; this does not mean Save/Create failed and does not authorize repeating them. ' +
    `Passive browser observation ${tool} failed: ${detail}`;

export const EVIDENCE_FAILURE_EXPLANATIONS = {
    'absent-ref': 'The previously observed reference is absent from the current page.',
    disconnected: 'The target was disconnected during the visibility check.',
    'frame-boundary': 'Visibility through the containing frame could not be established.',
    'not-revealed': 'Scrolling did not reveal enough of the target in its viewport.',
    'not-intersecting': 'The target does not intersect its viewport.',
    'empty-intersection': 'No visible target area was available to sample.',
    occluded: 'A sampled point on the target hit another element or no element.',
    'predicate-false': 'The visibility check returned false without a specific cause.',
};

export const BROWSER_STARTUP_INTERRUPTED = 'Browser startup was interrupted';
export const BROWSER_SESSION_INACTIVE = 'Browser session is not active; no action was dispatched';
export const CONCURRENT_BROWSER_ACTION =
    'Await the current browser action before dispatching another';

export const VIDEO_WITH_DOM_REDACTION_UNSUPPORTED =
    'DOM screenshot redaction cannot protect an existing video recording; capture sanitized PNGs or use an independently sanitized video fixture';

export const HOST_AUTH_MANUAL_CONTINUATION_REQUIRED =
    'Host authentication requires explicit manual continuation before browser capture';
export const AMBIGUOUS_HOST_AUTH_STATE =
    'Specify host authentication or a prepared storage state, not both';

export const USE_POLICY_CHECKED_SCREENSHOT =
    'Use the policy-checked screenshot API; native screenshot forwarding is unavailable when a screenshot policy is configured';

export const REDACTION_REQUIRES_NETWORK_GUARD =
    'DOM redaction requires a host-reviewed read-only network guard before changing page presentation';
