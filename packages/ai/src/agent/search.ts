/**
 * Lazy tools: past `LAZY_AT` tools a turn sends the model only its core tools and `tool_search`,
 * with one catalog line per group in the instructions. A search finds tools by their name and
 * description and turns them on from the next step, so a big set (many connectors) costs a short
 * prompt instead of every schema on every call.
 */
import { openai } from '@ai-sdk/openai';
import {
  type JSONSchema7,
  type JSONValue,
  type Tool,
  type ToolSet,
  asSchema,
  jsonSchema,
  tool,
} from 'ai';

/** Past this many tools a turn starts with `tool_search` and its core tools only. */
export const LAZY_AT = 30;
export const TOOL_SEARCH = 'tool_search';
/** OpenAI's own tool search, when the turn's tools are deferred (`deferredTools`). */
export const DEFERRED_SEARCH = 'openai_tool_search';

/** Most tools one search turns on. */
const FOUND_MAX = 8;

export interface LazyTools {
  /** The search tool, to add to the turn's tools. */
  search: Tool;
  /** One line per group, for the instructions. */
  catalog: string;
  /** The names to keep active now: the core tools, the search and what it found. */
  active(): string[];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

/** How well a tool's name and description match the query's words. */
export function toolScore(query: string, name: string, description = ''): number {
  const q = words(query);
  if (!q.length) return 0;
  const n = new Set(words(name));
  const d = new Set(words(description));
  let score = 0;
  for (const w of q) {
    if (n.has(w)) score += 3;
    else if ([...n].some((x) => x.startsWith(w) || w.startsWith(x))) score += 2;
    if (d.has(w)) score += 1;
  }
  return score;
}

/**
 * The tools a chat already used or found in earlier turns: each turn starts with only its core
 * tools on, so a reply such as "yes" to a card offered last turn would call a tool that is off
 * (AI_NoSuchToolError). Read from the history's tool calls and `tool_search` results.
 */
export function usedTools(messages: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const m of messages) {
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content as { type?: string; toolName?: string; output?: unknown }[]) {
      if (part.type === 'tool-call' && part.toolName) out.add(part.toolName);
      if (part.type === 'tool-result' && part.toolName === TOOL_SEARCH) {
        const o = part.output as { value?: unknown } | undefined;
        const v = (o && typeof o === 'object' && 'value' in o ? o.value : o) as
          | { found?: { name?: unknown }[] }
          | undefined;
        for (const f of v?.found ?? []) if (typeof f?.name === 'string') out.add(f.name);
      }
    }
  }
  return [...out];
}

/**
 * A search over `tools` whose finds stay on for the rest of the turn. `core` names are always on;
 * `groupOf` names each tool's group for the catalog; `start` names tools already on (those the
 * chat used or found in earlier turns, `usedTools`), at most `FOUND_MAX` of the latest.
 */
export function lazyTools(
  tools: ToolSet,
  core: string[],
  groupOf: (name: string) => string,
  start: readonly string[] = [],
  labels: Record<string, string> = {},
): LazyTools {
  const found = new Set<string>(
    start.filter((n) => n in tools && !core.includes(n) && n !== TOOL_SEARCH).slice(-FOUND_MAX),
  );
  const about = (n: string) => {
    const d = tools[n]?.description;
    return typeof d === 'string' ? d : '';
  };
  const names = Object.keys(tools);
  const groups = new Map<string, number>();
  for (const n of names) {
    if (core.includes(n)) continue;
    const g = groupOf(n);
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  // A labelled group (a connector) names what it is and its tools, so the model knows to look.
  const own = (n: string) => (n.includes('__') ? n.slice(n.indexOf('__') + 2) : n);
  const line = (g: string, n: number) => {
    const label = labels[g];
    if (!label) return `${g} (${n})`;
    const list = names.filter((x) => groupOf(x) === g && !core.includes(x)).map(own);
    return `${g}: ${label} (${list.slice(0, 12).join(', ')}${list.length > 12 ? ', …' : ''})`;
  };
  const catalog = `More tools are off until you find them: call ${TOOL_SEARCH} with a few words of what you need, then call what it finds. Groups: ${[
    ...groups,
  ]
    .map(([g, n]) => line(g, n))
    .join(', ')}.`;
  const search = tool({
    description:
      'Finds tools by what they do and turns them on for your next call. Give a few words (e.g. "create calendar event"), and a group to look in only it.',
    inputSchema: jsonSchema<{ query: string; group?: string }>({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words of what the tool does.' },
        group: { type: 'string', description: 'Look in this group only.' },
      },
      required: ['query'],
    } as JSONSchema7),
    execute: async ({ query, group }) => {
      const hits = names
        .filter((n) => !core.includes(n) && (!group || groupOf(n) === group))
        .map((n) => ({ n, s: toolScore(query, n, about(n)) }))
        .filter((h) => h.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, FOUND_MAX);
      for (const h of hits) found.add(h.n);
      if (!hits.length) return { found: [], note: 'Nothing matched. Try other words or a group.' };
      return {
        found: hits.map((h) => ({
          name: h.n,
          description: about(h.n).slice(0, 300),
        })),
        note: 'These are on from your next call.',
      };
    },
  });
  return {
    search,
    catalog,
    active: () => [...core, TOOL_SEARCH, ...found],
  };
}

/**
 * Lazy tools as an OpenAI model takes them: every tool is sent, those outside \`core\` marked
 * \`defer_loading\`, with OpenAI's own \`tool_search\`. A deferred tool's schema stays out of the
 * model's context until a search loads it, and the search's result lands at the end of the
 * conversation, so the tool list at the start of the cached prompt never changes (live 2026-11-15:
 * with the list narrowed per step, the call after a search sent a longer list and read 0 of the
 * cache, its unchanged 5.4k-token instructions included).
 */
export function deferredTools(
  tools: ToolSet,
  core: readonly string[],
  o: { client?: boolean } = {},
): ToolSet {
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const kind = (t as { type?: string }).type;
    if (core.includes(name) || (kind && kind !== 'function' && kind !== 'dynamic')) {
      out[name] = t;
      continue;
    }
    const po =
      (t as { providerOptions?: Record<string, Record<string, unknown>> }).providerOptions ?? {};
    out[name] = {
      ...t,
      providerOptions: { ...po, openai: { ...po.openai, deferLoading: true } },
    } as Tool;
  }
  // Its own name: a chat's earlier calls of Lumen's `tool_search` stay plain function calls.
  out[DEFERRED_SEARCH] = o.client ? clientSearch(tools, core) : openai.tools.toolSearch({});
  return out;
}

/**
 * OpenAI's \`tool_search\` run by us (\`execution: 'client'\`, as the AI SDK and OpenAI's own Codex
 * client send it): the model searches the deferred tools, we score them (\`toolScore\`) and hand
 * back their definitions, which OpenAI loads at the end of the conversation. For a ChatGPT plan,
 * whose server-side search is refused ("subscription_sharing_unsupported_capability").
 */
function clientSearch(tools: ToolSet, core: readonly string[]): Tool {
  const names = Object.keys(tools).filter((n) => !core.includes(n));
  return openai.tools.toolSearch({
    execution: 'client',
    description:
      'Finds tools by what they do and loads them. Give a few words (e.g. "create calendar event").',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A few words of what the tool does.' } },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async ({ arguments: args }) => {
      const query = String((args as { query?: unknown } | undefined)?.query ?? '');
      const about = (n: string) => {
        const d = tools[n]?.description;
        return typeof d === 'string' ? d : '';
      };
      const hits = names
        .map((n) => ({ n, s: toolScore(query, n, about(n)) }))
        .filter((h) => h.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, FOUND_MAX);
      const found = await Promise.all(
        hits.map(async ({ n }) => ({
          type: 'function',
          name: n,
          description: about(n),
          parameters: (await asSchema(tools[n]?.inputSchema).jsonSchema) as JSONValue,
          defer_loading: true,
        })),
      );
      return { tools: found };
    },
  });
}
