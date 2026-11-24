// A section whose body cannot be drawn before its read answers (it is built from the data).
// While the read runs it draws the shape the section had last time on this device: its field rows
// and expand rows in their order, each a bar, so nothing reads as empty and nothing jumps when the
// data lands. A failed read shows the kit's error with Retry. See docs/parts/loading.md.
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { ExpandRowSkeleton } from './expand-list';
import { LoadingBar, LumenLoading } from './loading';
import { LumenError, type LumenLoad } from './lumen-source';

const shapeKey = (id: string) => `lumen:shape:${id}`;
/** The first visit's guess: three field rows. */
const FIRST = 'fff';

function readShape(id: string) {
  try {
    const s = localStorage.getItem(shapeKey(id));
    return s && /^[fr]{1,30}$/.test(s) ? s : FIRST;
  } catch {
    return FIRST;
  }
}

/** One `SettingField` while it loads: a label bar and a control bar, the field's own height. */
export function SettingFieldSkeleton() {
  return (
    <div
      data-slot="setting-field-skeleton"
      aria-hidden="true"
      className="flex min-h-10 min-w-0 items-center gap-3 border-t border-border/60 py-1.5 first:border-t-0"
    >
      <LoadingBar className="w-24" />
      <LoadingBar className="ml-auto h-8 w-full max-w-56" />
    </div>
  );
}

/**
 * Draws `children(data)` once `load` has answered; until then the section's last shape as bars
 * (kept per device under `id`). `children` is only called with data, so the section never draws
 * its empty or "not set up" state for a read still running.
 */
export function LumenPending<T>({
  id,
  load,
  data,
  shape: fixed,
  children,
}: {
  /** Names the section, so its skeleton keeps its shape across visits. */
  id: string;
  /** The shape when the caller knows it: `f` a field row, `r` an expand row, in order ("rr"). */
  shape?: string;
  load: LumenLoad;
  data: T | undefined;
  children: (data: T) => ReactNode;
}) {
  const [kept] = useState(() => readShape(id));
  const shape = fixed ?? kept;
  const box = useRef<HTMLDivElement>(null);
  const ready = data !== undefined;
  // Once drawn, keep the order of its field rows (f) and expand rows (r) for the next visit.
  useLayoutEffect(() => {
    const el = box.current;
    if (!ready || !el) return;
    const seen = [
      ...el.querySelectorAll<HTMLElement>('[data-slot=setting-field], [data-slot=collapsible]'),
    ].filter((n) => !n.parentElement?.closest('[data-slot=collapsible]'));
    const next = seen
      .map((n) => (n.dataset.slot === 'collapsible' ? 'r' : 'f'))
      .join('')
      .slice(0, 30);
    try {
      if (next) localStorage.setItem(shapeKey(id), next);
      else localStorage.removeItem(shapeKey(id));
    } catch {
      // A blocked store keeps the first visit's guess.
    }
  });
  if (load.error && !ready)
    return <LumenError error={load.error} onRetry={() => void load.refresh()} />;
  if (!ready)
    return (
      <LumenLoading loading>
        <div className="grid grid-cols-1">
          {[...shape].map((k, i) =>
            k === 'r' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows in the kept order
              <ExpandRowSkeleton key={i} />
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows in the kept order
              <SettingFieldSkeleton key={i} />
            ),
          )}
        </div>
      </LumenLoading>
    );
  return (
    <div ref={box} className="contents">
      {children(data)}
    </div>
  );
}
