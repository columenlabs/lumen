/**
 * Web lookup: one tool that answers a question from the web without putting whole pages in the
 * assistant's context. It searches (ScrapeQL `search`, no model), then has ScrapeQL `ask` read each
 * of the best pages and answer the question in a few sentences (ScrapeQL runs that on its cheapest
 * model). The assistant gets back a short answer per page and its address, about a thousand tokens
 * in all, instead of the pages themselves.
 */
import { type OpenTools, ToolError, type ToolSource, plainTools } from '../assistant/tools';
import { refused } from '../assistant/web';

export interface WebLookupOptions {
  /** Pages read for one question; default 3, at most 5. */
  pages?: number;
  /** Tokens each page's answer may use; default 300 (ScrapeQL's floor is 200). */
  answerTokens?: number;
  /** Hosts never read (the app's own, behind sign-in), each with its subdomains. */
  blockHosts?: string[];
}

/** One page a lookup read: its address, its title when the search gave one, and its answer. */
export interface LookupSource {
  url: string;
  title?: string;
  answer: string;
}

/** What `web__lookup` returns. */
export interface LookupResult {
  question: string;
  /** The search words, when it searched. */
  query?: string;
  sources: LookupSource[];
  /** Pages it could not read, and why. */
  failed?: { url: string; error: string }[];
}

const LINK = /\[([^\]\n]{0,300})\]\((https?:\/\/[^)\s]{1,2000})\)/g;
/** ScrapeQL notes after an answer (`\n\n---\n_…_`): for an agent, not for this one. */
const FOOTER = /\n\n---\n_[\s\S]*$/;
const ANSWER_MAX = 2000;

const DESCRIPTION =
  'Answer a question from the web. It searches, reads the best pages and returns a short answer from each with its address: about a thousand tokens, never whole pages. Ask one specific question (a part number, a standard, a size); pass urls to read pages you already know instead of searching. Returns {question, sources: [{url, title, answer}], failed}.';

const clamp = (n: number | undefined, lo: number, hi: number, d: number) =>
  Math.min(hi, Math.max(lo, Math.round(n ?? d)));

/** Text of a tool's answer: a string, or JSON of anything else. */
const textOf = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));

/** True when `raw` is an http(s) address this lookup may read. */
function readable(raw: string, block: string[]): boolean {
  try {
    return refused(new URL(raw), block) === null;
  } catch {
    return false;
  }
}

/**
 * The `lookup` tool (in the `web` group, `web__lookup`) over ScrapeQL's tools (`scrapeqlTools`).
 * ScrapeQL is opened on the first lookup of an answer and closed with it.
 */
export function webLookupTools(scrapeql: ToolSource, o: WebLookupOptions = {}): ToolSource {
  const pages = clamp(o.pages, 1, 5, 3);
  const answerTokens = clamp(o.answerTokens, 200, 2000, 300);
  const block = (o.blockHosts ?? []).map((h) => h.toLowerCase());
  return async () => {
    let open: Promise<OpenTools> | undefined;
    const sq = () => {
      open ??= scrapeql();
      return open;
    };
    const tools = await plainTools([
      {
        name: 'lookup',
        title: 'Look it up on the web',
        description: DESCRIPTION,
        read: true,
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              maxLength: 500,
              description: 'The question each page should answer, in full.',
            },
            search: {
              type: 'string',
              maxLength: 300,
              description: 'Search words, when they differ from the question.',
            },
            urls: {
              type: 'array',
              items: { type: 'string', maxLength: 2000 },
              maxItems: pages,
              description: 'Pages to read instead of searching.',
            },
          },
          required: ['question'],
        },
        async run(args) {
          const a = (args ?? {}) as { question?: unknown; search?: unknown; urls?: unknown };
          const question = String(a.question ?? '')
            .trim()
            .slice(0, 500);
          if (!question) throw new ToolError('Give the question to look up.');
          const given = Array.isArray(a.urls) ? a.urls.map(String) : [];
          const t = await sq();
          let query: string | undefined;
          let picks: { url: string; title?: string }[];
          if (given.length) {
            picks = given.filter((u) => readable(u, block)).map((url) => ({ url }));
            if (!picks.length) throw new ToolError('None of those addresses can be read.');
          } else {
            query =
              String(a.search ?? '')
                .trim()
                .slice(0, 300) || question;
            const found = textOf(await t.call('search', { query, limit: pages + 3 }));
            picks = [];
            for (const m of found.matchAll(LINK)) {
              const url = m[2] as string;
              if (!readable(url, block) || picks.some((p) => p.url === url)) continue;
              const title = (m[1] as string).trim();
              picks.push(title && title !== url ? { url, title } : { url });
            }
          }
          picks = picks.slice(0, pages);
          const out: LookupResult = { question, ...(query ? { query } : {}), sources: [] };
          if (!picks.length) return out;
          const read = await Promise.all(
            picks.map(async (p): Promise<LookupSource | { url: string; error: string }> => {
              try {
                const r = textOf(
                  await t.call('ask', { url: p.url, question, budgetTokens: answerTokens }),
                );
                return { ...p, answer: r.replace(FOOTER, '').trim().slice(0, ANSWER_MAX) };
              } catch (err) {
                return { url: p.url, error: String((err as Error)?.message ?? err).slice(0, 200) };
              }
            }),
          );
          const failed: { url: string; error: string }[] = [];
          for (const r of read)
            if ('answer' in r) {
              if (r.answer) out.sources.push(r);
            } else failed.push(r);
          return failed.length ? { ...out, failed } : out;
        },
      },
    ])();
    return {
      ...tools,
      async close() {
        if (open) await (await open.catch(() => null))?.close();
      },
    };
  };
}
