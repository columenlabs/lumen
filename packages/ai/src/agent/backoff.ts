/**
 * One retry policy for every model provider call. A call refused for load or a limit (408, 409,
 * 429, 5xx, 529) is sent again after the wait the provider asks for (`retry-after-ms`,
 * `retry-after` in seconds or as a date), else an exponential wait with jitter (1, 2, 4, 8 s).
 * It stops at 4 retries or 30 s of waiting in all, at once on the caller's abort, and never retries a
 * body it cannot send twice (a stream). Its last answer goes back as it came, so the caller still
 * sees the provider's status and message. The SDKs' own retries are off where this runs, so a call
 * is never retried twice over.
 */
const RETRY = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const TRIES = 4;
const BUDGET_MS = 30_000;
const BASE_MS = 1_000;

/** The wait a refused answer asks for, in ms, or undefined when it names none. */
export function retryAfterMs(h: Headers): number | undefined {
  const ms = Number(h.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const v = h.get('retry-after');
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return s >= 0 ? s * 1000 : undefined;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** `base` with the retry policy above. */
export function backoffFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const body = init?.body;
    const resendable =
      body == null ||
      typeof body === 'string' ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body) ||
      body instanceof URLSearchParams ||
      body instanceof Blob;
    if (!resendable || input instanceof Request) return base(input, init);
    let waited = 0;
    for (let n = 0; ; n += 1) {
      const res = await base(input, init);
      if (!RETRY.has(res.status) || n >= TRIES) return res;
      const asked = retryAfterMs(res.headers);
      const wait = asked ?? BASE_MS * 2 ** n * (0.75 + Math.random() * 0.5);
      if (waited + wait > BUDGET_MS) return res;
      await res.body?.cancel().catch(() => undefined);
      await sleep(wait, init?.signal);
      waited += wait;
    }
  };
}
