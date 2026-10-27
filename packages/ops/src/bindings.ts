/**
 * The binding meter: every call a Worker makes to its bindings (a Durable Object's RPC method,
 * Workers AI, Vectorize, KV, R2, a service or VPC binding) and every outbound `fetch` is timed and
 * charged to the request in scope, without touching a call site. Wrap the env once at the entry
 * (`meteredBindings`), patch `fetch` once (`meterFetch`), and the request meter then has, per
 * request, how many calls of each kind ran and how long they took (`Server-Timing`, and one `call`
 * event per call code when the request ends: `flushCalls`).
 *
 * A call is named by its binding and method only (`DIRECTORY.seen`, `AI.run`, `fetch.api.x.com`),
 * never its arguments, so no id, key or person's data is ever written.
 */
import { meterEvent } from './events';
import { addCall, requestCalls } from './requests';

export interface BindingMeterOptions {
  /** The kind each binding counts as (`{ AI: 'ai', CAREER_INDEX: 'vectorize' }`); a Durable Object
   * namespace is `do` and a binding with only `fetch` is `fetch` without saying. */
  kinds?: Record<string, string>;
  /** Bindings left as they are (an Analytics Engine dataset, a Secrets Store secret). */
  skip?: string[];
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v &&
  (typeof v === 'object' || typeof v === 'function') &&
  typeof (v as PromiseLike<unknown>).then === 'function';

/** Times one call: charged to the request in scope, else written as its own event. */
function charge(kind: string, code: string, t0: number, ok: boolean) {
  const ms = performance.now() - t0;
  if (!addCall(kind, code, ms, ok))
    meterEvent({ event: 'call', code, ok, ms, counts: [1, ok ? 0 : 1] });
}

function timed<T>(kind: string, code: string, run: () => T): T {
  const t0 = performance.now();
  let out: T;
  try {
    out = run();
  } catch (err) {
    charge(kind, code, t0, false);
    throw err;
  }
  if (!isThenable(out)) return out;
  return Promise.resolve(out).then(
    (v) => {
      charge(kind, code, t0, true);
      return v;
    },
    (err) => {
      charge(kind, code, t0, false);
      throw err;
    },
  ) as T;
}

/** Methods that hand back another handle rather than doing work: their result is wrapped too. */
const HANDLES = new Set(['get', 'getByName']);
/** Methods that only build ids: left alone, since the runtime checks what it gets back. */
const PLAIN = new Set(['idFromName', 'idFromString', 'newUniqueId']);

const isNamespace = (v: object) => typeof (v as { idFromName?: unknown }).idFromName === 'function';

function meterObject<T extends object>(target: T, name: string, kind: string, stub: boolean): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if (typeof prop !== 'string' || prop === 'then' || PLAIN.has(prop)) {
        return typeof v === 'function' ? v.bind(t) : v;
      }
      // A stub's property is an RPC call whether or not it reads as a function.
      if (typeof v !== 'function' && !stub) return v;
      const code = `${name}.${prop}`;
      return (...args: unknown[]) => {
        if (!stub && HANDLES.has(prop) && isNamespace(t)) {
          const handle = (t as Record<string, (...a: unknown[]) => object>)[prop]?.(...args);
          return handle ? meterObject(handle, name, kind, true) : handle;
        }
        return timed(kind, code, () =>
          (t as Record<string, (...a: unknown[]) => unknown>)[prop]?.(...args),
        );
      };
    },
  });
}

/**
 * The env with every object binding metered. Strings (vars) and skipped bindings pass through as
 * they are. Wrap once per request at the entry and hand the result to the app.
 */
export function meteredBindings<E extends object>(env: E, opts: BindingMeterOptions = {}): E {
  const skip = new Set(opts.skip ?? []);
  const cache = new Map<string, unknown>();
  return new Proxy(env, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if (typeof prop !== 'string' || !v || typeof v !== 'object' || skip.has(prop)) return v;
      const hit = cache.get(prop);
      if (hit) return hit;
      const keys = Object.keys(v);
      const kind =
        opts.kinds?.[prop] ??
        (isNamespace(v)
          ? 'do'
          : typeof (v as { fetch?: unknown }).fetch === 'function' && keys.length <= 1
            ? 'fetch'
            : prop.toLowerCase());
      const wrapped = meterObject(v, prop, kind, false);
      cache.set(prop, wrapped);
      return wrapped;
    },
  });
}

let fetchPatched = false;

/**
 * Patches the global `fetch` once per isolate: every outbound request is a `fetch` call coded by
 * its host (`fetch.api.example.com`), never its path or query.
 */
export function meterFetch() {
  if (fetchPatched) return;
  fetchPatched = true;
  const native = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let host = 'other';
    try {
      host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    } catch {}
    return timed('fetch', `fetch.${host}`, () => native(input, init));
  }) as typeof fetch;
}

/**
 * Writes one `call` event per call code the request in scope made (counts: calls, failed; ms:
 * their total). The request meter's Hono middleware calls this itself after the answer.
 */
export function flushCalls() {
  for (const [code, c] of requestCalls()) {
    meterEvent({
      event: 'call',
      code,
      ok: c.errors === 0,
      ms: c.ms,
      counts: [c.n, c.errors],
      ref: c.kind,
    });
  }
}
