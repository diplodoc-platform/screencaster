# Diplodoc Screencaster

Browser guide media generation for documentation.

`@diplodoc/screencaster` is the starting point for the shared browser automation
and media generation core in Diplodoc.

This repository currently contains only the TypeScript package scaffold. The core
implementation will be imported separately. The public API, scenario format, and
capture commands will be defined as part of that work.

The library entry point is empty, and the CLI only prints a placeholder message.
Version `0.0.1` is prepared for the initial npm release.

## Development

Requires Node.js 24+ and npm 11.5.1+.

Run from this directory:

```sh
npm ci --no-workspaces
npm run build
npm start
```

Validation and watch mode:

```sh
npm run typecheck
npm run lint
npm test
npm run watch
```

`npm run lint:fix` applies the shared Diplodoc formatting rules.

There are no tests yet. `npm test` uses Vitest with `--passWithNoTests` until the
core implementation and its tests are added.

## Structure

- `src/index.ts` — empty library entry point.
- `src/cli.ts` — placeholder for the `screencaster` command.
- `build/` — generated JavaScript and TypeScript declarations.

The package builds independently of the Diplodoc metapackage. It uses
`@diplodoc/infra` for TypeScript and lint configuration.

## Releases

The npm package is `@diplodoc/screencaster` and is published with public access
and provenance through `.github/workflows/release.yml`, using the shared
`NPM_TOKEN` organization secret.

For the initial release, merge the scaffold into `master` and create a GitHub
release tagged `v0.0.1` at that commit. The workflow checks that the tag matches
`package.json`, runs tests and type checking, builds the package, and publishes it.

Subsequent versions are managed by Release Please on `master`, using the shared
`YC_UI_BOT_GITHUB_TOKEN` secret. Merge its release PR to create the next tag and
trigger npm publication. The release workflow also supports manual stable and
prerelease publishing, as well as version deprecation.
