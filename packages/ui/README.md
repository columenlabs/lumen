# @columenlabs/lumen-ui

Lumen's React components for data apps: the app frame, pages and views over your rows, widgets, charts, drawers and pickers, all on one theme. You give it data and a view config; it draws the screen. Built on [shadcn/ui](https://ui.shadcn.com) (Radix UI, Base UI, Tailwind CSS 4). Its view model is [`@columenlabs/lumen-ui-types`](https://www.npmjs.com/package/@columenlabs/lumen-ui-types).

- Docs and live examples: https://lumen.columenlabs.com/docs/
- For agents: https://lumen.columenlabs.com/llms.txt
- Source: https://github.com/columenlabs/lumen (`packages/ui`). MIT.

## Install

Pin both packages to the same exact version.

```bash
bun add @columenlabs/lumen-ui @columenlabs/lumen-ui-types
bun add react react-dom @tanstack/react-query @tanstack/react-router   # peers
bun add -d tailwindcss @tailwindcss/vite tw-animate-css shadcn
```

## Set up

`src/index.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@columenlabs/lumen-ui/theme.css";
@source "../node_modules/@columenlabs/lumen-ui/dist";

/* your accent, per app (LumenShell sets data-app on <html>) */
:root[data-app="myapp"] { --primary: oklch(0.55 0.15 160); }
/* optional: numbers in the text font instead of mono (code stays mono via `font-code`) */
:root[data-app="myapp"] { --num-font: var(--app-font); }
```

At start, before anything renders, tell the kit about your app. The kit names no product: your names and data come in here.

```ts
import { configureLumen } from '@columenlabs/lumen-ui';
import { registerDomains } from '@columenlabs/lumen-ui-types/registry';

configureLumen({ prefsCookie: 'myapp_prefs' });   // where display preferences live
registerDomains({ /* your joins, sources and domain keys */ });
```

Wrap your routes in the shell:

```tsx
import { LumenShell } from '@columenlabs/lumen-ui';

<LumenShell app="myapp" appLabel="My app" brand={<Logo />} nav={nav} user={{ email, name }}>
  <Outlet />
</LumenShell>
```

Your own parts go in `LumenShell`'s slots: `brand`, `headerActions`, `panel` (a side panel such as an assistant), `wrap` (providers around the page), `shared`, `profile` (the profile menu) and `statusEnd` (the right end of the status bar).

Use `createDeskQueryClient()` for the app's TanStack Query client: data stays fresh 5 minutes and cached 30.

## What's inside

**Frame.** `LumenShell` (sidebar with icons-only collapse and a drawer on phone, header, status bar, Settings, profile menu, ⌘K Find), `LumenAppSwitcher` and `LumenSuiteSwitcher` (groups, apps on other sites, a list read from an address), `WhatsNew` (release notes in a drawer), `TasksButton` and `TasksProvider` (background work in the header), `NotificationsSettings`, `McpSettings`, sign-in screens (`LumenAuthStage`, `LumenSecondStep`, `LumenSignInMethods`, `LumenBackupCodes`, `LumenBotCheck` for Cloudflare Turnstile, `authErrorText` for errors in plain words), `StatusHealth`, `LumenBoundary` (keeps a crash inside its card), `LumenPageState` (loading, empty and error), `lumenToast`.

**Pages and views.** `LumenLayout` (a page of cards from one view config: filter, tiles, widgets; Edit layout and Edit widget when you pass `onConfigChange`; a card with `header: false` is its body alone), `LumenGrid` (the 6-column grid under it), `LumenView` and `LumenViewCard` (a table that filters, groups, pivots and totals the rows you load), `LumenTable`, `LumenTokenizedFilter`, `LumenWidget` and `LumenSavedWidget` (the frame every card sits in, with its link square and controls), `LumenCard` (one number and its lines), `LumenPager`, `DetailsTable`, `LumenTree`, `useAppView` (a page whose layout each person can change and reset).

**Charts.** `LumenChart` (one or more symbols' prices, with indicators), `LumenEChart`, `LumenGeoMap`, growth and price charts, `StackedBars`, `StackedColumns`, `TimeLines` (lines over time, with an optional right axis), `RankedBars` (with each bar's share of the total or of the first bar, and an empty state).

**Pickers and panels.** `LumenSelector` (every picker), `LumenDrawer` with `DrawerSection` (a side panel on desktop, a sheet on phone), `LumenTabs`, `LumenConfirm` (destructive confirms), `LumenForm`, `LumenDateInput`, `LumenChoice`, `LumenSecret`, `LumenFileField` (drop or pick a file), `RenameField`, `ResetButton`, `SaveButton` with `FormIssue` (a Save that says why it can't), `IconPicker`.

**Primitives.** The shadcn parts under `@columenlabs/lumen-ui/ui/*` (`ui/button`, `ui/badge`, `ui/input`, ...) and `theme.css` (light and dark tokens).

Every export, its props and an example are on the [docs](https://lumen.columenlabs.com/docs/) and in [`llms-full.txt`](https://lumen.columenlabs.com/llms-full.txt).

## Rules the kit follows, and apps should too

- Pickers are `LumenSelector`, side panels `LumenDrawer`, tabs `LumenTabs`, destructive confirms `LumenConfirm`; reach for the raw `ui/*` part only when no Lumen part fits.
- Every card body sits in `LumenBoundary`, so one crash never blanks a page.
- Numbers use tabular figures and a true minus `−`; a gain or loss always shows a sign or arrow.
- A page's header numbers are metric cards: `TileRow` of `Tile` (or `TileToggleGroup` when they pick what the page shows), with `fill` so they share the row, each with `spark` set to its daily history where it has one. Don't build a card of your own for this.
- Column widths: the first column (a row's name) grows only to `--lead-col-max` (18rem, theme.css); past it the cell truncates on one line and a plain text value shows in full on hover (a rendered cell brings its own hover card). Cap any other column with the field's `maxWidth` (`'12rem'`), or lift the cap with `maxWidth: false`. In a rendered name cell, put the name in a `truncate` span so the ellipsis lands on it, not on a chip after it.
- Column alignment is the table's, not the cell's. Text left, numbers right, and a number column has one right edge for its header, values, dashes and Total. `UnitValue` puts the unit in a fixed slot after the number (`--unit-slot`, 2rem) and its status dot just left of the number. In a LumenView table the first `UnitValue` drawn in a column marks it (`data-units` on every cell of that column, through the `UnitColumns` context and the cell's `data-col`); theme.css then widens that column's right gutter by the slot and hangs each unit in it. So a plain `—`, `Free` or `$0.21` an app draws in the same column sits on the digits' edge, and the header sits over the digits. Don't hand-place units, dots or padding to line a column up; if a column is off, draw its numbers through `UnitValue`. Outside a LumenView table (a hover card, a tile) `UnitValue` keeps its slot inline.
- A metered column (use against an allowance) shows one number per cell with `UnitValue` (right-aligned number, fixed muted unit slot, status dot), never `value [pct]`. Offer both readings through the field's `showAs` (Amount / % of allowance, picked per column in Edit view, saved as `shows`); default amounts for sizes (storage) and shares for capped counts. Put the other reading, the allowance and the cost formula in a hover card. Totals use `rollRender`: sum amounts with their unit; a share is the rows' total over their allowance, never a sum of percents.
- A floating bulk-action bar over a table's selection: Apply clears the selection and the bar goes away; the toast's Undo restores the change, not the selection. Cancel keeps the selection.
- Bars in a column line up: use `ShareMeter` (fixed track, fixed right-aligned number), never a bar sized by its label.
- A shared cap split by who used it (an account's allowance by label): `ShareMeter segments={[{ value, color, label }]}` stacks each part's share of the cap in its own colour on the same fixed track; past the cap the track reads as the total and a tick marks the cap. Roll such rows up with `poolShare(rows, { pool, used, cap })` in a field's `rollRender`: a pool's share is its rows' use over the cap (never a sum or max of their own %), and a group across several pools reads the fullest one (`top`).
- Meter levels are the kit's, not the app's: a share of a cap reads `ok` (grey) under 75%, `watch` (amber) from 75%, `alert` (red) from 90%. `ShareMeter` takes its colour from the share unless you pass `color`; `UnitValue share={0.8}` tints its number and dot the same way; usage progress cards follow the same levels. For any other mark (a dot, a chip, a "nearest cap" cell) call `meterLevel(share)` and colour it with `METER_LEVEL_COLOR` or `meterValueTone(share)`. Override per app with `configureLumen({ meterLevels: { watch: 0.8 } })` (each level can move alone) or per meter with `levels={{ watch: 0.5 }}`. Don't hand-roll `share >= 0.75` checks.
- Pace (time to a cap at the recent rate) is the kit's: `burnRate(samples, { per, gauge })` over the window's complete samples (hourly, or daily for `7d`), then `timeToCap(rate, used, cap, resetInHours)`. A lone sample above 3× the window's median counts as 3× the median (`spikes` says how many); a run of hot samples counts in full. Show it with `TimeToCap` (`in 2h 05m`, `At cap`, `Resets first`; `short` on a phone), coloured by the meter level of where the meter lands at reset, and pick the window with `PaceWindowPicker` (6h, 12h, 24h, 7d) in the page header; `usePaceWindow()` reads the same choice everywhere, kept in the viewer's browser (`setDefaultPaceWindow` sets the app's default). Where most hours are empty (median 0) a lone nonzero hour counts as 0, and a window with too little use (`timeToCap(..., { minTotal })`, default 0.1% of the cap) is `thin`: no time to the cap. Don't hand-roll ETAs or a window toggle.
- A change between periods (this week against last) is `trendChange(now, prev, { minBase })` drawn by `TrendValue`: `▲ 12%` over a big enough earlier period, the plain difference `▲ +3` when it is at or under `minBase`, `▲ >10×` past ten times. A % over a near-empty baseline misleads; never show one.
- Table rows are one line. A cell shows one value (with a small bar or tag at most); anything more (other metrics, the allowance, a breakdown) goes in a hover tooltip, never in stacked text or sub-rows.
- Chart colours are theme tokens (`var(--chart-1)`, `useChartTokens()`), never hex picked for one theme; `LumenEChart` resolves `var(--…)` in its option so sparklines read in light and dark.
- "No label" filters come built in: `LumenTokenizedFilter` pins a "No <field>" row on any text field where some rows have no value (an `empty` token); don't add your own toggle for it.
- Fewer tab rows: one row of tabs at most per card; narrower cuts (a product, a type) are fields in `LumenTokenizedFilter`, and a link to one opens the tab with that filter chip set.
- One selected sidebar row: give each nav item its own route, and let an open parent look neutral.
- What's new is on in every app: pass `releases="/api/releases"` to `LumenShell`, served by lumen-ship's `listReleases`.
- A Save blocked by its form's checks is a `SaveButton` that lists each issue, never a bare `disabled`.

## Notices

Charts use TradingView Lightweight Charts™ with its logo off. Please link to https://www.tradingview.com/ somewhere in your app (see NOTICE).

## Versions

0.x: any minor may break things until 1.0. Every merge to Lumen's `main` publishes the next patch of every Lumen package; see the [releases](https://github.com/columenlabs/lumen/releases).
