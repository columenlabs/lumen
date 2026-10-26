/**
 * The request meter: every request a Worker answers is one Analytics Engine point, with its route
 * template, status, outcome code, who called and how long it took, so errors, slow routes and a bad
 * deploy show up without any code in the routes themselves.
 *
 * It also holds the request in scope (`currentRequest`), so the event meter and the query meter
 * charge their points to it and carry the same request id.
 *
 * A point holds enums, templates, ids the app makes and numbers only: never a raw path, a query
 * string, a header, a body or a person's name, email or address.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { cap, codeOf, num } from './fields';
import type { PointSink } from './points';
import { withQueryCaller } from './queries';

export interface RequestScope {
  /** The app, or the part of it, answering. */
  app: string;
  /** A short id the app makes per request, sent back as `X-Request-Id`. */
  requestId: string;
  /** production, preview, or your own. */
  env?: string;
  /** The deploy's version id. */
  version?: string;
}

export interface RequestPoint {
  /** Which part of the app was asked: console, admin, api, mcp, webhook, site, or your own. */
  surface: string;
  method: string;
  /** The route template (`/v1/accounts/:id`), never the raw path. */
  route: string;
  status: number;
  ms: number;
  /** `ok`, or a short code (`rate_limited`, `invalid_signature`, `exception`), never a message. */
  outcome?: string;
  /** Who called: an opaque id the app makes (a person's or account's id), or empty. */
  subject?: string;
  /** How they called: session, key, oauth, admin, webhook, anon, or your own. */
  callerKind?: string;
  /** The key's or OAuth client's id, never the key itself. */
  callerId?: string;
  region?: string;
  colo?: string;
  country?: string;
  bytesIn?: number;
  bytesOut?: number;
  /** Time spent waiting on other services in this request, ms. */
  upstreamMs?: number;
  subrequests?: number;
  /** Defaults to the request in scope. */
  scope?: RequestScope;
}

let sink: PointSink | undefined;
let logLines = false;
const scope = new AsyncLocalStorage<RequestScope & { upstreamMs: number; subrequests: number }>();

/** The entry point sets the dataset once per isolate; `log` also prints one JSON line a point. */
export function setRequestSink(s: PointSink | undefined, opts: { log?: boolean } = {}) {
  sink = s;
  logLines = Boolean(opts.log);
}

/** Runs `fn` as request `r`: points written inside carry its id, and queries its route. */
export function withRequest<T>(r: RequestScope, route: string, fn: () => T): T {
  return scope.run({ ...r, upstreamMs: 0, subrequests: 0 }, () =>
    withQueryCaller({ app: r.app, kind: 'fetch', route }, fn),
  );
}

/** The request in scope, if any. */
export function currentRequest(): RequestScope | undefined {
  return scope.getStore();
}

/** Adds a call to another service to the request in scope (the event meter does this itself). */
export function addUpstream(ms: number) {
  const s = scope.getStore();
  if (!s) return;
  s.upstreamMs += ms;
  s.subrequests += 1;
}

/** Prints the point as one JSON line for the platform's logs, when the sink was set with `log`. */
export function logLine(kind: string, fields: Record<string, unknown>) {
  if (!logLines) return;
  try {
    console.log(JSON.stringify({ lumen: kind, ...fields }));
  } catch {}
}

/**
 * Column order is the contract with whoever reads the dataset back: index1 subject (or `anon`);
 * blobs app, surface, method, route, outcome, caller kind, caller id, region, env, version, colo,
 * country, request id; doubles status, ms, bytes in, bytes out, upstream ms, subrequests.
 */
export function meterRequest(p: RequestPoint) {
  if (!sink && !logLines) return;
  try {
    const s = p.scope ?? scope.getStore();
    const live = scope.getStore();
    const upstreamMs = p.upstreamMs ?? live?.upstreamMs;
    const subrequests = p.subrequests ?? live?.subrequests;
    const outcome = codeOf(p.outcome, p.status < 400 ? 'ok' : `http_${p.status}`);
    sink?.writeDataPoint({
      indexes: [cap(p.subject || 'anon')],
      blobs: [
        cap(s?.app),
        cap(p.surface),
        cap(p.method, 8),
        cap(p.route, 256),
        outcome,
        cap(p.callerKind),
        cap(p.callerId),
        cap(p.region),
        cap(s?.env),
        cap(s?.version),
        cap(p.colo, 8),
        cap(p.country, 4),
        cap(s?.requestId),
      ],
      doubles: [
        num(p.status),
        num(p.ms),
        num(p.bytesIn),
        num(p.bytesOut),
        num(upstreamMs),
        num(subrequests),
      ],
    });
    logLine('request', {
      id: s?.requestId,
      surface: p.surface,
      method: p.method,
      route: p.route,
      status: p.status,
      outcome,
      ms: Math.round(p.ms),
      caller: p.callerKind,
    });
  } catch (err) {
    console.error('meterRequest', err);
  }
}
