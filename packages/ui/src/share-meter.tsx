// A share as a bar and its number (used of an allowance, a goal reached). The bar track, the
// spill slot past it and the number column are fixed widths and the number is right-aligned in
// tabular figures, so every meter in a column starts and ends at the same x whatever its number
// reads (`5%` or `>999%`). Its colour is the share's `meterLevel` (green, amber from 75%, orange
// from 90%, red at the cap; `kind="health"` the other way) unless `color` is set. Past the cap the
// track stays full and a hatched stub spills into the slot after a tick at the cap, growing to
// +50% and no further. `segments` name who used the cap (a pool's labels or resources) in the
// bar's hover; the bar keeps one colour, the level's, so its colour always says how full it is.
import type { HealthLevels, MeterKind, MeterLevels } from '@columenlabs/lumen-ui-types/views';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './lib/utils';
import { METER_LEVEL_COLOR, meterLevel } from './meter-level';
import { Progress } from './ui/progress';

/** One part of a split meter: its own share of the cap (0 to 1 of the whole cap). */
export interface ShareSegment {
  value: number;
  /** No longer drawn (the bar takes its level's colour); kept so older calls still compile. */
  color?: string;
  /** Who it is, read out by screen readers and in the bar's hover (`web 122%`). */
  label?: string;
}

/** How far past the cap the spill stub can grow (a share of the cap). */
const SPILL_MAX = 0.5;

export function ShareMeter({
  value,
  label,
  color,
  kind,
  levels,
  segments,
  wide,
  className,
}: {
  /** 0 to 1 fills the bar; past 1 it stays full and the overage spills past a tick at the cap. */
  value: number;
  /** The number beside the bar, e.g. `113%`; left out, the rounded percent. */
  label?: ReactNode;
  /** The bar's colour, a theme token; left out, the share's level. */
  color?: string;
  /** `health` reads higher as better (uptime): green at 99% and over, amber, red under 95%. */
  kind?: MeterKind;
  /** This meter's own levels (e.g. `{ watch: 0.5 }`); left out, the app's levels for its kind. */
  levels?: Partial<MeterLevels> | Partial<HealthLevels>;
  /** Who used the cap, largest first; their values add up to `value`. Shown in the hover. */
  segments?: ShareSegment[];
  /** Fills its cell (a list row) instead of the fixed table width. */
  wide?: boolean;
  className?: string;
}) {
  const said = segments
    ?.filter((s) => s.value > 0)
    .map((s) => `${s.label ?? ''} ${Math.round(s.value * 100)}%`.trim());
  const over = kind !== 'health' && value > 1;
  const spill = over ? Math.min(value - 1, SPILL_MAX) / SPILL_MAX : 0;
  return (
    <span
      className={cn('inline-flex items-center gap-2', wide && 'w-full', className)}
      title={said?.length ? said.join(' · ') : undefined}
    >
      <span
        data-slot="share-meter"
        data-over={over || undefined}
        className={cn('flex shrink-0 items-center', wide ? 'w-full shrink' : 'w-14')}
        style={
          {
            '--meter-color': color ?? METER_LEVEL_COLOR[meterLevel(value, levels, kind)],
          } as CSSProperties
        }
      >
        <Progress
          value={Math.max(0, Math.min(value, 1)) * 100}
          aria-label={said?.length ? said.join(', ') : undefined}
          className={cn(
            'h-1.5 w-auto flex-3 [&>[data-slot=progress-indicator]]:bg-(--meter-color)',
            over && 'rounded-r-none',
          )}
        />
        {/* The spill slot: empty under the cap, so every bar in a column keeps one track width. */}
        <span aria-hidden className="flex h-1.5 flex-1">
          {over && (
            <span
              data-slot="share-spill"
              className="h-full rounded-r-full border-foreground/70 border-l-2"
              style={{
                width: `${spill * 100}%`,
                background:
                  'repeating-linear-gradient(135deg, var(--meter-color) 0 3px, transparent 3px 5px)',
              }}
            />
          )}
        </span>
      </span>
      <span className="num w-11 shrink-0 text-right text-xs">
        {label ?? `${Math.round(value * 100)}%`}
      </span>
    </span>
  );
}
