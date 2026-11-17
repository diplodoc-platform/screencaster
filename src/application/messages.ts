export const LOAD_ONE_INSTRUCTION_BEFORE_RECORDING_ACTIONS =
    'Load one instruction before recording actions';
export const REGISTER_A_PLAN_ONCE_AFTER_ITS_SOURCE_AND =
    'Register a plan once, after its source and before recorded actions';
export const ONLY_A_PENDING_REGISTERED_STEP_CAN_BE_STARTED =
    'Only a pending registered step can be started';
export const COMPLETION_NEEDS_AN_ACTIVE_STEP_AND_BOUNDED_EVIDENCE =
    'Completion needs an active step and bounded evidence';
export const RESOLUTION_NEEDS_AN_UNRESOLVED_ACTION_AND_BOUNDED_OBSERVED =
    'Resolution needs an unresolved action and bounded observed evidence';
export const CANNOT_CAPTURE_A_SCREENSHOT_AFTER_FINISHING_THE_BROWSER =
    'Cannot capture a screenshot after finishing the browser';
export const FINISH_A_RECORDED_RUN_BEFORE_EXPORTING_VIDEO =
    'Finish a recorded run before exporting video';
export const VIDEO_OUTPUT_REQUIRES_RECORDING =
    'Configured video output requires recording; remove video: false or omit outputs.video';
export const AUTOMATIC_VIDEO_EXPORT_FAILED =
    'Automatic video export failed; retain the raw recording and inspect registered artifacts';
export const AUTOMATIC_NARRATION_FAILED =
    'Automatic narration failed; silent video and cached speech retained';
export const AUTOMATIC_NARRATION_REQUIRES_TTS = 'Configured narration requires a TTS provider';
export const AUTOMATIC_NARRATION_REQUIRES_STEPS =
    'Automatic narration requires completed plan steps with recorded interactions and short action text';
export const EXPORT_DIRECTORY_MUST_NOT_BE_A_SYMBOLIC_LINK =
    'Export directory must not be a symbolic link';
export const EXPORT_ARTIFACTS_MUST_NOT_BE_SYMBOLIC_LINKS =
    'Export artifacts must not be symbolic links';
export const AWAIT_THE_CURRENT_OPERATION_BEFORE_CHANGING_PLAN_STATE =
    'Await the current operation before changing plan state';
export const ARTIFACT_NAMES_USE_LETTERS_NUMBERS_HYPHENS_AND_UNDERSCORES =
    'Artifact names use letters, numbers, hyphens and underscores';
export const RUN_ARTIFACTS_MUST_STAY_INSIDE_THE_RUN_DIRECTORY =
    'Run artifacts must stay inside the run directory';
export const A_REGISTERED_ARTIFACT_CHANGED = 'A registered artifact changed';

export const ACTION_JOURNAL_UNCONFIRMED =
    'Action returned but its journal could not be persisted; do not repeat it';
export const OPERATION_JOURNAL_UNCONFIRMED =
    'Operation failed and journal persistence is unconfirmed; do not repeat browser actions';
export const JOURNAL_UNCONFIRMED_SUFFIX = '; journal persistence is unconfirmed';

export const UNKNOWN_ACTION_RECEIPT_UNAVAILABLE =
    'Unknown action has no fresh media receipt; session stopped, retain raw recordings';

export const FINAL_JOURNAL_UNCONFIRMED =
    'Final journal persistence is unconfirmed; retain raw recordings and action receipts';

export const ILLUSTRATION_INPUT_MUST_BE_REGISTERED =
    'Illustration input must be an unchanged registered artifact in the current run';
