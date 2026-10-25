// A number and its unit in a table cell, so a column lines up: the number right-aligned in tabular
// figures, the unit in a fixed, muted slot after it, and a fixed slot for a status dot. One
// number per cell; a second measure (the share of an allowance) goes in a hover card, never in
// brackets beside it.
import type { ReactNode } from 'react';
import { cn } from './lib/utils';

export function UnitValue({
  value,
  unit,
  tone,
  title,
  className,
}: {
  /** The number, already formatted (`231.4`). */
  value: ReactNode;
  /** Its unit (`GB`, `M`, `/day`); left out, the slot stays empty so the column still lines up. */
  unit?: ReactNode;
  /** Near (`warning`) or past (`loss`) a limit: tints the number and shows a dot. */
  tone?: 'warning' | 'loss';
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex w-full items-center justify-end gap-1 whitespace-nowrap',
        className,
      )}
    >
      <span
        className={cn(
          'num text-right',
          tone === 'warning' && 'text-warning',
          tone === 'loss' && 'text-loss',
        )}
      >
        {value}
      </span>
      <span className="w-10 shrink-0 text-left text-muted-foreground text-xs">{unit}</span>
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'warning' ? 'bg-warning' : tone === 'loss' ? 'bg-loss' : 'bg-transparent',
        )}
      />
    </span>
  );
}
