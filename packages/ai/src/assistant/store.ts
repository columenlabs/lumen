/**
 * Where the assistant keeps things: chats, each person's settings, keys and spend, and the app's own
 * settings (its key, the cap per person, the ScrapeQL token). One table of documents over any SQLite,
 * a Durable Object's own (`doSql`) or D1 (`d1Sql`); an app with another store implements
 * `AssistantStore` itself.
 *
 * Every value and title goes through the app's `Sealer` before it is stored, so chats and keys are
 * as private as the app's other sealed data. Without a sealer they are stored as written.
 */

/** Seals text before it is stored and opens it after. The app's own (the hub's USERS_KEK sealing). */
export interface Sealer {
  seal(plain: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

/** One stored document: `scope` is a person's id or `APP_SCOPE`, `key` names it. */
export interface StoredDoc {
  key: string;
  /** A short line kept apart from the value, so a list never reads every value (a chat's title). */
  meta: string | null;
  value: string;
  /** Last written, epoch ms. */
  at: number;
}

export interface AssistantStore {
  /** Creates the table. Safe to call often. */
  init(): Promise<void>;
  get(scope: string, key: string): Promise<StoredDoc | null>;
  put(scope: string, key: string, value: string, meta?: string | null): Promise<void>;
  remove(scope: string, key: string): Promise<void>;
  /** Keys starting with `prefix`, newest first, without their values. */
  list(scope: string, prefix: string, limit: number): Promise<Omit<StoredDoc, 'value'>[]>;
  /** Drops documents starting with `prefix` (any scope) last written before `before`. */
  purge(prefix: string, before: number): Promise<number>;
}

/** The scope of what belongs to the app, not one person. */
export const APP_SCOPE = '_app';

type Row = Record<string, unknown>;

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

/** The table name, so an app's own tables never clash with it. */
const TABLE = 'assistant_docs';

export function sqlAssistantStore(sql: SqlRunner): AssistantStore {
  let ready: Promise<void> | null = null;
  const init = () => {
    ready ??= sql.run(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (scope TEXT NOT NULL, key TEXT NOT NULL, meta TEXT, value TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (scope, key))`,
    );
    return ready;
  };
  return {
    init,
    async get(scope, key) {
      await init();
      const [r] = await sql.all(
        `SELECT key, meta, value, at FROM ${TABLE} WHERE scope = ? AND key = ?`,
        scope,
        key,
      );
      return r
        ? {
            key: String(r.key),
            meta: r.meta == null ? null : String(r.meta),
            value: String(r.value),
            at: Number(r.at),
          }
        : null;
    },
    async put(scope, key, value, meta = null) {
      await init();
      await sql.run(
        `INSERT INTO ${TABLE} (scope, key, meta, value, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (scope, key) DO UPDATE SET meta = excluded.meta, value = excluded.value, at = excluded.at`,
        scope,
        key,
        meta,
        value,
        Date.now(),
      );
    },
    async remove(scope, key) {
      await init();
      await sql.run(`DELETE FROM ${TABLE} WHERE scope = ? AND key = ?`, scope, key);
    },
    async list(scope, prefix, limit) {
      await init();
      const rows = await sql.all(
        `SELECT key, meta, at FROM ${TABLE} WHERE scope = ? AND substr(key, 1, ?) = ? ORDER BY at DESC LIMIT ?`,
        scope,
        prefix.length,
        prefix,
        limit,
      );
      return rows.map((r) => ({
        key: String(r.key),
        meta: r.meta == null ? null : String(r.meta),
        at: Number(r.at),
      }));
    },
    async purge(prefix, before) {
      await init();
      const [r] = await sql.all(
        `SELECT count(*) AS n FROM ${TABLE} WHERE substr(key, 1, ?) = ? AND at < ?`,
        prefix.length,
        prefix,
        before,
      );
      await sql.run(
        `DELETE FROM ${TABLE} WHERE substr(key, 1, ?) = ? AND at < ?`,
        prefix.length,
        prefix,
        before,
      );
      return Number(r?.n ?? 0);
    },
  };
}

/** JSON documents over a store, sealed when the app gives a sealer. */
export class Docs {
  constructor(
    private readonly store: AssistantStore,
    private readonly sealer?: Sealer,
    /** Opened values already read in this request (`cached`), by scope and key. */
    private readonly memo?: Map<string, Promise<string | null>>,
  ) {}

  /**
   * The same documents with each one read once: one request (a Settings page, a chat turn) reads
   * a person's settings, keys and spend many times, and each read is a store call and an unseal.
   * Writes keep it current; `update` always reads the store, so a change never builds on a value
   * another request has since replaced. Make one per request, never one per app.
   */
  cached(): Docs {
    return new Docs(this.store, this.sealer, new Map());
  }

  private seal = (s: string) => (this.sealer ? this.sealer.seal(s) : Promise.resolve(s));
  private open = (s: string) => (this.sealer ? this.sealer.open(s) : Promise.resolve(s));
  private id = (scope: string, key: string) => `${scope}\u0000${key}`;

  private async fresh(scope: string, key: string): Promise<string | null> {
    const d = await this.store.get(scope, key);
    return d ? this.open(d.value) : null;
  }

  async read<T>(scope: string, key: string): Promise<T | null> {
    let text: Promise<string | null>;
    if (this.memo) {
      const id = this.id(scope, key);
      const hit = this.memo.get(id);
      text = hit ?? this.fresh(scope, key);
      if (!hit) {
        this.memo.set(id, text);
        text.catch(() => this.memo?.delete(id));
      }
    } else text = this.fresh(scope, key);
    const t = await text;
    // Parsed each time, so a caller that changes what it got never changes the next read.
    return t === null ? null : (JSON.parse(t) as T);
  }

  async write<T>(scope: string, key: string, value: T, meta?: string) {
    const text = JSON.stringify(value);
    await this.store.put(
      scope,
      key,
      await this.seal(text),
      meta === undefined ? null : await this.seal(meta),
    );
    this.memo?.set(this.id(scope, key), Promise.resolve(text));
  }

  /** Read (from the store, never the request's copy), change and write back; `change` returning
   * null removes it. */
  async update<T>(scope: string, key: string, change: (prev: T | null) => T | null) {
    const t = await this.fresh(scope, key);
    const next = change(t === null ? null : (JSON.parse(t) as T));
    if (next === null) await this.remove(scope, key);
    else await this.write(scope, key, next);
    return next;
  }

  async remove(scope: string, key: string) {
    await this.store.remove(scope, key);
    this.memo?.set(this.id(scope, key), Promise.resolve(null));
  }

  async list(scope: string, prefix: string, limit: number) {
    const rows = await this.store.list(scope, prefix, limit);
    return Promise.all(
      rows.map(async (r) => ({
        key: r.key,
        meta: r.meta == null ? null : await this.open(r.meta),
        at: r.at,
      })),
    );
  }
}
