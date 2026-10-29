/**
 * Row budgets for a Durable Object's SQLite. Cloudflare's free plan allows an account 5M rows
 * read and 100k rows written a day across every object; past either, every SQL call in every
 * object throws until 00:00 UTC. One looping page or a full-table scan per request can spend that
 * in minutes, so every call, wake and object here is bounded:
 *
 *   per call   one request may read and write so many rows; past it, its next statement throws
 *   per wake   the same for one alarm wake (background work)
 *   per day    the object's share of the account for one UTC day; past `background` of it, wakes
 *              wait for the next day; past all of it, calls are refused until 00:00 UTC
 *   brake      a level set from outside (the whole account is near its cap): `background` stops
 *              wakes, `stop` refuses calls too
 *
 * Counts come from the cursors themselves (`rowsRead`, `rowsWritten`), so they are what Cloudflare
 * bills. The day's totals live in memory and are saved to storage at most once a minute.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RowLimits {
  /** Rows one call may read (default 100k). */
  callRead?: number;
  /** Rows one call may write (default 20k). */
  callWrite?: number;
  /** Rows one wake may read (default 200k). */
  wakeRead?: number;
  /** Rows one wake may write (default 20k). */
  wakeWrite?: number;
  /** Rows this object may read in one UTC day (default 600k). */
  dayRead?: number;
  /** Rows this object may write in one UTC day (default 12k). */
  dayWrite?: number;
  /** Share of the day after which wakes wait for the next day (default 0.6). */
  background?: number;
}

export type BudgetLevel = 'ok' | 'background' | 'stop';

/** What `onLimit` hears, once per level per day, and what `_object.budget` returns. */
export interface BudgetState {
  day: string;
  read: number;
  written: number;
  level: BudgetLevel;
  brake: BudgetLevel;
  limits: Required<RowLimits>;
}

export interface BudgetHooks {
  /** A level crossed today (`background`, `stop`) or one call or wake stopped (`call`, `wake`). */
  onLimit?(e: { kind: 'background' | 'stop' | 'call' | 'wake'; state: BudgetState }): void;
}

export const DEFAULT_LIMITS: Required<RowLimits> = {
  callRead: 100_000,
  callWrite: 20_000,
  wakeRead: 200_000,
  wakeWrite: 20_000,
  dayRead: 600_000,
  dayWrite: 12_000,
  background: 0.6,
};

/** A spent budget: the person sees a 503 that says when it comes back. */
export class BudgetError extends Error {
  readonly status = 503 as const;
}

type Cursor = { rowsRead?: number; rowsWritten?: number };
type Scope = { kind: 'call' | 'wake'; cursors: Cursor[]; read: number; written: number };

const scopes = new AsyncLocalStorage<Scope>();

/** The UTC day of `now` (`2026-10-29`). */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** The next 00:00 UTC after `now`. */
export function nextUtcDay(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

const sum = (cs: Cursor[], k: 'rowsRead' | 'rowsWritten') =>
  cs.reduce((n, c) => n + (Number(c[k]) || 0), 0);

interface BudgetStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

const KEY = '_row_budget';
const FLUSH_MS = 60_000;

/** One object's row budget. Wrap its SQL with `sql()`, run each call or wake in `scope()`. */
export class RowBudget {
  readonly limits: Required<RowLimits>;
  private day = utcDay();
  private read = 0;
  private written = 0;
  private brake: { level: BudgetLevel; until: number } = { level: 'ok', until: 0 };
  private told = new Set<string>();
  private loaded?: Promise<void>;
  private savedAt = 0;
  private loose: Cursor[] = [];

  constructor(
    private readonly storage: BudgetStorage,
    limits: RowLimits = {},
    private readonly hooks: BudgetHooks = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** Reads the day's saved totals once (one row). */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      const s = await this.storage
        .get<{ day: string; read: number; written: number; brake?: RowBudget['brake'] }>(KEY)
        .catch(() => undefined);
      if (s?.day === this.day) {
        this.read = Math.max(this.read, s.read);
        this.written = Math.max(this.written, s.written);
      }
      if (s?.brake && s.brake.until > Date.now()) this.brake = s.brake;
    })();
    return this.loaded;
  }

  /** The SQLite with every statement counted against the current call or wake, and the object. */
  sql<S extends { exec(query: string, ...b: unknown[]): unknown }>(raw: S): S {
    const self = this;
    return new Proxy(raw, {
      get(t, p) {
        if (p !== 'exec') return Reflect.get(t, p, t);
        return (query: string, ...b: unknown[]) => {
          self.check();
          const cur = t.exec(query, ...b) as Cursor;
          const s = scopes.getStore();
          if (s) s.cursors.push(cur);
          else self.loose.push(cur);
          return cur;
        };
      },
    });
  }

  private roll() {
    const today = utcDay();
    if (today === this.day) return;
    this.day = today;
    this.read = 0;
    this.written = 0;
    this.told.clear();
  }

  /** Moves finished counts onto the day's totals. */
  private settle(cursors: Cursor[]) {
    this.roll();
    this.read += sum(cursors, 'rowsRead');
    this.written += sum(cursors, 'rowsWritten');
  }

  private settleLoose() {
    if (!this.loose.length) return;
    const l = this.loose;
    this.loose = [];
    this.settle(l);
  }

  /** The level today's totals and the brake give. */
  level(): BudgetLevel {
    this.settleLoose();
    this.roll();
    const l = this.limits;
    const brake = this.brake.until > Date.now() ? this.brake.level : 'ok';
    if (brake === 'stop' || this.read >= l.dayRead || this.written >= l.dayWrite) return 'stop';
    if (
      brake === 'background' ||
      this.read >= l.dayRead * l.background ||
      this.written >= l.dayWrite * l.background
    )
      return 'background';
    return 'ok';
  }

  state(): BudgetState {
    const level = this.level();
    return {
      day: this.day,
      read: this.read,
      written: this.written,
      level,
      brake: this.brake.until > Date.now() ? this.brake.level : 'ok',
      limits: this.limits,
    };
  }

  private tell(kind: 'background' | 'stop' | 'call' | 'wake') {
    const key =
      kind === 'call' || kind === 'wake' ? `${kind}:${Math.floor(Date.now() / 3_600_000)}` : kind;
    if (this.told.has(key)) return;
    this.told.add(key);
    try {
      this.hooks.onLimit?.({ kind, state: this.state() });
    } catch {}
    console.error(
      JSON.stringify({ event: 'row_budget', kind, ...this.state(), limits: undefined }),
    );
  }

  /** Throws before a statement that would run past the call's, wake's or day's budget. */
  private check() {
    const s = scopes.getStore();
    if (s) {
      const read = s.read + sum(s.cursors, 'rowsRead');
      const written = s.written + sum(s.cursors, 'rowsWritten');
      const l = this.limits;
      const [r, w] = s.kind === 'call' ? [l.callRead, l.callWrite] : [l.wakeRead, l.wakeWrite];
      if (read >= r || written >= w) {
        this.tell(s.kind);
        throw new BudgetError(
          `this ${s.kind === 'call' ? 'request' : 'background step'} reads or writes too much at once (${read} rows read, ${written} written)`,
        );
      }
      // Only a step past the whole day's budget is stopped mid-way; background waits at its start.
      if (this.read + read >= l.dayRead || this.written + written >= l.dayWrite) {
        this.tell('stop');
        throw new BudgetError(stopMessage());
      }
    } else if (this.level() === 'stop') {
      this.tell('stop');
      throw new BudgetError(stopMessage());
    }
  }

  /** Whether a call may start now (false: the day is spent or the brake is on). */
  callAllowed(): boolean {
    const ok = this.level() !== 'stop';
    if (!ok) this.tell('stop');
    return ok;
  }

  /** Whether background work may start now. */
  wakeAllowed(): boolean {
    const level = this.level();
    if (level !== 'ok') this.tell(level);
    return level === 'ok';
  }

  /** Runs `fn` as one call or wake, counted on its own and then on the day. */
  async scope<T>(kind: 'call' | 'wake', fn: () => Promise<T>): Promise<T> {
    const s: Scope = { kind, cursors: [], read: 0, written: 0 };
    try {
      return await scopes.run(s, fn);
    } finally {
      this.settle(s.cursors);
      const level = this.level();
      if (level !== 'ok') this.tell(level);
      void this.save();
    }
  }

  /** A brake from outside (`ok` lifts it); it ends by itself at `until` (default next 00:00 UTC). */
  async setBrake(level: BudgetLevel, until = nextUtcDay()): Promise<BudgetState> {
    this.brake = { level, until: level === 'ok' ? 0 : until };
    await this.save(true);
    return this.state();
  }

  /** Saves the day's totals (at most once a minute unless forced). */
  async save(force = false): Promise<void> {
    if (!force && Date.now() - this.savedAt < FLUSH_MS) return;
    this.savedAt = Date.now();
    this.settleLoose();
    try {
      await this.storage.put(KEY, {
        day: this.day,
        read: this.read,
        written: this.written,
        brake: this.brake,
      });
    } catch {
      // The storage itself may be refusing (the account's limit): the totals stay in memory.
    }
  }
}

function stopMessage(now = Date.now()) {
  return `today's storage budget is used; it comes back at ${new Date(nextUtcDay(now)).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
