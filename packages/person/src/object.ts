/**
 * One store per person: a Durable Object (named by the person) whose SQLite holds every app's
 * tables for that person. Each app is a module that owns the tables named `<module>_*`, its own
 * migrations and its own wake time, so app code stays apart while one person's data can be joined
 * in one SQL query.
 *
 * - Migrations run per module, on that module's first call or wake, each step in one transaction.
 *   A step that throws leaves the module refusing its own calls (503) for a minute, then it tries
 *   again; every other module keeps answering.
 * - One alarm serves every module: `_wakes` keeps each module's next time and the alarm is set to
 *   the earliest. A wake gets a deadline to stop by and set its next time. A wake that throws is
 *   tried again later, sooner first (1 minute, doubling to an hour).
 * - `_object` methods back up, restore and delete one module's tables or the whole store.
 *
 * The object is the only writer of its person's data: a sync, a webhook and an edit run in turn,
 * so a read-modify-write needs no retry loop. Network waits still let other calls in (input gates).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BudgetError,
  type BudgetHooks,
  type BudgetLevel,
  RowBudget,
  type RowLimits,
  nextUtcDay,
} from './budget';
import { fromJson, toJson } from './json';

/** The SQLite of a Durable Object (`ctx.storage.sql`): typed loosely, so `SqlStorage` passes as it is. */
export interface SqlLike {
  // biome-ignore lint/suspicious/noExplicitAny: SqlStorage's own row type and bindings must fit here
  exec<T extends Record<string, any> = Record<string, unknown>>(
    query: string,
    // biome-ignore lint/suspicious/noExplicitAny: as above
    ...bindings: any[]
  ): { toArray(): T[]; rowsRead?: number; rowsWritten?: number };
}

/** What the store needs of `DurableObjectState`. */
export interface PersonState {
  storage: {
    sql: SqlLike;
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    setAlarm(ms: number): Promise<void>;
    deleteAlarm(): Promise<void>;
    /** Deletes every key and table of the object, SQLite included. */
    deleteAll(): Promise<void>;
    /** Runs `fn` as one SQLite transaction: a throw rolls back every statement in it. */
    transactionSync<T>(fn: () => T): T;
  };
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

/** One migration step: SQL (statements separated by `;`) or a function over the SQLite, never async. */
export type PersonMigration = string | ((sql: SqlLike) => void);

/** What a module gets on each call and wake. `X` is the app's own (its env, a vault). */
export interface PersonCtx<X = unknown> {
  owner: string;
  module: string;
  sql: SqlLike;
  extra: X;
  /** `fn` as one SQLite transaction (a throw rolls it all back). */
  transaction<T>(fn: () => T): T;
  /** Runs `fn` with no other call or wake let in until it ends. Use rarely: it stops the store. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** When this module wants its `wake` next; null: never. */
  wakeAt(at: number | null): Promise<void>;
  /** The time (ms) a wake should stop by and set its next time. A call gets none (Infinity). */
  deadline: number;
}

/** An app's part of the store: its tables, what the Worker may ask of it and its alarm. */
export interface PersonModule<X = unknown> {
  /** Lower-case letters and digits; every table of the module is `<name>_*`. */
  name: string;
  /** In order; each runs once, inside the object. Never edit or reorder a released step: add one. */
  migrations: PersonMigration[];
  call(ctx: PersonCtx<X>, method: string, args: unknown): Promise<unknown>;
  /** Runs at the time it last asked for (`wakeAt`). Do small steps and ask again for more. */
  wake?(ctx: PersonCtx<X>): Promise<void>;
}

export interface PersonDeps<X = unknown> {
  modules: PersonModule<X>[];
  extra: X;
  /** Names a person may have (the first call claims the store). Default: 1 to 200 non-space characters. */
  owner?: RegExp;
  /** Runs once, when the first call claims the store (to list it somewhere). */
  onClaim?(owner: string): Promise<void>;
  /** How long one module's wake may run (default 30 s). */
  wakeMs?: number;
  /**
   * Row budgets for this store (`./budget`): per call, per wake and per UTC day, so no loop can
   * spend the account's daily Durable Objects limit. Left out, the defaults apply.
   */
  budget?: RowLimits & BudgetHooks;
}

/** A refusal with a status and a message the person can act on. */
export class PersonError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}

/** How a call answers: across RPC an error loses its class, so the status travels in the value. */
export type PersonReply =
  | { ok: true; value: unknown }
  | { ok: false; status: PersonError['status']; error: string };

/** The store's own module: backup, restore, delete and counts. */
export const OBJECT_MODULE = '_object';

/** One table of a dump: its columns and rows in that order. Bytes are `{b64}`. */
export interface DumpTable {
  cols: string[];
  rows: unknown[][];
}

/** What `dump` (whole store) or `dumpModule` (one module) returns, and `load`/`loadModule` take. */
export interface PersonDump {
  owner: string;
  /** The module dumped; absent for the whole store. */
  module?: string;
  at: string;
  /** Each module's migration level when dumped. */
  schema: Record<string, number>;
  tables: Record<string, DumpTable>;
}

const NAME = /^[a-z][a-z0-9]*$/;
const OWNER = /^[^\s]{1,200}$/;
const RETRY_MS = 60_000;
const BACKOFF_MAX_MS = 3_600_000;
/** An alarm may run 15 minutes; stop starting wakes well before. */
const ALARM_MS = 10 * 60_000;

/** Calls made from inside a store to its own person run in place (a stub call back in is a new request). */
type Inside = {
  owner: string;
  call(module: string, method: string, args: unknown): Promise<unknown>;
};
const inside = new AsyncLocalStorage<Inside>();
export const insideStore = () => inside.getStore();

/** One person's store. A Durable Object class holds one and passes its calls and alarm through. */
export class PersonObject<X = unknown> {
  private deps?: Promise<PersonDeps<X>>;
  private owner?: string;
  private ownerRead = false;
  private readonly ready = new Set<string>();
  private readonly broken = new Map<string, { at: number; error: string }>();
  private rows?: RowBudget;
  private metered?: SqlLike;

  constructor(
    private readonly state: PersonState,
    private readonly load: PersonDeps<X> | (() => Promise<PersonDeps<X>>),
  ) {}

  /** The SQLite, every statement counted against the row budget once it is set up. */
  private get sql(): SqlLike {
    if (!this.rows) return this.state.storage.sql;
    this.metered ??= this.rows.sql(this.state.storage.sql);
    return this.metered;
  }

  /** The store's row budget (set up with the first call or wake). */
  private budget(deps: PersonDeps<X>): RowBudget {
    this.rows ??= new RowBudget(this.state.storage, deps.budget, deps.budget);
    return this.rows;
  }

  private async setup(): Promise<PersonDeps<X>> {
    this.deps ??= (async () => {
      const deps = typeof this.load === 'function' ? await this.load() : this.load;
      await this.budget(deps).load();
      for (const m of deps.modules)
        if (!NAME.test(m.name)) throw new Error(`person module name ${m.name}`);
      // The store's own two tables, unmetered so the budget can answer even on a spent day.
      const raw = this.state.storage.sql;
      raw.exec(
        'CREATE TABLE IF NOT EXISTS _schema (module TEXT PRIMARY KEY, version INTEGER NOT NULL)',
      );
      raw.exec(
        'CREATE TABLE IF NOT EXISTS _wakes (module TEXT PRIMARY KEY, at INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0)',
      );
      return deps;
    })();
    this.deps.catch(() => {
      this.deps = undefined;
    });
    return this.deps;
  }

  /** The module's pending migrations, each in its own transaction. False: it is broken for now. */
  private migrate(m: PersonModule<X>): boolean {
    if (this.ready.has(m.name)) return true;
    const broke = this.broken.get(m.name);
    if (broke && Date.now() - broke.at < RETRY_MS) return false;
    try {
      const row = this.sql
        .exec<{ version: number }>('SELECT version FROM _schema WHERE module = ?', m.name)
        .toArray()[0];
      for (let v = row?.version ?? 0; v < m.migrations.length; v++) {
        const step = m.migrations[v] as PersonMigration;
        this.state.storage.transactionSync(() => {
          if (typeof step === 'string') this.sql.exec(step);
          else step(this.sql);
          this.sql.exec(
            'INSERT INTO _schema (module, version) VALUES (?, ?) ON CONFLICT (module) DO UPDATE SET version = excluded.version',
            m.name,
            v + 1,
          );
        });
      }
      this.broken.delete(m.name);
      this.ready.add(m.name);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.broken.set(m.name, { at: Date.now(), error });
      console.error(JSON.stringify({ event: 'person_migration_failed', module: m.name, error }));
      return false;
    }
  }

  private async currentOwner(): Promise<string | undefined> {
    if (!this.ownerRead) {
      this.owner = await this.state.storage.get<string>('owner');
      this.ownerRead = true;
    }
    return this.owner;
  }

  /** The first call names the person; every later one must match. */
  private async claim(deps: PersonDeps<X>, owner: string) {
    if (!(deps.owner ?? OWNER).test(owner))
      throw new PersonError(400, 'not a person this store can hold');
    const now = await this.currentOwner();
    if (now === owner) return;
    if (now) throw new PersonError(403, 'not this person’s store');
    await this.state.storage.put('owner', owner);
    this.owner = owner;
    await deps.onClaim?.(owner);
  }

  private ctx(deps: PersonDeps<X>, owner: string, module: string, deadline: number): PersonCtx<X> {
    return {
      owner,
      module,
      sql: this.sql,
      extra: deps.extra,
      deadline,
      transaction: (fn) => this.state.storage.transactionSync(fn),
      exclusive: (fn) => this.state.blockConcurrencyWhile(fn),
      wakeAt: async (at) => {
        if (at === null) this.sql.exec('DELETE FROM _wakes WHERE module = ?', module);
        else
          this.sql.exec(
            'INSERT INTO _wakes (module, at, fails) VALUES (?, ?, 0) ON CONFLICT (module) DO UPDATE SET at = excluded.at, fails = 0',
            module,
            Math.round(at),
          );
        await this.arm();
      },
    };
  }

  private async arm() {
    const next = this.sql
      .exec<{ at: number | null }>('SELECT MIN(at) AS at FROM _wakes')
      .toArray()[0]?.at;
    if (next) await this.state.storage.setAlarm(Math.max(next, Date.now()));
    else await this.state.storage.deleteAlarm();
  }

  private module(deps: PersonDeps<X>, name: string): PersonModule<X> {
    const m = deps.modules.find((x) => x.name === name);
    if (!m) throw new PersonError(404, `no module ${name}`);
    if (!this.migrate(m)) throw new PersonError(503, `${name} is updating; try again in a minute`);
    return m;
  }

  /** A call from the Worker (an RPC method on the Durable Object passes it through). */
  async call(owner: string, module: string, method: string, args?: unknown): Promise<PersonReply> {
    try {
      const deps = await this.setup();
      const rows = this.budget(deps);
      // The budget itself answers even when the day is spent: it reads no rows.
      if (module === OBJECT_MODULE && (method === 'budget' || method === 'brake'))
        return { ok: true, value: await this.own(deps, method, args ?? null) };
      if (!rows.callAllowed()) throw new BudgetError(spentMessage());
      const value = await rows.scope('call', async () => {
        await this.claim(deps, owner);
        return this.within(deps, owner, () => this.run(deps, owner, module, method, args ?? null));
      });
      return { ok: true, value: value ?? null };
    } catch (err) {
      if (err instanceof PersonError) return { ok: false, status: err.status, error: err.message };
      if (err instanceof BudgetError) return { ok: false, status: 503, error: err.message };
      console.error(
        JSON.stringify({ event: 'person_call_failed', module, method, error: String(err) }),
      );
      return { ok: false, status: 502, error: `${module} failed` };
    }
  }

  /** The same as `call`, for a store reached by `fetch` with `{owner, module, method, args}`. */
  async fetch(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as {
      owner?: string;
      module?: string;
      method?: string;
      args?: unknown;
    } | null;
    if (!body?.owner || !body.module || !body.method)
      return Response.json({ error: 'bad request' }, { status: 400 });
    const r = await this.call(body.owner, body.module, body.method, body.args);
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
  }

  private run(deps: PersonDeps<X>, owner: string, module: string, method: string, args: unknown) {
    if (module === OBJECT_MODULE) return this.own(deps, method, args);
    const m = this.module(deps, module);
    return m.call(this.ctx(deps, owner, m.name, Number.POSITIVE_INFINITY), method, args);
  }

  /** Runs `fn` as code inside this store: its calls to this person stay in place. */
  private within<T>(deps: PersonDeps<X>, owner: string, fn: () => Promise<T>): Promise<T> {
    return inside.run(
      { owner, call: (module, method, args) => this.run(deps, owner, module, method, args) },
      fn,
    );
  }

  private tables(): { name: string; virtual: boolean }[] {
    return this.sql
      .exec<{ name: string; sql: string | null }>(
        // Not SQLite's, the platform's (`_cf_*`) or a local runtime's (`__*`) own tables.
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY name",
      )
      .toArray()
      .map((r) => ({ name: r.name, virtual: /^\s*CREATE\s+VIRTUAL/i.test(r.sql ?? '') }));
  }

  /** Data tables a dump carries: virtual tables (FTS5) and their shadow tables are rebuilt, not copied. */
  private dataTables(prefix?: string): string[] {
    const all = this.tables();
    const virtual = all.filter((t) => t.virtual).map((t) => t.name);
    const shadow = (n: string) => virtual.some((v) => n.startsWith(`${v}_`));
    return all
      .filter((t) => !t.virtual && !shadow(t.name))
      .map((t) => t.name)
      .filter((n) => (prefix ? n.startsWith(prefix) : true));
  }

  private columns(table: string): string[] {
    return this.sql
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`)
      .toArray()
      .map((r) => r.name);
  }

  private schema(): Record<string, number> {
    return Object.fromEntries(
      this.sql
        .exec<{ module: string; version: number }>('SELECT module, version FROM _schema')
        .toArray()
        .map((r) => [r.module, r.version]),
    );
  }

  private dumpTables(names: string[]): Record<string, DumpTable> {
    const tables: Record<string, DumpTable> = {};
    for (const t of names) {
      const cols = this.columns(t);
      const rows = this.sql
        .exec<Record<string, unknown>>(`SELECT * FROM "${t}"`)
        .toArray()
        .map((r) => cols.map((c) => toJson(r[c])));
      tables[t] = { cols, rows };
    }
    return tables;
  }

  /** Replaces `names` with the dump's rows; only columns this version has, the rest keep defaults. */
  private loadTables(
    names: string[],
    dump: Record<string, DumpTable>,
    rename: (t: string) => string,
  ) {
    const loaded: Record<string, number> = {};
    const skipped: string[] = [];
    this.state.storage.transactionSync(() => {
      this.sql.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of names) this.sql.exec(`DELETE FROM "${t}"`);
      for (const [from, data] of Object.entries(dump)) {
        const t = rename(from);
        if (!names.includes(t)) {
          skipped.push(from);
          continue;
        }
        const cols = this.columns(t);
        const pick = data.cols.map((c, i) => [c, i] as const).filter(([c]) => cols.includes(c));
        const insert = `INSERT INTO "${t}" (${pick.map(([c]) => `"${c}"`).join(', ')}) VALUES (${pick.map(() => '?').join(', ')})`;
        for (const row of data.rows)
          this.sql.exec(insert, ...pick.map(([, i]) => fromJson(row[i])));
        loaded[t] = data.rows.length;
      }
    });
    // Word indexes kept by triggers are already in step; a rebuild covers any that are not.
    for (const v of this.tables().filter((x) => x.virtual)) {
      try {
        this.sql.exec(`INSERT INTO "${v.name}"("${v.name}") VALUES ('rebuild')`);
      } catch {
        // Not an FTS5 table with its own content: nothing to rebuild.
      }
    }
    return { loaded, skipped };
  }

  private async own(deps: PersonDeps<X>, method: string, args: unknown): Promise<unknown> {
    const owner = this.owner as string;
    const a = (args ?? {}) as { module?: string; dump?: PersonDump; prefix?: boolean };
    const named = () => {
      if (!a.module) throw new PersonError(400, 'name the module');
      return this.module(deps, a.module);
    };
    switch (method) {
      case 'budget':
        return this.budget(deps).state();
      case 'brake': {
        // From the Worker when the whole account nears its cap: `background` stops wakes, `stop` calls too.
        const b = (args ?? {}) as { level?: BudgetLevel; until?: number };
        if (b.level !== 'ok' && b.level !== 'background' && b.level !== 'stop')
          throw new PersonError(400, 'brake takes level ok, background or stop');
        return this.budget(deps).setBrake(b.level, b.until);
      }
      case 'dump':
        for (const m of deps.modules) this.migrate(m);
        return {
          owner,
          at: new Date().toISOString(),
          schema: this.schema(),
          tables: this.dumpTables(this.dataTables().filter((t) => !t.startsWith('_'))),
        } satisfies PersonDump;
      case 'dumpModule': {
        const m = named();
        return {
          owner,
          module: m.name,
          at: new Date().toISOString(),
          schema: { [m.name]: this.schema()[m.name] ?? 0 },
          tables: this.dumpTables(this.dataTables(`${m.name}_`)),
        } satisfies PersonDump;
      }
      case 'loadModule': {
        // Restores one module (from its own dump), or moves rows in from an older store: table
        // names without the prefix get it (`stories` → `career_stories`) when `prefix` is set.
        const m = named();
        const dump = a.dump;
        if (!dump?.tables) throw new PersonError(400, 'loadModule takes a dump');
        if (dump.owner && dump.owner !== owner)
          throw new PersonError(400, 'that dump is another person’s');
        const p = `${m.name}_`;
        return this.state.blockConcurrencyWhile(async () =>
          this.loadTables(this.dataTables(p), dump.tables, (t) =>
            a.prefix && !t.startsWith(p) ? p + t : t,
          ),
        );
      }
      case 'load': {
        const dump = args as PersonDump | null;
        if (!dump?.tables || dump.owner !== owner)
          throw new PersonError(400, 'load takes this person’s dump');
        for (const m of deps.modules) this.migrate(m);
        return this.state.blockConcurrencyWhile(async () => {
          const out = this.loadTables(
            this.dataTables().filter((t) => !t.startsWith('_')),
            dump.tables,
            (t) => t,
          );
          await this.arm();
          return out;
        });
      }
      case 'counts': {
        const counts: Record<string, number> = {};
        for (const t of this.dataTables())
          counts[t] = Number(
            this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`).toArray()[0]?.n ?? 0,
          );
        return { schema: this.schema(), counts, broken: Object.fromEntries(this.broken) };
      }
      case 'wipeModule': {
        const m = named();
        this.state.storage.transactionSync(() => {
          for (const t of this.dataTables(`${m.name}_`)) this.sql.exec(`DELETE FROM "${t}"`);
          this.sql.exec('DELETE FROM _wakes WHERE module = ?', m.name);
        });
        await this.arm();
        return { wiped: m.name };
      }
      case 'wipe':
        await this.state.storage.deleteAlarm();
        await this.state.storage.deleteAll();
        // The next call starts over: migrations again, then the first call claims it.
        this.deps = undefined;
        this.ready.clear();
        this.broken.clear();
        this.owner = undefined;
        this.ownerRead = false;
        return { wiped: true };
      default:
        throw new PersonError(404, `no ${OBJECT_MODULE} method ${method}`);
    }
  }

  /** The Durable Object's alarm: each due module's wake in turn, then the next earliest time. */
  async alarm(): Promise<void> {
    const deps = await this.setup();
    const owner = await this.currentOwner();
    if (!owner) return;
    const rows = this.budget(deps);
    if (!rows.wakeAllowed()) {
      // Background work waits for the next UTC day (spread over its first half hour), so the
      // budget left today serves the person's own requests. Unmetered: two small statements.
      const raw = this.state.storage.sql;
      const at = nextUtcDay() + Math.floor(Math.random() * 30 * 60_000);
      try {
        raw.exec('UPDATE _wakes SET at = ? WHERE at < ?', at, at);
        await this.state.storage.setAlarm(at);
      } catch {
        // Storage refusing too: the alarm is not set again, the next call or wake sets it.
      }
      return;
    }
    const start = Date.now();
    const due = this.sql
      .exec<{ module: string; fails: number }>(
        'SELECT module, fails FROM _wakes WHERE at <= ? ORDER BY at',
        start + 1000,
      )
      .toArray();
    for (const { module, fails } of due) {
      if (Date.now() - start > ALARM_MS) break; // the rest stay due; the alarm comes straight back
      const m = deps.modules.find((x) => x.name === module);
      if (!m?.wake) {
        this.sql.exec('DELETE FROM _wakes WHERE module = ?', module);
        continue;
      }
      if (!this.migrate(m)) {
        this.sql.exec('UPDATE _wakes SET at = ? WHERE module = ?', Date.now() + RETRY_MS, module);
        continue;
      }
      // A module that sets no new time is not woken again.
      this.sql.exec('DELETE FROM _wakes WHERE module = ?', module);
      const wake = m.wake.bind(m);
      try {
        await rows.scope('wake', () =>
          this.within(deps, owner, () =>
            wake(this.ctx(deps, owner, module, Date.now() + (deps.wakeMs ?? 30_000))),
          ),
        );
      } catch (err) {
        const wait = Math.min(RETRY_MS * 2 ** fails, BACKOFF_MAX_MS);
        this.sql.exec(
          'INSERT INTO _wakes (module, at, fails) VALUES (?, ?, ?) ON CONFLICT (module) DO UPDATE SET at = MIN(_wakes.at, excluded.at), fails = excluded.fails',
          module,
          Date.now() + wait,
          fails + 1,
        );
        console.error(
          JSON.stringify({
            event: 'person_wake_failed',
            module,
            fails: fails + 1,
            error: String(err),
          }),
        );
      }
    }
    await this.arm();
  }
}

function spentMessage() {
  return `today's storage budget is used; it comes back at ${new Date(nextUtcDay()).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
