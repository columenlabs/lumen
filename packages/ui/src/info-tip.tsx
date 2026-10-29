import { InfoIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { cn } from './lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/**
 * The details of a label, behind an (i) beside it: shown on hover or focus, and on tap on a
 * phone. The kit's one way to say more than a label: keep visible copy to a few words and put
 * the rest here, never in a grey line under a field or a section title.
 */
export function InfoTip({
  children,
  label = 'More about this',
  side = 'top',
  className,
}: {
  /** The details: a sentence or two, a short list. */
  children: ReactNode;
  /** The button's accessible name ("About Edit"). */
  label?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Hover opens it after a beat and leaving closes it after one, so the pointer can cross to it.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const later = (next: boolean, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), ms);
  };
  const hover = {
    onPointerEnter: (e: { pointerType: string }) => e.pointerType === 'mouse' && later(true, 150),
    onPointerLeave: (e: { pointerType: string }) => e.pointerType === 'mouse' && later(false, 200),
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            // A 16px icon with a 24px hit area (WCAG 2.2 target size on a phone).
            "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none after:absolute after:-inset-1 after:content-[''] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          onFocus={() => later(true, 0)}
          onBlur={() => later(false, 100)}
          {...hover}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className="w-72 text-muted-foreground text-xs leading-relaxed"
        // Focus stays on the (i): the tip is read, not worked in.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        {...hover}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** A label with its (i): `Link works for (i)`. */
export function InfoLabel({
  children,
  info,
  className,
}: {
  children: ReactNode;
  info?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {children}
      {info ? (
        <InfoTip label={typeof children === 'string' ? `About ${children}` : undefined}>
          {info}
        </InfoTip>
      ) : null}
    </span>
  );
}
