# Diplodoc Screencaster

`@diplodoc/screencaster` is a standalone ESM package for browser guide media
generation. It currently contains only a scaffold; the shared core will be
imported separately.

## Development

Use Node.js 24+ and npm 11.5.1+. Install with `npm ci --no-workspaces`.

- `npm run build` compiles `src/` to JavaScript and declarations in `build/`.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run lint` uses the shared `@diplodoc/infra` configuration.
- `npm test` runs Vitest. There are no tests yet; the scaffold explicitly allows
  an empty suite. Remove `--passWithNoTests` when the core and its tests arrive.
- `npm start` runs the placeholder CLI.

Write TypeScript in strict mode and keep code, comments, and documentation in
English. Use Conventional Commits. Keep the package independently buildable;
do not depend on the surrounding metapackage checkout.

## Package Boundaries

`src/index.ts` is the empty library entry point. `src/cli.ts` is the CLI entry
point. Public API and scenario contracts will be defined during core integration.
Exclude tests from the published build. Do not commit credentials or generated
`build/`, `coverage/`, or `node_modules/` directories.

## Infrastructure and Releases

GitHub workflows are the standard Diplodoc workflows from `@diplodoc/infra`.
Keep their job names compatible with the repository rulesets. CommonJS tool
configs use `.cjs` because the package is ESM; `.infrarc.yml` excludes their
`.js` template counterparts from infrastructure updates.

Release Please manages versions and release PRs on `master`. A published GitHub
release triggers `.github/workflows/release.yml`, which validates the package and
publishes it to npm with provenance using the shared `NPM_TOKEN` secret. Keep
`package.json`, `package-lock.json`, and `.release-please-manifest.json` versions
in sync. See README for the initial release procedure.

Coverage is optional until real tests and a SonarCloud project are configured.
Add `test:coverage` only when that setup is ready; the standard workflow skips
coverage when the script is absent.
