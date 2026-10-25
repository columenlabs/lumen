// A share as a bar and its number (used of an allowance, a goal reached). The bar track and the
// number column are fixed widths and the number is right-aligned in tabular figures, so every
// meter in a column starts and ends at the same x whatever its number reads (`5%` or `>999%`).
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './lib/utils';
import { Progress } from './ui/progress';

export function ShareMeter({
  value,
  label,
  color = 'var(--primary)',
  wide,
  className,
}: {
  /** 0 to 1 fills the bar; past 1 it stays full. */
  value: number;
  /** The number beside the bar, e.g. `113%`; left out, the rounded percent. */
  label?: ReactNode;
  /** The bar's colour, a theme token (`var(--loss)` when over). */
  color?: string;
  /** Fills its cell (a list row) instead of the fixed table width. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', wide && 'w-full', className)}>
      <Progress
        value={Math.max(0, Math.min(value, 1)) * 100}
        className={cn(
          'h-1.5 shrink-0 [&>[data-slot=progress-indicator]]:bg-(--meter-color)',
          wide ? 'w-full shrink' : 'w-14',
        )}
        style={{ '--meter-color': color } as CSSProperties}
      />
      <span className="num w-11 shrink-0 text-right text-xs">
        {label ?? `${Math.round(value * 100)}%`}
      </span>
    </span>
  );
}
