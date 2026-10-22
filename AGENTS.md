# AGENTS.md — Lumen

Instructions for every coding agent in this repo. `CLAUDE.md` imports this file; keep it.

## What this is
Lumen is Columen Labs' public React component system (MIT), published to npm as `@columenlabs/lumen-ui` and `@columenlabs/lumen-ui-types`. Columen's apps install it from npm. This repo is the only place the kit's source lives: change it here, release it, then bump the version in each app.

## Layout
- `packages/lumen-types`: the view model (views, formulas, domains and joins, catalog, frames, chart formulas). No React.
- `packages/lumen`: the components, `ui/*` (shadcn parts) and `theme.css`.
- `scripts/pack.sh` builds both into `out/`. `.github/workflows/publish.yml` publishes them on every merge to `main` and tags `v<version>`. CI and publishing run on OpenShip's self-hosted runner.

## Rules
- Neutral kit: no app's or product's names anywhere in the kit, comments included, and no import of an app's own packages. An app passes its names through `configureLumen` and its data through `registerDomains`. `scripts/check-kit-neutral.sh` fails lint on the names in the repository variable `LUMEN_FORBIDDEN_NAMES` (set it in your shell to run the check locally); the list itself never goes in the repo.
- General over specific: a part one app needs should be built so any app could use it, through props or slots, never by checking which app is running.
- No hand-rolled components where a shadcn or Radix part fits. Compose them.
- Every card body sits in `LumenBoundary`. Pickers are `LumenSelector`, drawers `LumenDrawer`, tabs `LumenTabs`.
- A `useExhaustiveDependencies` suppression needs a reason of three words or more (`scripts/check-suppressions.sh`). Settings section descriptions are one plain line of 64 characters or less (`scripts/check-settings-copy.sh`). Hard-coded px/rem class values may only go down (`scripts/check-magic-numbers.sh`, `scripts/magic-numbers.baseline`).
- Numbers use tabular figures and a true minus `−`. A gain or loss always shows a sign or arrow.
- No unit or e2e tests. Verify with lint, type-check and build. A visual change carries phone (390×844) and desktop (1440×900) screenshots in the PR, taken in an app that uses the change.
- Breaking changes are allowed while the version is 0.x, but say so in the PR, and land the app-side fix in the same release cycle.

## Release
1. Every merge to `main` publishes the next patch (0.1.0, 0.1.1, ...) of the minor in `packages/*/package.json` and tags it. For a new minor (new parts or anything that breaks), set both package.json versions to `x.y.0` in the PR.
2. Bump the exact version in each app (`@columenlabs/lumen-ui` and `@columenlabs/lumen-ui-types` together).

## Conventions
- Bun only, never npm, yarn or pnpm. The one exception is the publish workflow, which calls `npm publish`.
- Commit prefixes: `feat:`, `fix:`, `perf:`, `infra:`, `docs:`. Branch from `main`, PR into `main`.
- Never commit secrets. Publishing signs in with the repository secret `NPM_TOKEN`.
- This repo is public: workflows run on the self-hosted runner only for this repo's own branches, never for a fork's pull request.

## Verify before pushing
```bash
bun run lint && bun run type-check && bun run build
```
