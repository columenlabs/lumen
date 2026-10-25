# AGENTS.md — Lumen

Instructions for every coding agent in this repo. `CLAUDE.md` imports this file; keep it.

## What this is
Lumen is Columen Labs' public React component system (MIT), published to npm as `@columenlabs/lumen-ui` and `@columenlabs/lumen-ui-types`. Columen's apps install it from npm. This repo is the only place the kit's source lives: change it here, release it, then bump the version in each app.

## Layout
One repo for the Lumen family: each package is a folder `packages/<name>` published as `@columenlabs/lumen-<name>`, all at one version from one release. Today `ui` and `ui-types`; `ai`, `auth`, `vault`, `ship` and `ops` (shared backend parts) join as they are moved in. A part joins only when two or more apps run it, it names no product, it moves from working code, and it owns no app's data.
- `packages/ui-types` (`@columenlabs/lumen-ui-types`): the view model (views, formulas, domains and joins, catalog, frames, chart formulas). No React.
- `packages/ui` (`@columenlabs/lumen-ui`): the components, `ui/*` (shadcn parts) and `theme.css`.
- `scripts/pack.sh` builds both into `out/`. `.github/workflows/publish.yml` publishes them on every merge to `main` and tags `v<version>`. CI and publishing run on OpenShip's self-hosted runner.

## Rules
- Neutral kit: no app's or product's names anywhere in the kit, comments included, and no import of an app's own packages. An app passes its names through `configureLumen` and its data through `registerDomains`. `packages/ship/scripts/check-kit-neutral.sh` fails lint on the names in the repository variable `LUMEN_FORBIDDEN_NAMES` (set it in your shell to run the check locally); the list itself never goes in the repo.
- General over specific: a part one app needs should be built so any app could use it, through props or slots, never by checking which app is running.
- No hand-rolled components where a shadcn or Radix part fits. Compose them.
- Every card body sits in `LumenBoundary`. Pickers are `LumenSelector`, drawers `LumenDrawer`, tabs `LumenTabs`.
- A `useExhaustiveDependencies` suppression needs a reason of three words or more (`lumen-ship check suppressions`). Settings section descriptions are one plain line of 64 characters or less (`lumen-ship check settings-copy`). Hard-coded px/rem class values may only go down (`lumen-ship check magic-numbers`, `scripts/magic-numbers.baseline`).
- Table rows are one line: one value per cell (a small bar or tag at most); more goes in a hover tooltip, never stacked text or sub-rows. Prefer a `LumenTokenizedFilter` field over another row of tabs.
- Header numbers are metric cards: `TileRow fill` of `Tile` / `TileToggleGroup fill`, with `spark` (daily history) where one exists.
- Metered columns: one number per cell via `UnitValue`; Amount vs % of allowance through `showAs` (saved as `shows`); the other reading in a hover card; Total/group cells via `rollRender` (sum amounts with units, recompute shares, never sum %).
- Share bars are `ShareMeter`: a fixed track and a fixed, right-aligned tabular number, so a column's bars line up.
- Sidebar: one selected row (best URL match, query included); an open parent is never shown as selected. Sub-items take `icon` + `color` and a `badge` that lines up with the section's counts.
- What's new ships in every app through `LumenShell`'s `releases` prop and lumen-ship's `listReleases`; it shows an empty state before the first release.
- Numbers use tabular figures and a true minus `−`. A gain or loss always shows a sign or arrow.
- No unit or e2e tests. Verify with lint, type-check and build. A visual change carries phone (390×844) and desktop (1440×900) screenshots in the PR, taken in an app that uses the change.
- Breaking changes are allowed while the version is 0.x, but say so in the PR, and land the app-side fix in the same release cycle.

## Release
1. Every merge to `main` publishes the next patch after the newest tag (0.1.0, 0.1.1, ...), tags it and makes its GitHub release. `lumen-ship release` (`packages/ship`, config `lumen-ship.json`, prompt `.github/release-prompt.md`) has Claude (secret `ANTHROPIC_API_KEY`) write the notes from the merged pull requests: Key takeaways that name the exported part and prop each change lives in, then a section per area. Notes naming a product in `LUMEN_FORBIDDEN_NAMES` are not published. Run workflow on Publish with a tag (and redo) writes one tag's release again. A new minor is cut only when the owner asks: Run workflow on Publish with bump = minor (the next minor neither a tag nor npm has used). PRs never change the versions in `packages/*/package.json`, which publishing does not read.
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
