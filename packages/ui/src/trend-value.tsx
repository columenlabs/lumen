// A change between two periods (this week against the last) that never misleads: a share only when
// the earlier period is big enough to divide by, the plain difference (`▲ +3`) when it is tiny or
// empty, and `▲ >10×` once the change is past ten times, never a five-digit percent.
import { cn } from './lib/utils';

export type TrendChange =
  /** Both periods empty, or nothing to compare. */
  | { kind: 'none' }
  /** No visible change. */
  | { kind: 'flat' }
  /** A share of the earlier period (0.12 = +12%). */
  | { kind: 'pct'; ratio: number }
  /** Past `max` times the earlier period. */
  | { kind: 'many'; up: boolean }
  /** The earlier period is at or under `minBase`: the plain difference. */
  | { kind: 'abs'; delta: number };

/**
 * How `now` compares with `prev`. `minBase`: the smallest earlier period a share is worked out
 * from (in the values' own unit); `max`: the multiple from which it reads `>10×`.
 */
export function trendChange(
  now: number,
  prev: number,
  { minBase = 0, max = 10 }: { minBase?: number; max?: number } = {},
): TrendChange {
  const delta = now - prev;
  if (!now && !prev) return { kind: 'none' };
  if (prev <= minBase) return delta ? { kind: 'abs', delta } : { kind: 'flat' };
  const ratio = now / prev - 1;
  if (now / prev >= max) return { kind: 'many', up: true };
  if (Math.round(ratio * 100) === 0) return { kind: 'flat' };
  return { kind: 'pct', ratio };
}

const minus = (s: string) => s.replace(/^-/, '−');

/**
 * Draws a `trendChange`: `▲ 12%`, `▼ 8%`, `▲ >10×`, `▲ +3` (`format` writes the difference), `0%`
 * muted when flat, a dash when there is nothing to compare.
 */
export function TrendValue({
  change,
  format = (v) => Math.round(v).toLocaleString('en-US'),
  title,
  className,
}: {
  change: TrendChange | null;
  /** Writes a plain difference (without its sign). */
  format?: (v: number) => string;
  title?: string;
  className?: string;
}) {
  if (!change || change.kind === 'none')
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  if (change.kind === 'flat')
    return (
      <span className={cn('num text-muted-foreground', className)} title={title}>
        0%
      </span>
    );
  const up =
    change.kind === 'pct' ? change.ratio > 0 : change.kind === 'abs' ? change.delta > 0 : change.up;
  const text =
    change.kind === 'pct'
      ? `${Math.abs(Math.round(change.ratio * 100))}%`
      : change.kind === 'many'
        ? '>10×'
        : `${up ? '+' : '−'}${minus(format(Math.abs(change.delta)))}`;
  return (
    <span className={cn('num whitespace-nowrap', className)} title={title}>
      {up ? '▲' : '▼'} {text}
    </span>
  );
}
