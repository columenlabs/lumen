/**
 * Runs a frame's browser recipe (a script with `runtime: 'browser'`) in the person's page and
 * saves what it gives as the frame's rows: one write. The script runs in a Web Worker inside an
 * iframe with `sandbox="allow-scripts"` (the server's `<api>/sandbox` page: an opaque origin, no
 * cookies, no network of its own), so it cannot reach the app or its data. Its one way out is
 * `hub.fetch(url, {method, body, key})`, which this file carries to the app's fetch proxy
 * (`<api>/fetch`: allowlisted hosts, a named data key added server side) and back.
 *
 * The script is the body of an async function of `fetched` (the answers to its `requests`, in
 * order: `{url, vars, status, body}`) and `hub`. It returns rows, or `{columns?, rows}` where
 * `columns` picks and orders the fields. Limits: `BROWSER_RUN_MS`, `FETCH_CALLS` web reads a run
 * and the frame's own caps (rows, size), which the server checks when it saves.
 */
import {
  FETCH_CALLS,
  type FrameData,
  type FrameFetch,
  type FrameScript,
  fetchCalls,
  runsInBrowser,
} from '@columenlabs/lumen-ui-types/frames';
import { apiJson } from './api-fetch';

/** Longest a browser run may take before it stops (the worker is ended, a loop included). */
export const BROWSER_RUN_MS = 30_000;

type Answer = { status: number; body: unknown; error?: string };

/** What the script gave, as rows; a bad shape says what it should be. */
function rowsOf(out: unknown): Record<string, unknown>[] {
  const o = out as { rows?: unknown; columns?: unknown } | null;
  const list = Array.isArray(out) ? out : Array.isArray(o?.rows) ? o.rows : null;
  if (!list) throw new Error('The script must return rows: a list, or {columns, rows}.');
  const rows = list.map((r) =>
    r && typeof r === 'object' && !Array.isArray(r)
      ? (r as Record<string, unknown>)
      : { value: r as unknown },
  );
  const columns = Array.isArray(o?.columns) ? o.columns.map(String) : null;
  return columns
    ? rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])))
    : rows;
}

/**
 * Runs a browser script once and gives back its rows, or throws why it failed. Each web read it
 * makes goes through `<api>/fetch`; more than `FETCH_CALLS` a run is refused.
 */
export async function runBrowserScript(
  api: string,
  script: Extract<FrameScript, { kind: 'script' }>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  let reads = 0;
  const read = async (call: FrameFetch): Promise<Answer> => {
    if (++reads > FETCH_CALLS) throw new Error(`A run makes at most ${FETCH_CALLS} web reads.`);
    return apiJson<Answer>(
      `${api}/fetch`,
      { method: 'POST', body: JSON.stringify(call), signal },
      'workspace.fetch',
    );
  };
  // The recipe's own requests first, so the script starts with their answers.
  const fetched = script.requests
    ? await Promise.all(
        fetchCalls(script.requests).map(async (c) => {
          const a = await read({ url: c.url, method: c.method, body: c.body, key: c.key });
          return { url: c.url, vars: c.vars, status: a.status, body: a.body };
        }),
      )
    : [];

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.hidden = true;
  frame.src = `${api}/sandbox`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      frame.remove();
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error(`The script took over ${BROWSER_RUN_MS / 1000} s, so it stopped.`)),
        ),
      BROWSER_RUN_MS,
    );
    const onAbort = () => finish(() => reject(new DOMException('Stopped', 'AbortError')));
    signal?.addEventListener('abort', onAbort);
    const post = (m: unknown) => frame.contentWindow?.postMessage(m, '*');
    function onMessage(e: MessageEvent) {
      // Only this run's own frame speaks here; its origin is opaque ("null").
      if (e.source !== frame.contentWindow) return;
      const m = (e.data ?? {}) as {
        type?: string;
        id?: number;
        url?: string;
        init?: { method?: 'GET' | 'POST'; body?: string; key?: string };
        result?: unknown;
        error?: string;
      };
      if (m.type === 'ready') post({ type: 'run', code: script.code, fetched });
      else if (m.type === 'fetch') {
        const init = m.init ?? {};
        read({
          url: String(m.url),
          method: init.method === 'POST' ? 'POST' : 'GET',
          ...(typeof init.body === 'string' ? { body: init.body } : {}),
          ...(typeof init.key === 'string' ? { key: init.key } : {}),
        }).then(
          (result) => post({ type: 'fetched', id: m.id, result }),
          (err: Error) => post({ type: 'fetched', id: m.id, error: err.message }),
        );
      } else if (m.type === 'done') {
        if (m.error) finish(() => reject(new Error(m.error)));
        else
          finish(() => {
            try {
              resolve(rowsOf(m.result));
            } catch (err) {
              reject(err);
            }
          });
      }
    }
    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);
  });
}

/**
 * Runs a frame's browser recipe and saves the rows (or why it failed) on the frame: the ↻ of a
 * browser tab. Gives back the frame as saved; a failed run throws after it is recorded.
 */
export async function runBrowserFrame(api: string, id: string): Promise<FrameData> {
  const { script } = await apiJson<{ script: FrameScript | null }>(
    `${api}/frames/${id}/script`,
    {},
    'workspace.script',
  );
  if (!script || !runsInBrowser(script) || script.kind !== 'script')
    throw new Error('This tab has no browser script to run.');
  const started = performance.now();
  const save = (body: unknown) =>
    apiJson<FrameData>(
      `${api}/frames/${id}/rows`,
      { method: 'PUT', body: JSON.stringify(body) },
      'workspace.rows',
    );
  let rows: Record<string, unknown>[];
  try {
    rows = await runBrowserScript(api, script);
  } catch (err) {
    const error = (err as Error).message || 'The script failed.';
    await save({ error, ms: Math.round(performance.now() - started) }).catch(() => undefined);
    throw err;
  }
  return save({ rows, ms: Math.round(performance.now() - started) });
}
