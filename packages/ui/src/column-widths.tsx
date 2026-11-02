// Resizable table columns: a grip on each header's right edge sets that column's width by drag
// (or ← → on the focused grip), a double click (or Enter) gives it back its own width, and the
// widths are kept on the device per table. A table turns it on with `resizable`, an app for every
// table with `configureLumen({ resizableColumns: true })`. Desktop only: a phone's rows are cards.
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './lib/utils';

/** The narrowest and widest a person can drag a column (px). */
export const COL_MIN = 48;
export const COL_MAX = 960;
/** How far ← or → moves a focused grip (px). */
const STEP = 16;
const PREFIX = 'lumen:col-widths:';

type Widths = Readonly<Record<string, number>>;

const clamp = (w: number) => Math.round(Math.min(COL_MAX, Math.max(COL_MIN, w)));

function read(key: string): Widths {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, w] of Object.entries(v)) if (typeof w === 'number' && w > 0) out[k] = clamp(w);
    return out;
  } catch {
    return {};
  }
}

function write(key: string, widths: Widths) {
  try {
    if (Object.keys(widths).length)
      window.localStorage.setItem(PREFIX + key, JSON.stringify(widths));
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage off (a private window, blocked site data): widths last for the visit only.
  }
}

/**
 * The widths a person set on one table's columns, by field key, kept on the device under `key`.
 * Left out `key`: no widths (resizing off). `set` updates while dragging; `save` sets and keeps.
 */
export function useColumnWidths(key: string | undefined) {
  const [widths, setWidths] = useState<Widths>(() =>
    key && typeof window !== 'undefined' ? read(key) : {},
  );
  useEffect(() => {
    setWidths(key ? read(key) : {});
  }, [key]);
  const set = useCallback((col: string, w: number) => {
    setWidths((o) => (o[col] === clamp(w) ? o : { ...o, [col]: clamp(w) }));
  }, []);
  const save = useCallback(
    (col: string, w: number) => {
      setWidths((o) => {
        const next = { ...o, [col]: clamp(w) };
        if (key) write(key, next);
        return next;
      });
    },
    [key],
  );
  const reset = useCallback(
    (col: string) => {
      setWidths((o) => {
        if (!(col in o)) return o;
        const { [col]: _, ...rest } = o;
        if (key) write(key, rest);
        return rest;
      });
    },
    [key],
  );
  return { widths: key ? widths : ({} as Widths), set, save, reset };
}

/**
 * The grip on a header cell's right edge. It measures its header cell when a drag starts, so a
 * column that never had a width set starts from where it is drawn.
 */
export function ColumnResizer({
  label,
  width,
  onWidth,
  onDone,
  onReset,
}: {
  /** The column's name, for the grip's label ("Resize Name"). */
  label: string;
  /** The width set, if any. */
  width: number | undefined;
  onWidth: (w: number) => void;
  /** The drag or key press ended: keep this width. */
  onDone: (w: number) => void;
  /** Back to the column's own width. */
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; w: number; frame: number; next: number } | null>(null);
  const [active, setActive] = useState(false);
  const cellWidth = (el: HTMLElement) =>
    el.closest('th')?.getBoundingClientRect().width ?? width ?? COL_MIN;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={width}
      aria-valuemin={COL_MIN}
      aria-valuemax={COL_MAX}
      tabIndex={0}
      title={`Drag to resize ${label}; double-click to reset`}
      data-slot="column-resizer"
      data-active={active || undefined}
      className={cn(
        'absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none rounded-sm outline-none',
        "after:absolute after:inset-y-2 after:right-0.5 after:w-px after:bg-border after:content-['']",
        'hover:after:w-0.5 hover:after:bg-primary data-active:after:w-0.5 data-active:after:bg-primary',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:after:bg-primary',
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const w = cellWidth(e.currentTarget);
        drag.current = { x: e.clientX, w, frame: 0, next: w };
        setActive(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.next = d.w + e.clientX - d.x;
        if (!d.frame)
          d.frame = requestAnimationFrame(() => {
            d.frame = 0;
            onWidth(d.next);
          });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.frame) cancelAnimationFrame(d.frame);
        drag.current = null;
        setActive(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (d.next !== d.w) onDone(d.next);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        if (d?.frame) cancelAnimationFrame(d.frame);
        drag.current = null;
        setActive(false);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          const w = width ?? cellWidth(e.currentTarget);
          onDone(w + (e.key === 'ArrowRight' ? STEP : -STEP));
        } else if (e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          e.stopPropagation();
          onReset();
        }
      }}
    />
  );
}
