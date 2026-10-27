import { useEffect, useRef, useState } from 'react';

/** How long a pop-up stays after the mouse leaves, so it can travel from trigger to pop-up. */
const HOVER_CLOSE_MS = 150;

/** Focus stays on the trigger: moving it into the pop-up, or back on close, would dismiss a
 *  neighbour's pop-up the mouse just opened (Radix closes a pop-up on focus outside). */
const keepFocus = (e: Event) => e.preventDefault();

/**
 * Open state for a status bar pop-up that opens on hover with a mouse and on tap with a finger or
 * keyboard (a `Popover`'s own trigger). Spread `hover` on the trigger and `content` on the
 * `PopoverContent`.
 */
export function useHoverOpen() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hover = (on: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer.current);
    if (on) setOpen(true);
    else timer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };
  const handlers = { onPointerEnter: hover(true), onPointerLeave: hover(false) };
  return {
    open,
    setOpen,
    hover: handlers,
    content: { ...handlers, onOpenAutoFocus: keepFocus, onCloseAutoFocus: keepFocus },
  };
}
