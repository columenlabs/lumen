import { cn } from '../lib/utils';
import { Dialog as SheetPrimitive } from 'radix-ui';

import { Button } from './button';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { useOverlayOpen } from '../hooks/use-back-close';
import { useKeyboardFit } from '../hooks/use-keyboard-fit';
import { useIsMobile } from '../hooks/use-mobile';
import { escapeToPicker } from './overlay-guard';

/** Closes the sheet from inside it (the grab handle's swipe). */
const SheetCloseContext = React.createContext<() => void>(() => undefined);

function Sheet({
  open: given,
  defaultOpen,
  onOpenChange: changed,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  // Phone back closes it (useBackClose).
  const { open, onOpenChange } = useOverlayOpen({
    open: given,
    defaultOpen,
    onOpenChange: changed,
  });
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  return (
    <SheetCloseContext.Provider value={close}>
      <SheetPrimitive.Root data-slot="sheet" open={open} onOpenChange={onOpenChange} {...props} />
    </SheetCloseContext.Provider>
  );
}

/** How far a swipe down on the grab handle must pull the sheet before letting go closes it. */
const SWIPE_CLOSE = 80;

/**
 * A bottom sheet's grab handle on a phone: a wide strip at its top that drags the sheet down, and
 * a pull past SWIPE_CLOSE (or a quick flick) closes it; a shorter one springs back.
 */
function SheetGrab() {
  const close = React.useContext(SheetCloseContext);
  const drag = React.useRef<{ y: number; t: number; el: HTMLElement } | null>(null);
  const move = (dy: number, el: HTMLElement) => {
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  return (
    <div
      data-slot="sheet-grab"
      aria-hidden
      className="absolute inset-x-0 top-0 z-10 flex h-6 cursor-grab touch-none justify-center pt-2"
      onPointerDown={(e) => {
        const el = e.currentTarget.closest<HTMLElement>('[data-slot=sheet-content]');
        if (!el) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        el.style.transition = 'none';
        drag.current = { y: e.clientY, t: e.timeStamp, el };
      }}
      onPointerMove={(e) => {
        if (drag.current) move(e.clientY - drag.current.y, drag.current.el);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const dy = e.clientY - d.y;
        const flick = dy > 24 && dy / Math.max(1, e.timeStamp - d.t) > 0.5;
        d.el.style.transition = '';
        if (dy > SWIPE_CLOSE || flick) close();
        else move(0, d.el);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d) {
          d.el.style.transition = '';
          move(0, d.el);
        }
      }}
    >
      <span className="h-1 w-9 rounded-full bg-border" />
    </div>
  );
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-y-0 left-0 right-(--assistant-docked,0px) z-50 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Left out on desktop only: a phone's bottom sheet always has its X. */
  showCloseButton?: boolean;
}) {
  // On a phone a bottom sheet rises from the bottom and stops short of the top, so the dimmed page
  // above it shows and a tap there closes it; it carries a grab handle (swipe down to close), its
  // X and the safe areas. With the keyboard up a sheet ends at the keyboard; a top sheet or a phone
  // bottom sheet starts at the top of what is visible.
  const kb = useKeyboardFit();
  const phone = useIsMobile();
  const card = side === 'bottom' && phone;
  const closable = showCloseButton || card;
  const style = !kb
    ? props.style
    : side === 'top'
      ? { ...props.style, top: kb.top, maxHeight: kb.height, height: kb.height }
      : card
        ? {
            ...props.style,
            top: kb.top + CARD_GAP,
            bottom: 'auto',
            maxHeight: kb.height - CARD_GAP,
            height: kb.height - CARD_GAP,
          }
        : side === 'bottom'
          ? { ...props.style, bottom: kb.below, maxHeight: kb.height - 8 }
          : { ...props.style, top: kb.top, height: kb.height };
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-card={card || undefined}
        data-close={closable || undefined}
        className={cn(
          'group/sheet bg-popover text-popover-foreground fixed z-50 flex flex-col gap-4 bg-clip-padding text-sm shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-(--assistant-docked,0px) data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10 data-[side=left]:pt-[env(safe-area-inset-top)] data-[side=right]:pt-[env(safe-area-inset-top)]',
          className,
          // After the caller's classes: a phone's bottom sheet always keeps its shape and room.
          card &&
            'max-h-[calc(100dvh-env(safe-area-inset-top)-2.75rem)] rounded-t-2xl border-t-0 pt-5',
        )}
        {...props}
        onEscapeKeyDown={escapeToPicker(props.onEscapeKeyDown)}
        style={style}
        // A click or focus in the docked the assistant panel leaves the sheet open, so the person can ask
        // about what it shows (LumenShell).
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest?.('[data-assistant-docked]')) e.preventDefault();
          props.onInteractOutside?.(e);
        }}
      >
        {card && <SheetGrab />}
        {children}
        {card && (
          <div aria-hidden className="h-[env(safe-area-inset-bottom)] shrink-0" />
        )}
        {closable && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3 z-20 group-data-card/sheet:top-8 group-data-[side=left]/sheet:top-[calc(0.75rem+env(safe-area-inset-top))] group-data-[side=right]/sheet:top-[calc(0.75rem+env(safe-area-inset-top))]"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

/** Room a phone's bottom sheet leaves above it, px: the dimmed page a tap closes it on. */
const CARD_GAP = 44;

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      // Its title stops short of the sheet's X, never running under it.
      className={cn('gap-0.5 p-4 flex flex-col group-data-close/sheet:pr-12', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('gap-2 p-4 mt-auto flex flex-col', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground text-base font-medium cn-font-heading min-w-0', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
