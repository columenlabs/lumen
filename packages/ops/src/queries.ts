/**
 * The query meter: every data query an app runs is one Analytics Engine point, with the engine it
 * ran on, the query's shape and what it cost, so slow and heavy queries can be found and fixed.
 *
 * It sits on the bindings, not the call sites: wrap D1 with `meteredD1`, a ClickHouse HTTP service
 * with `meteredClickHouse` and a Durable Object's SQLite with `meteredSql` once at start, and every
 * query through them is metered without opting in. Another engine calls `meterQuery` from its one
 * client.
 *
 * A point holds the query's shape only: string and number literals become `?` and `IN` lists fold,
 * so no value, id or person's data is ever written. The caller is the app, route and tool of the
 * request (or the cron job, queue batch or alarm) it ran in: `withQueryCaller` names a job, and
 * `setQueryCallerOf` tells the meter how to name the request in scope.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PointSink } from './points';

export type QueryEngine = 'clickhouse' | 'd1' | 'do_sqlite' | 'r2_sql' | (string & {});

export interface QueryCaller {
  /** The app, or the part of it, the query ran for. */
  app: string;
  /** fetch, cron, queue, alarm, ws or do. */
  kind: string;
  /** A route (folded path), or the job's name. */
  route: string;
  tool?: string;
}

export interface QueryPoint {
  engine: QueryEngine;
  /** The SQL as sent; only its normalized shape is written. */
  sql: string;
  /** How it was called: query, insert (ClickHouse); all, first, run, raw, batch (D1); exec. */
  method: string;
  ok: boolean;
  /** Wall time in the Worker, ms (request to last byte). */
  ms: number;
  /** The engine's own time, ms, where it says. */
  engineMs?: number;
  rowsRead?: number;
  bytesRead?: number;
  /** Rows the query returned. */
  rowsOut?: number;
  rowsWritten?: number;
  /** Response bytes (ClickHouse). */
  bytesOut?: number;
  /** HTTP status (ClickHouse). */
  status?: number;
  /** Defaults to the request or job in scope. */
  caller?: QueryCaller;
}

let sink: PointSink | undefined;
let rowCap = 0;
let callerOf: (() => QueryCaller | undefined) | undefined;
const scope = new AsyncLocalStorage<QueryCaller>();

/** The entry point sets the dataset once per isolate. */
export function setQuerySink(s: PointSink | undefined) {
  sink = s;
}

/**
 * The most rows one statement should return (an app's page size cap); a statement that returns
 * more is marked `capped`, so a query that dodged paging shows up. 0 turns the check off.
 */
export function setQueryRowCap(n: number | undefined) {
  rowCap = n && n > 0 ? n : 0;
}

/** How to name the request in scope when no job is (the app's request telemetry). */
export function setQueryCallerOf(f: (() => QueryCaller | undefined) | undefined) {
  callerOf = f;
}

/** Runs `fn` with `caller` as the caller of every query inside (cron runs, queue batches, alarms). */
export function withQueryCaller<T>(caller: QueryCaller, fn: () => T): T {
  return scope.run(caller, fn);
}

function currentCaller(): QueryCaller {
  const job = scope.getStore();
  if (job) return job;
  try {
    const c = callerOf?.();
    if (c) return c;
  } catch {}
  return { app: 'other', kind: 'other', route: '' };
}

/** Id-like path segments become `:id`, so a route never carries an id. */
export const foldRoute = (path: string) =>
  path
    .replace(/^\/api\/v1(?=\/|$)/, '/api')
    .split('/')
    .map((seg) =>
      /^[a-z]{1,3}_[A-Za-z0-9]+$/.test(seg) ||
      seg.length >= 20 ||
      (seg.length >= 8 && /\d/.test(seg))
        ? ':id'
        : seg,
    )
    .join('/');

export interface QueryShape {
  /** The SQL with every literal as `?`, lists folded, comments and the output format dropped. */
  text: string;
  /** A hash of `text`: one per query shape. */
  fingerprint: string;
  /** select, insert, update, delete, ddl, pragma or other. */
  op: string;
}

const SQL_CAP = 1024;
const shapes = new Map<string, QueryShape>();

const fnv = (s: string, seed: number) => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** The query's shape: no literal survives, so no value or person's data is ever written. */
export function queryShape(sql: string): QueryShape {
  const known = shapes.get(sql);
  if (known) return known;
  let s = sql;
  // An insert's rows ride after its FORMAT line; only the statement is kept.
  const insert = /^\s*INSERT\b/i.test(s);
  if (insert) s = s.split('\n', 1)[0] ?? '';
  s = s
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, '?')
    .replace(/(?<![\w$.])\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, '?')
    .replace(/\s+/g, ' ')
    .trim();
  if (!insert) s = s.replace(/\s+FORMAT\s+\w+\s*$/i, '');
  s = s
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?...)')
    .replace(/\[\s*\?(?:\s*,\s*\?)+\s*\]/g, '[?...]')
    .replace(/\(\?\.\.\.\)(?:\s*,\s*\(\?\.\.\.\))+/g, '(?...),...');
  const head = (s.match(/^\(?\s*(\w+)/)?.[1] ?? '').toUpperCase();
  const op =
    head === 'SELECT' || head === 'WITH'
      ? 'select'
      : head === 'INSERT' || head === 'REPLACE'
        ? 'insert'
        : head === 'UPDATE'
          ? 'update'
          : head === 'DELETE'
            ? 'delete'
            : head === 'CREATE' || head === 'ALTER' || head === 'DROP'
              ? 'ddl'
              : head === 'PRAGMA'
                ? 'pragma'
                : 'other';
  const shape = {
    text: s.slice(0, SQL_CAP),
    fingerprint: fnv(s, 2166136261) + fnv(s, 0x9e3779b9),
    op,
  };
  if (shapes.size >= 1000) shapes.clear();
  shapes.set(sql, shape);
  return shape;
}

const cap = (s: string, n = 96) => (s.length > n ? s.slice(0, n) : s);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * Column order is the contract with whoever reads the dataset back: index1 engine; blobs
 * engine, app, kind, route, tool, op, fingerprint, sql shape, outcome, method, cap (`capped` when
 * it returned more rows than `setQueryRowCap` allows); doubles wall ms,
 * engine ms, rows read, bytes read, rows out, rows written, bytes out, status.
 */
export function meterQuery(p: QueryPoint) {
  if (!sink) return;
  try {
    const shape = queryShape(p.sql);
    const c = p.caller ?? currentCaller();
    sink.writeDataPoint({
      indexes: [p.engine],
      blobs: [
        p.engine,
        cap(c.app),
        cap(c.kind),
        cap(c.route),
        cap(c.tool ?? ''),
        shape.op,
        shape.fingerprint,
        shape.text,
        p.ok ? 'ok' : 'error',
        p.method,
        rowCap && num(p.rowsOut) > rowCap ? 'capped' : '',
      ],
      doubles: [
        p.ms,
        num(p.engineMs),
        num(p.rowsRead),
        num(p.bytesRead),
        num(p.rowsOut),
        num(p.rowsWritten),
        num(p.bytesOut),
        num(p.status),
      ],
    });
  } catch (err) {
    console.error('meterQuery', err);
  }
}

// ── D1 ──────────────────────────────────────────────────────────────────────

interface D1Meta {
  duration?: number;
  rows_read?: number;
  rows_written?: number;
}
interface NativeStatement {
  bind(...values: unknown[]): NativeStatement;
  all(): Promise<{ results?: unknown[]; meta?: D1Meta }>;
  run(): Promise<{ results?: unknown[]; meta?: D1Meta }>;
  raw(opts?: unknown): Promise<unknown[]>;
}
interface NativeD1 {
  prepare(sql: string): NativeStatement;
  batch(stmts: NativeStatement[]): Promise<{ results?: unknown[]; meta?: D1Meta }[]>;
}

const d1Point = (
  sql: string,
  method: string,
  ms: number,
  r?: { results?: unknown[]; meta?: D1Meta },
) =>
  meterQuery({
    engine: 'd1',
    sql,
    method,
    ok: Boolean(r),
    ms,
    engineMs: r?.meta?.duration,
    rowsRead: r?.meta?.rows_read,
    rowsWritten: r?.meta?.rows_written,
    rowsOut: r?.results?.length,
  });

class MeteredStatement {
  constructor(
    readonly native: NativeStatement,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    return new MeteredStatement(this.native.bind(...values), this.sql);
  }
  private async timed<R extends { results?: unknown[]; meta?: D1Meta }>(
    method: string,
    run: () => Promise<R>,
  ): Promise<R> {
    const t0 = performance.now();
    try {
      const r = await run();
      d1Point(this.sql, method, performance.now() - t0, r);
      return r;
    } catch (err) {
      d1Point(this.sql, method, performance.now() - t0);
      throw err;
    }
  }
  all() {
    return this.timed('all', () => this.native.all());
  }
  run() {
    return this.timed('run', () => this.native.run());
  }
  /** D1's own `first` is `all` and its first row; through `all` it carries rows read. */
  async first(column?: string) {
    const r = await this.timed('first', () => this.native.all());
    const row = (r.results?.[0] ?? null) as Record<string, unknown> | null;
    if (!row || column === undefined) return row;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column];
  }
  async raw(opts?: unknown) {
    const t0 = performance.now();
    let ok = false;
    try {
      const rows = await this.native.raw(opts);
      ok = true;
      return rows;
    } finally {
      meterQuery({ engine: 'd1', sql: this.sql, method: 'raw', ok, ms: performance.now() - t0 });
    }
  }
}

/** The D1 binding, metered: one point per statement, a batch's each with its own meta. */
export function meteredD1<T>(db: T | undefined): T | undefined {
  if (!db) return db;
  const native = db as unknown as NativeD1;
  return new Proxy(native, {
    get(target, prop, receiver) {
      if (prop === 'prepare')
        return (sql: string) => new MeteredStatement(target.prepare(sql), sql);
      if (prop === 'batch')
        return async (stmts: (MeteredStatement | NativeStatement)[]) => {
          const t0 = performance.now();
          const unwrap = stmts.map((s) => (s instanceof MeteredStatement ? s.native : s));
          const sqls = stmts.map((s) => (s instanceof MeteredStatement ? s.sql : ''));
          try {
            const rs = await target.batch(unwrap);
            const each = (performance.now() - t0) / Math.max(1, rs.length);
            rs.forEach((r, i) => d1Point(sqls[i] ?? '', 'batch', each, r));
            return rs;
          } catch (err) {
            const each = (performance.now() - t0) / Math.max(1, sqls.length);
            for (const sql of sqls) d1Point(sql, 'batch', each);
            throw err;
          }
        };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as unknown as T;
}

// ── ClickHouse (the VPC service every client fetches through) ───────────────

type Fetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

const STATS_RE =
  /"statistics"\s*:\s*\{\s*"elapsed"\s*:\s*([\d.e+-]+)\s*,\s*"rows_read"\s*:\s*(\d+)\s*,\s*"bytes_read"\s*:\s*(\d+)/;
const ROWS_RE = /"rows"\s*:\s*(\d+)\s*,/g;

/** `X-ClickHouse-Summary`: what the server knew when it sent the headers. */
function summaryOf(res: Response) {
  try {
    const s = JSON.parse(res.headers.get('x-clickhouse-summary') ?? '{}') as Record<string, string>;
    return {
      rowsRead: num(s.read_rows),
      bytesRead: num(s.read_bytes),
      rowsWritten: num(s.written_rows),
      rowsOut: s.result_rows === undefined ? undefined : num(s.result_rows),
      engineMs: s.elapsed_ns === undefined ? undefined : num(s.elapsed_ns) / 1e6,
    };
  } catch {
    return {};
  }
}

const sqlOf = (input: Request | string | URL, init?: RequestInit): string | null => {
  if (typeof init?.body === 'string') return init.body;
  try {
    return new URL(input instanceof Request ? input.url : String(input)).searchParams.get('query');
  } catch {
    return null;
  }
};

/**
 * The ClickHouse VPC binding, metered. The point is written when the caller has read the whole
 * answer: wall time to the last byte, and the `statistics` ClickHouse puts at the end of a JSON
 * answer (rows and bytes read, its own time), else the summary header.
 */
export function meteredClickHouse<T extends { fetch: Fetch }>(
  binding: T | undefined,
): T | undefined {
  if (!binding) return binding;
  const fetchMetered: Fetch = async (input, init) => {
    const sql = sqlOf(input, init);
    if (!sql) return binding.fetch(input, init);
    const method = /^\s*INSERT\b/i.test(sql) ? 'insert' : 'query';
    const t0 = performance.now();
    const caller = currentCaller();
    let res: Response;
    try {
      res = await binding.fetch(input, init);
    } catch (err) {
      meterQuery({
        engine: 'clickhouse',
        sql,
        method,
        ok: false,
        ms: performance.now() - t0,
        caller,
      });
      throw err;
    }
    const head = summaryOf(res);
    if (!res.ok || !res.body) {
      meterQuery({
        engine: 'clickhouse',
        sql,
        method,
        ok: res.ok,
        ms: performance.now() - t0,
        status: res.status,
        caller,
        ...head,
      });
      return res;
    }
    let bytes = 0;
    let tail = new Uint8Array(0);
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          bytes += chunk.byteLength;
          // Keep the last 1 KB: the answer's `rows` and `statistics` close it.
          const joined = new Uint8Array(tail.byteLength + chunk.byteLength);
          joined.set(tail, 0);
          joined.set(chunk, tail.byteLength);
          tail = joined.subarray(Math.max(0, joined.byteLength - 1024));
          ctl.enqueue(chunk);
        },
        flush() {
          const text = new TextDecoder().decode(tail);
          const st = text.match(STATS_RE);
          const rows = [...text.matchAll(ROWS_RE)].pop();
          meterQuery({
            engine: 'clickhouse',
            sql,
            method,
            ok: true,
            ms: performance.now() - t0,
            status: res.status,
            bytesOut: bytes,
            caller,
            ...head,
            ...(rows ? { rowsOut: num(rows[1]) } : {}),
            ...(st
              ? { engineMs: num(st[1]) * 1000, rowsRead: num(st[2]), bytesRead: num(st[3]) }
              : {}),
          });
        },
      }),
    );
    return new Response(counted, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
  return new Proxy(binding, {
    get(target, prop, receiver) {
      if (prop === 'fetch') return fetchMetered;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

// ── Durable Object SQLite ───────────────────────────────────────────────────

interface NativeCursor {
  toArray(): unknown[];
  rowsRead?: number;
  rowsWritten?: number;
}
interface NativeSql {
  exec(query: string, ...bindings: unknown[]): NativeCursor;
}

/**
 * A Durable Object's `storage.sql`, metered for `caller`. Each statement is read to the end at
 * `exec`, so its rows read and written are known; callers read rows only through `toArray`.
 */
export function meteredSql<T>(sql: T, caller: QueryCaller): T {
  const native = sql as unknown as NativeSql;
  return new Proxy(native, {
    get(target, prop, receiver) {
      if (prop === 'exec')
        return (query: string, ...bindings: unknown[]) => {
          const t0 = performance.now();
          try {
            const cursor = target.exec(query, ...bindings);
            const rows = cursor.toArray();
            meterQuery({
              engine: 'do_sqlite',
              sql: query,
              method: 'exec',
              ok: true,
              ms: performance.now() - t0,
              rowsRead: cursor.rowsRead,
              rowsWritten: cursor.rowsWritten,
              rowsOut: rows.length,
              caller,
            });
            return {
              toArray: () => rows,
              rowsRead: cursor.rowsRead,
              rowsWritten: cursor.rowsWritten,
            };
          } catch (err) {
            meterQuery({
              engine: 'do_sqlite',
              sql: query,
              method: 'exec',
              ok: false,
              ms: performance.now() - t0,
              caller,
            });
            throw err;
          }
        };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as unknown as T;
}
