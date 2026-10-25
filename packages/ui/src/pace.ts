// Pace: how fast a meter is being used over a recent window, carried forward to when it reaches its
// cap. The same for every product: the app passes the window's samples (hourly or daily amounts, or
// sizes for a stored amount), what is used so far, the cap and the hours until the cap resets.
// A lone hot sample (above 3× the window's median, with neither neighbour above it) counts as 3×
// the median, so one burst can't fake a crisis; a run of hot samples is a real change and counts.
// `TimeToCap` draws the answer; its colour is where the meter lands at reset, on the meter levels.
import { useCallback, useSyncExternalStore } from 'react';

/** The windows a pace is read over. */
export const PACE_WINDOWS = [
  { id: '6h', hours: 6 },
  { id: '12h', hours: 12 },
  { id: '24h', hours: 24 },
  { id: '7d', hours: 168 },
] as const;
export type PaceWindow = (typeof PACE_WINDOWS)[number]['id'];
export const paceHours = (w: PaceWindow) => PACE_WINDOWS.find((x) => x.id === w)?.hours ?? 12;

export interface BurnRate {
  /** Units per hour; a stored amount's growth per hour (can be negative). */
  rate: number;
  /** The plain average, before a lone spike was capped. */
  raw: number;
  /** Lone hot samples that were capped. */
  spikes: number;
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * The rate over `samples` (oldest first, complete periods only), each `per` hours long. `gauge`:
 * the samples are sizes, so the rate is their growth from first to last. `damp: false` keeps spikes.
 */
export function burnRate(
  samples: readonly number[],
  { per = 1, gauge = false, damp = true }: { per?: number; gauge?: boolean; damp?: boolean } = {},
): BurnRate {
  const n = samples.length;
  if (!n) return { rate: 0, raw: 0, spikes: 0 };
  if (gauge) {
    const r = n > 1 ? ((samples[n - 1] ?? 0) - (samples[0] ?? 0)) / ((n - 1) * per) : 0;
    return { rate: r, raw: r, spikes: 0 };
  }
  const total = samples.reduce((s, v) => s + v, 0);
  const cap = median(samples) * 3;
  const hot = (i: number) => cap > 0 && i >= 0 && i < n && (samples[i] ?? 0) > cap;
  let kept = 0;
  let spikes = 0;
  for (let i = 0; i < n; i++) {
    if (damp && hot(i) && !hot(i - 1) && !hot(i + 1)) {
      kept += cap;
      spikes++;
    } else kept += samples[i] ?? 0;
  }
  const hours = n * per;
  return { rate: kept / hours, raw: total / hours, spikes };
}

export interface Pace extends BurnRate {
  /** Hours until the cap at this rate: 0 when already there, Infinity when not growing. */
  eta: number;
  /** Where the meter lands at reset, as a share of the cap (1.2 = 120%). */
  atReset: number;
  /** Reaches the cap before it resets. */
  hits: boolean;
  /** Hours until the cap resets (or the horizon for a stored amount). */
  resetIn: number;
  /** The rate that lands exactly on the cap at reset (0 once there). */
  safe: number;
}

/** When `used` reaches `cap` at `rate`, and where it stands when the cap resets in `resetIn` hours. */
export function timeToCap(rate: BurnRate, used: number, cap: number, resetIn: number): Pace {
  const left = cap - used;
  const eta = left <= 0 ? 0 : rate.rate > 0 ? left / rate.rate : Number.POSITIVE_INFINITY;
  return {
    ...rate,
    eta,
    atReset: cap > 0 ? (used + Math.max(rate.rate, 0) * resetIn) / cap : 0,
    hits: eta <= resetIn,
    resetIn,
    safe: left > 0 && resetIn > 0 ? left / resetIn : 0,
  };
}

/** `40m`, `2h 05m`, `29h`, `3 days`; `short` gives `2h`, `29h`, `3d` (a phone cell). */
export function durationText(hours: number, short = false): string {
  if (!Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (short) return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  if (hours < 10) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m === 60 ? `${h + 1}h 00m` : `${h}h ${String(m).padStart(2, '0')}m`;
  }
  return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)} days`;
}

// The window someone picked, kept in their browser (one choice per app host, every page shares it).
const KEY = 'lumen:pace-window';
const listeners = new Set<() => void>();
let picked: PaceWindow | null = null;
let fallback: PaceWindow = '12h';
const isWindow = (v: unknown): v is PaceWindow => PACE_WINDOWS.some((x) => x.id === v);

function read(): PaceWindow {
  if (picked) return picked;
  try {
    const v = localStorage.getItem(KEY);
    if (isWindow(v)) picked = v;
  } catch {
    // Storage refused: the app's default holds.
  }
  return picked ?? fallback;
}

function write(w: PaceWindow) {
  picked = w;
  try {
    localStorage.setItem(KEY, w);
  } catch {
    // Storage refused: the pick holds until reload.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The app's window before anyone picks one (`12h` unless set). */
export function setDefaultPaceWindow(w: PaceWindow) {
  fallback = w;
  for (const l of listeners) l();
}

/** The pace window in use and its setter; every `PaceWindowPicker` and reader shares it. */
export function usePaceWindow(): [PaceWindow, (w: PaceWindow) => void] {
  const w = useSyncExternalStore(subscribe, read, () => fallback);
  return [w, useCallback((x: PaceWindow) => write(x), [])];
}
