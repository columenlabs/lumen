// The shared loading contract.
// Every card and view loads its own data and says so the same way: a skeleton on first load, a thin
// bar while a view's query runs, the old data on screen (dimmed) while a refresh someone asked for
// runs (a poll, refetch on focus or other background refresh is silent: the data just updates in
// place), its own ↻ that
// reloads just its source past the server cache, a failure kept inside it with Retry, and, with
// Settings ▸ Preferences ▸ Observability details on, how long it took. TanStack Query is the engine;
// `useLumenSource` runs one query, `useLumenLoad` reads queries a page already runs, and `LumenStates`
// draws the states. No component draws its own.
import {
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from '@tanstack/react-query';
import { AlertTriangleIcon, CodeIcon, RefreshCwIcon, RotateCcwIcon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { timeZoneLabel, usePrefs } from './prefs';
import { withRefreshToken } from './refresh';
import { Alert, AlertAction, AlertDescription, AlertTitle } from './ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Progress } from './ui/progress';
import { Skeleton } from './ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** One component's loading state, from `useLumenSource` or `useLumenLoad`. */
export interface LumenLoad {
  /** Nothing to show yet: the first load runs, or waits until the card scrolls into view. */
  loading: boolean;
  /** A request is in flight (first load or refresh). */
  fetching: boolean;
  /** A request is in flight while data is on screen. */
  refreshing: boolean;
  /** A background refresh (a poll, refetch on focus) is in flight: silent unless a view shows it. */
  background: boolean;
  /** The load failed and there is nothing to show. */
  error: Error | null;
  /** A refresh failed; the older data stays on screen. */
  stale: Error | null;
  /** Reloads this component's source only, skipping the server cache. */
  refresh: () => Promise<void>;
  /** Reads the source again quietly, through the server cache (a live view's poll). */
  poll?: () => void;
  /** The last load, request start to data, in ms; null before the first. */
  tookMs: number | null;
  /** The data on screen came from this browser's cache, with no request. */
  cached: boolean;
  /** When the data on screen arrived (ms since epoch); null before the first. */
  at: number | null;
  /**
   * When the source itself was last updated, apart from when this browser loaded it (the assistant
   * frame's last run of its script): the card's header shows it as a signal dot, its time and why
   * its last update failed on hover. `live` sources are fresh for 5 minutes,
   * others for the day; `fixed` ones never go stale; `about` is one line on what the source is.
   */
  /**
   * Opens the code that makes this source (the assistant frame's script) to read and edit; the signal dot's
   * popover and the card's ⋯ menu offer it.
   */
  editScript?: () => void;
  updated?: {
    at: number;
    error?: string | null;
    kind?: 'live' | 'asof' | 'fixed';
    about?: string;
  };
  /** What the card's ↻ does, when it is more than a reload (the assistant frame runs its script again). */
  refreshLabel?: string;
}

/** What `useLumenLoad` reads of a TanStack query. */
type QueryState = Pick<
  UseQueryResult<unknown, unknown>,
  'data' | 'error' | 'isError' | 'isFetching' | 'dataUpdatedAt' | 'refetch'
> &
  Partial<Pick<UseQueryResult<unknown, unknown>, 'isPlaceholderData'>>;

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

/** Times each load from the moment a request is in flight to the render that shows its data. */
function useLoadTime(fetching: boolean, updatedAt: number) {
  const start = useRef<number | null>(null);
  const seen = useRef(0);
  const [time, setTime] = useState<{ tookMs: number | null; cached: boolean }>({
    tookMs: null,
    cached: false,
  });
  useEffect(() => {
    if (fetching) {
      start.current ??= performance.now();
      return;
    }
    if (updatedAt && updatedAt !== seen.current) {
      seen.current = updatedAt;
      const t0 = start.current;
      setTime(
        t0 === null
          ? { tookMs: 0, cached: true }
          : { tookMs: performance.now() - t0, cached: false },
      );
    }
    start.current = null;
  }, [fetching, updatedAt]);
  return time;
}

/** The loading state of queries a page already runs (rows built from several reads). */
export function useLumenLoad(...queries: QueryState[]): LumenLoad {
  const latest = useRef(queries);
  latest.current = queries;
  const has = queries.every((q) => q.data !== undefined);
  const failed = queries.find((q) => q.isError);
  const fetching = queries.some((q) => q.isFetching);
  const updatedAt = Math.max(0, ...queries.map((q) => q.dataUpdatedAt));
  const time = useLoadTime(fetching, has ? updatedAt : 0);
  // A ↻ (or the page's Refresh) is the only refresh that shows; a poll or refetch on focus over data
  // already on screen updates it in place with no bar, dimming or spin. New inputs showing the old
  // rows as placeholder still show the bar.
  const [asked, setAsked] = useState(false);
  const refresh = useCallback(async () => {
    setAsked(true);
    try {
      await withRefreshToken(() => Promise.all(latest.current.map((q) => q.refetch())));
    } finally {
      setAsked(false);
    }
  }, []);
  const poll = useCallback(() => {
    for (const q of latest.current) void q.refetch();
  }, []);
  const quiet = has && !asked && !queries.some((q) => q.isPlaceholderData);
  const shown = fetching && !quiet;
  return {
    loading: !has && !failed,
    fetching: shown,
    refreshing: has && shown,
    background: fetching && quiet,
    error: !has && failed ? asError(failed.error) : null,
    stale: has && failed ? asError(failed.error) : null,
    refresh,
    poll,
    tookMs: time.tookMs,
    cached: time.cached,
    at: has && updatedAt ? updatedAt : null,
  };
}

/**
 * Cards that draw one shared source (a view and the widgets over its rows). A card's ↻ still reloads
 * that source, since every card draws the same rows, but only the card that asked spins, dims and
 * shows the new load time; the others keep still with their own last time and take the new rows
 * quietly. A reload no card asked for (the page's Refresh, a refetch) shows on every card. Returns a
 * function giving each card its own load.
 */
export function useCardLoads() {
  const [owner, setOwner] = useState<string | null>(null);
  // When each card's last ↻ ran (ms since epoch): data that landed then is that card's alone.
  const asked = useRef(new Map<string, { from: number; to: number }>());
  // Each card's own load time, kept while another card's refresh is on screen.
  const times = useRef(new Map<string, Pick<LumenLoad, 'tookMs' | 'cached' | 'at'>>());
  return useCallback(
    (id: string, load: LumenLoad | undefined): LumenLoad | undefined => {
      if (!load) return load;
      const shown = owner === null || owner === id;
      const at = load.at;
      const byOther =
        !shown ||
        (at !== null &&
          [...asked.current].some(([card, r]) => card !== id && at >= r.from && at <= r.to));
      const kept = times.current.get(id);
      const time = byOther && kept ? kept : { tookMs: load.tookMs, cached: load.cached, at };
      times.current.set(id, time);
      return {
        ...load,
        ...time,
        fetching: load.fetching && shown,
        refreshing: load.refreshing && shown,
        background: load.background && shown,
        refresh: async () => {
          const from = Date.now();
          setOwner(id);
          try {
            await load.refresh();
          } finally {
            asked.current.set(id, { from, to: Date.now() });
            setOwner(null);
          }
        },
      };
    },
    [owner],
  );
}

/** Runs one source. `lazy` holds the query until the card (`ref`) scrolls into view. */
export function useLumenSource<TQueryFnData, TError, TData, TKey extends QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TKey>,
  { lazy = false }: { lazy?: boolean } = {},
) {
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: '200px', skip: !lazy });
  const query = useQuery({ ...options, enabled: lazy && !inView ? false : options.enabled });
  const load = useLumenLoad(query);
  return { data: query.data, load, ref };
}

/** Mounts `children` once they scroll into view: cards whose data is their own (live market). */
export function LumenLazy({
  children,
  fallback = <Skeleton className="h-40 w-full" />,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: '200px' });
  return <div ref={ref}>{inView ? children : fallback}</div>;
}

/** The thin indeterminate bar along the top of a view while its query runs. */
export function LumenProgress({ load }: { load: LumenLoad }) {
  if (!load.fetching) return null;
  return (
    <Progress
      aria-label="Loading"
      className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 rounded-none bg-transparent"
    />
  );
}

/** ↻ for one card or view: reloads its source past the server cache, spinning while it runs. */
export function LumenRefresh({ load, label = 'Refresh' }: { load: LumenLoad; label?: string }) {
  return (
    <IconButton
      icon={RefreshCwIcon}
      busy={load.fetching}
      label={load.refreshLabel ?? `${label} (skip cache)`}
      disabled={load.fetching}
      onClick={() => void load.refresh()}
    />
  );
}

const SLOW_MS = 2000;

/** The load time line (`1.8 s · 412 rows · 12:41:08 Pacific`), only with Observability details on. */
export function LumenLoadTime({
  load,
  rows,
  className,
}: {
  load: LumenLoad;
  rows?: number;
  className?: string;
}) {
  const { observability, timeZone } = usePrefs();
  if (!observability || load.tookMs === null) return null;
  const when =
    load.at === null
      ? ''
      : new Intl.DateTimeFormat('en-US', {
          timeZone,
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        }).format(load.at);
  // Whole ms under a second, seconds with one decimal from there.
  const took =
    load.tookMs < 1000 ? `${Math.round(load.tookMs)} ms` : `${(load.tookMs / 1000).toFixed(1)} s`;
  const count = rows === undefined ? null : `${rows.toLocaleString('en-US')} rows`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-slot="lumen-load-time"
          className={cn(
            'num flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground',
            className,
          )}
        >
          <span className={cn(load.tookMs > SLOW_MS ? 'text-loss' : 'text-gain')}>
            {load.cached ? 'cache' : took}
          </span>
          {count && <span>· {count}</span>}
          {load.refreshing && <span>· refreshing…</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {load.cached
          ? "From this browser's cache, no request"
          : `Loaded in ${took}${load.tookMs > SLOW_MS ? ', slow (over 2 s)' : ''}`}
        {when && ` at ${when} ${timeZoneLabel(timeZone)}`}
        {count && ` · ${count}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** A failed source, inside its own card, with Retry. */
export function LumenError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>Could not load</AlertTitle>
      <AlertDescription className="num text-xs break-words">{error.message}</AlertDescription>
      {onRetry && (
        <AlertAction>
          <IconButton icon={RotateCcwIcon} label="Retry" variant="outline" onClick={onRetry} />
        </AlertAction>
      )}
    </Alert>
  );
}

/** Rows of skeleton the height of a table, so nothing jumps when the data lands. */
export function LumenSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={cn('flex flex-col gap-2 p-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/** One component's states from its load: bar (views), skeleton, error with Retry, empty, then the
 *  content, dimmed while it refreshes. Place it at the top of a `relative` card body. */
export function LumenStates({
  load,
  kind = 'table',
  skeleton,
  empty,
  children,
}: {
  load: LumenLoad;
  /** Views (tables, grids) carry the progress bar; widgets a skeleton and their spinning ↻. */
  kind?: 'table' | 'widget';
  skeleton?: ReactNode;
  /** Shown in place of the content when the source loaded nothing. */
  empty?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {kind === 'table' && <LumenProgress load={load} />}
      {load.error ? (
        <div className="p-3">
          <LumenError error={load.error} onRetry={() => void load.refresh()} />
        </div>
      ) : load.loading ? (
        (skeleton ?? (kind === 'table' ? <LumenSkeleton /> : <Skeleton className="h-40 w-full" />))
      ) : empty ? (
        empty
      ) : (
        <div
          className={cn('contents [&>*]:transition-opacity', load.refreshing && '[&>*]:opacity-70')}
        >
          {children}
        </div>
      )}
    </>
  );
}

/** A card's footer line with its load time, rows and clock time, only with Observability details on. */
export function LumenLoadFooter({
  load,
  rows,
  note,
}: {
  load: LumenLoad;
  rows?: number;
  /** Said instead of rows, e.g. a chart drawn from its view's rows. */
  note?: string;
}) {
  const { observability, timeZone } = usePrefs();
  if (!observability || load.tookMs === null) return null;
  return (
    <div data-slot="lumen-load-footer" className="shrink-0 border-t border-dashed">
      <LumenLoadTimeLine load={load} rows={rows} note={note} timeZone={timeZone} />
    </div>
  );
}

const FRESH_LIVE_MS = 5 * 60_000;

/** How often a view showing live columns reads its source again while the market trades. */
export const LIVE_POLL_MS = 60_000;

/**
 * When US stocks trade at all: pre-market, the session, after-hours and the
 * overnight session run from 8:00 PM New York on Sunday to 8:00 PM on Friday (holidays not known here).
 */
export function marketTrades(at = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const evening = Number(p.hour) >= 20;
  if (p.weekday === 'Sat') return false;
  if (p.weekday === 'Sun') return evening;
  return p.weekday !== 'Fri' || !evening;
}

/**
 * A view's load while it shows live columns (#861): while the market trades and
 * the tab shows, it reads its source again every minute, quietly, and the card's header carries the
 * green signal dot (Live, with when it last updated). Extended hours and overnight poll too (the
 * app's feed decides whether prices move then); over the weekend nothing polls.
 */
export function useLiveLoad(load: LumenLoad | undefined, live: boolean): LumenLoad | undefined {
  const [open, setOpen] = useState(() => marketTrades());
  const poll = load?.poll;
  const on = live && open && !!poll;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setOpen(marketTrades()), 30_000);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => {
    if (!on || !poll) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, LIVE_POLL_MS);
    return () => clearInterval(t);
  }, [on, poll]);
  if (!load || !on || load.updated || load.at === null) return load;
  return {
    ...load,
    updated: {
      at: load.at,
      kind: 'live',
      about: 'Live columns update every minute, extended hours included',
    },
  };
}

/** How long ago, in words: `just now`, `3 min ago`, `2 h ago`, `4 d ago`. */
function ago(ms: number) {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/**
 * The card header's signal dot for a source with its own update time (`load.updated`): green while
 * fresh, amber once stale (worth a ↻), red when its last update failed, grey for data that never
 * updates; hover (a tap on phone) says when, what and why.
 */
export function LumenFreshness({ load }: { load: LumenLoad }) {
  const { timeZone } = usePrefs();
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const u = load.updated;
  if (!u) return null;
  const kind = u.kind ?? 'asof';
  const age = now - u.at;
  const sameDay = (a: number, b: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'short' }).format(a) ===
    new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'short' }).format(b);
  const state = u.error
    ? 'failed'
    : kind === 'fixed'
      ? 'fixed'
      : (kind === 'live' ? age < FRESH_LIVE_MS : sameDay(u.at, now))
        ? 'fresh'
        : 'stale';
  const dot = {
    fresh: 'bg-gain',
    stale: 'bg-amber-500',
    failed: 'bg-loss',
    fixed: 'bg-muted-foreground/50',
  }[state];
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(u.at);
  const label = {
    fresh: 'Up to date',
    stale: 'Not updated recently',
    failed: 'Last update failed',
    fixed: 'Does not update',
  }[state];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="lumen-freshness"
          aria-label={`${label}: updated ${when}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <span className={cn('size-2 rounded-full', dot)} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 space-y-1 p-3 text-xs"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <span className={cn('size-2 rounded-full', dot)} />
          {label}
        </div>
        <div className="num text-muted-foreground">
          Updated {when} ({ago(age)})
        </div>
        {u.about && <div className="text-muted-foreground">{u.about}</div>}
        {u.error && <div className="break-words text-loss">{u.error}</div>}
        {kind !== 'fixed' && load.refreshLabel && (
          <div className="text-muted-foreground">↻ {load.refreshLabel}</div>
        )}
        {load.editScript && (
          <IconButton
            icon={CodeIcon}
            label="See and edit the script"
            variant="outline"
            onClick={() => {
              setOpen(false);
              load.editScript?.();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The Observability line of the footer: load time, rows or a note, and the clock time. */
function LumenLoadTimeLine({
  load,
  rows,
  note,
  timeZone,
}: {
  load: LumenLoad;
  rows?: number;
  note?: string;
  timeZone: string;
}) {
  return (
    <div className="flex h-7 items-center gap-2 overflow-hidden px-3">
      <LumenLoadTime load={load} rows={note ? undefined : rows} />
      {note && <span className="truncate text-xs text-muted-foreground">· {note}</span>}
      {load.at !== null && (
        <span className="num ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          }).format(load.at)}
        </span>
      )}
    </div>
  );
}
