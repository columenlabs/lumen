/**
 * The Tasks ledger: one row a background job a person started, in any SQLite (a Durable Object's
 * own through `doSql`, or D1 through `d1Sql`). The engine that does the work reports here
 * (`start`, `progress`, `finish`); the person reads, cancels and clears through `taskRoutes`.
 *
 * Nothing runs here: the work runs where its data is (a Durable Object's alarm, a queue, a runner
 * elsewhere) and only reports. Cancel is cooperative: it ends the task at once, and the engine's
 * next `progress` answers `stop: true`, so it stops between steps. A task open past its limit is
 * failed by the reaper, which runs on every read, so no cron is needed and nothing stays running
 * for good. Ended tasks are kept `keepDays` (7) and then dropped.
 *
 * Table `tasks` (plain rows: a title names what ran, never amounts or private values).
 */
import type { Task, TaskList, TaskState } from '@columenlabs/lumen-ui-types/tasks';
import { isActive } from '@columenlabs/lumen-ui-types/tasks';

type Row = Record<string, unknown>;

/** The SQL a ledger needs: the same shape as `lumen-people`'s, so one runner serves both. */
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

/** What an engine gives when it starts a job. */
export interface TaskStart {
  /** Whose task it is (the app's stable id for the person, such as their email). */
  owner: string;
  /** The app it runs on; the list names it when tasks come from several. */
  app: string;
  /** What kind of work (`search`, `sync`, `backfill`). */
  kind: string;
  /** `Search · Remote roles`: what ran, never amounts or private values. */
  title: string;
  /** The page with the result, a whole address. */
  link?: string | null;
  /** How many steps, in `unit`, when the engine counts. */
  total?: number | null;
  unit?: string | null;
  /** The engine's own id for the work, so a page finds the task its button started. */
  ref?: string | null;
  /** Whether Cancel works for it (the engine checks `progress`'s `stop`). Default true. */
  cancellable?: boolean;
  /** Open longer than this fails it (default 15). */
  limitMinutes?: number;
  /** Starts as running (default) or queued, for work that waits its turn. */
  state?: 'queued' | 'running';
}

/** How a job ended. */
export interface TaskEnd {
  state: 'done' | 'failed';
  /** One line on the result (`14 new jobs`). */
  summary?: string | null;
  /** Why it failed. */
  error?: string | null;
  /** The result's page, when it is only known at the end. */
  link?: string | null;
}

/** A task as stored: `owner` and the limit stay on the server. */
export interface StoredTask extends Task {
  owner: string;
  limit_minutes: number;
}

export interface TasksOptions {
  db: SqlRunner;
  /** Days an ended task is kept (default 7). */
  keepDays?: number;
  /** Called once when a task ends (done, failed, cancelled or reaped), to notify the person
   *  (email, push) for long ones. Errors are swallowed: a failed notice never fails the job. */
  onEnd?: (task: StoredTask) => Promise<void> | void;
  /** The clock (tests and replays); default `Date.now`. */
  now?: () => number;
}

export interface Tasks {
  start(t: TaskStart): Promise<StoredTask>;
  /** Reports progress; `stop` is true once the task is no longer open (cancelled or reaped),
   *  so the engine stops between steps. */
  progress(
    id: string,
    p: { done?: number | null; total?: number | null; state?: 'running' },
  ): Promise<{ stop: boolean }>;
  /** Ends an open task; an already ended one (cancelled meanwhile) stays as it is and gives null. */
  finish(id: string, end: TaskEnd): Promise<StoredTask | null>;
  get(id: string): Promise<StoredTask | null>;
  /** The person's newest task for one piece of work (`kind` + `ref`). */
  byRef(owner: string, kind: string, ref: string): Promise<StoredTask | null>;
  /** The person's tasks over the kept days, newest first; reaps first. */
  list(owner: string): Promise<TaskList>;
  /** The person's task, or null. */
  read(owner: string, id: string): Promise<Task | null>;
  cancel(owner: string, id: string): Promise<Task | null>;
  /** Marks every ended task of the person seen. */
  seen(owner: string): Promise<void>;
  /** Drops one ended task, or every ended one; open tasks stay. */
  clear(owner: string, id?: string): Promise<void>;
  /** Fails tasks open past their limit and drops old ended ones. */
  reap(): Promise<void>;
}

const DAY_MS = 24 * 60 * 60_000;
const iso = (v: unknown) => (v == null ? null : new Date(Number(v)).toISOString());
const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));
const STATES: readonly TaskState[] = ['queued', 'running', 'done', 'failed', 'cancelled'];

function toTask(r: Row): StoredTask {
  const state = STATES.includes(r.state as TaskState) ? (r.state as TaskState) : 'failed';
  return {
    id: String(r.id),
    owner: String(r.owner),
    app: String(r.app),
    kind: String(r.kind),
    title: String(r.title),
    link: str(r.link),
    state,
    done: num(r.done),
    total: num(r.total),
    unit: str(r.unit),
    summary: str(r.summary),
    error: str(r.error),
    ref: str(r.ref),
    cancellable: Number(r.cancellable) === 1 && isActive({ state }),
    created_at: iso(r.created_at) ?? new Date(0).toISOString(),
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    seen_at: iso(r.seen_at),
    limit_minutes: Number(r.limit_minutes ?? 15),
  };
}

/** What the person sees: the stored task without the owner and the limit. */
export function publicTask(t: StoredTask): Task {
  const { owner: _o, limit_minutes: _l, ...rest } = t;
  return rest;
}

export function createTasks(opts: TasksOptions): Tasks {
  const { db } = opts;
  const now = opts.now ?? Date.now;
  const keep = (opts.keepDays ?? 7) * DAY_MS;
  let ready: Promise<void> | null = null;
  const init = () => {
    ready ??= (async () => {
      await db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, app TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, link TEXT, state TEXT NOT NULL, done REAL, total REAL, unit TEXT,
        summary TEXT, error TEXT, ref TEXT, cancellable INTEGER NOT NULL DEFAULT 1,
        limit_minutes INTEGER NOT NULL DEFAULT 15, created_at INTEGER NOT NULL,
        started_at INTEGER, finished_at INTEGER, seen_at INTEGER)`);
      await db.run('CREATE INDEX IF NOT EXISTS tasks_owner ON tasks (owner, created_at)');
      await db.run('CREATE INDEX IF NOT EXISTS tasks_open ON tasks (state)');
    })().catch((e) => {
      ready = null;
      throw e;
    });
    return ready;
  };
  const one = async (id: string) => {
    await init();
    const [r] = await db.all('SELECT * FROM tasks WHERE id = ?', id);
    return r ? toTask(r) : null;
  };
  const ended = async (t: StoredTask | null) => {
    if (!t || !opts.onEnd) return;
    try {
      await opts.onEnd(t);
    } catch {
      // A notice that fails never fails the job.
    }
  };
  // Ends an open task; gives it when this call ended it (so `onEnd` fires once), else null.
  const end = async (id: string, state: TaskState, set: Record<string, unknown>) => {
    const before = await one(id);
    if (!before || !isActive(before)) return null;
    const cols = Object.keys(set);
    await db.run(
      `UPDATE tasks SET state = ?, finished_at = ?${cols.map((c) => `, ${c} = ?`).join('')}
       WHERE id = ? AND state IN ('queued', 'running')`,
      state,
      now(),
      ...cols.map((c) => set[c] ?? null),
      id,
    );
    return one(id);
  };

  const tasks: Tasks = {
    async start(t) {
      await init();
      const id = crypto.randomUUID();
      const at = now();
      const state = t.state ?? 'running';
      await db.run(
        `INSERT INTO tasks (id, owner, app, kind, title, link, state, done, total, unit, ref,
          cancellable, limit_minutes, created_at, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        t.owner,
        t.app,
        t.kind,
        t.title,
        t.link ?? null,
        state,
        t.total ? 0 : null,
        t.total ?? null,
        t.unit ?? null,
        t.ref ?? null,
        t.cancellable === false ? 0 : 1,
        t.limitMinutes ?? 15,
        at,
        state === 'running' ? at : null,
      );
      return (await one(id)) as StoredTask;
    },

    async progress(id, p) {
      await init();
      const sets: string[] = [];
      const args: unknown[] = [];
      if (p.done !== undefined) {
        sets.push('done = ?');
        args.push(p.done);
      }
      if (p.total !== undefined) {
        sets.push('total = ?');
        args.push(p.total);
      }
      if (p.state === 'running') {
        sets.push("state = 'running', started_at = COALESCE(started_at, ?)");
        args.push(now());
      }
      if (sets.length)
        await db.run(
          `UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND state IN ('queued', 'running')`,
          ...args,
          id,
        );
      const t = await one(id);
      return { stop: !t || !isActive(t) };
    },

    async finish(id, e) {
      await init();
      const t = await end(id, e.state, {
        summary: e.summary ?? null,
        error: e.state === 'failed' ? (e.error ?? 'Failed') : null,
        ...(e.link !== undefined ? { link: e.link } : {}),
      });
      // A done task's progress reads full.
      if (t && e.state === 'done' && t.total != null) {
        await db.run('UPDATE tasks SET done = total WHERE id = ?', id);
        t.done = t.total;
      }
      await ended(t);
      return t;
    },

    get: one,

    async byRef(owner, kind, ref) {
      await init();
      const [r] = await db.all(
        'SELECT * FROM tasks WHERE owner = ? AND kind = ? AND ref = ? ORDER BY created_at DESC LIMIT 1',
        owner,
        kind,
        ref,
      );
      return r ? toTask(r) : null;
    },

    async list(owner) {
      await tasks.reap();
      const rows = await db.all(
        'SELECT * FROM tasks WHERE owner = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 100',
        owner,
        now() - keep,
      );
      const list = rows.map(toTask);
      return {
        tasks: list.map(publicTask),
        active: list.filter(isActive).length,
        unseen: list.filter((t) => t.finished_at && !t.seen_at).length,
      };
    },

    async read(owner, id) {
      const t = await one(id);
      return t && t.owner === owner ? publicTask(t) : null;
    },

    async cancel(owner, id) {
      const t = await one(id);
      if (!t || t.owner !== owner) return null;
      if (!t.cancellable) return publicTask(t);
      const done = await end(id, 'cancelled', { error: 'Cancelled' });
      await ended(done);
      return publicTask(done ?? ((await one(id)) as StoredTask));
    },

    async seen(owner) {
      await init();
      await db.run(
        'UPDATE tasks SET seen_at = ? WHERE owner = ? AND finished_at IS NOT NULL AND seen_at IS NULL',
        now(),
        owner,
      );
    },

    async clear(owner, id) {
      await init();
      if (id)
        await db.run(
          'DELETE FROM tasks WHERE owner = ? AND id = ? AND finished_at IS NOT NULL',
          owner,
          id,
        );
      else await db.run('DELETE FROM tasks WHERE owner = ? AND finished_at IS NOT NULL', owner);
    },

    async reap() {
      await init();
      const at = now();
      const stuck = await db.all(
        "SELECT id, limit_minutes FROM tasks WHERE state IN ('queued', 'running') AND created_at < ? - limit_minutes * 60000",
        at,
      );
      for (const r of stuck) {
        const t = await end(String(r.id), 'failed', {
          error: `Stopped after ${Number(r.limit_minutes)} ${Number(r.limit_minutes) === 1 ? 'minute' : 'minutes'}`,
        });
        await ended(t);
      }
      await db.run(
        'DELETE FROM tasks WHERE finished_at IS NOT NULL AND finished_at < ?',
        at - keep,
      );
    },
  };
  return tasks;
}
