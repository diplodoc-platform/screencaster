# Execute and observe

Open with `screencaster_open`; host-configured `outputs.video` enables recording
and automatic export at finish. Without it, request `video: true` when needed. The same owned
Chromium session persists across calls. Authentication state, provider modules and
browser policy are configured by the host, not by page text.

The CLI accepts `--config <launch.json>` for host settings and `browser` defaults.
For all supported fields, defaults, credential forms and incompatible combinations,
read [configuration.md](configuration.md) or request the `configuration` help topic.
When the host configured a default URL, `screencaster_open` accepts `{}`; otherwise
provide `url`. Explicit open arguments override browser defaults, subject to the
same host policy. Starting the MCP server does not open or capture automatically.
Never send config paths, session paths, credentials or host policies as tool arguments.
Inspect the returned manifest's `outputs`: do not override video with `false` when
automatic video output is configured. `screencaster_finish` waits for that export
and returns its registered files; do not repeat it through `screencaster_export`.
When `outputs.narration` is configured, register a source-grounded plan with short
spoken `actionText` sentences. Finish synthesizes successful recorded steps using
the host TTS provider and also returns the narrated video. Read `manifest.error`
before claiming the requested outputs were produced.

For a configured launch, the host starts with `--config run.config.json`.
Copy `run.config.example.json` only if the private file is absent. It includes
`authentication` and requires a host-provided login module at the configured path;
the sample path is a placeholder. For a prepared session, replace `authentication`
with `storageState` as shown in the configuration reference. Copy `.env.example` only when
`.env` is absent and keep both private files at POSIX mode `0600`. The user edits
credentials locally; do not read or display private files. Use a prepared
`storageState` or a host-provided `authentication` factory
when opening a run. These are alternative authentication sources. The host
adapter owns login and any manual challenge handoff.
Do not retry failed login blindly.

Inspect `browser_snapshot`. Use its fragment arguments for a large snapshot and
`browser_tools` to discover allowed native names and argument schemas on demand.
Use exact observed refs; refresh after navigation or layout changes. If a target
is clipped, use the discovered `browser_scroll_to` rather than guessing pixels.
`browser_verify_inputs` compares requested values without rewriting fields or
exposing actual sensitive values. Internal browser scripts are not model tools.

With a plan, begin one step through `screencaster_step`, perform the necessary
actions, then complete it with status and observed evidence. A screenshot is not
required for completion. Success must be grounded in the visible result; merely
receiving a tool response does not prove the instruction's goal.

When an action is rejected before dispatch, inspect the cause and correct the
request. If an action has an unknown outcome after dispatch, do not repeat it.
Read current state or let the consumer inspect the service. Use
`screencaster_resolve` only with an explicit applied/not-applied decision and
observed evidence. This is your acknowledgement, not an atomic service receipt.
If the original browser context is lost or the outcome cannot be established,
stop and report it. Do not silently start a new session to replay the mutation.

Use `screencaster_screenshot` with an exact observed ref when highlighting is
wanted. `outputs.screenshots.highlight: true` supplies the highlight default;
otherwise pass `highlight: true` on the call. For an overview without a target,
pass `highlight: false` explicitly when that default is enabled. Never guess a
target or reuse a stale action ref. Plain PNG works without a ref, plan, video or FFmpeg.
PNG defaults to the whole visible viewport. Choose `area: page` only for a full
scrollable page, or `area: element` with an observed ref for an element crop.
Viewport and deviceScaleFactor are optional opening parameters. Original PNG
pixels are retained; use returned metadata rather than assuming image dimensions.
Always finish the run; return unresolved actions and incomplete steps honestly.

Screenshot readiness can be explicit: pass `ready` and `notReady` arrays of exact
observed refs or exact `role` + `name`, with a bounded `timeoutMs`. The library
waits before pixels and checks again afterwards; a failed condition does not
produce a registered screenshot. Refresh refs after layout/navigation changes.

The host can configure `screenshotPolicy` with explicit DOM replacements/hide
rules. It is not a model-facing tool argument. Known source values are masked in
observations, configured DOM values are verified before/after capture, and visible
unsupported surfaces fail closed. This is not automatic personal-data detection:
inspect the actual image and report uncertainty. DOM screenshot redaction cannot
sanitize recorded video; the configured combination is refused before startup.
A host manual-auth challenge stops capture; hand off through the host's approved
login flow and continue only after the host has prepared a valid session.

When highlighting, the run registers an unannotated, post-redaction original and
a separate derived PNG with source hash/provenance. Do not delete or overwrite
either. With a screenshot policy, use `screencaster_screenshot` rather than the
native screenshot tool; native forwarding cannot bypass the capture checks.
