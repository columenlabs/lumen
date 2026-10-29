// A number and its unit in a table cell, so a column lines up: the number right-aligned in tabular
// figures, the unit in a fixed, muted slot after it, and a status dot just left of the number. One
// number per cell; a second measure (the share of an allowance) goes in a hover card, never in
// brackets beside it.
//
// In a LumenView table the column learns it holds units from the first UnitValue drawn in it
// (`UnitColumns`): that column's header, dashes, plain numbers and Total then right-align on the
// numbers' edge and the unit slot hangs in the cell's gutter (theme.css, `[data-units]`). So an
// app can draw its own dash or text beside UnitValue cells and the column still has one edge.
import type { MeterLevels } from '@columenlabs/lumen-ui-types/views';
import { type ReactNode, createContext, useContext, useLayoutEffect, useRef } from 'react';
import { cn } from './lib/utils';
import { meterValueTone } from './meter-level';

/** Set by a table: marks the column (its cell's `data-col`) a UnitValue draws in. */
export const UnitColumns = createContext<((col: string) => void) | null>(null);

export function UnitValue({
  value,
  unit,
  tone: toneProp,
  share,
  levels,
  title,
  className,
}: {
  /** The number, already formatted (`231.4`). */
  value: ReactNode;
  /** Its unit (`GB`, `M`, `/day`); left out, the slot stays empty so the column still lines up. */
  unit?: ReactNode;
  /** Near (`warning`, amber), close to (`caution`, orange) or at (`loss`, red) a limit: tints the number and shows a dot. */
  tone?: 'warning' | 'caution' | 'loss';
  /** Its share of a cap (0 to 1): sets `tone` by `meterLevel` (amber from 75%, orange from 90%, red from 100%). */
  share?: number;
  /** This value's own levels; left out, the app's `meterLevels`. */
  levels?: Partial<MeterLevels>;
  title?: string;
  className?: string;
}) {
  const tone = toneProp ?? (share === undefined ? undefined : meterValueTone(share, levels));
  const mark = useContext(UnitColumns);
  const ref = useRef<HTMLSpanElement>(null);
  // Before paint, so the column never draws on two edges, even for a frame.
  useLayoutEffect(() => {
    const col = ref.current?.closest('[data-col]')?.getAttribute('data-col');
    if (mark && col) mark(col);
  }, [mark]);
  return (
    <span
      ref={ref}
      data-slot="unit-value"
      title={title}
      className={cn('inline-flex w-full items-center justify-end whitespace-nowrap', className)}
    >
      <span
        className={cn(
          'num relative text-right',
          tone === 'warning' && 'text-warning',
          tone === 'caution' && 'text-caution',
          tone === 'loss' && 'text-loss',
        )}
      >
        {tone && (
          <span
            aria-hidden="true"
            className={cn(
              '-translate-y-1/2 absolute top-1/2 right-full mr-1 size-1.5 rounded-full',
              tone === 'warning' ? 'bg-warning' : tone === 'caution' ? 'bg-caution' : 'bg-loss',
            )}
          />
        )}
        {value}
      </span>
      <span
        data-slot="unit-value-unit"
        className="w-(--unit-slot) shrink-0 pl-1 text-left text-muted-foreground text-xs"
      >
        {unit}
      </span>
    </span>
  );
}
