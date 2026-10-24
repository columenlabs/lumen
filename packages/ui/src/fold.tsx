// Folded section headers (option B): a header someone folds stays folded in
// their browser. Sidebar sections fold across the app; cards and the groups inside them fold per
// page (the route, so every symbol page shares one choice). One localStorage list per app host;
// nothing is stored server-side, and a browser that refuses storage simply starts everything open.
import { useRouterState } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';
import { cn } from './lib/utils';
import { Button } from './ui/button';

const KEY = 'edgeshell:folded';
const listeners = new Set<() => void>();
let cache: Set<string> | null = null;

function read(): Set<string> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    cache = new Set(
      Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [],
    );
  } catch {
    cache = new Set();
  }
  return cache;
}

function write(key: string, folded: boolean) {
  const next = new Set(read());
  if (folded) next.add(key);
  else next.delete(key);
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // Storage refused (private window, blocked site data): the fold still holds until reload.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether the header `key` is folded, and a setter that remembers it. */
export function useFolded(key: string): [boolean, (folded: boolean) => void] {
  const folded = useSyncExternalStore(
    subscribe,
    () => read().has(key),
    () => false,
  );
  const set = useCallback((f: boolean) => write(key, f), [key]);
  return [folded, set];
}

/** Every folded key at once, for headers drawn in a loop (a map's groups), and the setter. */
export function useFolds(): [Set<string>, (key: string, folded: boolean) => void] {
  const folds = useSyncExternalStore(subscribe, read, () => EMPTY);
  return [folds, write];
}
const EMPTY = new Set<string>();

/** The page's route (`/market/$symbol`), so a fold on one page holds for all its params. */
export function usePageKey(): string {
  return useRouterState({
    select: (s): string => String(s.matches.at(-1)?.routeId ?? s.location.pathname),
  });
}

/**
 * The chevron after a foldable header's name, always shown: it alone folds the header
 *, so a click elsewhere on a header never folds it.
 */
export function FoldChevron({
  folded,
  label,
  onToggle,
  className,
}: {
  folded: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-expanded={!folded}
      aria-label={`${folded ? 'Expand' : 'Collapse'} ${label}`}
      onClick={onToggle}
      className={cn('shrink-0 text-muted-foreground', className)}
    >
      <ChevronRightIcon className={cn('transition-transform', !folded && 'rotate-90')} />
    </Button>
  );
}
