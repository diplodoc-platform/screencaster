export const SPECIFY_DIRECTORY_FOR_LOCAL_RUN_ARTIFACTS_USE_HELP =
    'Specify directory in --config or use --directory for local run artifacts. Use --help for options.';
export const INVALID_LAUNCH_CONFIG =
    'Invalid launch config: expected a version 1 JSON configuration with supported fields and values';
export const LAUNCH_CONFIG_ENV_MISSING =
    'The storageState environment variable configured for this launch is empty or missing';
export const AMBIGUOUS_LAUNCH_CAPABILITIES =
    'Configure each host capability once: policy, authentication/storageState and screenshotPolicy cannot have conflicting sources';
export const HOST_PROVIDERS_LOAD_FAILED = 'Could not load the trusted provider module';
export const PRIVATE_AUTH_CONFIG_REQUIRED =
    'Authentication/TTS config must be a regular private file (chmod 600 on POSIX), not a symlink';
export const CLI_USAGE =
    'Usage: screencaster --config <config.json>\n       screencaster --directory <runs-root> [--providers <trusted-module.mjs>] [--storageState <private-state.json>] [--policy <policy.json>]\nCLI flags override config fields. Config paths are relative to the config file.\n';
export const PROVIDER_MODULE_MUST_EXPORT_LOADER_AND_OR_TTS =
    'Trusted provider module must export valid loader, tts, policyFactory, authentication or screenshotPolicy capabilities';
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
export const INVALID_LAUNCH_CONFIG_PREFIX = 'Invalid launch config';
export const AUTH_MODULE_IMPORT_FAILED =
    'authentication.module: could not import the configured module';
export const AUTH_FACTORY_MISSING = 'authentication.module: expected a createAuthentication export';
export const AUTH_FACTORY_FAILED =
    'authentication.options: factory failed or returned an invalid authenticator';
export const TTS_MODULE_IMPORT_FAILED = 'tts.module: could not import the configured module';
export const TTS_FACTORY_MISSING = 'tts.module: expected a createTts export';
export const TTS_FACTORY_FAILED = 'tts.options: factory failed or returned an invalid TTS provider';
export const INVALID_LAUNCH_ENV_FILE =
    'envFile: expected a readable regular dotenv file, no symlink, mode 0600 and at most 64 KiB; check variable names and values';
