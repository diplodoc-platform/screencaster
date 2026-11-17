export const TOOL_DESCRIPTIONS = {
    screencaster_help:
        'Read the bundled guidance for configuration, planning, browser execution or optional media exports.',
    screencaster_open: 'Open an owned Chromium session and a new local run directory.',
    screencaster_source:
        'Load Markdown text or a URL with the configured loader. Specify exactly one input.',
    screencaster_plan:
        'Validate and register a source-grounded instruction plan before recorded actions.',
    screencaster_step:
        'Begin a pending step by ID, or record its completion with status and observed evidence.',
    browser_snapshot: 'Observe the current page or request a bounded fragment.',
    browser_tools: 'Discover allowed native tool names and argument schemas on demand.',
    browser_action:
        'Execute one discovered browser tool. Unknown dispatch outcomes require inspection, never blind replay.',
    screencaster_screenshot:
        'Save a policy-checked PNG using configured screenshot defaults and optional ready/notReady conditions. Highlighting requires a ref and preserves the clean source separately; publication review remains pending.',
    screencaster_finish:
        'Close the owned browser, finalize recording, produce configured outputs and return the manifest.',
    screencaster_resolve:
        'Acknowledge an unknown action only after inspecting current state. Evidence is supplied by the caller, not inferred by the library.',
    screencaster_export: 'Export a finished recording. Video highlights are opt-in.',
    screencaster_narrate: 'Narrate an export through the configured provider. Captions are opt-in.',
    screencaster_edit:
        'Create a new export by cutting time intervals, action IDs or step IDs; raw and execution results stay intact.',
    screencaster_clip:
        'Export selected time intervals, action IDs or step IDs as WebM or an optional silent GIF; no new browser run.',
    screencaster_edit_proposal:
        'Validate a reversible detour proposal against observed state. The proposal may be rejected.',
    screencaster_captions:
        'Create a new export with optional VTT from explicit timed text, without requiring audio.',
    screencaster_preview: 'Create a neutral preview PNG with caller-provided title and subtitle.',
    screencaster_illustrations_analyze:
        'Analyze registered PNG/JPEG artifacts and save an immutable crop/annotation plan with a contact-sheet preview. Sources are run-relative registered paths; ready analysis is not visual approval.',
    screencaster_illustrations_produce:
        'Produce local panels, collages, QA and optional YFM from a confirmed saved analysis hash. Visual review and publication stay pending until host review.',
    screencaster_state: 'Read run status and artifact paths without advancing the browser.',
} as const;
