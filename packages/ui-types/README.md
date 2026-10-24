# @columenlabs/lumen-ui-types

Lumen's view model: the schemas and registries that [`@columenlabs/lumen-ui`](https://www.npmjs.com/package/@columenlabs/lumen-ui) reads, and that your server can check against. No React, so it runs in a browser, a Worker or Node alike.

- Docs: https://lumen.columenlabs.com/docs/
- For agents: https://lumen.columenlabs.com/llms.txt
- Source: https://github.com/columenlabs/lumen (`packages/ui-types`). MIT.

## Install

```bash
bun add @columenlabs/lumen-ui-types
```

Pin it to the same exact version as `@columenlabs/lumen-ui`.

## The model in one paragraph

A **domain** is a set of rows with their own fields and the **keys** its rows carry (a symbol, an account). A **join** is a set of fields that attaches to any row with that key (a symbol's price, an account's cash). A **view** is one config over one domain: its columns, filters, grouping, formulas and widgets. The **catalog** lists every domain your pages show and the function that reads it. The kit ships the shapes and the machinery with every list empty; your app fills them once at start with `registerDomains`.

## Modules

Import each by its path, for example `@columenlabs/lumen-ui-types/views`.

| Path | What it holds |
|---|---|
| `/registry` | `registerDomains`: what your app tells the kit about its data, once at start, on the server and in the browser alike |
| `/views` | The view config schema (columns, filters, group, pivot, sort, formats, totals, widgets and their styles) and `upgradeViewConfig` |
| `/view-formula` | Formula columns in Jexl (an interpreter, no `eval`): `group_sum`, `total_sum`, names by where a field comes from, and the checker |
| `/domains` | Keys, joins and `joinFields`: which fields attach to a row by its key |
| `/catalog` | The data catalog: each domain's app, tables, fields and reader, and lookups such as `readableDomain` |
| `/frames` | Frames: named rows plus the one script that made them, linked to a card by key or a snapshot of their own |
| `/workspaces` | Workspaces: a page of tabs, each tab one view config over a frame or a domain |
| `/chart-formula` | Chart indicators as specs: a built-in with any window (`ema_13`) or a formula over open, high, low and close |
| `/market` | The market widget's symbols and the shapes of bars and quotes |
| `/tasks` | Background tasks: the shape every app reports and the header's Tasks list reads |
| `.` | What belongs to no module, such as the Refresh request header |

## Register your data

```ts
// src/registry.ts: the module every entry imports first
import { registerDomains } from '@columenlabs/lumen-ui-types/registry';

registerDomains({
  joins: { /* key → the fields that attach to a row with that key */ },
  joinSources: { /* where each join's fields come from */ },
  domainKeys: { /* domain → the keys its rows carry */ },
  catalog: { /* domain → its app, tables, fields and reader */ },
});
```

Call it before anything renders or answers, in both your server and your browser entries, so both read the same lists.

## Versions

0.x: any minor may break things until 1.0. Every merge to Lumen's `main` publishes the next patch of every Lumen package; see the [releases](https://github.com/columenlabs/lumen/releases).
