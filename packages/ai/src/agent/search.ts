/**
 * Lazy tools: past `LAZY_AT` tools a turn sends the model only its core tools and `tool_search`,
 * with one catalog line per group in the instructions. A search finds tools by their name and
 * description and turns them on from the next step, so a big set (many connectors) costs a short
 * prompt instead of every schema on every call.
 */
import { type JSONSchema7, type Tool, type ToolSet, jsonSchema, tool } from 'ai';

/** Past this many tools a turn starts with `tool_search` and its core tools only. */
export const LAZY_AT = 30;
export const TOOL_SEARCH = 'tool_search';

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
 * A search over `tools` whose finds stay on for the rest of the turn. `core` names are always on;
 * `groupOf` names each tool's group for the catalog.
 */
export function lazyTools(
  tools: ToolSet,
  core: string[],
  groupOf: (name: string) => string,
): LazyTools {
  const found = new Set<string>();
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
  const catalog = `More tools are off until you find them: call ${TOOL_SEARCH} with a few words of what you need, then call what it finds. Groups: ${[
    ...groups,
  ]
    .map(([g, n]) => `${g} (${n})`)
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
