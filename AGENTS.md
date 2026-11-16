# Diplodoc Screencaster

`@diplodoc/screencaster` is a standalone ESM package for browser guide capture and
media generation. It exposes a TypeScript API and a stdio MCP server. The host
supplies agent reasoning, authorization, instruction loaders, and optional TTS.

## Context and workflow

Read the nearest `MODULE.md` before changing browser or media behavior. For capture
tasks, use [.agents/skills/screencaster/SKILL.md](.agents/skills/screencaster/SKILL.md)
and its conditional references. The skill describes how to operate Screencaster;
this file describes how to develop it. `readHarness()` and `screencaster_help`
serve that same packaged skill content.

When working inside the Diplodoc metapackage, also follow the enclosing
`AGENTS.md` and its shared `.agents/` guidance. All commands in this package must
also work from a standalone checkout.

## Structure and dependency rules

- `src/application/` — capture-run orchestration and artifact registration.
- `src/browser/` — owned browser lifecycle, interaction policy, capture, and driver scripts.
- `src/media/` — recording validation, timelines, exports, audio, and previews.
- `src/instruction/` — Markdown loading and instruction-plan validation.
- `src/transport/mcp/` — JSON-RPC process transport and reply decoding.
- `src/server/mcp/` — MCP tools composing the application and media services.
- `src/providers/` — optional integrations, currently SpeechKit.
- `src/shared/` — file handling, sanitization, snapshot parsing, and capture contracts.
- `src/agent/` — access to the packaged agent guide.
- `test/unit/`, `test/browser/`, `test/architecture/` — separate validation suites.
- `scripts/` — build, watch, benchmark, and installed-package checks.
- `examples/host-adapters/` — portable policy/authentication, SpeechKit and fixture examples.

Dependencies flow from CLI/server/application into capabilities and shared code.
`shared` has no runtime dependency on other modules; `transport` may depend on
`shared`; browser and media have no runtime dependency on one another. Shared
capture types and UI-state classification belong in `shared`. Type-only imports
are permitted across capability boundaries. Architecture tests enforce runtime
boundaries, acyclic imports, and source filenames. Browser lifecycle,
dialog ownership and dispatch receipt state belong in their dedicated collaborators.
Use streaming frame validation and packed hashes/references in internal exports;
preserve all retained-frame and raw-source verification. Run/media journal writes
are queued: await `flush()` at receipt boundaries and before reading files. Shutdown
must join startup and drain journals, including cancellation and failed operations. See [docs/architecture.md](docs/architecture.md).

## Development

Use Node.js 24+ and npm 11.5.1+. Install with `npm ci --no-workspaces`.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:package
```

`npm test` includes unit and architecture tests. `npm run test:browser` runs
Chromium integration tests separately and requires a recent FFmpeg build. Use
`FFMPEG_PATH` to select the binary. `npm run watch` rebuilds TypeScript and bundled
browser programs. Restart watch after adding a new script entry point.

## Code conventions

Write strict TypeScript. Use `kebab-case` for source filenames and directories,
`PascalCase` for classes and types, and `camelCase` for functions and variables.
Keep code, comments, documentation, and commit messages in English. Use
Conventional Commits.

Keep configuration and operational limits in each module's `config.ts`, regular
expressions in `patterns.ts`, and diagnostics in `messages.ts`. Name values by
purpose and unit. Keep protocol discriminants in their schemas. Preserve the
existing defaults when reorganizing configuration.

Capture policies and authentication are host capabilities, never model arguments.
Keep clean post-redaction PNGs and derive highlights offline with source hashes.
Configured DOM redaction requires a network guard; it cannot protect raw video.
Illustration production is local and preserves source pixels. Keep machine,
visual and publication QA independent. Host review appends a hash-bound attestation;
never expose an automatic visual PASS tool or rewrite registered production files.
Organization-specific adapters belong in ignored `examples/private-adapters/`, outside the public build and package.

Browser programs belong in `src/browser/scripts/driver/` or `dom/`. Write typed
functions; build them into self-contained programs with `build:scripts`. DOM
programs imported with `?script` are callable functions bundled for the page's
separate JavaScript realm. Pass input data through JSON and Playwright arguments; imports and host
closures do not cross evaluation boundaries. Keep trusted observer source handling
at the explicit serializer boundary. Never expose internal scripts as model tools.

## Package and release contracts

Public exports are explicit in `package.json`. Preserve existing import aliases
when moving files. Tests stay outside `src/` and the published package. Publish
`build/` and the Screencaster agent skill; never commit generated output,
credentials, `node_modules/`, or capture artifacts.

`run.config.json` is private local launch configuration and may contain robot
credentials. Never print or inspect its contents in agent output, overwrite an
existing copy, stage it, or include it in package artifacts. Keep it ignored and
owner-only (`0600` on POSIX). Maintain `run.config.example.json` with empty
credentials and document changes in README and `docs/host-adapters.md`. Host auth
factories receive config options outside MCP arguments. Keep organization-specific
implementations in ignored `examples/private-adapters/`; never import them from public code,
examples, tests or shipped instructions. Keep
external comparison tooling and its settings outside this repository and package.
Launch settings and shipped instructions must describe only this implementation.
Report fixed errors, never raw config, credential values, child output or provider
exceptions.

GitHub workflows come from `@diplodoc/infra`; preserve standard job names and
ruleset compatibility. ESM tool configs use `.cjs`, with corresponding `.infrarc.yml`
exclusions. Release Please manages `master`; keep `package.json`,
`package-lock.json`, and `.release-please-manifest.json` versions aligned. See
README for publication. Coverage remains optional until SonarCloud is configured.

## Generated configuration documentation

Maintain `docs/configuration.md` as the configuration prose source and
`run.config.example.json` as the single canonical launch sample. Document
`storageState` as a replacement snippet, not a separate config file.
Keep authentication visible in the main sample; never combine it with top-level
storageState. The host module path is a documented integration placeholder. Run `npm run docs:generate`
to refresh the marked README section, packaged agent reference and
`run.config.schema.json`. These generated documentation/schema files are tracked
contracts; build output remains ignored. `npm run docs:check` and `test:package`
fail on drift. Do not edit the generated sections independently.

The application may compose optional providers; provider runtime imports must
stay within providers, media and shared. The built-in SpeechKit factory lives
in `src/providers`; examples retain compatibility re-exports only.

Private credentials normally live in ignored `.env`; `.env.example` contains only
empty values and placeholders. The launch config selects `envFile` explicitly and
uses env references. Never print or stage dotenv secrets. Existing process values
take precedence; browser storage state remains a separate private file.
