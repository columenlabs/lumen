/**
 * The request meter as Hono middleware: mount it once, first, and every route the app has or adds
 * later is metered. It names the request (`withRequest`), so events and queries inside carry its
 * id, then writes one request point after the answer. Put Hono's own `requestId()` before it to
 * send the id back as `X-Request-Id`.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { flushCalls } from './bindings';
import { codeOf } from './fields';
import { foldRoute } from './queries';
import { type RequestPoint, meterRequest, serverTiming, withRequest } from './requests';

export interface RequestMeterOptions {
  /** The app, or the part of it, answering; a function when one Worker serves several apps. */
  app: string | ((c: Context) => string);
  /** The route template, when Hono's own can't name it (a Worker that hands requests on to other
   * apps by path sees only its catch-all); fold ids out of it with `foldRoute`. */
  route?: (c: Context) => string | undefined;
  /** Send the request's time per kind of call back as `Server-Timing` (do, ai, fetch, app, total). */
  serverTiming?: boolean;
  env?: (c: Context) => string | undefined;
  version?: (c: Context) => string | undefined;
  /** Which part was asked and who called, read after the answer (auth has run by then). */
  describe?: (
    c: Context,
  ) => Partial<Pick<RequestPoint, 'surface' | 'subject' | 'callerKind' | 'callerId' | 'region'>>;
  /** The outcome code of an answer; by default the `error` field of a small JSON error answer. */
  outcome?: (c: Context) => Promise<string | undefined> | string | undefined;
}

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const size = (h: string | null | undefined) => (h ? Number(h) || 0 : 0);

/** The `error` field of a JSON error answer under 4 KB, if it reads as a code. */
async function errorCode(c: Context): Promise<string | undefined> {
  const res = c.res;
  if (res.status < 400 || !res.headers.get('content-type')?.includes('json')) return;
  if (size(res.headers.get('content-length')) > 4096) return;
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    return codeOf(body?.error) || undefined;
  } catch {
    return;
  }
}

export function requestMeter(opts: RequestMeterOptions): MiddlewareHandler {
  return async (c, next) => {
    const t0 = performance.now();
    const requestId = codeOf((c.var as Record<string, unknown>).requestId) || newId();
    const app = typeof opts.app === 'function' ? opts.app(c) : opts.app;
    const scope = { app, requestId, env: opts.env?.(c), version: opts.version?.(c) };
    await withRequest(scope, foldRoute(c.req.path), async () => {
      await next();
      try {
        // The template of the deepest route that ran (Hono leaves its index set once the chain
        // unwinds); `-1` would name the last route that merely matched, a catch-all say. A path
        // only this middleware matched is `/*`, so junk never lands.
        const hono = routePath(c);
        const route =
          opts.route?.(c) || (hono && hono !== '*' && hono !== '/*' ? hono : '') || hono || '*';
        const outcome = c.error
          ? 'exception'
          : await (opts.outcome ? opts.outcome(c) : errorCode(c));
        const ms = performance.now() - t0;
        if (opts.serverTiming && c.res.status !== 101) {
          try {
            c.res.headers.set('server-timing', serverTiming(ms));
          } catch {
            // A response with frozen headers (a passed-through fetch): copy it once.
            c.res = new Response(c.res.body, c.res);
            c.res.headers.set('server-timing', serverTiming(ms));
          }
        }
        flushCalls();
        const cf = (c.req.raw as { cf?: { colo?: string; country?: string } }).cf;
        meterRequest({
          surface: 'other',
          ...opts.describe?.(c),
          method: c.req.method,
          route,
          status: c.res.status,
          ms,
          outcome,
          colo: cf?.colo,
          country: cf?.country,
          bytesIn: size(c.req.header('content-length')),
          bytesOut: size(c.res.headers.get('content-length')),
          scope,
        });
      } catch (err) {
        console.error('requestMeter', err);
      }
    });
  };
}
