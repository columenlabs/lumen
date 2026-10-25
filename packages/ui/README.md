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

**Frame.** `LumenShell` (sidebar with icons-only collapse and a drawer on phone, header, status bar, Settings, profile menu, ⌘K Find), `LumenAppSwitcher`, `WhatsNew` (release notes in a drawer), `TasksButton` and `TasksProvider` (background work in the header), `NotificationsSettings`, `McpSettings`, sign-in screens (`LumenAuthStage`, `LumenSecondStep`, `LumenSignInMethods`, `LumenBackupCodes`), `StatusHealth`, `LumenBoundary` (keeps a crash inside its card), `LumenPageState` (loading, empty and error), `lumenToast`.

**Pages and views.** `LumenLayout` (a page of cards from one view config: filter, tiles, widgets; Edit layout and Edit widget when you pass `onConfigChange`), `LumenGrid` (the 6-column grid under it), `LumenView` and `LumenViewCard` (a table that filters, groups, pivots and totals the rows you load), `LumenTable`, `LumenTokenizedFilter`, `LumenWidget` and `LumenSavedWidget` (the frame every card sits in, with its link square and controls), `LumenCard` (one number and its lines), `LumenPager`, `DetailsTable`, `LumenTree`, `useAppView` (a page whose layout each person can change and reset).

**Charts.** `LumenChart` (one or more symbols' prices, with indicators), `LumenEChart`, `LumenGeoMap`, growth and price charts, `StackedBars`, `StackedColumns`, `RankedBars`.

**Pickers and panels.** `LumenSelector` (every picker), `LumenDrawer` with `DrawerSection` (a side panel on desktop, a sheet on phone), `LumenTabs`, `LumenConfirm` (destructive confirms), `LumenForm`, `LumenDateInput`, `LumenChoice`, `LumenSecret`, `RenameField`, `ResetButton`, `SaveButton` with `FormIssue` (a Save that says why it can't), `IconPicker`.

**Primitives.** The shadcn parts under `@columenlabs/lumen-ui/ui/*` (`ui/button`, `ui/badge`, `ui/input`, ...) and `theme.css` (light and dark tokens).

Every export, its props and an example are on the [docs](https://lumen.columenlabs.com/docs/) and in [`llms-full.txt`](https://lumen.columenlabs.com/llms-full.txt).

## Rules the kit follows, and apps should too

- Pickers are `LumenSelector`, side panels `LumenDrawer`, tabs `LumenTabs`, destructive confirms `LumenConfirm`; reach for the raw `ui/*` part only when no Lumen part fits.
- Every card body sits in `LumenBoundary`, so one crash never blanks a page.
- Numbers use tabular figures and a true minus `−`; a gain or loss always shows a sign or arrow.
- Bars in a column line up: use `ShareMeter` (fixed track, fixed right-aligned number), never a bar sized by its label.
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
