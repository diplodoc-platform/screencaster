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
npm run test:coverage
npm run build
npm run test:package
```

Add Vitest tests under `test/unit/`, mirroring the relevant capability. Browser
integration tests live under `test/browser/` and run separately with `npm run test:browser`; they require
Playwright Chromium and FFmpeg. See README for setup instructions.

The coverage command writes `coverage/lcov.info` from the unit and architecture
suites for SonarCloud. Browser integration coverage is separate.

Use Conventional Commits and write code, comments, and documentation in English.
Open a pull request with a description of the change and its validation. Changes
to `master` require the configured review and CI checks. Git hooks run lint-staged
and validate commit messages.
