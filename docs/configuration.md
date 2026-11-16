# Launch configuration

This reference covers every field accepted by the version 1 launch config and
every option of the bundled SpeechKit adapter. Values are host settings, not
MCP tool arguments. Custom authentication/provider modules define their own
options; the library cannot enumerate arbitrary module-specific settings.

## Complete authentication, speech, and video example

Copy `run.config.example.json` to `run.config.json` and `.env.example` to `.env`;
keep both private files at POSIX mode `0600`. The main sample includes an explicit
`authentication` section and SpeechKit with an API key. Fill `SCREENCASTER_LOGIN`,
`SCREENCASTER_PASSWORD` and `SPEECHKIT_API_KEY` locally. It loads them through
`"envFile": ".env"`; JSON holds only env references.

**Supply your host authentication module before launching.**
`./host/authentication.js` is a config-relative integration placeholder, not a
bundled login implementation. Replace it with the path to your trusted module
exporting `createAuthentication`. Its options must support the illustrated
`allowedOrigins`, `login` and `password` convention; option interpretation belongs
to that module. Loading `.env` populates the process environment, but the core
passes custom `options` unchanged. There is no universal login flow for arbitrary
services. See Custom authentication options below.

For a prepared browser session, replace `authentication` with `storageState` as
shown below; the remaining settings stay the same.

The sample targets the public DataLens service; it does not grant access or execute
a scenario. Set `browser.url`, the policy origin and authentication allowlist for
your service. Paths are relative to the config. Built-in `tts.provider` works from
both a checkout and an installed package, with no module path to configure.

<!-- config-example:start -->

```json
{
  "$schema": "./run.config.schema.json",
  "version": 1,
  "envFile": ".env",
  "directory": "./runs",
  "authentication": {
    "module": "./host/authentication.js",
    "options": {
      "allowedOrigins": ["https://datalens.ru"],
      "login": {
        "env": "SCREENCASTER_LOGIN"
      },
      "password": {
        "env": "SCREENCASTER_PASSWORD"
      }
    }
  },
  "tts": {
    "provider": "speechkit",
    "options": {
      "apiKey": {
        "env": "SPEECHKIT_API_KEY"
      },
      "voice": "jane",
      "speed": 1
    }
  },
  "browser": {
    "url": "https://datalens.ru",
    "headless": true,
    "video": true,
    "locale": "en-US",
    "viewport": {
      "width": 1440,
      "height": 1000
    },
    "deviceScaleFactor": 1
  },
  "policy": {
    "rules": [
      {
        "origin": "https://datalens.ru",
        "pathPrefix": "/",
        "actions": ["read", "act"]
      }
    ]
  },
  "screenshotPolicy": {
    "requireRedaction": false
  },
  "outputs": {
    "video": {
      "name": "walkthrough",
      "highlights": true
    },
    "screenshots": {
      "highlight": true
    },
    "narration": {
      "name": "narrated",
      "captions": true,
      "maxHoldSeconds": 5
    }
  }
}
```

<!-- config-example:end -->

Run `npm start -- --config run.config.json`, then call `screencaster_open({})`.
Starting the server loads configuration; browser capture starts when a run opens.
Inspect the page, perform the authorized scenario, capture selected steps, and
call `screencaster_finish`. It waits for automatic video export and returns
registered artifact paths. `outputs.narration` also produces narrated video from
completed plan steps. The server does not execute a scenario or publish artifacts.

There is no valid config with every alternative enabled at once. In particular,
`authentication` and `storageState` are alternatives; DOM redaction and video are
incompatible. The replacement examples below cover those remaining branches.

## Top-level fields and precedence

All objects have a fixed set of keys unless stated otherwise. Unknown keys and
`null` are rejected; omission means use the documented default. JSON has no
comments. `envFile` explicitly loads a dotenv file; omission loads none.
Strings do not expand `$VAR` or `${VAR}` and no shell commands are evaluated.
Only the explicit `{ "env": "NAME" }` forms below read environment variables.
An environment name must match `[A-Za-z_][A-Za-z0-9_]*`.

| Field                    | Accepted values                                                                      | Default / meaning                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `$schema`                | Optional string pointing to the JSON Schema; used by editors and ignored at runtime. | The sample uses `./run.config.schema.json`.                                                                                |
| `version`                | Integer `1` only; required in a file.                                                | Config format version.                                                                                                     |
| `envFile`                | Optional nonempty dotenv file path, relative to the config.                          | No implicit loading. File values fill only unset process variables before session resolution and provider imports.         |
| `directory`              | Nonempty path string.                                                                | No default; supply here or with `--directory`. Parent for separate per-run directories.                                    |
| `browser`                | Object described below.                                                              | No configured browser overrides.                                                                                           |
| `outputs`                | Object described below.                                                              | No automatic export; plain screenshots by default.                                                                         |
| `tts`                    | Object with `options` and exactly one of `provider` or `module`.                     | Built-in SpeechKit or a custom trusted TTS factory.                                                                        |
| `tts.provider`           | `"speechkit"`.                                                                       | Select the built-in integration; mutually exclusive with `module`.                                                         |
| `tts.module`             | Nonempty trusted module path.                                                        | Alternative custom factory; must export `createTts`.                                                                       |
| `tts.options`            | JSON object defined by the factory.                                                  | SpeechKit options are listed below.                                                                                        |
| `authentication`         | Object with required `module` and `options`.                                         | No config-supplied authentication callback.                                                                                |
| `authentication.module`  | Nonempty path to an importable trusted module.                                       | Required with `authentication`; exports `createAuthentication(options, {baseDirectory})`.                                  |
| `authentication.options` | JSON object with string keys; values defined by the module.                          | Required with `authentication`; not passed to model-facing tools. Custom options are defined by the host module.           |
| `storageState`           | Nonempty file path **or** `{ "env": "NAME" }`.                                       | No prepared session. An env reference must resolve to a nonempty path, not session JSON. Alternative to authentication.    |
| `providers`              | Nonempty trusted module path.                                                        | No provider module. It must export at least one of `loader`, `tts`, `policyFactory`, `authentication`, `screenshotPolicy`. |
| `policy`                 | Nonempty JSON file path **or** the inline policy object below.                       | Without a provider policy or DOM redaction, allow `read` and `act` on the opened target origin.                            |
| `screenshotPolicy`       | Inline object described below.                                                       | No configured DOM redaction; a provider may supply it instead.                                                             |

Paths in JSON are relative to the config file's directory. This also applies to
relative paths obtained through `storageState.env`. CLI path overrides are
relative to the working directory. `--config` is itself resolved from the working
directory. `--directory`, `--providers`, `--storageState`, and `--policy` replace
the corresponding JSON values; inline objects are not merged with file contents.

Explicit `screencaster_open` browser arguments replace matching `browser` fields;
nested objects such as `viewport` are replaced as a whole. A default `browser.url`
allows an empty open call; otherwise `url` is required on that call. Overrides
cannot bypass host policies or disable recording required by `outputs.video`.

Provider modules may combine capabilities, but duplicate sources are rejected:

- `storageState` with authentication from either JSON or providers;
- `authentication` in both JSON and providers;
- `policy` with a provider's `policyFactory`;
- `screenshotPolicy` in both JSON and providers;
- `tts` in both JSON and providers.

A config containing `authentication` or `tts` must be a regular file, not a symlink, and
have exactly `0600` permissions on POSIX. On Windows use user-only ACLs. Keep
credentials and session contents out of logs, tool arguments, and committed files.

## Browser settings

| Field                       | Accepted values                                           | When omitted                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser.url`               | Absolute HTTP(S) target URL without embedded credentials. | Must be supplied to `screencaster_open`. Access also depends on the policy and authentication allowlist.                                                                                  |
| `browser.headless`          | `true` or `false`.                                        | `true`: no visible capture window. `false`: visible capture window. Independent of the login window.                                                                                      |
| `browser.video`             | `true` or `false`.                                        | Recording off unless `outputs.video` is present. `true` alone records raw video for manual export; `false` conflicts with `outputs.video`.                                                |
| `browser.locale`            | Locale string, e.g. `en-US` or `ru-RU`.                   | No locale override; browser-driver default. The config schema accepts strings, but the browser must support the locale. This does not change an application's stored language preference. |
| `browser.viewport.width`    | Positive integer, CSS pixels.                             | `1280` when the whole viewport is omitted.                                                                                                                                                |
| `browser.viewport.height`   | Positive integer, CSS pixels.                             | `720` when the whole viewport is omitted. Both dimensions are required when `viewport` is supplied.                                                                                       |
| `browser.deviceScaleFactor` | Positive finite number, e.g. `1` or `2`.                  | `1`. PNG device pixels scale with this value; video recording size follows the viewport.                                                                                                  |

## Output settings

| Field                              | Accepted values                                                                  | When omitted                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `outputs.video`                    | Object, including `{}`. Not a boolean.                                           | No automatic recording/export. Presence enables recording and one export during finish.                                                   |
| `outputs.video.name`               | 1–80 ASCII letters, digits, `_`, `-`; first character must be a letter or digit. | `walkthrough`. A new directory name inside the run, not a filename or external path.                                                      |
| `outputs.video.highlights`         | `true` or `false`.                                                               | `false`. `true` adds outlines for measured action targets to the exported video. It does not invent targets for actions without geometry. |
| `outputs.narration`                | Object, including `{}`.                                                          | Omitted: no automatic narration. Requires `outputs.video`, a TTS provider, and an instruction plan with successful recorded interactions. |
| `outputs.narration.name`           | Same naming rules as video; must differ from video name.                         | `narrated`; final video is `<name>/video.webm`.                                                                                           |
| `outputs.narration.captions`       | `true` or `false`.                                                               | `false`; `true` also writes WebVTT/JSON captions.                                                                                         |
| `outputs.narration.maxHoldSeconds` | Number from `0` through `5`.                                                     | `5`; maximum additional still-frame hold to fit speech.                                                                                   |
| `outputs.screenshots`              | Object, including `{}`.                                                          | No screenshot defaults.                                                                                                                   |
| `outputs.screenshots.highlight`    | `true` or `false`.                                                               | `false` behavior. `true` outlines the exact target of each screenshot call; `false` produces plain PNGs by default.                       |

With the example settings, a screenshot call needs only its name and a current
observed `ref`; do not repeat `highlight: true`. An overview can explicitly pass
`highlight: false` without a ref. Missing highlight targets are rejected, not
guessed from a previous interaction. Screenshot calls still choose their timing,
`area`, `ready`, `notReady`, and `timeoutMs`; these are not launch config fields.

Finish retains the raw recording and registers `<name>/video.webm` plus media
metadata. Repeated finish calls return existing artifacts without exporting again.
An export failure marks the run as failed with an error; keep the raw recording
and retry manually under a new export name. Additional manual exports remain
available. Highlighted screenshots retain their clean original and source hash.
Changing the config cannot create video for an earlier unrecorded run.

Automatic narration speaks each successful step’s `actionText` (1–1000 characters),
anchored to its first confirmed recorded interaction. Steps without interactions
and failed/skipped steps are omitted. Use short, source-grounded spoken sentences
in the plan. Missing anchors or speech that cannot fit cause an explicit failure;
the silent export and completed speech cache are retained. The narrated export
inherits video highlights. No credentials enter the manifest. For direct capture
without a plan, omit automatic narration and use explicit `screencaster_narrate`.

To disable automatic video, **omit** `outputs.video` and `outputs.narration`. Also omit `browser.video`
or set it to `false` to disable raw recording. To keep raw recording only, omit
`outputs.video` and keep `browser.video: true`. For plain exported video, retain
`outputs.video` and set `highlights: false`. For plain screenshots, set
`outputs.screenshots.highlight: false` or omit it.

FFmpeg must be installed with the encoders/features described in Development.
The process uses `FFMPEG_PATH` if set, otherwise `ffmpeg` from `PATH`. There is no
`ffmpegPath` JSON field. Manual narration, captions, clips, and editorial
illustration jobs also remain available through separate media tools.

## Custom authentication options

`authentication.module` points to a trusted host module exporting
`createAuthentication(options, {baseDirectory})`. It returns a `HostAuthenticator`
with exact `allowedOrigins` and an `authenticate` callback. The module defines
its own `options` schema and owns login, credentials and manual challenges.
The package does not provide a universal username/password login flow.

```json
{
  "authentication": {
    "module": "./host/authentication.js",
    "options": {
      "allowedOrigins": ["https://datalens.ru"],
      "login": {"env": "SCREENCASTER_LOGIN"},
      "password": {"env": "SCREENCASTER_PASSWORD"}
    }
  }
}
```

The main sample uses this host-provided module contract. Remove `storageState`
when using it. The following option names are a convention for your adapter,
not additional core fields:

| Example option   | Meaning                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `allowedOrigins` | Exact HTTPS origins accepted by the host authenticator. Keep them aligned with the capture target and policy. |
| `login`          | `{ "env": "SCREENCASTER_LOGIN" }`; the host module reads that process variable.                               |
| `password`       | `{ "env": "SCREENCASTER_PASSWORD" }`; the host module reads that process variable without logging it.         |

A service-specific adapter may require more settings or use a different options
schema; document those in the consuming project. Do not add arbitrary options to
this sample as if they were supported by every authenticator. The generic wrapper in `examples/host-adapters/host.ts` shows target
validation and callback error handling. See the host adapter guide for the
ready/challenge result contracts and session ownership.

## Prepared sessions and provider modules

To reuse a session, **remove** `authentication` and use one of these top-level
replacements. The file contains Playwright storage state; the config contains
only its path. Omit both authentication and storage state for an unauthenticated
target.

```json
{"storageState": "/absolute/path/to/browser-state.json"}
```

```json
{"storageState": {"env": "SCREENCASTER_STORAGE_STATE"}}
```

Use `"providers": "./host-providers.mjs"` for trusted executable callbacks. A
module must export at least one recognized capability: `loader` (instruction
loader function), `tts` (provider with `identity` and `synthesize`), `policyFactory`
(function returning a `BrowserPolicy`), `authentication` (host authenticator), or
`screenshotPolicy` (DOM policy object). These are module exports, not additional
top-level JSON fields. The duplicate-source rules above still apply. Host-specific
URLs, credentials, and callback implementation belong in that trusted module.

## SpeechKit, IAM, and external values

The bundled SpeechKit factory is configured directly in the private JSON:
`tts.provider: "speechkit"`, with the following
`tts.options`. No custom JavaScript module is needed. The complete example above
uses `apiKey: {"env": "SPEECHKIT_API_KEY"}` and automatic narration.
Browser and SpeechKit credentials are separate.

Select exactly one authentication mode. `apiKey` is the simplest option: it is
sent directly to SpeechKit. `iamToken` is a ready short-lived token.
`serviceAccountKey` contains an authorized-key JSON used to obtain and refresh
an IAM token; `serviceAccount` provides the same key material as separate fields.
These are different credential types, but all secret values use the same
string, `env`, or `file` source format:

| Field under `tts.options`         | Accepted values / behavior                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`                          | Secret source containing a SpeechKit API key.                                                                                                     |
| `iamToken`                        | Secret source containing a ready IAM token; no renewal in this mode.                                                                              |
| `serviceAccountKey`               | Secret source containing authorized-key JSON with nonempty `id`, `service_account_id`, `private_key`; obtains/refreshes IAM tokens automatically. |
| `serviceAccount`                  | Object with required `keyId`, `serviceAccountId`, `privateKey`; alternative to complete JSON; obtains/refreshes IAM tokens automatically.         |
| `serviceAccount.keyId`            | Nonempty authorized-key ID (`id`/`kid`), or `{ "env": "NAME" }`.                                                                                  |
| `serviceAccount.serviceAccountId` | Nonempty service-account ID, or `{ "env": "NAME" }`.                                                                                              |
| `serviceAccount.privateKey`       | Secret source containing the PEM private key. PEM alone does not contain the two required IDs.                                                    |
| `folderId`                        | Optional nonempty folder ID; accepted only with ready `iamToken`. Omit for API-key and service-account modes.                                     |
| `voice`                           | Default `jane`; 1–64 lowercase ASCII letters, digits, `_`, `-`, starting with a letter; must also be supported by SpeechKit.                      |
| `speed`                           | Finite number from `0.1` through `3`; default `1`.                                                                                                |

Every secret source accepts exactly one representation:

| Representation                             | Meaning                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Nonempty string                            | Literal value in the private JSON.                                                                                                     |
| `{ "env": "NAME" }`                        | Nonempty process env value; name matches `[A-Za-z_][A-Za-z0-9_]*`. Supports `envFile` values; existing process values take precedence. |
| `{ "file": "/absolute/path/to/key.json" }` | UTF-8 text from a config-relative regular file; no symlink, POSIX mode `0600`, at most 64 KiB.                                         |

Secret text is trimmed and resolved during launch, before browser startup. Secret
values are not returned as public server fields or written to manifests. IAM uses
a PS256-signed JWT and exchanges it at the fixed endpoint
`https://iam.api.cloud.yandex.net/iam/v1/tokens`, with a 30-second timeout and no
redirects. Tokens are cached until one minute before expiry. The exchange starts
when synthesis first needs a token. No JWTs or tokens are printed.

Service-account setup using separate dotenv fields (replace `apiKey` with this
`serviceAccount` object inside `tts.options`):

```json
{
  "serviceAccount": {
    "serviceAccountId": {"env": "SPEECHKIT_SERVICE_ACCOUNT_ID"},
    "keyId": {"env": "SPEECHKIT_SERVICE_ACCOUNT_KEY_ID"},
    "privateKey": {"env": "SPEECHKIT_PRIVATE_KEY"}
  }
}
```

```dotenv
SPEECHKIT_SERVICE_ACCOUNT_ID=REPLACE_ACCOUNT_ID
SPEECHKIT_SERVICE_ACCOUNT_KEY_ID=REPLACE_KEY_ID
SPEECHKIT_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----
REPLACE_PEM_BODY
-----END PRIVATE KEY-----'
```

Alternative `tts.options` examples (replace the current authentication mode):

```json
{"apiKey": {"env": "SPEECHKIT_API_KEY"}, "voice": "jane", "speed": 1}
```

```json
{"iamToken": {"env": "SPEECHKIT_IAM_TOKEN"}, "folderId": "REPLACE_FOLDER_ID"}
```

```json
{"serviceAccountKey": {"env": "SPEECHKIT_SERVICE_ACCOUNT_KEY"}}
```

Synthesis uses the fixed endpoint
`https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis`, a 120-second timeout,
1–1000 characters per phrase, and an 8 MiB response limit. These limits are not
launch settings. The library does not invoke `yc iam create-token`. Configuring
TTS without `outputs.narration` only enables manual `screencaster_narrate` calls.

Existing module-based configs, including the old example wrapper, remain supported.
The factory is also exported as `@diplodoc/screencaster/providers/speechkit-factory`.

Custom `providers` modules exporting `tts` and custom `tts.module` factories remain
supported, but cannot both supply TTS. Their options belong to the host. The
TypeScript `SpeechKitProvider` also accepts `getIamToken` and `request` callbacks;
functions cannot be supplied as JSON.

| Other external value                  | Where configured                                              |
| ------------------------------------- | ------------------------------------------------------------- |
| Prepared browser session              | `storageState` path or `storageState.env`; separate from IAM. |
| FFmpeg executable                     | `FFMPEG_PATH`, otherwise `ffmpeg` on `PATH`.                  |
| Custom instruction-loader credentials | Trusted module exporting `loader`.                            |
| Agent/model credentials               | Consuming host; not used by this library.                     |

### Local dotenv file

`envFile` uses Node.js dotenv syntax: `NAME=value`, comments and quoted multiline
values. It never sources a shell, executes commands or expands other variables.
For a service account, prefer separate `SPEECHKIT_SERVICE_ACCOUNT_ID`,
`SPEECHKIT_SERVICE_ACCOUNT_KEY_ID` and `SPEECHKIT_PRIVATE_KEY` variables. The PEM
uses a quoted multiline value. A complete authorized-key JSON in one variable
remains an alternative for exported keys; preserve JSON's literal `\n` escapes
inside `private_key` in that mode. Select one TTS authentication mode in JSON; extra unused env
variables do not enable another mode.

The file must be regular, not a symlink, at most 64 KiB and mode `0600` on POSIX.
A configured missing or unreadable file fails the launch. Existing process values
win, including empty values. Loaded values remain in the server process for host
callbacks; they are not returned in launch options or manifests. Do not share a
server process across unrelated credential environments. Omit `envFile` when CI
or the MCP host already injects variables. GUI clients need not inherit the shell
when the config names an env file.

Browser storage state is still a Playwright JSON file; `.env` holds its path.
Video and screenshots remain under `directory`. No `private/` directory is needed.
Legacy literal and file secret sources remain supported. `.env` and `.env.*` are
ignored, except the credential-free `.env.example`. Never print the environment,
private config or dotenv file while diagnosing access.

## Browser policy fields

`policy` accepts an inline object or a path to a JSON file containing that same
object. With neither policy nor active DOM redaction, the default allows reads
and interactions on the target origin; it does not supply a network allowlist.
Active DOM redaction without an explicit policy selects the restrictive capture
policy automatically. Review the application's asset/API origins when supplying
an allowlist: missing CDN origins can prevent styles or data from loading.

| Field under `policy`                 | Accepted values                                                                              | Default / meaning                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`                              | Required nonempty array of rule objects.                                                     | No implicit rules in a supplied policy. A matching rule must grant the requested action.                                                                       |
| `rules[].origin`                     | Required exact HTTP(S) origin without credentials, path, query, fragment, or trailing slash. | Origin to which this rule applies.                                                                                                                             |
| `rules[].path`                       | Exact normalized path beginning with `/`, without query or fragment.                         | Any path unless `pathPrefix` is supplied. Mutually exclusive with `pathPrefix`.                                                                                |
| `rules[].pathPrefix`                 | Path prefix beginning with `/`.                                                              | Any path. Matches the prefix itself and its descendants at a `/` boundary; `/settings` does not match `/settings-old`.                                         |
| `rules[].actions`                    | Required nonempty array containing `read`, `act`, and/or `evaluate`.                         | `read`: observations/navigation/screenshots; `act`: interaction tools; `evaluate`: browser evaluation permission. Additional runtime restrictions still apply. |
| `networkAllowedOrigins`              | Nonempty array of exact HTTP(S) origins.                                                     | No network-origin allowlist. Include every reviewed asset/API origin needed by the page.                                                                       |
| `readOnlyNetwork`                    | Object with required `postReads` array.                                                      | No read-only method guard. If supplied, allows GET/HEAD/OPTIONS and only listed POST reads. Cannot coexist with `capture`.                                     |
| `readOnlyNetwork.postReads`          | Array of `{ "origin": "...", "path": "/..." }`, including `[]`.                              | Required within `readOnlyNetwork`. These must be reviewed read endpoints, not write endpoints.                                                                 |
| `readOnlyNetwork.postReads[].origin` | Exact HTTP(S) origin.                                                                        | Required; must be in `networkAllowedOrigins` when that allowlist exists.                                                                                       |
| `readOnlyNetwork.postReads[].path`   | Exact normalized path beginning with `/`, without query or fragment.                         | Required. No wildcards or method/name heuristics.                                                                                                              |
| `capture`                            | Object described below.                                                                      | No restrictive capture profile.                                                                                                                                |

For a policy file, replace the inline object with `"policy": "./capture-policy.json"`.
To restrict one path, use a rule such as:

```json
{
  "rules": [
    {
      "origin": "https://datalens.ru",
      "path": "/settings/templates",
      "actions": ["read", "act"]
    }
  ]
}
```

### Restrictive capture profile

When `policy.capture` is present, every rule must grant only `read`. Navigation
is restricted to exact listed URLs, interaction tools to reviewed action entries,
and networking to read methods plus listed POST reads. Popups, downloads, and
redirects are blocked; violations stop capture. Do not enable this profile for a
scenario that needs writes. It cannot coexist with `readOnlyNetwork`.

| Field under `policy.capture` | Accepted values                                                                                | Default / meaning                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigationUrls`             | 1–100 absolute HTTP(S) URLs; each at most 8192 characters.                                     | In **JSON**, omission supplies no navigation URLs: list them explicitly. URLs are normalized with fragments removed; query strings remain significant. Each URL must match a read rule and any network allowlist. |
| `postReads`                  | 0–100 `{origin, path}` objects with the same constraints as above.                             | `[]`: no POST requests permitted.                                                                                                                                                                                 |
| `deniedHosts`                | 0–100 lowercase hostnames, no scheme, path, port, or trailing dot.                             | `[]`. Each entry denies that hostname and all its subdomains.                                                                                                                                                     |
| `readOnlyActions`            | 0–1000 action objects described below.                                                         | `[]`: no interaction tools permitted.                                                                                                                                                                             |
| `networkAllowedOrigins`      | 1–100 exact origins in the shared capture options schema.                                      | This nested option is used by the TypeScript `createCapturePolicy()` factory, **not applied by the JSON loader**. In JSON use `policy.networkAllowedOrigins`; do not rely on this nested key.                     |
| `readOnlyActions[].origin`   | Required exact HTTP(S) origin, at most 8192 characters.                                        | Must be covered by a read rule.                                                                                                                                                                                   |
| `readOnlyActions[].path`     | Required exact normalized path beginning with `/`, at most 4096 characters, no query/fragment. | Current page on which the action is allowed.                                                                                                                                                                      |
| `readOnlyActions[].tool`     | `browser_click`, `browser_hover`, `browser_scroll_to`, or `browser_press_key`.                 | Required; no other tool values.                                                                                                                                                                                   |
| `readOnlyActions[].ref`      | 1–256 ASCII letters, digits, `_`, `-`.                                                         | Required for click/hover/scroll; use an exact currently observed ref. Not allowed for press-key entries.                                                                                                          |
| `readOnlyActions[].key`      | `Escape` only.                                                                                 | Required for press-key entries; not allowed for click/hover/scroll entries.                                                                                                                                       |

The TypeScript factory supplies target-derived defaults for navigation/origins;
an inline JSON `capture` object does not. Persisted refs can become stale: refresh
the host's reviewed actions rather than guessing references or widening policy.

Example read-only policy replacement (no POST endpoints or interactions allowed):

```json
{
  "policy": {
    "rules": [{"origin": "https://datalens.ru", "actions": ["read"]}],
    "networkAllowedOrigins": ["https://datalens.ru", "https://static.example.org"],
    "capture": {
      "navigationUrls": ["https://datalens.ru"],
      "postReads": [],
      "deniedHosts": [],
      "readOnlyActions": []
    }
  }
}
```

This is a configuration example, not an exhaustive service asset/API inventory.
Add only verified origins and read endpoints required by the authorized scenario.

## Screenshot privacy settings

| Field under `screenshotPolicy`  | Accepted values                                                           | Default / meaning                                                                |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `requireRedaction`              | `true` or `false`.                                                        | `false`. `true` requires at least one replacement or hide rule.                  |
| `redaction`                     | Object with `replacements` and/or `hide`.                                 | No DOM redaction. Its presence, even `{}`, is incompatible with video recording. |
| `redaction.replacements`        | Array of 0–64 replacement objects.                                        | `[]`. Source strings must be unique.                                             |
| `redaction.replacements[].from` | String of 3–2048 characters.                                              | Required; literal DOM source value to replace, not a regular expression.         |
| `redaction.replacements[].to`   | String of 0–2048 characters.                                              | Required; may be empty, but cannot contain its corresponding source string.      |
| `redaction.hide`                | Array of 0–32 nonempty CSS selector strings, each at most 512 characters. | `[]`. Hide matching DOM elements during capture. Invalid selectors fail capture. |

To use redaction, remove `outputs.video` and `outputs.narration`, set `browser.video: false`, and use a
policy with a network guard (`capture` or `readOnlyNetwork`); active redaction
with an explicit unguarded policy is refused. If policy is omitted, the library
selects a restrictive capture policy. Replace the sample's screenshot policy with:

```json
{
  "screenshotPolicy": {
    "requireRedaction": true,
    "redaction": {
      "replacements": [{"from": "Sample Operator", "to": "Demo User"}],
      "hide": ["[data-private]"]
    }
  }
}
```

These are illustrative values/selectors: choose actual reviewed rules locally.
DOM redaction is not OCR or automatic personal-data detection. Unsupported visible
surfaces or unstable evidence can cause capture to fail. With screenshot policy
configured, use `screencaster_screenshot`; native screenshot forwarding is blocked.
Keep machine, visual, and publication review separate.

## Editor validation and diagnostics

The shipped `run.config.schema.json` is generated from runtime Zod schemas.
Use the sample's `$schema` in a checkout, or point it to the schema beside an
installed package. It describes built-in TTS options, bounds and mutually
exclusive credential forms. Custom factory options remain defined by the host.
Cross-field policy semantics, referenced files, permissions and external access
are checked at runtime; editor validation does not prove a launch can succeed.

Configuration errors report supported field names and fixed reasons, never input
values. Built-in TTS distinguishes option validation, missing env/file secrets
and malformed authorized keys. Custom module imports, missing factory exports
and factory execution failures have separate diagnostics; raw provider exceptions
are never forwarded.
