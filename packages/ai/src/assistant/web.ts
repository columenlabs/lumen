/**
 * The web: `fetch`, a plain GET from the Worker (no browser, 10 s, 2 MB), tried first for APIs, JSON
 * and plain pages; and ScrapeQL's own MCP tools (`search`, `scrape`, `extract`, `ask`) over its API
 * for pages that need a real browser or after a fetch fails. ScrapeQL sits behind Cloudflare Access,
 * so the app reaches it with one Access service token an admin pastes in Settings.
 */
import { type ToolSource, plainTools, remoteMcpTools } from './tools';

/** Fetches one answer may have in flight at once; more wait their turn. */
const PARALLEL = 20;
const TIMEOUT_MS = 10_000;
/** Bytes of body read; past it the body is cut and `truncated` says so. */
const MAX_BYTES = 2_000_000;

const DESCRIPTION = `Plain HTTP GET of one URL from the server, no browser: fast and cheap, so use it first for APIs, JSON, CSV, RSS and plain HTML. Returns {ok, status, url (after redirects), content_type, json (when the body is JSON) or text, truncated}; a failed fetch (refused, timed out, not 2xx) returns ok false with status and error. Bodies over ${MAX_BYTES / 1_000_000} MB are cut; ${TIMEOUT_MS / 1000} s per fetch. Use the browser tools (scrape, extract, ask) only for pages built by JavaScript, bot walls, or after fetch fails.`;

export interface WebFetchOptions {
  /** Hosts never fetched (the app's own, behind sign-in), each with its subdomains. */
  blockHosts?: string[];
  userAgent?: string;
  fetch?: typeof fetch;
}

/** Why a URL is refused, or null. */
function refused(url: URL, block: string[]): string | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'only http and https';
  const host = url.hostname.toLowerCase();
  if (block.some((b) => host === b || host.endsWith(`.${b}`))) return "the app's own hosts";
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    host.startsWith('[')
  )
    return 'a public host name, not an address';
  return null;
}

async function readCapped(res: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
    if (size > MAX_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
  let at = 0;
  for (const p of parts) {
    const take = p.subarray(0, bytes.length - at);
    bytes.set(take, at);
    at += take.length;
    if (at >= bytes.length) break;
  }
  return { bytes, truncated };
}

/** One GET, never thrown: what it got, or why not. */
export async function webFetch(
  raw: string,
  headers: Record<string, string> = {},
  o: WebFetchOptions = {},
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 0, url: raw, error: 'not a full URL (https://…)' };
  }
  const why = refused(
    url,
    (o.blockHosts ?? []).map((h) => h.toLowerCase()),
  );
  if (why) return { ok: false, status: 0, url: raw, error: `refused: ${why}` };
  const f = o.fetch ?? fetch;
  try {
    const res = await f(url.toString(), {
      headers: { 'user-agent': o.userAgent ?? 'LumenAssistant/1.0', accept: '*/*', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const type = res.headers.get('content-type') ?? '';
    const { bytes, truncated } = await readCapped(res);
    const text = new TextDecoder().decode(bytes);
    let json: unknown;
    if (!truncated && (/json/i.test(type) || /^\s*[[{]/.test(text))) {
      try {
        json = JSON.parse(text);
      } catch {}
    }
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url.toString(),
      content_type: type,
      ...(json !== undefined ? { json } : { text }),
      truncated,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      status: 0,
      url: url.toString(),
      error: timedOut
        ? `timed out after ${TIMEOUT_MS / 1000} s`
        : String((err as Error)?.message ?? err),
    };
  }
}

/** `fetch` as a tool, at most `PARALLEL` at once per answer. */
export function webFetchTools(o: WebFetchOptions = {}): ToolSource {
  return async () => {
    let running = 0;
    const waiting: (() => void)[] = [];
    const open = await plainTools([
      {
        name: 'fetch',
        title: 'Read a web page',
        description: DESCRIPTION,
        read: true,
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', maxLength: 2000, description: 'A full address, https://…' },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string', maxLength: 500 },
              description: 'Request headers, e.g. {"accept": "application/json"}.',
            },
          },
          required: ['url'],
        },
        async run(args) {
          const a = (args ?? {}) as { url?: unknown; headers?: unknown };
          while (running >= PARALLEL) await new Promise<void>((r) => waiting.push(r));
          running++;
          try {
            const headers =
              a.headers && typeof a.headers === 'object'
                ? Object.fromEntries(
                    Object.entries(a.headers as Record<string, unknown>).map(([k, v]) => [
                      k,
                      String(v),
                    ]),
                  )
                : {};
            return await webFetch(String(a.url ?? ''), headers, o);
          } finally {
            running--;
            waiting.shift()?.();
          }
        },
      },
    ])();
    return open;
  };
}

/** A Cloudflare Access service token: its Client ID and Client Secret. */
export interface AccessToken {
  client_id: string;
  client_secret: string;
}

/** ScrapeQL's MCP tools over its API, with an Access service token. Every one of them reads. */
export function scrapeqlTools(url: string, token: AccessToken, f?: typeof fetch): ToolSource {
  const remote = remoteMcpTools({
    url,
    headers: {
      'CF-Access-Client-Id': token.client_id,
      'CF-Access-Client-Secret': token.client_secret,
    },
    ...(f ? { fetch: f } : {}),
  });
  return async () => {
    const open = await remote();
    return { ...open, tools: open.tools.map((t) => ({ ...t, read: true })) };
  };
}
