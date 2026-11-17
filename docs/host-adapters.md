# Host adapters

The package owns browser execution; a host owns credentials, service-specific
routes, service-specific policies and authorization for test writes. Model-facing MCP
arguments cannot supply these capabilities. `ServerOptions.policyFactory`,
`authentication` and `screenshotPolicy` are trusted host configuration.

TTS can also be configured in the same private JSON with `tts: {module, options}`
for custom factories, or `tts: {provider: "speechkit", options}` for the built-in provider.
The factory exports `createTts(options, {baseDirectory})`; it returns a `TtsProvider`.
The built-in `tts: {provider: "speechkit", options}` accepts API keys, ready
IAM tokens, authorized-key JSON or a PEM plus service-account/key IDs. Secret
sources support literal/env/private-file values. Service-account modes obtain
and refresh IAM tokens. Choose one TTS source: this factory or `providers.tts`.
`outputs.narration` enables automatic narrated video at finish from successful
plan steps. See the configuration reference for every option and source form.

See the [complete launch configuration reference](../README.md#launch-configuration)
for the full sample, every JSON field, accepted values, defaults, and conflicts.
The same reference is packaged for agents through the `configuration` help topic.

The CLI collects launch settings in a version 1 JSON file; `envFile: ".env"`
loads private environment values before calling host factories. Copy `.env.example`
to the ignored `.env`, keep mode `0600` and use `{env: "NAME"}` secret references.
Existing process variables take precedence. Pass the launch JSON with
`--config`. It accepts `directory`, `storageState` (a path or `{ "env": "NAME" }`),
`authentication` (a trusted factory module and its options), `providers`,
`policy` (an inline policy object or file path), `screenshotPolicy`, `outputs`,
and `browser` defaults (`url`, `headless`, `video`, `locale`, `viewport`,
`deviceScaleFactor`). Paths are relative to the config file. Existing CLI flags
override the matching fields, with paths relative to the current directory.
Provider callbacks remain in trusted modules. Inline passwords are accepted only
in a private authentication config; never include session contents. A configured URL permits
`screencaster_open({})`; explicit browser arguments override those defaults but
do not change host permissions. The server does not launch the browser on startup.

`outputs.video: {name: "walkthrough", highlights: true}` enables recording and
automatic export during `screencaster_finish`; it cannot be combined with
`browser.video: false`. `outputs.screenshots: {highlight: true}` applies outlines
to screenshot calls, which still need an observed target `ref`. A particular
overview can opt out with `highlight: false`. Both original media and derived
artifacts are retained. These options also work with `CaptureRun.create()` and
`ServerOptions.outputs`; no separate export call is needed. Output settings are
included in the run manifest, without authentication configuration. See the
[launch workflow](../README.md#usage) for disabling outputs and handling failures.

## Capture policy

`createCapturePolicy(target, options)` opts into capture-read-only behavior while
`createBrowserPolicy()` retains its historical defaults. The capture factory:

- Allows observation and explicit navigation only to `navigationUrls` (the exact
  target URL by default); it strips fragments for network comparison.
- Refuses modifying tools. A host can declare individual `readOnlyActions` using
  the exact origin, path, observed ref and tool. Escape is a separate page-bound
  grant with no fictitious ref; other keys are refused. Tool discovery reports
  the exact approved argument combinations through `describeTool()`.
  This does not grant fill, submit, upload, generated-password or evaluation rights.
- Installs a context-wide guard before navigation. GET, HEAD and OPTIONS are
  allowed on explicit network origins; POST reads require an exact origin/path.
- Blocks popup pages, downloads, WebSockets, denied hosts and all HTTP redirects.
  Redirect refusal is intentional: use the final canonical capture URL and finish
  authentication before capture. This prevents hidden redirect hops reaching a
  forbidden host, including from subresources and child frames.
- Reports attempted violations with bounded categories; no request URL, body,
  headers or credentials enter diagnostics. A strict violation fails subsequent
  observation instead of silently declaring the screenshot safe.

Network origins do not grant permission to navigate or act on those origins.
`deniedHosts` rejects an exact hostname and its subdomains; it cannot be overridden
by a reading endpoint or navigation declaration.

## Host authentication

The main `run.config.example.json` explicitly includes `authentication.module`
and login/password env references. Its `./host/authentication.js` path is a
placeholder for a trusted service-specific implementation; no login module at
that path is bundled. The host resolves the supplied env references from the
process environment loaded by `envFile`. Custom options are passed unchanged.
For a prepared session, replace `authentication` with `storageState`.
Never configure both authentication sources. See the configuration reference
for all sample option conventions and the separate SpeechKit service-account
fields; browser credentials and TTS credentials are independent.

A `HostAuthenticator` declares exact `allowedOrigins` and an `authenticate`
callback. `authenticateWithHost({targetUrl, policy, authentication, signal})`
validates the target against both allowlists **before** invoking the callback.
The callback can use a separately audited login helper or injected env values
inside the host process; those values never enter MCP arguments or this library.

Return either:

- `{status: 'ready', origin, storageStatePath, expiresAt?}`: an absolute path to a
  nonempty, regular, non-symlink private file (0600 on POSIX), bound by the host to
  the exact origin. The core checks metadata and expiry without reading state
  contents into model-facing results.
- `{status: 'challenge', origin, challenge}` with `captcha`, `mfa`, `webauthn` or
  `device`: stop before starting capture. The host explicitly hands over its own
  headed login window; once the user completes the challenge, the host can invoke
  the adapter again. No challenge is bypassed and no login submission is retried.

`storageStatePath` is an opaque credential-bearing resource. Keep it outside VCS
and logs and delete it according to the host's session-retention contract. The
host must validate its actual provider route and trusted helper executable;
the generic wrapper does not implement a provider-specific login flow. Supply a
trusted `authentication.module` or use a prepared `storageState` file.

## Generic examples

[The typed adapter](../examples/host-adapters/host.ts) contains a configurable
capture-policy wrapper, origin-bound authentication and a bounded test-fixture
operation. It contains no built-in service domains or login routes.

`applyFixtureOperation()` requires explicit authorization, a purpose, an allowed
`account-language` operation, an exact HTTPS `fixtureOrigin`, the fixed path
`/test-fixtures/account/language` and a RU/EN enum. The route is an illustrative
fixture contract. Supply an executor for your own test service; the helper does
not call a production API. A transport error is an unknown outcome and does not
trigger retry. Fixture operations do not broaden capture browser permissions.

After building, type-check `examples/tsconfig.json` and run
`node build/examples/host-adapters/synthetic.js`. This example uses empty synthetic
storage state and a local fixture callback. It makes no external requests and
prints no state path or credentials. Production hosts must keep their own policy,
secrets, provider routes, approval evidence and tests.

## Trusted CLI module

[`providers.ts`](../examples/host-adapters/providers.ts) is a complete host module
for the synthetic `https://docs.test.example` fixture:

```sh
node build/cli.js --directory ./runs \
  --providers build/examples/host-adapters/providers.js
```

It exposes policy/auth/redaction capabilities to the server, not the model. With
no `SCREENCASTER_HOST_STORAGE_STATE` path it returns a manual device challenge.
The host can provide a prepared private state file through that variable; no
state contents or credentials are printed. Replace the explicit synthetic origin
and reviewed rules in the consuming project before using a production service.
A policy factory and a policy file are mutually exclusive. An authentication
callback and a pre-supplied `storageStatePath` are also mutually exclusive.

Build emits JavaScript/declarations for the typed examples in `build/examples/`.
Use these compiled modules from an installed package: Node does not strip
TypeScript inside `node_modules`. Source `.ts` files remain included for adaptation.
