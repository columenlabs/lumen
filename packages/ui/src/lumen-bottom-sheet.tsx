import * as React from 'react';
import { Drawer } from 'vaul';
import { cn } from './lib/utils';

/**
 * A snap point: a share of the screen's height (0 to 1), or a height in px ("64px") measured above the
 * phone's home bar (the sheet adds the bar's safe area to it).
 */
export type SheetSnap = number | string;

export interface LumenBottomSheetProps {
  /** The heights it rests at, smallest first: `['64px', 0.5, 0.92]` is peek, half and full. */
  snaps: SheetSnap[];
  /** Where it rests now (one of `snaps`). */
  snap: SheetSnap;
  /** The person dragged it to another snap. */
  onSnap: (snap: SheetSnap) => void;
  /** Its name for screen readers. */
  title: string;
  /** What it holds. It stays mounted at every snap, so running work inside keeps going. */
  children: React.ReactNode;
  className?: string;
}

/** A snap point in px against a screen `h` px tall. */
function px(s: SheetSnap, h: number): number {
  if (typeof s === 'number') return s * h;
  return Number.parseFloat(s);
}

/** The phone's bottom safe area (its home bar), px: 0 where there is none. */
function useSafeBottom() {
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const read = () => setInset(Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0);
    read();
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      probe.remove();
    };
  }, []);
  return inset;
}

/** The screen's height, kept up to date. */
function useScreenHeight() {
  const [h, setH] = React.useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );
  React.useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

/**
 * A bottom sheet that stays on screen and leaves the page under it live: no dim, no blur, taps and
 * drags above it reach the page. The person drags its handle between `snaps` (peek, half, full);
 * it never closes, so what it holds is never unmounted. Built on vaul's snap points.
 */
export function LumenBottomSheet({
  snaps,
  snap,
  onSnap,
  title,
  children,
  className,
}: LumenBottomSheetProps) {
  const h = useScreenHeight();
  const inset = useSafeBottom();
  // A px snap rests above the home bar: vaul gets it with the bar's height added.
  const rest = (s: SheetSnap): SheetSnap => (typeof s === 'string' ? `${px(s, h) + inset}px` : s);
  const rests = snaps.map(rest);
  const at = snaps.indexOf(snap);
  // The sheet is as tall as the screen and slides down to its snap; what it holds fills only the
  // part on screen, so a composer or footer at its bottom stays in view at every snap.
  const shown = Math.min(h, Math.max(0, px(rest(snap), h)));
  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      handleOnly
      snapPoints={rests}
      activeSnapPoint={rests[at] ?? rest(snap)}
      setActiveSnapPoint={(s) => {
        const i = s == null ? -1 : rests.indexOf(s);
        const next = snaps[i];
        if (next !== undefined) onSnap(next);
      }}
    >
      <Drawer.Portal>
        <Drawer.Content
          data-slot="lumen-bottom-sheet"
          aria-describedby={undefined}
          // Focus stays where the person was: the sheet is always there, opening it is not a move.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed inset-x-0 bottom-0 z-40 flex h-dvh flex-col rounded-t-2xl border-t bg-popover text-popover-foreground shadow-[0_-4px_16px_rgb(0_0_0/0.15)] outline-none',
            className,
          )}
        >
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          {/* Clipped to its snap: at peek only the handle and the header show, nothing of the body below. */}
          <div className="flex min-h-0 flex-col overflow-hidden" style={{ height: shown }}>
            <Drawer.Handle
              aria-label="Drag to resize"
              className="mx-auto! my-2! h-1! w-9! shrink-0 rounded-full! bg-border! opacity-100!"
            />
            <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
              {children}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
