import { cn } from '../lib/utils';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/** Opens or closes the tooltip it is inside (a tap on touch, `TooltipTrigger`). */
const TapContext = React.createContext<((open: boolean | ((o: boolean) => boolean)) => void) | null>(
  null,
);

/**
 * A tooltip. A touch screen has no hover, so a tap on a trigger that does nothing else (a value, a
 * name, a chip: not a button, link or field) opens it, and a tap anywhere else closes it. That way
 * every hover detail (a table cell's tokens, a chart point's note) reaches a phone too.
 */
function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [own, setOwn] = React.useState(defaultOpen);
  const open = openProp ?? own;
  const latest = React.useRef({ open, onOpenChange });
  latest.current = { open, onOpenChange };
  const setOpen = React.useCallback((next: boolean | ((o: boolean) => boolean)) => {
    const v = typeof next === 'function' ? next(latest.current.open) : next;
    setOwn(v);
    latest.current.onOpenChange?.(v);
  }, []);
  return (
    <TapContext.Provider value={setOpen}>
      <TooltipPrimitive.Root data-slot="tooltip" open={open} onOpenChange={setOpen} {...props} />
    </TapContext.Provider>
  );
}

/** A trigger that has its own action on a tap: its tooltip stays a hover (and focus) help. */
const ACTS = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"]';

function TooltipTrigger({
  onPointerDown,
  onClick,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const setOpen = React.useContext(TapContext);
  const touch = React.useRef(false);
  // The trigger itself, or the element it renders (asChild), may act on a tap; then it keeps it.
  const acts = (el: Element) => el.matches(ACTS) || !!el.closest(ACTS);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={(e) => {
        onPointerDown?.(e);
        touch.current = e.pointerType === 'touch' && !acts(e.currentTarget);
        // Radix closes a tooltip on a press; a tap on touch toggles it instead (onClick).
        if (touch.current && setOpen) e.preventDefault();
      }}
      onClick={(e) => {
        onClick?.(e);
        if (!touch.current || !setOpen) return;
        touch.current = false;
        e.preventDefault();
        setOpen((o) => !o);
      }}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm z-50 w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) border bg-popover text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="size-2.5 rotate-45 rounded-[2px] z-50 translate-y-[calc(-50%_-_2px)] border-r border-b bg-popover fill-popover" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
