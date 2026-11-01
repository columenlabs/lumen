/**
 * Behavior check: does a store act like a healthy one over a simulated day?
 *
 * A sanity run drives an app's Durable Objects on a simulated clock (`simClock`, `SimAlarms`): it
 * jumps from one alarm to the next, fires it, and records each wake as a `Wake`. `judge` then holds
 * every store to the same vital signs, whatever the app and whatever the cause:
 *
 *   idle wakes      a wake that writes nothing and calls nothing; at most `idlePerHour` an hour
 *   quick idle      an idle wake that sets its next alarm under `quickMs` ahead; at most
 *                   `quickIdlePerHour` an hour (a store that keeps checking and finds nothing)
 *   wake rate       at most `wakesPerHour` wakes an hour, working or not
 *   rows per wake   at most `wakeRead` / `wakeWrite` rows (the free tier's 10k a step)
 *   rows per day    at most `dayRead` / `dayWrite` rows for one store over the day
 *   settles         the last `settleHours` hours wake no more than `idlePerHour` an hour
 *   errors          a wake that throws or logs an error
 *   runaway         the run stopped at `maxWakes` wakes for one state (the driver says so)
 *
 * No list of known bugs: a loop, a runaway read or stuck work breaks a vital sign by itself.
 * Pure: no runtime, no I/O, so the same code judges main and the PR.
 */

/** One wake of one store, as the driver saw it. Times are the simulated clock, in ms. */
export type Wake = {
  /** The store: its class and object id, `Store:ab12…`. */
  store: string;
  /** The simulated time the wake started. */
  at: number;
  /** What it read, wrote and called out to (network and bindings) while it ran. */
  rowsRead: number;
  rowsWritten: number;
  calls: number;
  /** Errors: the wake threw, or logged an error while it ran. */
  errors: number;
  /** The alarm it left set, or null for none. */
  next: number | null;
  /** The parts of the store that were due (a person store's modules), when the driver knows. */
  parts?: string[];
};

export type Vitals = {
  idlePerHour: number;
  quickIdlePerHour: number;
  quickMs: number;
  wakesPerHour: number;
  wakeRead: number;
  wakeWrite: number;
  dayRead: number;
  dayWrite: number;
  settleHours: number;
  maxWakes: number;
};

/** Defaults for a small personal system on the free plan. An app may tighten any of them. */
export const VITALS: Vitals = {
  idlePerHour: 12,
  quickIdlePerHour: 5,
  quickMs: 60_000,
  wakesPerHour: 120,
  wakeRead: 10_000,
  wakeWrite: 10_000,
  dayRead: 800_000,
  dayWrite: 40_000,
  settleHours: 6,
  maxWakes: 2_000,
};

export type Broken = { store: string; rule: string; detail: string };

export type Judged = {
  /** Numbers for the run's diff against main: totals and the worst hour of any store. */
  numbers: Record<string, number>;
  /** Every vital sign broken, worst first per rule. Empty is healthy. */
  broken: Broken[];
};

const HOUR = 3_600_000;
const idle = (w: Wake) => w.rowsWritten === 0 && w.calls === 0 && w.errors === 0;
const short = (store: string) => store.replace(/:([0-9a-f]{6})[0-9a-f]+$/, ':$1');
const partsOf = (ws: Wake[]) => {
  const n = new Map<string, number>();
  for (const w of ws) for (const p of w.parts ?? []) n.set(p, (n.get(p) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  return top ? ` (mostly ${top[0]})` : '';
};

/**
 * Judges the wakes of one simulated span (`from` to `to`, ms). `stopped` is true when the driver
 * hit `maxWakes` before `to`: that alone is a broken vital sign.
 */
export function judge(
  wakes: Wake[],
  span: { from: number; to: number; stopped?: boolean },
  limits: Partial<Vitals> = {},
): Judged {
  const v = { ...VITALS, ...limits };
  const hours = Math.max(1, Math.ceil((span.to - span.from) / HOUR));
  const broken: Broken[] = [];
  const numbers = {
    wakes: wakes.length,
    idleWakes: 0,
    quickIdleWakes: 0,
    rowsRead: 0,
    rowsWritten: 0,
    calls: 0,
    errors: 0,
    stores: 0,
    maxWakesHour: 0,
    maxIdleHour: 0,
    maxRowsReadWake: 0,
    maxRowsWrittenWake: 0,
    lastHoursWakes: 0,
  };
  const byStore = new Map<string, Wake[]>();
  for (const w of wakes) {
    const list = byStore.get(w.store) ?? [];
    list.push(w);
    byStore.set(w.store, list);
  }
  numbers.stores = byStore.size;
  const settleFrom = span.to - v.settleHours * HOUR;

  for (const [store, ws] of byStore) {
    const name = short(store);
    const perHour = new Array<number>(hours).fill(0);
    const idleHour = new Array<number>(hours).fill(0);
    const quickHour = new Array<number>(hours).fill(0);
    let read = 0;
    let written = 0;
    let errors = 0;
    let last = 0;
    let past = 0;
    let worstRead: Wake | undefined;
    let worstWrite: Wake | undefined;
    for (const w of ws) {
      const h = Math.min(hours - 1, Math.max(0, Math.floor((w.at - span.from) / HOUR)));
      perHour[h] = (perHour[h] ?? 0) + 1;
      read += w.rowsRead;
      written += w.rowsWritten;
      errors += w.errors;
      numbers.calls += w.calls;
      if (idle(w)) {
        idleHour[h] = (idleHour[h] ?? 0) + 1;
        numbers.idleWakes++;
        if (w.next !== null && w.next - w.at < v.quickMs) {
          quickHour[h] = (quickHour[h] ?? 0) + 1;
          numbers.quickIdleWakes++;
        }
      }
      if (w.next !== null && w.next < w.at) past++;
      if (w.at >= settleFrom) last++;
      if (!worstRead || w.rowsRead > worstRead.rowsRead) worstRead = w;
      if (!worstWrite || w.rowsWritten > worstWrite.rowsWritten) worstWrite = w;
    }
    numbers.rowsRead += read;
    numbers.rowsWritten += written;
    numbers.errors += errors;
    const maxW = Math.max(...perHour);
    const maxI = Math.max(...idleHour);
    const maxQ = Math.max(...quickHour);
    numbers.maxWakesHour = Math.max(numbers.maxWakesHour, maxW);
    numbers.maxIdleHour = Math.max(numbers.maxIdleHour, maxI);
    numbers.maxRowsReadWake = Math.max(numbers.maxRowsReadWake, worstRead?.rowsRead ?? 0);
    numbers.maxRowsWrittenWake = Math.max(numbers.maxRowsWrittenWake, worstWrite?.rowsWritten ?? 0);
    numbers.lastHoursWakes = Math.max(numbers.lastHoursWakes, last);
    const why = partsOf(ws);

    if (maxI > v.idlePerHour)
      broken.push({
        store,
        rule: 'idle wakes',
        detail: `${name}: ${maxI} wakes in one hour did nothing (limit ${v.idlePerHour})${why}`,
      });
    if (maxQ > v.quickIdlePerHour)
      broken.push({
        store,
        rule: 'quick idle',
        detail: `${name}: ${maxQ} idle wakes in one hour set the next under ${v.quickMs / 1000} s (limit ${v.quickIdlePerHour})${why}`,
      });
    if (maxW > v.wakesPerHour)
      broken.push({
        store,
        rule: 'wake rate',
        detail: `${name}: ${maxW} wakes in one hour (limit ${v.wakesPerHour})${why}`,
      });
    if (past)
      broken.push({
        store,
        rule: 'alarm in the past',
        detail: `${name}: ${past} wakes set an alarm before their own time${why}`,
      });
    if (worstRead && worstRead.rowsRead > v.wakeRead)
      broken.push({
        store,
        rule: 'rows per wake',
        detail: `${name}: one wake read ${worstRead.rowsRead} rows (limit ${v.wakeRead})${partsOf([worstRead])}`,
      });
    if (worstWrite && worstWrite.rowsWritten > v.wakeWrite)
      broken.push({
        store,
        rule: 'rows per wake',
        detail: `${name}: one wake wrote ${worstWrite.rowsWritten} rows (limit ${v.wakeWrite})${partsOf([worstWrite])}`,
      });
    const days = Math.max(1, (span.to - span.from) / (24 * HOUR));
    if (read / days > v.dayRead)
      broken.push({
        store,
        rule: 'rows per day',
        detail: `${name}: read ${Math.round(read / days)} rows a day (limit ${v.dayRead})${why}`,
      });
    if (written / days > v.dayWrite)
      broken.push({
        store,
        rule: 'rows per day',
        detail: `${name}: wrote ${Math.round(written / days)} rows a day (limit ${v.dayWrite})${why}`,
      });
    if (span.to - span.from > v.settleHours * HOUR && last > v.idlePerHour * v.settleHours)
      broken.push({
        store,
        rule: 'settles',
        detail: `${name}: still ${last} wakes in the last ${v.settleHours} h (limit ${v.idlePerHour * v.settleHours})${why}`,
      });
    if (errors)
      broken.push({ store, rule: 'errors', detail: `${name}: ${errors} wake errors${why}` });
  }
  if (span.stopped)
    broken.unshift({
      store: '',
      rule: 'runaway',
      detail: `stopped at ${v.maxWakes} wakes, ${Math.round((wakes.at(-1)?.at ?? span.from) - span.from) / 1000} simulated seconds in${partsOf(wakes)}`,
    });
  return { numbers, broken };
}

/**
 * Alarms kept by the sanity run instead of the runtime, one per store. The runtime's own alarm is
 * never set while the clock is simulated, so nothing fires on real time.
 */
export class SimAlarms {
  private at = new Map<string, number>();
  set(store: string, at: number) {
    this.at.set(store, at);
  }
  get(store: string): number | null {
    return this.at.get(store) ?? null;
  }
  delete(store: string) {
    this.at.delete(store);
  }
  /** The earliest alarm at or before `until`, or null. */
  next(until: number): { store: string; at: number } | null {
    let best: { store: string; at: number } | null = null;
    for (const [store, at] of this.at)
      if (at <= until && (!best || at < best.at)) best = { store, at };
    return best;
  }
}

/**
 * A clock that runs from real time plus an offset the driver moves forward. Installs itself as the
 * global `Date` (so `Date.now()` and `new Date()` everywhere read it) and never runs backwards.
 */
export function simClock(g: { Date: DateConstructor } = globalThis) {
  const Real = g.Date;
  let offset = 0;
  const now = () => Real.now() + offset;
  class SimDate extends Real {
    // biome-ignore lint/suspicious/noExplicitAny: Date's constructor takes any of its overloads.
    constructor(...a: any[]) {
      if (a.length === 0) super(now());
      // @ts-expect-error: spread into Date's overloads.
      else super(...a);
    }
    static override now() {
      return now();
    }
  }
  g.Date = SimDate as DateConstructor;
  return {
    now,
    /** Moves the clock to `t` if that is ahead; never back. */
    advanceTo(t: number) {
      const d = t - now();
      if (d > 0) offset += d;
    },
    /** Puts the real `Date` back. */
    restore() {
      g.Date = Real;
    },
  };
}
