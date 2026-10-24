<div align="center">

# Lumen

**A React component system for data apps**, from [Columen Labs](https://github.com/columenlabs). An app frame, data-driven pages and views, widgets, charts, drawers and pickers, all on one theme. You give it data and a view config; it draws the screen.

[![npm](https://img.shields.io/npm/v/@columenlabs/lumen-ui?label=%40columenlabs%2Flumen-ui&color=5b8cff)](https://www.npmjs.com/package/@columenlabs/lumen-ui)
[![license](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)
[![docs](https://img.shields.io/badge/docs-live-f59e0b)](https://lumen-ui.columenlabs.com/docs/)
[![built on shadcn/ui](https://img.shields.io/badge/built%20on-shadcn%2Fui-111)](https://ui.shadcn.com)

[**Docs**](https://lumen-ui.columenlabs.com/docs/) · [**Changelog**](https://github.com/columenlabs/lumen-ui/releases) · [**llms.txt**](https://lumen-ui.columenlabs.com/docs/llms.txt) · [**Install**](#install)

<img src=".github/assets/lumen-in-play.png" alt="A sample app built with Lumen: sidebar, summary tiles, a donut and bar list, a filterable table and the status bar, in dark mode" width="900" />

<sub>A made-up sample app: everything on screen is Lumen.</sub>

</div>

## What's inside

| | Part | What it does |
|---|---|---|
| 🪟 | **App shell** | `LumenShell`: sidebar (icons-only collapse, a drawer on phone), header, status bar, Settings, profile menu and ⌘K Find |
| 🧱 | **Blocks** | `LumenLayout` and `LumenGrid` (a page of cards you can rearrange), `LumenWidget` (a card with its header, link square and controls), sign-in and Security, Settings sections, tabs |
| 📊 | **Views and charts** | `LumenView` and `LumenTable` (filter, group, pivot, totals), `LumenCard`, `LumenChart`, `LumenEChart`, price and growth charts |
| 🎛️ | **Pickers and panels** | `LumenSelector`, `LumenDrawer`, `LumenConfirm`, `LumenForm`, `LumenDateInput`, `LumenTabs` |
| 🧩 | **Primitives** | The shadcn/ui parts under `ui/*` and `theme.css` |

| Package | What it holds |
|---|---|
| [`@columenlabs/lumen-ui`](packages/lumen) | The components, the shadcn parts under `ui/*`, and `theme.css` |
| [`@columenlabs/lumen-ui-types`](packages/lumen-types) | The view model: view config, formulas, domains and joins, the data catalog, frames, chart formulas |

## Pages people can rearrange

Give `LumenLayout` an `onConfigChange` and every page can be changed by the person using it: **Edit layout** moves and sizes the widgets on a 6-column grid, and each widget's **Edit widget** changes its type, fields and controls. Both write back into the view config.

| Edit layout | Edit widget |
|---|---|
| <img src=".github/assets/edit-layout.gif" alt="Edit layout: the Donut narrows to two columns, the Bar list slides over and widens, then the layout is saved" width="440" /> | <img src=".github/assets/edit-widget.gif" alt="Edit widget: the Donut's menu opens Edit widget, its By field changes from Region to Format, and the saved donut shows formats" width="440" /> |

Try both live on the docs' [Edit layout](https://lumen-ui.columenlabs.com/docs/?path=/docs/blocks-edit-layout--docs) and [Edit widget](https://lumen-ui.columenlabs.com/docs/?path=/docs/blocks-edit-widget--docs) pages.

> **Status: 0.x.** Any minor version may break things until 1.0.

**For coding agents:** read [`llms.txt`](https://lumen-ui.columenlabs.com/docs/llms.txt) or the [component manifest](https://lumen-ui.columenlabs.com/docs/manifests/components.json). `bun run --filter=lumen-docs dev` also serves Storybook's MCP at `http://localhost:6006/mcp`.

## Install

```bash
bun add @columenlabs/lumen-ui @columenlabs/lumen-ui-types
bun add react react-dom @tanstack/react-query @tanstack/react-router   # peers
bun add -d tailwindcss @tailwindcss/vite tw-animate-css shadcn
```

## Use

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

```tsx
import { LumenShell } from '@columenlabs/lumen-ui';

<LumenShell app="myapp" appLabel="My app" brand={<Logo />} nav={nav} user={{ email, name }}>
  <Outlet />
</LumenShell>
```

Your app plugs its own parts into `LumenShell`'s slots: `brand`, `headerActions`, `panel`, `wrap`, `shared`, `profile` and `statusEnd`. It passes its names through `configureLumen` and registers its data domains through `registerDomains` (`@columenlabs/lumen-ui-types/registry`). The kit itself never names a product.

Charts use TradingView Lightweight Charts™ with its logo off. Please link to https://www.tradingview.com/ somewhere in your app (see [NOTICE](NOTICE)).

## Develop

```bash
bun install
bun run lint && bun run type-check && bun run build   # build writes out/lumen-types, out/lumen and docs/dist
bun run --filter=lumen-docs dev                       # the docs at http://localhost:6006
```

The docs (`docs/`) are Storybook over the kit's source: add or change a story in `docs/stories/` with the part. `docs/wrangler.jsonc` serves `docs/dist` at lumen-ui.columenlabs.com/docs.

To try a change inside an app before it is published, use `bun link` in `out/<package>` and `bun link @columenlabs/lumen-ui` in the app.

## Releases

Every merge to `main` publishes both packages at the next patch version and tags it ([publish.yml](.github/workflows/publish.yml)), with notes on what changed in each release: see the [releases](https://github.com/columenlabs/lumen-ui/releases). A new minor is cut only by hand (Run workflow with bump = minor).

## License

MIT, see [LICENSE](LICENSE). Third-party notices are in [NOTICE](NOTICE).
