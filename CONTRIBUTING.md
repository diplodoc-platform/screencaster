# Contributing

Use Node.js 24+ and npm 11.5.1+.

```sh
git clone https://github.com/diplodoc-platform/screencaster.git
cd screencaster
npm ci --no-workspaces
```

Create a branch from `master`, make your changes, and run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The package currently contains only a scaffold. Add Vitest tests with the core
implementation and remove `--passWithNoTests` from the test script at that point.

Use Conventional Commits and write code, comments, and documentation in English.
Open a pull request with a description of the change and its validation. Changes
to `master` require the configured review and CI checks. Git hooks run lint-staged
and validate commit messages.
