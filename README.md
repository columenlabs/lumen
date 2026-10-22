# Lumen

Lumen is a React component system from [Columen Labs](https://github.com/columenlabs): an app frame, data-driven pages and views, widgets, charts, drawers and pickers, all sharing one theme. You give it data and config, and it handles the screen.

| Package | What it holds |
|---|---|
| [`@columenlabs/lumen-ui`](packages/lumen) | Components: `LumenShell` (sidebar, header, status bar, settings), `LumenLayout` and `LumenGrid` (a page of cards), `LumenView` and `LumenTable` (filter, group, pivot), `LumenWidget` and `LumenCard`, `LumenChart` and `LumenEChart`, `LumenDrawer`, `LumenSelector`, `LumenTabs`, `LumenForm`, the shadcn parts under `ui/*`, and `theme.css` |
| [`@columenlabs/lumen-ui-types`](packages/lumen-types) | The view model: view config, formulas, domains and joins, the data catalog, frames, chart formulas |

Status: 0.x. Any minor version may break things until 1.0.

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
bun run lint && bun run type-check && bun run build   # build writes out/lumen-types and out/lumen
```

To try a change inside an app before it is published, use `bun link` in `out/<package>` and `bun link @columenlabs/lumen-ui` in the app.

## Releases

Every merge to `main` publishes both packages at the next patch version and tags it ([publish.yml](.github/workflows/publish.yml)). The minor version comes from `packages/*/package.json`.

## License

MIT, see [LICENSE](LICENSE). Third-party notices are in [NOTICE](NOTICE).
