/**
 * The assistant moves the person's screen: one tool, `screen`, takes a short list of moves the
 * browser runs (`@columenlabs/lumen-ui`'s `AssistantScreenProvider`): a page of the app, Settings
 * at a section (pulsing a row, never changing it), a symbol's chart, a row's details, a card
 * pointed at. The browser sends its page map with each message; every move is checked against it
 * here before the call reaches the screen, and the browser checks again. How each call ended comes
 * back with the next message, so the model never guesses. Settings ▸ Screen: Off leaves the tool out.
 */
import type {
  AssistantScreenMap,
  AssistantScreenMove,
  AssistantScreenOutcome,
} from '@columenlabs/lumen-ui-types/assistant';
import { indicatorSpecIssue, indicatorSpecSchema } from '@columenlabs/lumen-ui-types/chart-formula';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';

const ticker = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.^$=:/-]{1,24}$/);

const move = z.union([
  z.object({ go: z.string().trim().min(1).max(600) }).strict(),
  z
    .object({
      settings: z.string().trim().min(1).max(80),
      row: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
  z
    .object({
      chart: z.union([ticker, z.array(ticker).min(1).max(8)]),
      indicators: z.array(indicatorSpecSchema).max(8).optional(),
    })
    .strict(),
  z.object({ open: z.string().trim().min(1).max(200) }).strict(),
  z.object({ point: z.string().trim().min(1).max(200) }).strict(),
]);

export const screenInput = z.object({
  label: z
    .string()
    .describe('What the screen will show, in a few words, e.g. "Settings · Email".')
    .transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, 80)),
  moves: z
    .array(move)
    .min(1)
    .max(8)
    .describe(
      'In order. Each is one of: {go: "/path"} (a page; fill path params), {settings: "<section id>", row?: "<row label>"}, {chart: "SYM"} or {chart: ["A", "B"]} (up to 8 on one chart), {open: "<row title>"} (the row\'s details in the view on screen), {point: "<card id>"} (scroll to a card and highlight it).',
    ),
});

/** Bounds on a page map from the browser, so a bad one costs nothing. */
export function screenMapOf(v: unknown): AssistantScreenMap | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const list = <T>(x: unknown, n: number, f: (i: Record<string, unknown>) => T | null): T[] =>
    (Array.isArray(x) ? x : [])
      .slice(0, n)
      .flatMap((i) => (i && typeof i === 'object' ? [f(i as Record<string, unknown>)] : []))
      .filter((i): i is T => i !== null);
  const str = (x: unknown, n: number) => (typeof x === 'string' && x ? x.slice(0, n) : null);
  return {
    routes: (Array.isArray(o.routes) ? o.routes : [])
      .slice(0, 200)
      .flatMap((r) => (typeof r === 'string' ? [r.slice(0, 300)] : [])),
    pages: list(o.pages, 300, (p) => {
      const path = str(p.path, 300);
      const title = str(p.title, 120);
      const section = str(p.section, 80);
      return path && title ? { path, title, ...(section ? { section } : {}) } : null;
    }),
    settings: list(o.settings, 60, (p) => {
      const id = str(p.id, 80);
      const title = str(p.title, 120);
      return id && title ? { id, title } : null;
    }),
    cards: list(o.cards, 60, (p) => {
      const id = str(p.id, 200);
      const title = str(p.title, 200) ?? '';
      const kind = str(p.kind, 40);
      return id ? { id, title, ...(kind ? { kind } : {}) } : null;
    }),
    rows: (Array.isArray(o.rows) ? o.rows : [])
      .slice(0, 30)
      .flatMap((r) => (typeof r === 'string' && r ? [r.slice(0, 120)] : [])),
  };
}

/** Outcomes from the browser, checked. */
export function screenOutcomesOf(v: unknown): AssistantScreenOutcome[] {
  return (Array.isArray(v) ? v : []).slice(0, 50).flatMap((o) => {
    const x = o as Record<string, unknown> | null;
    if (!x || typeof x.id !== 'string' || !/^sc_[a-f0-9]{16}$/.test(x.id)) return [];
    if (!['done', 'failed', 'waiting', 'undone'].includes(String(x.status))) return [];
    return [
      {
        id: x.id,
        status: x.status as AssistantScreenOutcome['status'],
        ...(typeof x.text === 'string' && x.text ? { text: x.text.slice(0, 1200) } : {}),
      },
    ];
  });
}

/** The pattern's segments match the path's: `$param` matches any one segment. */
function matches(pattern: string, path: string): boolean {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.startsWith('$') || s === b[i]);
}

/**
 * Each move checked against the page map: an unknown page, Settings section or card is an error
 * back to the model in the same turn. A card after `go` is checked by the browser alone.
 */
export function checkMoves(moves: AssistantScreenMove[], map: AssistantScreenMap): string | null {
  let moved = false;
  for (const m of moves) {
    if ('go' in m) {
      const path = m.go.split(/[?#]/)[0] ?? '';
      if (!path.startsWith('/') || /\$/.test(path))
        return `go "${m.go}": give a path of this app with its params filled`;
      if (!map.routes.some((r) => matches(r, path)))
        return `go "${m.go}": no such page. Routes: ${map.routes.join(', ')}`;
      moved = true;
    } else if ('chart' in m) {
      for (const spec of m.indicators ?? []) {
        const wrong = indicatorSpecIssue(spec);
        if (wrong) return `chart indicators: ${wrong}`;
      }
    } else if ('settings' in m) {
      if (!map.settings.some((s) => s.id === m.settings))
        return `settings "${m.settings}": no such section. Sections: ${map.settings.map((s) => s.id).join(', ')}`;
    } else if ('point' in m && !moved) {
      const id = m.point.replace(/^card:/, '');
      if (!map.cards.some((c) => c.id === id))
        return `point "${m.point}": no such card on this page. Cards: ${map.cards.map((c) => c.id).join(', ') || 'none'}`;
    }
  }
  return null;
}

/** The rules and this app's page map, for the instructions. */
export function screenRules(map: AssistantScreenMap): string {
  const pages = map.pages
    .map((p) => `${p.path} (${p.section ? `${p.section} ▸ ` : ''}${p.title})`)
    .join('; ');
  return `Screen: with the screen tool you move the person's screen in their browser.
- Use it when the person asks to see, open, show, go to or be taken somewhere ("show me", "take me to", "where do I set X"). Otherwise answer in words.
- One call with every move, in order. After go, the next moves act on the new page; open and point act on the page on screen after the moves before them.
- Moves only change the screen: nothing is saved. Never say something was saved or changed. Say in one line what you put on screen.
- Settings: you open a section and point at a row; you never flip a switch or change a value. Say which one the person taps.
- A line "Your screen moves since your last answer" tells you how each call ended (done, failed and why, waiting for the person's tap, or undone) and what the view shows now: answer from it.
Routes: ${map.routes.join(', ') || '(none)'}
Pages: ${pages || '(none listed)'}
Settings sections: ${map.settings.map((s) => `${s.id} (${s.title})`).join(', ') || '(none)'}
Cards on this page: ${map.cards.map((c) => `${c.id} (${c.title})`).join(', ') || '(none)'}${map.rows?.length ? `\nRows you can open here: ${map.rows.join('; ')}` : ''}`;
}

/** One screen call as the chat keeps it. */
export interface ScreenCall {
  id: string;
  label: string;
  moves: AssistantScreenMove[];
  status: 'sent' | AssistantScreenOutcome['status'];
  text?: string;
}

const SAID = {
  sent: 'sent; no word back yet',
  done: 'done',
  failed: 'failed',
  waiting: 'not run yet: the person was mid-edit; it runs when they tap it',
  undone: 'undone by the person',
} as const;

/** The calls the model has not heard about since the browser ran them or the person pressed Undo. */
export function screenNews(calls: ScreenCall[]): string {
  if (!calls.length) return '';
  const lines = calls.map(
    (c) =>
      `- "${c.label}" ${JSON.stringify(c.moves).slice(0, 300)}: ${SAID[c.status]}${c.text ? `. ${c.status === 'failed' ? 'Why' : 'On screen now'}: ${c.text}` : ''}`,
  );
  return `Your screen moves since your last answer:\n${lines.join('\n')}\n\n`;
}

export const screenId = () => `sc_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

/** The `screen` tool for one turn: checks the moves, keeps the call and answers with its id. */
export function screenTool(
  map: AssistantScreenMap,
  keep: (call: { id: string; label: string; moves: AssistantScreenMove[] }) => void,
): ToolSet {
  return {
    screen: tool({
      description:
        "Move the person's screen: go to a page, open Settings at a section, open a symbol's chart, open a row's details or point at a card. Moves run in order in their browser at once, with an Undo. Use the routes, pages, Settings sections and cards listed under Screen. The outcome comes with the person's next message.",
      inputSchema: screenInput,
      execute: async ({ label, moves }) => {
        const wrong = checkMoves(moves as AssistantScreenMove[], map);
        if (wrong) return { error: wrong };
        const id = screenId();
        keep({ id, label, moves: moves as AssistantScreenMove[] });
        return { screen: id, label, note: 'Sent to the screen. Say in one line what it shows.' };
      },
    }),
  };
}
