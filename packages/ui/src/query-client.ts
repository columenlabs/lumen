// One data cache rule for every app (switching tabs must not fetch again).
// A page's queries stay fresh for 5 minutes and stay in memory for 30, so a tab or page opened
// again shows what it had without a request. Data changes reach the cache another way: a save
// invalidates its keys, a running job polls (`refetchInterval`) until it ends, an ended Task
// invalidates everything (tasks.tsx), and the header's Refresh refetches the page.
//
// With `persist`, the cache also outlives the page: what the last visit read (within a day) is
// shown at once on the next load or in another app of the same site, and anything older than
// `staleTime` is read again in the background. Signing out (`[data-sign-out]`) clears it. A query
// with `meta: { persist: false }` is never written.

import {
  type DehydratedState,
  QueryClient,
  type QueryClientConfig,
  dehydrate,
  hydrate,
} from '@tanstack/react-query';

type Retry = NonNullable<NonNullable<QueryClientConfig['defaultOptions']>['queries']>['retry'];

export interface PersistOptions {
  /** The storage key; one per app (`career`), so apps never read each other's shapes. */
  key: string;
  /** Changes when stored shapes would no longer fit; a mismatch drops them. Defaults to the
   *  page's entry script address, which has a new hash on every build. */
  buster?: string;
  /** Oldest data shown at load, in ms (a day by default). */
  maxAge?: number;
}

const PREFIX = 'lumen-cache:';
const DAY = 24 * 60 * 60_000;
/** Above this a write is skipped rather than filling the origin's storage. */
const MAX_BYTES = 2_000_000;

/** The app's one QueryClient; `retry` is the app's own rule for failed requests. */
export function createDeskQueryClient({
  retry,
  persist,
}: { retry?: Retry; persist?: PersistOptions } = {}): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: retry ?? 1,
        refetchOnWindowFocus: false,
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
      },
    },
  });
  if (persist) persistQueries(qc, persist);
  return qc;
}

/** Signing out anywhere on the site forgets every app's stored reads. */
export function clearPersistedQueries() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {}
}

interface Stored {
  at: number;
  buster: string;
  state: DehydratedState;
}

function persistQueries(
  qc: QueryClient,
  { key, buster = entryScript(), maxAge = DAY }: PersistOptions,
) {
  if (typeof window === 'undefined') return;
  const storageKey = PREFIX + key;
  try {
    const raw = localStorage.getItem(storageKey);
    const stored = raw ? (JSON.parse(raw) as Stored) : null;
    if (stored && stored.buster === buster && Date.now() - stored.at < maxAge) {
      hydrate(qc, stored.state);
    } else if (raw) {
      localStorage.removeItem(storageKey);
    }
  } catch {
    clearKey(storageKey);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let off = false;
  const save = () => {
    timer = undefined;
    if (off) return;
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (q) =>
          q.state.status === 'success' &&
          (q.meta as { persist?: boolean } | undefined)?.persist !== false,
      });
      const text = JSON.stringify({ at: Date.now(), buster, state } satisfies Stored);
      if (text.length > MAX_BYTES) return;
      localStorage.setItem(storageKey, text);
    } catch {}
  };
  // One write a second at most, and one more when the tab is hidden (a reload or another app).
  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' && e.type !== 'removed') return;
    if (!timer && !off) timer = setTimeout(save, 1000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element | null)?.closest?.('[data-sign-out]')) {
        off = true;
        clearPersistedQueries();
      }
    },
    true,
  );
}

function entryScript(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '';
}

function clearKey(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {}
}
