/**
 * The page a browser recipe runs in (`GET <base>/sandbox`). The kit's runner loads it in an
 * iframe with `sandbox="allow-scripts"`: an opaque origin, so no cookies, storage or hub calls,
 * and this response's own policy reaches nothing (`connect-src 'none'`). The script itself runs
 * in a Web Worker inside it, so the page can stop it (a loop that never ends) at its time limit.
 * Its only way out is `hub.fetch(url)`, a message to the parent, which asks the product's fetch
 * proxy (allowlisted hosts, keys added server side) and posts the answer back.
 *
 * Messages (parent ⇄ page): `run {code, fetched}` → `done {result} | {error}`;
 * page → parent `fetch {id, url, init}` → parent → page `fetched {id, result} | {id, error}`.
 */

/** The worker's code: runs the person's script as an async function of `fetched` and `hub`. */
const WORKER = `
const waiting = new Map();
let next = 0;
const hub = {
  fetch(url, init) {
    return new Promise((ok, no) => {
      const id = ++next;
      waiting.set(id, { ok, no });
      postMessage({ type: 'fetch', id, url: String(url), init: init || {} });
    });
  },
};
onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'fetched') {
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    if (w) m.error ? w.no(new Error(m.error)) : w.ok(m.result);
    return;
  }
  if (m.type !== 'run') return;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const out = await new AsyncFunction('fetched', 'hub', m.code)(m.fetched, hub);
    postMessage({ type: 'done', result: JSON.parse(JSON.stringify(out === undefined ? null : out)) });
  } catch (err) {
    postMessage({ type: 'done', error: String((err && err.message) || err) });
  }
};`;

/** The page: starts the worker and passes messages between it and the parent. */
export const SANDBOX_HTML = `<!doctype html><meta charset="utf-8"><title>Recipe</title><script>
const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(WORKER)}], { type: 'text/javascript' })));
worker.onmessage = (e) => parent.postMessage(e.data, '*');
worker.onerror = (e) => parent.postMessage({ type: 'done', error: e.message || 'The script failed.' }, '*');
addEventListener('message', (e) => { if (e.source === parent) worker.postMessage(e.data); });
parent.postMessage({ type: 'ready' }, '*');
</script>`;

/** Its policy: inline and eval for the person's code, a blob worker, and no network at all. */
export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/** The sandbox page as a response. */
export function sandboxResponse(): Response {
  return new Response(SANDBOX_HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': SANDBOX_CSP,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      // Framed by the app's own pages only (a product's default may be DENY).
      'x-frame-options': 'SAMEORIGIN',
    },
  });
}
