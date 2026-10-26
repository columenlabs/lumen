# @columenlabs/lumen-ops

Lumen's ops parts for Cloudflare Workers: every request your app answers, every event and every data query becomes one Analytics Engine point, so you can find errors, mismatches and slow or heavy queries and fix them. The meter wraps your bindings once, so new code is metered without opting in. It writes only each query's shape, never a value. It also meters tool calls (`/tools`) and sends signed webhooks (`/webhooks`).

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
| `setQueryRowCap(n)` | The most rows one statement should return; one that returns more is marked `capped` in `blob11` |

## Requests

`@columenlabs/lumen-ops/hono` meters every request a Hono app answers: mount it once, first, and every route the app has or adds later writes one point with its route template, status, outcome code and time. It names the request in scope, so events and queries inside carry its id.

```ts
import { requestId } from 'hono/request-id';
import { requestMeter } from '@columenlabs/lumen-ops/hono';
import { setRequestSink } from '@columenlabs/lumen-ops/requests';

app.use('*', async (c, next) => {
  setRequestSink(c.env.REQUESTS, { log: true }); // also one JSON line per point in Workers Logs
  await next();
});
app.use('*', requestId());
app.use('*', requestMeter({
  app: 'myapp',
  env: (c) => c.env.DEPLOY_ENV,
  describe: (c) => ({ surface: 'api', subject: c.get('accountId'), callerKind: 'key' }),
}));
```

| Column | Holds |
|---|---|
| `index1` | Subject: an opaque id the app makes for who called, or `anon` |
| `blob1` … `blob7` | App, surface, method, route template, outcome (`ok`, an `error` code from a JSON answer, `exception`, `http_<status>`), caller kind, caller id |
| `blob8` … `blob13` | Region, env, version, colo, country, request id |
| `double1` … `double6` | Status, ms, bytes in, bytes out, upstream ms, subrequests |

A path no route matched is written as `*`, so a scanner's junk never lands. Without Hono, wrap the handler in `withRequest(scope, route, fn)` and call `meterRequest(point)` yourself.

## Events

`@columenlabs/lumen-ops/events` writes what an app does that isn't a request it answers: a call to another service, a webhook in or out, a sync's start and end, a sign-in. With the request points they show whether what came in was acted on.

```ts
import { meterEvent, setEventSink } from '@columenlabs/lumen-ops/events';

setEventSink(env.EVENTS);
meterEvent({ event: 'bank.call', code: '/accounts/get', ok: res.ok, ms, status: res.status, upstream: true });
meterEvent({ event: 'sync.done', ok: true, subject: accountId, ref: connectionId, counts: [added, modified, removed] });
```

| Column | Holds |
|---|---|
| `index1` | Subject, or `anon` |
| `blob1` … `blob10` | App, event, code, outcome, ref, trigger, request id, upstream id, env, version |
| `double1` … `double6` | ms, status, count1, count2, count3, attempt |

`upstream: true` adds the call's time to the request's `upstream ms`. In a Durable Object, pass `app`, `requestId` and `env` yourself.

## Browser telemetry

`useLumenTelemetry` in `@columenlabs/lumen-ui` sends screens opened, uncaught errors (class and a hash of the stack, never the message), failed requests and Web Vitals in batches to `/api/t`. The Worker checks and writes them:

```ts
import { meterClientBatch, setClientSink } from '@columenlabs/lumen-ops/client';

setClientSink(env.CLIENT);
app.post('/api/t', async (c) => {
  meterClientBatch(await c.req.json().catch(() => null), { app: 'console', subject: c.get('accountId') });
  return c.body(null, 204);
});
```

| Column | Holds |
|---|---|
| `index1` | Subject, or `anon` |
| `blob1` … `blob9` | App, kind (`view`, `error`, `fetch_fail`, `vital`), route template, name, stack fingerprint, request id, version, device, env |
| `double1`, `double2` | Value (ms or score), status |

A batch that fails the schema is dropped whole; only codes, templates and numbers pass.

## Tool calls

`@columenlabs/lumen-ops/tools` meters each call an assistant or agent makes: one point per call with its latency, outcome and a hash of the code it ran, so slow or failing tools show up and the same script is grouped across runs.

```ts
import { meteredCall, meterToolCall, setToolSink } from '@columenlabs/lumen-ops/tools';

setToolSink(env.TOOL_CALLS); // an Analytics Engine dataset binding

// Wrap a call: latency and outcome are taken for you.
const rows = await meteredCall({ app: 'trade', tool: 'portfolio_list', kind: 'call' }, () => run(args));

// Or write one by hand, with the code a script ran.
meterToolCall({ app: 'trade', tool: 'script', kind: 'script', ok: true, ms: 840, code: source, rows: 120 });
```

| Column | Holds |
|---|---|
| `index1` | app |
| `blob1`…`blob9` | app, tool, kind, outcome (`ok` or `error`), error kind, code hash, source, tier, run id |
| `double1`…`double6` | ms, rows, bytes in, bytes out, tokens in, tokens out |

Arguments and results are never written; only their sizes.

| Export | What it does |
|---|---|
| `setToolSink(binding)` | The dataset tool points go to; nothing is written until it is set |
| `meterToolCall(point)` | One point by hand |
| `meteredCall(point, fn, errorKind?)` | Runs `fn`, timing it and writing its outcome |
| `codeHash(code)` | A short hash of a script, whitespace folded |

## Webhooks out

`@columenlabs/lumen-ops/webhooks` sends one delivery, signed per the [Standard Webhooks](https://www.standardwebhooks.com) spec when a secret is given, so the receiver can verify it with any Standard Webhooks library. It never throws: the result says how it went, for the app's own delivery log and retries.

```ts
import { newWebhookSecret, sendWebhook } from '@columenlabs/lumen-ops/webhooks';

const secret = newWebhookSecret(); // whsec_…, shown to its owner once, kept sealed
const r = await sendWebhook({
  url: endpoint.url,
  secret,
  id: event.id, // the same id on a retry
  body: JSON.stringify(event.payload),
  headers: { authorization: `Bearer ${endpoint.token}` },
  userAgent: 'MyApp-Webhooks/1',
});
if (!r.ok) scheduleRetry(event, r.status, r.error);
```

| Export | What it does |
|---|---|
| `sendWebhook(send)` | One POST: `{ ok, status, ms, id, error? }`; status 0 when the endpoint never answered |
| `newWebhookSecret()` | A new `whsec_` secret, 32 random bytes |

The endpoint's own headers go first, so they can never replace the signature headers. Redirects count as failures unless `redirect` says otherwise; the timeout is 10 s by default.

## Versions

0.x: any minor may break things until 1.0. Every merge to Lumen's `main` publishes the next patch of every Lumen package; see the [releases](https://github.com/columenlabs/lumen/releases).
