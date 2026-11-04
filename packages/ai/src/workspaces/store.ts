/**
 * Workspaces on the server: a person's pages of tabs, each tab a table over a frame (the rows one
 * recipe pulled, the recipe that pulled them, and the person's hand edits). Any SQLite holds them:
 * a Durable Object's own (`doSql`) or D1 (`d1Sql`). The product runs recipes (`run`): a recipe is a
 * call to one of its read tools as the person, so running it again needs no model.
 *
 * Budget: a list reads at most `MAX_WORKSPACES` rows, a workspace one row plus its frames' heads,
 * a frame one row. A run writes one row (the frame); nothing here runs on a timer.
 *
 * Tables (names from `tables`, so a store with a prefix rule keeps it):
 *   spaces: owner, id, name, app, tabs (JSON), created_at, updated_at
 *   frames: owner, id, name, head (JSON: meta + recipe), rows (JSON), edits (JSON), at
 */
import {
  FRAME_RUNS,
  type FrameCell,
  type FrameChoice,
  type FrameData,
  type FrameEdit,
  type FrameEditInput,
  type FrameMeta,
  type FrameScript,
} from '@columenlabs/lumen-ui-types/frames';
import type { CustomViewConfig } from '@columenlabs/lumen-ui-types/views';
import type {
  Workspace,
  WorkspaceSummary,
  WorkspaceTab,
} from '@columenlabs/lumen-ui-types/workspaces';
import { FrameError, applyEdits, asRows, coerce, dedupeEdits, toFrame } from './frame';

type Row = Record<string, unknown>;

/** The SQL a store needs: the same shape as `lumen-tasks`' `SqlRunner`, so one runner serves both. */
export interface SqlRunner {
  all(sql: string, ...args: unknown[]): Promise<Row[]>;
  run(sql: string, ...args: unknown[]): Promise<void>;
}

/** A Durable Object's SQLite (`ctx.storage.sql`). */
export function doSql(sql: {
  exec(q: string, ...args: unknown[]): { toArray(): unknown[] };
}): SqlRunner {
  return {
    all: async (q, ...a) => sql.exec(q, ...a).toArray() as Row[],
    run: async (q, ...a) => {
      sql.exec(q, ...a);
    },
  };
}

/** A D1 database binding. */
export function d1Sql(db: {
  prepare(q: string): {
    bind(...a: unknown[]): { all(): Promise<{ results: unknown[] }>; run(): Promise<unknown> };
  };
}): SqlRunner {
  return {
    all: async (q, ...a) =>
      (
        await db
          .prepare(q)
          .bind(...a)
          .all()
      ).results as Row[],
    run: async (q, ...a) => {
      await db
        .prepare(q)
        .bind(...a)
        .run();
    },
  };
}

export const MAX_WORKSPACES = 30;
export const MAX_TABS = 12;
export const MAX_FRAMES = 100;
/** Most bytes a frame's rows keep as JSON (a SQLite row holds 2 MB). */
export const FRAME_BYTES = 1_500_000;
/** How long one recipe run may take before it gives up (the tab keeps its last rows). */
export const RUN_MS = 15_000;

export interface WorkspaceTables {
  spaces: string;
  frames: string;
}
const TABLES: WorkspaceTables = { spaces: 'ws_spaces', frames: 'ws_frames' };

/** The tables' SQL, for a store that runs its own migrations (a person store module). */
export function workspaceMigrations(t: WorkspaceTables = TABLES): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${t.spaces} (owner TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, app TEXT NOT NULL, tabs TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner, id))`,
    `CREATE TABLE IF NOT EXISTS ${t.frames} (owner TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, head TEXT NOT NULL, rows TEXT NOT NULL, edits TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (owner, id))`,
  ];
}

/** What runs a recipe: the product calls its read tool as the person and gives back its answer. */
export type RecipeRunner = (
  recipe: FrameScript,
  ctx: { owner: string; signal: AbortSignal },
) => Promise<unknown>;

export interface WorkspacesOptions {
  db: SqlRunner;
  run: RecipeRunner;
  /** The app new workspaces belong to (one-app products leave it). */
  app?: string;
  tables?: WorkspaceTables;
  now?: () => number;
}

/** A frame as stored: its meta plus the recipe that makes it. */
interface Head extends FrameMeta {
  script: FrameScript | null;
}

export type WorkspaceRead = Workspace & { frames: Record<string, FrameMeta> };

const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
const parse = <T>(v: unknown, d: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const metaOf = ({ script: _s, ...m }: Head): FrameMeta => m;

/** The recipe's text as the person reads it: `jobs.list` and its arguments. */
export function recipeText(s: FrameScript | null): string {
  if (!s) return 'nothing (rows written once)';
  if (s.kind === 'call') return `${s.fn} ${JSON.stringify(s.args)}`;
  return s.kind === 'sql' ? 'a SQL query' : 'a script';
}

export function createWorkspaces(opts: WorkspacesOptions) {
  const t = opts.tables ?? TABLES;
  const now = () => new Date((opts.now ?? Date.now)()).toISOString();
  const db = opts.db;

  const spaceOf = (r: Row): Workspace => ({
    id: String(r.id),
    name: String(r.name),
    app: String(r.app),
    tabs: parse<WorkspaceTab[]>(r.tabs, []),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  });

  async function getSpace(owner: string, id: string): Promise<Workspace> {
    const [r] = await db.all(
      `SELECT id, name, app, tabs, created_at, updated_at FROM ${t.spaces} WHERE owner = ? AND id = ? LIMIT 1`,
      owner,
      id,
    );
    if (!r) throw new FrameError('No workspace with this id.', 404);
    return spaceOf(r);
  }

  async function saveSpace(owner: string, w: Workspace): Promise<Workspace> {
    const next = { ...w, updated_at: now() };
    await db.run(
      `UPDATE ${t.spaces} SET name = ?, app = ?, tabs = ?, updated_at = ? WHERE owner = ? AND id = ?`,
      next.name,
      next.app,
      JSON.stringify(next.tabs),
      next.updated_at,
      owner,
      w.id,
    );
    return next;
  }

  async function heads(owner: string, ids: string[]): Promise<Map<string, Head>> {
    const out = new Map<string, Head>();
    if (!ids.length) return out;
    const rows = await db.all(
      `SELECT id, head FROM ${t.frames} WHERE owner = ? AND id IN (${ids.map(() => '?').join(', ')}) LIMIT ${ids.length}`,
      owner,
      ...ids,
    );
    for (const r of rows) out.set(String(r.id), parse<Head>(r.head, null as unknown as Head));
    return out;
  }

  async function getFrame(owner: string, id: string): Promise<{ head: Head; data: FrameData }> {
    const [r] = await db.all(
      `SELECT head, rows, edits FROM ${t.frames} WHERE owner = ? AND id = ? LIMIT 1`,
      owner,
      id,
    );
    if (!r) throw new FrameError('No frame with this id.', 404);
    const head = parse<Head>(r.head, null as unknown as Head);
    return {
      head,
      data: {
        meta: metaOf(head),
        rows: parse<FrameCell[][]>(r.rows, []),
        edits: parse<FrameEdit[]>(r.edits, []),
      },
    };
  }

  async function writeFrame(owner: string, head: Head, rows: FrameCell[][], edits: FrameEdit[]) {
    const body = JSON.stringify(rows);
    if (body.length > FRAME_BYTES)
      throw new FrameError(
        'These rows are too big for one tab: ask the recipe for fewer rows or fields.',
      );
    await db.run(
      `INSERT INTO ${t.frames} (owner, id, name, head, rows, edits, at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (owner, id) DO UPDATE SET name = excluded.name, head = excluded.head, rows = excluded.rows, edits = excluded.edits, at = excluded.at`,
      owner,
      head.id,
      head.name,
      JSON.stringify(head),
      body,
      JSON.stringify(edits),
      head.at,
    );
  }

  /** Runs a recipe with a time limit, as the person. */
  async function runRecipe(owner: string, recipe: FrameScript): Promise<unknown> {
    const signal = AbortSignal.timeout(RUN_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        opts.run(recipe, { owner, signal }),
        new Promise<never>((_, no) => {
          timer = setTimeout(
            () =>
              no(new FrameError(`The recipe took over ${RUN_MS / 1000} s, so it stopped.`, 504)),
            RUN_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Runs a frame's recipe and keeps the rows (hand edits put back). A failed run keeps the last
   * good rows and says why on the frame; it throws so the caller can tell the person.
   */
  async function refresh(owner: string, id: string, by: 'you' | 'assistant' = 'you') {
    const { head, data } = await getFrame(owner, id);
    if (!head.script)
      throw new FrameError('This tab was written once: it has no recipe to run.', 409);
    return runInto(owner, head, data.edits ?? [], head.script, by, data.rows);
  }

  async function runInto(
    owner: string,
    head: Head,
    edits: FrameEdit[],
    script: FrameScript,
    by: 'you' | 'assistant',
    lastRows: FrameCell[][],
  ): Promise<FrameData> {
    const started = Date.now();
    const at = now();
    try {
      const value = await runRecipe(owner, script);
      const { columns, data } = toFrame(asRows(value));
      const put = applyEdits(columns, data, edits);
      const next: Head = {
        ...head,
        columns,
        rows: put.data.length,
        at,
        script,
        error: undefined,
        edited: put.edits.length || undefined,
        runs: [
          { at, rows: put.data.length, ms: Date.now() - started, ok: true, by },
          ...(head.runs ?? []),
        ].slice(0, FRAME_RUNS),
      };
      await writeFrame(owner, next, put.data, put.edits);
      return { meta: metaOf(next), rows: put.data, edits: put.edits };
    } catch (err) {
      // The product's runner speaks to the person (a tool that is not a read, a grant missing).
      const error = (
        err instanceof Error && err.message ? err.message : 'The recipe failed.'
      ).slice(0, 300);
      const failed: Head = {
        ...head,
        error,
        runs: [
          { at, rows: 0, ms: Date.now() - started, ok: false, by, error },
          ...(head.runs ?? []),
        ].slice(0, FRAME_RUNS),
      };
      // A brand-new frame with no rows is not kept: the caller says why instead.
      if (lastRows.length || head.runs?.length) await writeFrame(owner, failed, lastRows, edits);
      throw err instanceof FrameError ? err : new FrameError(error, 502);
    }
  }

  /** A new frame from a recipe, run once (a failed run keeps the frame with its error). */
  async function newFrame(
    owner: string,
    name: string,
    recipe: FrameScript,
    by: 'you' | 'assistant',
  ): Promise<Head> {
    const [{ n } = { n: 0 }] = await db.all(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${t.frames} WHERE owner = ? LIMIT ${MAX_FRAMES})`,
      owner,
    );
    if (Number(n) >= MAX_FRAMES)
      throw new FrameError(
        `You keep ${MAX_FRAMES} tabs of data, the most: delete some first.`,
        409,
      );
    const head: Head = {
      id: newId('fr'),
      name,
      columns: [],
      rows: 0,
      mode: 'live',
      kind: 'snapshot',
      at: now(),
      origin: 'assistant',
      script: recipe,
    };
    await runInto(owner, head, [], recipe, by, []);
    return (await heads(owner, [head.id])).get(head.id) ?? head;
  }

  const choiceOf = (h: Head): FrameChoice => ({
    id: h.id,
    name: h.name,
    columns: h.columns,
    at: h.at,
    origin: h.origin ?? 'assistant',
  });

  /** A frame no tab shows but a card links (a recipe added from + Data) still counts as used. */
  async function dropFrameIfUnused(owner: string, frame: string) {
    const rows = await db.all(
      `SELECT tabs FROM ${t.spaces} WHERE owner = ? LIMIT ${MAX_WORKSPACES}`,
      owner,
    );
    const used = rows.some((r) =>
      parse<WorkspaceTab[]>(r.tabs, []).some(
        (x) =>
          ('frame' in x.source && x.source.frame === frame) ||
          JSON.stringify(x.config ?? null).includes(frame),
      ),
    );
    if (!used) await db.run(`DELETE FROM ${t.frames} WHERE owner = ? AND id = ?`, owner, frame);
  }

  return {
    async list(owner: string): Promise<{ workspaces: WorkspaceSummary[] }> {
      const rows = await db.all(
        `SELECT id, name, app, tabs, created_at, updated_at FROM ${t.spaces} WHERE owner = ? ORDER BY updated_at DESC LIMIT ${MAX_WORKSPACES}`,
        owner,
      );
      return {
        workspaces: rows.map((r) => {
          const w = spaceOf(r);
          return {
            id: w.id,
            name: w.name,
            app: w.app,
            updated_at: w.updated_at,
            tabs: w.tabs.map((x) => ({
              id: x.id,
              name: x.name,
              kind: 'frame' in x.source ? ('frame' as const) : ('domain' as const),
            })),
          };
        }),
      };
    },

    async create(owner: string, p: { name: string; app?: string }): Promise<Workspace> {
      const [{ n } = { n: 0 }] = await db.all(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${t.spaces} WHERE owner = ? LIMIT ${MAX_WORKSPACES})`,
        owner,
      );
      if (Number(n) >= MAX_WORKSPACES)
        throw new FrameError(
          `You have ${MAX_WORKSPACES} workspaces, the most: delete one first.`,
          409,
        );
      const at = now();
      const w: Workspace = {
        id: newId('ws'),
        name: p.name,
        app: p.app ?? opts.app ?? 'app',
        tabs: [],
        created_at: at,
        updated_at: at,
      };
      await db.run(
        `INSERT INTO ${t.spaces} (owner, id, name, app, tabs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        owner,
        w.id,
        w.name,
        w.app,
        '[]',
        at,
        at,
      );
      return w;
    },

    async read(owner: string, id: string): Promise<WorkspaceRead> {
      const w = await getSpace(owner, id);
      const ids = w.tabs.flatMap((x) => ('frame' in x.source ? [x.source.frame] : []));
      const hs = await heads(owner, ids);
      return { ...w, frames: Object.fromEntries([...hs].map(([k, h]) => [k, metaOf(h)])) };
    },

    async patch(owner: string, id: string, p: { name?: string; app?: string }) {
      const w = await getSpace(owner, id);
      return saveSpace(owner, {
        ...w,
        ...(p.name ? { name: p.name } : {}),
        ...(p.app ? { app: p.app } : {}),
      });
    },

    async remove(owner: string, id: string) {
      const w = await getSpace(owner, id);
      await db.run(`DELETE FROM ${t.spaces} WHERE owner = ? AND id = ?`, owner, id);
      for (const x of w.tabs)
        if ('frame' in x.source) await dropFrameIfUnused(owner, x.source.frame);
    },

    /** A new tab from a recipe: runs it once, keeps the rows as a frame, adds the tab. */
    async addTab(
      owner: string,
      id: string,
      p: { name: string; recipe: FrameScript; by?: 'you' | 'assistant' },
    ): Promise<{ workspace: WorkspaceRead; tab: string }> {
      const w = await getSpace(owner, id);
      if (w.tabs.length >= MAX_TABS)
        throw new FrameError(`${w.name} has ${MAX_TABS} tabs, the most: delete one first.`, 409);
      const head = await newFrame(owner, p.name, p.recipe, p.by ?? 'you');
      const tab: WorkspaceTab = {
        id: newId('tb'),
        name: p.name,
        source: { frame: head.id },
        config: null,
      };
      const saved = await saveSpace(owner, { ...w, tabs: [...w.tabs, tab] });
      const hs = await heads(
        owner,
        saved.tabs.flatMap((x) => ('frame' in x.source ? [x.source.frame] : [])),
      );
      return {
        workspace: {
          ...saved,
          frames: Object.fromEntries([...hs].map(([k, h]) => [k, metaOf(h)])),
        },
        tab: tab.id,
      };
    },

    async putTab(
      owner: string,
      id: string,
      tab: string,
      p: { name?: string; config?: CustomViewConfig | null },
    ): Promise<Workspace> {
      const w = await getSpace(owner, id);
      if (!w.tabs.some((x) => x.id === tab)) throw new FrameError('No tab with this id.', 404);
      return saveSpace(owner, {
        ...w,
        tabs: w.tabs.map((x) =>
          x.id === tab
            ? {
                ...x,
                ...(p.name ? { name: p.name } : {}),
                ...(p.config !== undefined ? { config: p.config } : {}),
              }
            : x,
        ),
      });
    },

    async removeTab(owner: string, id: string, tab: string): Promise<Workspace> {
      const w = await getSpace(owner, id);
      const gone = w.tabs.find((x) => x.id === tab);
      if (!gone) throw new FrameError('No tab with this id.', 404);
      const saved = await saveSpace(owner, { ...w, tabs: w.tabs.filter((x) => x.id !== tab) });
      if ('frame' in gone.source) await dropFrameIfUnused(owner, gone.source.frame);
      return saved;
    },

    /** Runs every tab's recipe again, one after another; a failed one leaves its last rows. */
    async refreshAll(
      owner: string,
      id: string,
    ): Promise<{ ran: number; failed: string[]; rows: number }> {
      const w = await getSpace(owner, id);
      let ran = 0;
      let rows = 0;
      const failed: string[] = [];
      for (const x of w.tabs) {
        if (!('frame' in x.source)) continue;
        try {
          const d = await refresh(owner, x.source.frame);
          ran++;
          rows += d.meta.rows;
        } catch {
          failed.push(x.name);
        }
      }
      return { ran, failed, rows };
    },

    async frames(owner: string): Promise<{ frames: FrameChoice[] }> {
      const rows = await db.all(
        `SELECT head FROM ${t.frames} WHERE owner = ? LIMIT ${MAX_FRAMES}`,
        owner,
      );
      return {
        frames: rows.map((r) => choiceOf(parse<Head>(r.head, null as unknown as Head))),
      };
    },

    /**
     * A frame from a recipe the product offers (+ Data's app recipes), for a card to link. One that
     * already runs the same recipe is reused, so picking it twice keeps one copy.
     */
    async makeFrame(owner: string, p: { name: string; recipe: FrameScript }): Promise<FrameChoice> {
      const rows = await db.all(
        `SELECT head FROM ${t.frames} WHERE owner = ? LIMIT ${MAX_FRAMES}`,
        owner,
      );
      const want = recipeText(p.recipe);
      const same = rows
        .map((r) => parse<Head>(r.head, null as unknown as Head))
        .find((h) => h?.script && recipeText(h.script) === want);
      return choiceOf(same ?? (await newFrame(owner, p.name, p.recipe, 'you')));
    },

    async frame(owner: string, id: string): Promise<FrameData> {
      return (await getFrame(owner, id)).data;
    },

    refresh,

    async script(owner: string, id: string): Promise<{ script: FrameScript | null }> {
      return { script: (await getFrame(owner, id)).head.script };
    },

    /** A new recipe for a frame: kept only if it runs. */
    async setScript(owner: string, id: string, script: FrameScript): Promise<FrameData> {
      const { head, data } = await getFrame(owner, id);
      return runInto(owner, head, data.edits ?? [], script, 'you', data.rows);
    },

    async editCells(owner: string, id: string, edits: FrameEditInput[]): Promise<FrameData> {
      const { head, data } = await getFrame(owner, id);
      const at = now();
      const add: FrameEdit[] = edits.map((e) => {
        const col = head.columns.find((c) => c.key === e.column);
        if (!col) throw new FrameError(`No column ${e.column}.`);
        if (e.row === undefined) throw new FrameError('An edit names its row.');
        return { column: e.column, row: e.row, value: coerce(col, e.value), at };
      });
      const all = dedupeEdits([...(data.edits ?? []), ...add]);
      const put = applyEdits(head.columns, data.rows, add);
      const next: Head = { ...head, edited: all.length || undefined };
      await writeFrame(owner, next, put.data, all);
      return { meta: metaOf(next), rows: put.data, edits: all };
    },
  };
}

export type Workspaces = ReturnType<typeof createWorkspaces>;
