/**
 * Where people live: one SQL schema over any SQLite, a Durable Object's own (`doSql`) or D1
 * (`d1Sql`). An app with another store implements `PeopleStore` itself.
 *
 * Tables: `people` (one row a person, keyed by email), `people_grants` (one row a scope, or a
 * resource of one, a person holds), `people_invites` (the hash of each live invite link; never
 * the link) and `people_audit` (every change and refusal, kept a year).
 */
import type { AuditEvent, AuditQuery, Grant, Role } from '@columenlabs/lumen-ui-types/people';

/** A person as stored: status is `active`, `invited` or `disabled` (`expired` is worked out). */
export interface StoredPerson {
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'invited' | 'disabled';
  invited_at: number;
  invited_by: string | null;
  expires_at: number | null;
  last_seen: number | null;
}

export interface PeopleStore {
  /** Creates the tables (and adds missing columns to an older `people`). Safe to call often. */
  init(): Promise<void>;
  all(): Promise<StoredPerson[]>;
  get(email: string): Promise<StoredPerson | null>;
  insert(p: StoredPerson): Promise<void>;
  patch(email: string, change: Partial<Omit<StoredPerson, 'email'>>): Promise<void>;
  /** Drops the person, their grants and their links. */
  remove(email: string): Promise<void>;
  /** Every grant, by email. */
  grants(): Promise<Map<string, Grant[]>>;
  setGrant(email: string, g: Grant, lowest: boolean): Promise<void>;
  /** One live link per person: a new one replaces the old. */
  putLink(email: string, hash: string, expiresAt: number): Promise<void>;
  linkEmail(hash: string): Promise<{ email: string; expires_at: number } | null>;
  dropLinks(email: string): Promise<void>;
  log(e: Omit<AuditEvent, 'id'>): Promise<void>;
  audit(q: AuditQuery): Promise<AuditEvent[]>;
}

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

const YEAR_MS = 365 * 24 * 60 * 60_000;
const num = (v: unknown) => (v == null ? null : Number(v));

function toPerson(r: Row): StoredPerson {
  return {
    email: String(r.email),
    name: String(r.name ?? ''),
    role: r.role === 'admin' ? 'admin' : 'member',
    status: r.status === 'active' || r.status === 'disabled' ? r.status : 'invited',
    invited_at: Number(r.invited_at ?? 0),
    invited_by: r.invited_by == null ? null : String(r.invited_by),
    expires_at: num(r.expires_at),
    last_seen: num(r.last_seen),
  };
}

export function sqlStore(db: SqlRunner): PeopleStore {
  let ready: Promise<void> | null = null;
  const init = () => {
    ready ??= (async () => {
      await db.run(`CREATE TABLE IF NOT EXISTS people (
        email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
        invited_at INTEGER NOT NULL, last_seen INTEGER, invited_by TEXT, expires_at INTEGER)`);
      // An older `people` table (same rows, fewer columns) is kept and widened.
      const cols = new Set((await db.all('PRAGMA table_info(people)')).map((r) => String(r.name)));
      if (!cols.has('invited_by')) await db.run('ALTER TABLE people ADD COLUMN invited_by TEXT');
      if (!cols.has('expires_at')) await db.run('ALTER TABLE people ADD COLUMN expires_at INTEGER');
      await db.run(`CREATE TABLE IF NOT EXISTS people_grants (
        email TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL DEFAULT '', level TEXT NOT NULL,
        updated_at INTEGER NOT NULL, PRIMARY KEY (email, scope, resource))`);
      await db.run(`CREATE TABLE IF NOT EXISTS people_invites (
        hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
      await db.run(`CREATE TABLE IF NOT EXISTS people_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL,
        op TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, refused TEXT, via TEXT NOT NULL)`);
      await db.run('CREATE INDEX IF NOT EXISTS people_audit_at ON people_audit (at)');
    })();
    return ready;
  };
  const q = async (sql: string, ...a: unknown[]) => {
    await init();
    return db.all(sql, ...a);
  };
  const run = async (sql: string, ...a: unknown[]) => {
    await init();
    await db.run(sql, ...a);
  };
  return {
    init,
    all: async () => (await q('SELECT * FROM people ORDER BY invited_at')).map(toPerson),
    get: async (email) => {
      const r = (await q('SELECT * FROM people WHERE email = ?', email))[0];
      return r ? toPerson(r) : null;
    },
    insert: (p) =>
      run(
        `INSERT INTO people (email, name, role, status, invited_at, last_seen, invited_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        p.email,
        p.name,
        p.role,
        p.status,
        p.invited_at,
        p.last_seen,
        p.invited_by,
        p.expires_at,
      ),
    patch: async (email, change) => {
      const keys = Object.keys(change).filter((k) =>
        ['name', 'role', 'status', 'invited_at', 'invited_by', 'expires_at', 'last_seen'].includes(
          k,
        ),
      ) as (keyof typeof change)[];
      if (!keys.length) return;
      await run(
        `UPDATE people SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE email = ?`,
        ...keys.map((k) => change[k] ?? null),
        email,
      );
    },
    remove: async (email) => {
      await run('DELETE FROM people_grants WHERE email = ?', email);
      await run('DELETE FROM people_invites WHERE email = ?', email);
      await run('DELETE FROM people WHERE email = ?', email);
    },
    grants: async () => {
      const out = new Map<string, Grant[]>();
      for (const r of await q('SELECT email, scope, resource, level FROM people_grants')) {
        const list = out.get(String(r.email)) ?? [];
        list.push({
          scope: String(r.scope),
          ...(r.resource ? { resource: String(r.resource) } : {}),
          level: String(r.level),
        });
        out.set(String(r.email), list);
      }
      return out;
    },
    setGrant: async (email, g, lowest) => {
      if (lowest)
        await run(
          'DELETE FROM people_grants WHERE email = ? AND scope = ? AND resource = ?',
          email,
          g.scope,
          g.resource ?? '',
        );
      else
        await run(
          `INSERT INTO people_grants (email, scope, resource, level, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(email, scope, resource) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
          email,
          g.scope,
          g.resource ?? '',
          g.level,
          Date.now(),
        );
    },
    putLink: async (email, hash, expiresAt) => {
      await run('DELETE FROM people_invites WHERE email = ?', email);
      await run(
        'INSERT INTO people_invites (hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)',
        hash,
        email,
        expiresAt,
        Date.now(),
      );
    },
    linkEmail: async (hash) => {
      const r = (await q('SELECT email, expires_at FROM people_invites WHERE hash = ?', hash))[0];
      return r ? { email: String(r.email), expires_at: Number(r.expires_at) } : null;
    },
    dropLinks: (email) => run('DELETE FROM people_invites WHERE email = ?', email),
    log: async (e) => {
      await run(
        `INSERT INTO people_audit (at, actor, kind, op, target, detail, refused, via)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        e.at,
        e.actor,
        e.kind,
        e.op,
        e.target,
        e.detail,
        e.refused ?? null,
        e.via,
      );
      await run('DELETE FROM people_audit WHERE at < ?', e.at - YEAR_MS);
    },
    audit: async ({ since, target, limit }) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (since) {
        where.push('at >= ?');
        args.push(since);
      }
      if (target) {
        where.push('target = ?');
        args.push(target);
      }
      const rows = await q(
        `SELECT * FROM people_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY at DESC, id DESC LIMIT ?`,
        ...args,
        Math.min(Math.max(limit ?? 500, 1), 2000),
      );
      return rows.map((r) => ({
        id: String(r.id),
        at: Number(r.at),
        actor: String(r.actor),
        kind: String(r.kind) as AuditEvent['kind'],
        op: String(r.op),
        target: String(r.target),
        detail: String(r.detail),
        ...(r.refused ? { refused: String(r.refused) } : {}),
        via: String(r.via),
      }));
    },
  };
}
