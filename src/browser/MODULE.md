# Browser execution

`BrowserSession` owns policy and action outcomes; `BrowserRuntime` owns the MCP
process and the browser-context lifecycle. `capture/` handles PNG output;
`interaction/` handles target evidence and interaction preflight; `recording/`
bridges the browser clock to the media journal. `scripts/` contains typed programs
for the driver VM and the DOM realm.

`runtime-state.ts`, `dialog-state.ts` and `dispatch-state.ts` own explicit lifecycle,
page/dialog ownership and dispatch receipts. Keep state changes in these
collaborators. Cancellation must join startup and leave no process able to spawn
after shutdown. Repeated close/abort calls must retain their terminal result.

Keep pre-dispatch refusal, known completion, and an unknown post-dispatch outcome
distinct. Do not retry a possible mutation because observation or transport failed.
Keep the same context identity across navigation. A replaced context is a terminal
failure for the owned session.

Observation must retain exact current refs and handles, protect sensitive values,
and fail conservatively. Background-click inspection must not click. Native
pointer checks, label associations, shadow boundaries, and clipped targets have
different evidence requirements; preserve the existing checks when refactoring.

DOM functions are compiled separately. Their imports are bundled into the
serialized function; dynamic values arrive as explicit evaluation arguments.
Driver scripts may use the driver-side clock. Page clocks are untrusted.

Use the browser's original PNG bytes for artifacts; image content returned by MCP
is a resized preview. Always close the owned context and process, including after
final evidence collection fails. Match the installed browser to the MCP driver's
Playwright version, which can differ from the package's direct Playwright version.

Screenshot privacy is host-owned. Gate native screenshot forwarding whenever a
screenshot policy is configured; the model uses the checked capture path. Ready
conditions are checked before and immediately after pixels. Configured DOM source
values must be verified conservatively, including composed text and inspectable
pseudos; unsupported surfaces/races fail without registering an artifact. This is
not OCR or automatic DLP. Keep visual review required.

Preserve the unannotated post-redaction PNG when highlighting and use the local
shared raster helper, not a new browser context. Both runtime/session startup
boundaries must refuse raw video with DOM screenshot redaction. See
`docs/illustrations.md` and `docs/host-adapters.md` for the full contract.
