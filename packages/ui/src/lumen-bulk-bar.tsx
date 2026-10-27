import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './ui/button';

/**
 * The bar over a table while rows are ticked: how many, the actions that apply to them, and a ✕
 * that clears the ticks. Each action clears the selection when it applies and offers Undo in a
 * toast (the change comes back, not the ticks). Pair it with LumenLayout's `selection`.
 */
export function LumenBulkBar({
  count,
  label = 'Change the ticked rows',
  onClear,
  children,
}: {
  count: number;
  /** The toolbar's name for screen readers ("Change the ticked people"). */
  label?: string;
  onClear: () => void;
  /** The actions, small outline buttons or a chip picker. */
  children: ReactNode;
}) {
  if (count < 1) return null;
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm"
    >
      <span className="num font-medium">{count} selected</span>
      {children}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Clear the selection"
        className="ml-auto"
        onClick={onClear}
      >
        <XIcon />
      </Button>
    </div>
  );
}
