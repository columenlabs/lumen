// What a panel docked right of the page needs: a value it keeps (its width, folded or not), the
// left edge that drags its width, and the shell's slot a docked drawer renders into (LumenShell puts
// it between the page and the assistant, so the page narrows to make room instead of being covered).
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * A value kept for this browser tab (sessionStorage), or for this browser with `'local'`
 * (localStorage), read with `use` and set with `write`.
 */
export function tabState<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
  keep: 'tab' | 'local' = 'tab',
) {
  const listeners = new Set<() => void>();
  const store = () => (keep === 'local' ? localStorage : sessionStorage);
  const read = () => {
    try {
      const raw = store().getItem(key);
      return raw == null ? fallback : (parse(raw) ?? fallback);
    } catch {
      return fallback;
    }
  };
  let state = typeof sessionStorage === 'undefined' ? fallback : read();
  const write = (next: T) => {
    state = next;
    try {
      store().setItem(key, String(next));
    } catch {}
    for (const l of listeners) l();
  };
  const use = () =>
    useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => state,
      () => fallback,
    );
  return { write, use, get: () => state };
}

/** Where a docked drawer renders on desktop; null outside LumenShell (it then opens over the page). */
export const DockSlot = createContext<HTMLElement | null>(null);
export const useDockSlot = () => useContext(DockSlot);

/**
 * A docked panel's left edge: drag it, or focus it and use the arrow keys, to set the width between
 * `min` and `max`; a double click goes back to the default (0). While dragging only `onDrag` hears it.
 */
export function ResizeEdge({
  name,
  width,
  min,
  max,
  onDrag,
  onWidth,
  slot,
}: {
  name: string;
  width: number;
  min: number;
  max: number;
  onDrag: (w: number | null) => void;
  onWidth: (w: number) => void;
  /** Its `data-slot`. */
  slot: string;
}) {
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(w, max)));
  // The panel's width on screen (the default one is CSS's).
  const now = (el: HTMLElement) =>
    Math.round(el.parentElement?.getBoundingClientRect().width ?? width);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging]);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${name}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      data-slot={slot}
      data-dragging={dragging ? '' : undefined}
      className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring data-dragging:after:bg-ring"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const w0 = now(el);
        let last = w0;
        setDragging(true);
        const move = (m: PointerEvent) => {
          last = clamp(w0 + x0 - m.clientX);
          onDrag(last);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          setDragging(false);
          onWidth(last);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      onDoubleClick={() => onWidth(0)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') onWidth(clamp(now(e.currentTarget) + step));
        else if (e.key === 'ArrowRight') onWidth(clamp(now(e.currentTarget) - step));
        else return;
        e.preventDefault();
      }}
    />
  );
}
