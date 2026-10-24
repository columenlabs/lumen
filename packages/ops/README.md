# @columenlabs/lumen-ops

Lumen's ops meters for Cloudflare Workers: every data query your app runs becomes one Analytics Engine point, so you can find slow and heavy queries and fix them. The meter wraps your bindings once, so new code is metered without opting in. It writes only each query's shape, never a value.

- Docs: https://lumen.columenlabs.com/docs/
- For agents: https://lumen.columenlabs.com/llms.txt
- Source: https://github.com/columenlabs/lumen (`packages/ops`). MIT.

## Install

```bash
bun add @columenlabs/lumen-ops
```

Pin it to the same exact version as your other Lumen packages. It uses `AsyncLocalStorage`, so the Worker needs the `nodejs_compat` flag.

## Set up

Bind an Analytics Engine dataset in `wrangler.jsonc`:

```jsonc
"analytics_engine_datasets": [{ "binding": "QUERIES", "dataset": "myapp_queries" }]
```

Wrap the bindings once at start, and hand the wrapped ones to your app:

```ts
import { foldRoute, meteredClickHouse, meteredD1, setQueryCallerOf, setQuerySink } from '@columenlabs/lumen-ops';

setQuerySink(env.QUERIES);
// Name the request in scope: the app (or part of it), the route, and the tool when an MCP call runs.
setQueryCallerOf(() => {
  const req = currentRequest(); // your own request scope
  return req && { app: 'myapp', kind: 'fetch', route: foldRoute(new URL(req.url).pathname) };
});
const db = meteredD1(env.DB);
const clickhouse = meteredClickHouse(env.CLICKHOUSE); // any ClickHouse HTTP service binding
```

In a Durable Object, meter its SQLite:

```ts
import { meteredSql } from '@columenlabs/lumen-ops';

const sql = meteredSql(state.storage.sql, { app: 'myapp', kind: 'do', route: 'Person' });
```

A cron run, queue batch or alarm names itself, so its queries are charged to it:

```ts
import { withQueryCaller } from '@columenlabs/lumen-ops';

await withQueryCaller({ app: 'myapp', kind: 'cron', route: 'nightly-rollup' }, () => rollup(env));
```

Another engine (R2 SQL, an HTTP database) calls `meterQuery({ engine, sql, method, ok, ms, ... })` from its one client.

## What a point holds

One point per statement (a D1 batch writes one per statement in it). The column order is the contract for reading the dataset back:

| Column | Holds |
|---|---|
| `index1` | Engine: `d1`, `clickhouse`, `do_sqlite`, `r2_sql` or your own |
| `blob1` … `blob5` | Engine, app, kind (`fetch`, `cron`, `queue`, `alarm`, `do`), route (ids folded to `:id`), tool |
| `blob6` … `blob8` | Op (`select`, `insert`, `update`, `delete`, `ddl`, `pragma`, `other`), fingerprint, the query's shape (up to 1 KB) |
| `blob9`, `blob10` | `ok` or `error`, method (`all`, `first`, `run`, `raw`, `batch`, `query`, `insert`, `exec`) |
| `double1` … `double8` | Wall ms, the engine's own ms, rows read, bytes read, rows returned, rows written, response bytes, HTTP status |

The shape has every string and number literal as `?`, `IN` lists folded to `(?...)`, comments and ClickHouse's `FORMAT` dropped, and an insert's rows cut off. The fingerprint is a hash of the shape, one per kind of query.

Read it back with the Analytics Engine SQL API, for example the slowest shapes of the last day:

```sql
SELECT blob7 AS fingerprint, any(blob8) AS shape, sum(_sample_interval) AS calls,
       quantileWeighted(0.95)(double1, _sample_interval) AS p95_ms
FROM myapp_queries
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY fingerprint ORDER BY p95_ms DESC LIMIT 20
```

## Exports

| Export | What it does |
|---|---|
| `setQuerySink(binding)` | The dataset every point goes to; nothing is written until it is set |
| `setQueryCallerOf(fn)` | Names the request in scope when no job is |
| `withQueryCaller(caller, fn)` | Charges every query inside `fn` to `caller` |
| `meteredD1(db)` | D1, metered: `prepare` and `batch`, with D1's own rows read and written and duration |
| `meteredClickHouse(binding)` | A ClickHouse HTTP service binding, metered when the answer has been read: wall time to the last byte, ClickHouse's own statistics |
| `meteredSql(sql, caller)` | A Durable Object's `storage.sql`, metered |
| `meterQuery(point)` | One point by hand, for any other engine |
| `queryShape(sql)` | The shape, fingerprint and op of a query |
| `foldRoute(path)` | A path with id-like segments as `:id` |

## Versions

0.x: any minor may break things until 1.0. Every merge to Lumen's `main` publishes the next patch of every Lumen package; see the [releases](https://github.com/columenlabs/lumen/releases).
