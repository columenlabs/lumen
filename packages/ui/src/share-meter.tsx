// A share as a bar and its number (used of an allowance, a goal reached). The bar track and the
// number column are fixed widths and the number is right-aligned in tabular figures, so every
// meter in a column starts and ends at the same x whatever its number reads (`5%` or `>999%`).
// Its colour is the share's `meterLevel` (grey, amber from 75%, red from 90%) unless `color` is set.
// With `segments` the bar splits into who used the cap (a pool's labels or resources), each in its
// own colour; past the cap the track stretches to the total and a tick marks the cap.
import type { MeterLevels } from '@columenlabs/lumen-ui-types/views';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './lib/utils';
import { METER_LEVEL_COLOR, meterLevel } from './meter-level';
import { Progress } from './ui/progress';

/** One part of a split meter: its own share of the cap (0 to 1 of the whole cap), in its colour. */
export interface ShareSegment {
  value: number;
  /** A theme token or CSS colour (a label's colour). */
  color: string;
  /** Who it is, read out by screen readers and in the bar's hover (`edgedesk 122%`). */
  label?: string;
}

export function ShareMeter({
  value,
  label,
  color,
  levels,
  segments,
  wide,
  className,
}: {
  /** 0 to 1 fills the bar; past 1 it stays full (with `segments`, the track stretches instead). */
  value: number;
  /** The number beside the bar, e.g. `113%`; left out, the rounded percent. */
  label?: ReactNode;
  /** The bar's colour, a theme token; left out, the share's level (grey, amber, red). */
  color?: string;
  /** This meter's own levels (e.g. `{ watch: 0.5 }`); left out, the app's `meterLevels`. */
  levels?: Partial<MeterLevels>;
  /** Splits the bar by who used the cap, largest first; their values add up to `value`. */
  segments?: ShareSegment[];
  /** Fills its cell (a list row) instead of the fixed table width. */
  wide?: boolean;
  className?: string;
}) {
  const number = (
    <span className="num w-11 shrink-0 text-right text-xs">
      {label ?? `${Math.round(value * 100)}%`}
    </span>
  );
  if (segments?.length) {
    // Past the cap the bar keeps its width: the track reads as the total and the tick as the cap.
    const scale = Math.max(1, value);
    const said = segments
      .filter((s) => s.value > 0)
      .map((s) => `${s.label ?? ''} ${Math.round(s.value * 100)}%`.trim());
    return (
      <span className={cn('inline-flex items-center gap-2', wide && 'w-full', className)}>
        <span
          role="img"
          aria-label={said.join(', ')}
          title={said.join(' · ')}
          data-slot="share-segments"
          className={cn(
            'relative flex h-1.5 shrink-0 overflow-hidden rounded-full bg-muted',
            wide ? 'w-full shrink' : 'w-14',
          )}
        >
          {segments.map((s, i) =>
            s.value > 0 ? (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: segments have no id and keep their order
                key={i}
                className="h-full shrink-0 border-background not-first:border-l"
                style={{ width: `${(s.value / scale) * 100}%`, background: s.color }}
              />
            ) : null,
          )}
          {value > 1 && (
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/70"
              style={{ left: `${(1 / scale) * 100}%` }}
            />
          )}
        </span>
        {number}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-2', wide && 'w-full', className)}>
      <Progress
        value={Math.max(0, Math.min(value, 1)) * 100}
        className={cn(
          'h-1.5 shrink-0 [&>[data-slot=progress-indicator]]:bg-(--meter-color)',
          wide ? 'w-full shrink' : 'w-14',
        )}
        style={
          {
            '--meter-color': color ?? METER_LEVEL_COLOR[meterLevel(value, levels)],
          } as CSSProperties
        }
      />
      {number}
    </span>
  );
}
