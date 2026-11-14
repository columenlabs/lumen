/**
 * The web: `fetch`, a plain GET from the Worker (no browser, 10 s, 2 MB), tried first for APIs, JSON
 * and plain pages; and ScrapeQL's own MCP tools (`search`, `scrape`, `extract`, `ask`) over its API
 * for pages that need a real browser or after a fetch fails. ScrapeQL sits behind Cloudflare Access,
 * so the app reaches it with one Access service token an admin pastes in Settings.
 */
import type { StepWeb, WebLink } from '@columenlabs/lumen-ui-types/assistant';
import { type ToolSource, plainTools, remoteMcpTools } from './tools';

/** Fetches one answer may have in flight at once; more wait their turn. */
const PARALLEL = 20;
const TIMEOUT_MS = 10_000;
/** Bytes of body read; past it the body is cut and `truncated` says so. */
const MAX_BYTES = 2_000_000;

const DESCRIPTION = `Plain HTTP GET of one URL from the server, no browser: fast and cheap, so use it first for APIs, JSON, CSV, RSS and plain HTML. Returns {ok, status, url (after redirects), content_type, json (when the body is JSON) or text, truncated}; a failed fetch (refused, timed out, not 2xx) returns ok false with status and error. Bodies over ${MAX_BYTES / 1_000_000} MB are cut; ${TIMEOUT_MS / 1000} s per fetch. Use the browser tools (scrape, extract, ask) only for pages built by JavaScript, bot walls, or after fetch fails.`;
/** The description when a turned-away page goes to a real browser by itself. */
const DESCRIPTION_ESCALATES = DESCRIPTION.replace(
  /Use the browser tools.*$/,
  'A page that turns the server away (a bot wall, 403) is read again in a real browser by itself and comes back with via "browser": no need to retry it with another tool.',
);

export interface WebFetchOptions {
  /** Hosts never fetched (the app's own, behind sign-in), each with its subdomains. */
  blockHosts?: string[];
  userAgent?: string;
  fetch?: typeof fetch;
  /**
   * Reads a page another way (a real browser) when the plain GET is turned away: refused (401, 403,
   * 429, 503), never answered, or an HTML page with almost no text or a bot check. Text, or null.
   */
  escalate?: (url: string) => Promise<string | null>;
}

/** Statuses a site answers a bot with, where a real browser often gets the page. */
const TURNED_AWAY = new Set([401, 403, 406, 429, 451, 503]);
const BOT_CHECK =
  /captcha|are you a (?:human|robot)|access denied|just a moment|enable javascript|verify you are human|unusual traffic/i;

/** Whether a plain GET's answer was a wall rather than the page. */
export function walled(r: {
  ok: boolean;
  status: number;
  error?: string;
  content_type?: string;
  text?: string;
}): boolean {
  if (r.error?.startsWith('refused:') || r.error?.startsWith('not a full URL')) return false;
  if (!r.ok) return r.status === 0 || TURNED_AWAY.has(r.status);
  if (!/html/i.test(r.content_type ?? '') || typeof r.text !== 'string') return false;
  const words = r.text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words.length < 400 || (words.length < 5000 && BOT_CHECK.test(words));
}

/** Why a URL is refused, or null. */
export function refused(url: URL, block: string[]): string | null {
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
        description: o.escalate ? DESCRIPTION_ESCALATES : DESCRIPTION,
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
            const url = String(a.url ?? '');
            const r = await webFetch(url, headers, o);
            if (!o.escalate || !walled(r)) return r;
            // Turned away: the same page through a real browser, with no question to anyone.
            const text = await o.escalate(url).catch(() => null);
            return text
              ? { ok: true, status: 200, url, via: 'browser', text, truncated: false }
              : {
                  ...r,
                  error: `${r.error ?? 'a bot check'}; a real browser could not read it either`,
                };
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

/**
 * ScrapeQL's MCP tools over its API, with an Access service token, or none over a service
 * binding (`f` is then the binding's fetch). Every one of them reads.
 */
export function scrapeqlTools(
  url: string,
  token: AccessToken | null,
  f?: typeof fetch,
): ToolSource {
  const remote = remoteMcpTools({
    url,
    ...(token
      ? {
          headers: {
            'CF-Access-Client-Id': token.client_id,
            'CF-Access-Client-Secret': token.client_secret,
          },
        }
      : {}),
    ...(f ? { fetch: f } : {}),
  });
  return async () => {
    const open = await remote();
    return { ...open, tools: open.tools.map((t) => ({ ...t, read: true })) };
  };
}

const LINK = /\[([^\]\n]{0,300})\]\((https?:\/\/[^)\s]{1,2000})\)/g;
/** Results a search step lists; more are cut. */
const RESULTS_MAX = 10;

/** Text a tool's output carries: a plain string, or the `result` string it was wrapped in. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  const r = v && typeof v === 'object' ? (v as { result?: unknown }).result : undefined;
  return typeof r === 'string' ? r : '';
}

/** A page's title from the HTML a fetch read, when it has one. */
function htmlTitle(text: string): string | undefined {
  const m = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(text.slice(0, 50_000));
  const t = m?.[1]?.replace(/\s+/g, ' ').trim();
  return t || undefined;
}

/**
 * What a finished web tool call shows the person, or undefined for any other tool: a search's
 * words and the pages it listed, or the page a read opened (`web__fetch` after redirects; ScrapeQL's
 * `scrape`, `extract`, `ask` and `screenshot` by the address they were given). A failed read names
 * the page it tried, never a page read.
 */
export function webStep(
  name: string,
  input: unknown,
  output: unknown,
  failed: boolean,
): StepWeb | undefined {
  // The kit's own web tools, and a connector's tools (`ext_<id>__…`) that search or read pages.
  const ext = /^ext_[A-Za-z0-9_-]*?__/.exec(name);
  if (!name.startsWith('web__') && !ext) return undefined;
  const tool = ext ? name.slice(ext[0].length) : name.slice(5);
  if (ext && tool === 'lookup') return undefined;
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (tool === 'search') {
    const query = typeof args.query === 'string' ? args.query.slice(0, 300) : undefined;
    const results: WebLink[] = [];
    for (const m of textOf(output).matchAll(LINK)) {
      if (results.length >= RESULTS_MAX) break;
      const url = m[2] as string;
      if (results.some((r) => r.url === url)) continue;
      const title = (m[1] as string).trim();
      results.push(title ? { url, title } : { url });
    }
    return { ...(query ? { query } : {}), results };
  }
  if (tool === 'lookup') {
    if (failed) return undefined;
    let o: unknown = output;
    if (typeof o === 'string') {
      try {
        o = JSON.parse(o);
      } catch {
        o = {};
      }
    }
    const r = (o && typeof o === 'object' ? o : {}) as { question?: unknown; sources?: unknown };
    const reads: WebLink[] = [];
    for (const x of Array.isArray(r.sources) ? r.sources : []) {
      const u = (x ?? {}) as { url?: unknown; title?: unknown };
      if (typeof u.url !== 'string' || !/^https?:\/\//.test(u.url)) continue;
      if (reads.some((p) => p.url === u.url)) continue;
      reads.push(
        typeof u.title === 'string' && u.title ? { url: u.url, title: u.title } : { url: u.url },
      );
    }
    const q = typeof args.question === 'string' ? args.question : r.question;
    return { lookup: true, ...(typeof q === 'string' ? { query: q.slice(0, 300) } : {}), reads };
  }
  if (failed) {
    const url = typeof args.url === 'string' ? args.url : '';
    return /^https?:\/\//.test(url) ? { tried: { url } } : undefined;
  }
  if (tool === 'fetch') {
    // A long answer reaches the model cut, as text: read its fields from that text.
    const cut = typeof output === 'string' ? output : '';
    const o = (output && typeof output === 'object' ? output : {}) as Record<string, unknown>;
    if (o.ok === false || cut.startsWith('{"ok":false')) return undefined;
    const said = cut ? /"url":"(https?:\/\/[^"]{1,2000})"/.exec(cut)?.[1] : undefined;
    const url =
      typeof o.url === 'string' ? o.url : (said ?? (typeof args.url === 'string' ? args.url : ''));
    if (!/^https?:\/\//.test(url)) return undefined;
    const body = typeof o.text === 'string' ? o.text : cut;
    const title = body ? htmlTitle(body) : undefined;
    return { read: title ? { url, title } : { url } };
  }
  if (['scrape', 'extract', 'ask', 'screenshot'].includes(tool)) {
    const url = typeof args.url === 'string' ? args.url : '';
    return /^https?:\/\//.test(url) ? { read: { url } } : undefined;
  }
  return undefined;
}
