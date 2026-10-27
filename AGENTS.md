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
- Design patterns live in [`DESIGN.md`](DESIGN.md) (helper text goes in an `InfoTip`, and most labels need none; actions are icon first and edit in place, see Actions: icon first) and what blocks a merge in [`REVIEW.md`](REVIEW.md). Read both before UI work or a PR.
- Neutral kit: no app's or product's names anywhere in the kit, comments included, and no import of an app's own packages. An app passes its names through `configureLumen` and its data through `registerDomains`. `packages/ship/scripts/check-kit-neutral.sh` fails lint on the names in the repository variable `LUMEN_FORBIDDEN_NAMES` (set it in your shell to run the check locally); the list itself never goes in the repo.
- General over specific: a part one app needs should be built so any app could use it, through props or slots, never by checking which app is running.
- No hand-rolled components where a shadcn or Radix part fits. Compose them.
- A card is as tall as its content; only a `LumenGrid` cell stretches its card to the cell (`data-folded` keeps a folded one short). Never give a card `h-full` outside the grid: in a scrolling column (Settings, a drawer, a sheet) it clips at one screen and leaves nothing to scroll.
- Every card body sits in `LumenBoundary`. Pickers are `LumenSelector`, drawers `LumenDrawer`, tabs `LumenTabs`.
- A settings list of things (providers, channels, accounts) is `LumenExpandList` of `LumenExpandRow`s: each row starts collapsed, shows its name, a line and a badge, and opens in place to its own settings, one at a time.
- A `useExhaustiveDependencies` suppression needs a reason of three words or more (`lumen-ship check suppressions`). Settings section descriptions are one plain line of 64 characters or less (`lumen-ship check settings-copy`). Hard-coded px/rem class values may only go down (`lumen-ship check magic-numbers`, `scripts/magic-numbers.baseline`).
- Any field makes a Row of numbers or Number card (`cardAgg`): numbers sum, a percent or weight takes its max (never sum %), text counts its distinct values. A number the app draws with `render` still rolls up from `value`.
- Short values never wrap: a number, time, email, id, badge or label stays on one line, and where room runs out it ends in an ellipsis with the full text on hover (`truncate` + `title`). `.num`, `<time>` and `<kbd>` never wrap (theme.css); label and value pairs are `FactList`.
- Table rows are one line: one value per cell (a small bar or tag at most); more goes in a hover tooltip, never stacked text or sub-rows. Prefer a `LumenTokenizedFilter` field over another row of tabs.
- Rows NEVER wrap, at any width, on a phone above all: every table row (data, group, sub-group, Total) is one line. On a phone LumenView draws each row as a one-line card (theme.css `table[data-cards]`): the name (`data-card="lead"`, truncates) and one value on the right (`data-card="meta"`: the sorted column, else the first number or date, else the next column not `hideOnPhone`); every other value waits in the row's drawer or panel, never on a second line. Roll-up rows carry `data-rollup`. theme.css holds every row to one line whatever an app draws in it, so never add CSS that lets a row's cells wrap, and never give a name cell a bare `colSpan` without `data-card`. A two-line row in the app's interaction smoke (UI gate 3) blocks the merge.
- Header numbers are metric cards: `TileRow fill` of `Tile` / `TileToggleGroup fill`, with `spark` (daily history) where one exists.
- A table's first (name) column stops at `--lead-col-max` (18rem, at most 55% of a phone screen): a longer name ends in an ellipsis on one line, the full name in its hover. Another column caps with `ViewField.maxWidth`; `maxWidth: false` lifts it. Never let one long value push the other columns off screen.
- One column, one edge: a number column right-aligns everything (header, value, dash, Total) on one edge. Put a number with a unit through `UnitValue`, never `value + unit` text; LumenView marks a column `data-units` from the first `UnitValue` drawn in it and hangs the unit slot (`--unit-slot`) in that column's gutter, so an app's own dash or text in it still lines up. A status dot sits just left of its number, never in a slot of its own. Never pad, margin or `w-*` a cell to nudge it into line.
- Metered columns: one number per cell via `UnitValue`; Amount vs % of allowance through `showAs` (saved as `shows`); the other reading in a hover card; Total/group cells via `rollRender` (sum amounts with units, recompute shares, never sum %).
- Paging holds its page while rows change in place (a selection tick, an edit, a refresh, a bulk apply). Only a new filter (a different set of row keys), grouping, sort or page size goes back to page 1, and a page past the end clamps to the last. Never reset the page on a new `rows` array.
- Popups always have a way out (DESIGN.md, Popups: always a way out): on a phone every sheet, drawer, picker and dialog shows a close × or Cancel, closes on a tap outside, a swipe down on its grab handle, Esc and back, pads the safe areas, and its title never runs under the ×. Build overlays only from the kit's `Sheet`, `Dialog` and `AlertDialog`, which give all of it.
- Pickers fit the screen: `LumenSelector` opens above its trigger when the room below is short, its list scrolls and its search, header and footer (Done) always stay in view. Never cap a popup's list without its footer.
- Bulk-action bars are `LumenBulkBar` over a `selection`: Apply clears the selection and dismisses the bar; Undo (toast) restores the change, not the selection.
- Share bars are `ShareMeter`: a fixed track and a fixed, right-aligned tabular number, so a column's bars line up.
- Pooled caps: rows that share one cap (an account's allowance split by label or resource) roll up with `poolShare` in `rollRender`: the pool's use over its cap, never a sum or max of the rows' %; a group across pools reads its fullest pool. Draw the split with `ShareMeter segments` (who used the cap, a tick at the cap), never a hand-rolled stacked bar.
- Meter colours are canonical: grey under 75%, amber (`watch`) from 75%, red (`alert`) from 90% of a cap. `ShareMeter` and `UnitValue share` colour themselves; anything else drawing a share of a cap uses `meterLevel` / `METER_LEVEL_COLOR`, never its own numbers. An app moves the levels once with `configureLumen({ meterLevels: { watch, alert } })`; one meter overrides with its `levels` prop.
- Pace and time to a cap: `burnRate` + `timeToCap`, drawn by `TimeToCap` and picked with `PaceWindowPicker` (6h, 12h, 24h, 7d; `usePaceWindow` shares the choice). Colour is the meter level of where the meter lands at reset; a lone spike hour counts as 3× the window's median (0 when most hours are empty); a window with too little use (`minTotal`, default 0.1% of the cap) is `thin` and gives no ETA. Never hand-roll an ETA. A part of a pooled meter (one bucket of an account's allowance) shows the pool's time only when it drives the pace.
- Changes between periods go through `trendChange` + `TrendValue`: a % only over a big enough earlier period (`minBase`), the plain difference (`▲ +3`) under it, `▲ >10×` past ten times. Never a % over a near-empty baseline.
- Sidebar: one selected row (best URL match, query included); an open parent is never shown as selected. Sub-items take `icon` + `color` and a `badge` that lines up with the section's counts.
- What's new ships in every app through `LumenShell`'s `releases` prop and lumen-ship's `listReleases`; it shows an empty state before the first release.
- Numbers use tabular figures and a true minus `−`. A gain or loss always shows a sign or arrow.
- No unit or e2e tests. Verify with lint, type-check and build. A visual change carries phone (390×844) and desktop (1440×900) screenshots in the PR, taken in an app that uses the change.
- Esc closes the topmost thing only: a picker open inside a Sheet, Dialog or AlertDialog takes the Esc and the overlay stays (`ui/overlay-guard.ts`, wired into all three). A new overlay or a new kind of picker joins that guard.
- Coloured chips (`ColorChip`) draw their text in the colour pulled toward the foreground, so any hue reads at 4.5:1 in light and dark. Never put a raw app colour on its own tint as text.
- Hover-card and tooltip triggers a person can Tab to show the focus ring (`HoverCardTrigger` carries it); never `outline-none` a focusable thing without a `focus-visible` ring.
- Breaking changes are allowed while the version is 0.x, but say so in the PR, and land the app-side fix in the same release cycle.

## UI gate: how a change is known to have no glitches
Screenshots show looks, not behaviour. Before a UI change is done, run the app's interaction smoke (in an app that uses the change, e.g. `bun e2e/smoke.ts` in an app that has one) at phone (390×844) and desktop (1440×900), light and dark. It drives every page, Settings section and control, and checks the invariants below on every screen and every popup. CI runs it on every app PR. Any of these is a bug, whatever the screenshot looks like:
1. **Reach:** every scroll box scrolls by wheel and by finger; no content cut off by `overflow: hidden/clip` with no way to reach it; no sideways page scroll.
2. **Popups:** every drawer, sheet, dialog, menu and picker opens from its trigger, fits the screen, has a way out (× or Cancel on a phone, Esc, tap outside), its title clears the ×, and Esc closes only the topmost one.
3. **Lines:** table rows, numbers, times, badges and labels stay on one line; no text overlaps other text.
4. **Controls:** sort changes the order, a filter that matches nothing shows the empty state, paging holds its page on a selection, a selection shows the bulk bar with a Clear, collapse can open again, every hover help shows.
5. **Access:** text reads at 4.5:1 (3:1 large), a phone's tap targets are 24px or sit alone in a 24px row, every Tab stop is on screen, uncovered and shows a focus ring.
6. **Health:** no console error, no failed or 4xx/5xx call, on any page or after any click.
7. **Visual:** screenshots that differ from main's are listed for review; an unplanned one is a bug.

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
