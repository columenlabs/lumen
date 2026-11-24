// Loading drawn as the thing itself, never as nothing.
// A screen whose data is still on its way wraps its parts in `LumenLoading` with the reads they
// draw from (`useLumenLoad`). Inside it every data part draws its own shape with bars in its slots:
// a settings row keeps its row, a field its label, a tile its label, a table its header and rows.
// Nothing is empty until a read has answered empty: no empty state, no Add, no count and no
// "not set up" while a read runs. A failed read shows the kit's error with Retry in the scope's
// place. Parts read the scope with `useLumenLoading()`; a new part does the same, and draws a
// `LoadingBar` in each slot it would fill from data. See docs/parts/loading.md.
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { cn } from './lib/utils';
import { LumenError, type LumenLoad } from './lumen-source';
import { Skeleton } from './ui/skeleton';

const LoadingCtx = createContext<LumenLoad | null>(null);

/** The load of the nearest `LumenLoading`, or null outside one. */
export function useLumenScopeLoad(): LumenLoad | null {
  return useContext(LoadingCtx);
}

/** True while the nearest `LumenLoading` has nothing to show yet: draw bars, not data or empties. */
export function useLumenLoading(): boolean {
  return useContext(LoadingCtx)?.loading ?? false;
}

/**
 * Wraps the parts a screen draws from its reads. While `load` is loading, every part inside draws
 * its own shape with bars; when it fails, the kit's error with Retry takes the scope's place; once
 * it answers, the parts draw their data. `loading` alone (no `load`) marks a scope by hand.
 */
export function LumenLoading({
  load,
  loading,
  className,
  children,
}: {
  load?: LumenLoad;
  loading?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const value: LumenLoad | null = load
    ? loading === undefined
      ? load
      : { ...load, loading: load.loading || loading }
    : loading
      ? HAND_LOADING
      : null;
  if (load?.error)
    return (
      <div className={className}>
        <LumenError error={load.error} onRetry={() => void load.refresh()} />
      </div>
    );
  const busy = value?.loading;
  return (
    <LoadingCtx.Provider value={value}>
      {className || busy ? (
        <div className={cn(className)} aria-busy={busy || undefined}>
          {children}
        </div>
      ) : (
        children
      )}
    </LoadingCtx.Provider>
  );
}

const HAND_LOADING: LumenLoad = {
  loading: true,
  fetching: true,
  refreshing: false,
  background: false,
  error: null,
  stale: null,
  refresh: async () => {},
  tookMs: null,
  cached: false,
  at: null,
};

/** One slot's placeholder: a bar the height of a line of text. Give it the slot's width. */
export function LoadingBar({ className }: { className?: string }) {
  return <Skeleton aria-hidden="true" className={cn('h-4 w-24 max-w-full rounded', className)} />;
}

const countKey = (id: string) => `lumen:rows:${id}`;

/**
 * How many rows a list showed last time, kept per device under `id`, so its skeleton draws as
 * many rows as the list will (`fallback` before the first visit). Pass the list's row count once
 * it has loaded; while `loading`, it returns the remembered count.
 */
export function useRememberedCount(
  id: string | undefined,
  count: number,
  loading: boolean,
  fallback = 3,
): number {
  const [kept, setKept] = useState(() => {
    if (!id) return fallback;
    try {
      const saved = localStorage.getItem(countKey(id));
      const n = Number(saved);
      // An empty list last time draws one row: the line its empty state takes.
      return saved !== null && Number.isFinite(n) ? Math.min(Math.max(n, 1), 20) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    if (!id || loading) return;
    setKept(Math.min(Math.max(count, 1), 20));
    try {
      localStorage.setItem(countKey(id), String(count));
    } catch {
      // A blocked store keeps the fallback.
    }
  }, [id, count, loading]);
  return loading ? kept : count;
}
