/**
 * Time spans on a chart's bars, apart from the chart itself so a page can work them out without
 * loading the chart (lightweight-charts) before it shows.
 */
import type { Time } from 'lightweight-charts';

/** A bar's time as Unix seconds (days read as UTC midnight). */
export const secOf = (t: string | number | Time) =>
  typeof t === 'number'
    ? t
    : typeof t === 'string'
      ? Date.parse(`${t}T00:00:00Z`) / 1000
      : Date.UTC(t.year, t.month - 1, t.day) / 1000;

/** A span of time in Unix seconds; either end may be infinite (from the first bar, to the last). */
export interface TimeSpan {
  from: number;
  to: number;
}

/** First index whose time is at or after `t` (`secs` ascending); `secs.length` when none is. */
export function lowerBound(secs: number[], t: number) {
  let lo = 0;
  let hi = secs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((secs[mid] as number) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The bars of `secs` inside `span`, as an index range (at least one bar). */
export function indexSpan(secs: number[], span: TimeSpan): [number, number] {
  const last = secs.length - 1;
  const a = Math.min(last, lowerBound(secs, span.from));
  const b = Math.max(a, Math.min(last, lowerBound(secs, span.to + 1) - 1));
  return [a, b];
}
