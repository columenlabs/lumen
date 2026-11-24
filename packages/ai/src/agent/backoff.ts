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

/** One HTTP attempt at a model provider, as `onModelRequest` listeners see it. */
export interface ModelAttempt {
  /** The provider's host (api.openai.com, api.anthropic.com, chatgpt.com). */
  host: string;
  /** The model the request names, when its body says. */
  model?: string;
  /** 0 for the first send of this request, 1 and on for this policy's own retries. */
  attempt: number;
  /** When it was sent (ms since the epoch) and how long until its answer's headers came back. */
  at: number;
  ms: number;
  status: number;
  /** Sent again after this answer, by this policy. */
  retried: boolean;
  /** A non-OK answer's message, its first 300 characters (never the request). */
  error?: string;
}

const listeners = new Set<(a: ModelAttempt) => void>();

/**
 * Hears every HTTP attempt a model call makes (each send, each retry), so an app can show where a
 * turn's time went (a trace span for each). Returns its removal. A listener that throws is ignored.
 */
export function onModelRequest(fn: (a: ModelAttempt) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const modelOf = (body: unknown): string | undefined =>
  typeof body === 'string'
    ? /"model"\s*:\s*"([^"]{1,80})"/.exec(body.slice(0, 4000))?.[1]
    : undefined;

async function tell(
  input: RequestInfo | URL,
  body: unknown,
  attempt: number,
  at: number,
  res: Response,
  retried: boolean,
) {
  if (!listeners.size) return;
  let host = '';
  try {
    host = new URL(input instanceof Request ? input.url : String(input)).host;
  } catch {}
  const error = res.ok
    ? undefined
    : (
        await res
          .clone()
          .text()
          .catch(() => '')
      ).slice(0, 300);
  const a: ModelAttempt = {
    host,
    model: modelOf(body),
    attempt,
    at,
    ms: Date.now() - at,
    status: res.status,
    retried,
    ...(error !== undefined ? { error } : {}),
  };
  for (const fn of listeners) {
    try {
      fn(a);
    } catch {}
  }
}

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
    if (!resendable || input instanceof Request) {
      const at = Date.now();
      const res = await base(input, init);
      await tell(input, body, 0, at, res, false);
      return res;
    }
    let waited = 0;
    for (let n = 0; ; n += 1) {
      const at = Date.now();
      const res = await base(input, init);
      const asked = retryAfterMs(res.headers);
      const wait = asked ?? BASE_MS * 2 ** n * (0.75 + Math.random() * 0.5);
      const again = RETRY.has(res.status) && n < TRIES && waited + wait <= BUDGET_MS;
      await tell(input, body, n, at, res, again);
      if (!again) return res;
      await res.body?.cancel().catch(() => undefined);
      await sleep(wait, init?.signal);
      waited += wait;
    }
  };
}
