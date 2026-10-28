// The status bar's model: what is true right now, at a glance, that nobody has to act on
// (DESIGN.md, Status bar). A banner is for what must be acted on, a toast for what someone just
// did, a badge for one row or card. Apps and pages pass data, never JSX; the bar draws five slots
// in a fixed order: Sync · Work · Message · Page facts · End (health, What's new, time zone).
// On a phone it shows the one most urgent item and a chip that opens the rest in a sheet, so a
// row never scrolls sideways. Nothing here waits: it draws from what the page already holds.
import { isActive } from '@columenlabs/lumen-ui-types/tasks';
import { InfoIcon } from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import {
  STATUS_TRIGGER,
  type StatusMessage,
  StatusMessages,
  StatusPop,
  groupStatusMessages,
} from './status-messages';
import { useTasks } from './tasks';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';

/** How fresh the page's data is: up to date, reading now, an old copy, no network, or failed. */
export type StatusSyncState = 'ok' | 'syncing' | 'stale' | 'offline' | 'failed';

export interface StatusSync {
  state: StatusSyncState;
  /** What it syncs with (`Bank feed`); left out, the line reads "Updated 3m ago". */
  label?: string;
  /** When the data shown was last read (ms or ISO); null when never. */
  at?: number | string | null;
  /** Progress of a sync that counts (`40` of `112`). */
  done?: number | null;
  total?: number | null;
  /** More on hover or tap (why it failed). */
  note?: string;
}

/** A fact this page has nowhere else to show (`Next run in 12m`): plain data, at most two. */
export interface StatusFact {
  label: string;
  value?: string | number;
  /** A time shown as `in 12m` or `3m ago` after the value, kept current. */
  at?: number | string | null;
  /** Green when true, red when false, grey while unknown; no dot when left out. */
  ok?: boolean | null;
}

/** What a page (or any part) adds to the bar through `useStatus`. */
export interface StatusPart {
  sync?: StatusSync | null;
  /** Newest first. */
  messages?: StatusMessage[];
  facts?: StatusFact[];
}

/** The app's own bar on `LumenShell` (`bar`): its sync and messages, and whether running Tasks show. */
export interface StatusBarModel {
  sync?: StatusSync | null;
  messages?: StatusMessage[];
  /** Shows this app's running task from the Tasks list (default true where Tasks is mounted). */
  work?: boolean;
}

const MAX_FACTS = 2;

interface Registry {
  set: (id: string, part: StatusPart | null) => void;
}
const RegistryCtx = createContext<Registry | null>(null);
const PartsCtx = createContext<StatusPart[]>([]);

/** Holds every part posted with `useStatus`; the shell mounts it around the page and the bar. */
export function StatusBarProvider({ children }: { children: ReactNode }) {
  const [parts, setParts] = useState<Map<string, StatusPart>>(() => new Map());
  const set = useCallback((id: string, part: StatusPart | null) => {
    setParts((prev) => {
      const next = new Map(prev);
      if (part) next.set(id, part);
      else next.delete(id);
      return next;
    });
  }, []);
  const registry = useMemo(() => ({ set }), [set]);
  const list = useMemo(() => [...parts.values()], [parts]);
  return (
    <RegistryCtx.Provider value={registry}>
      <PartsCtx.Provider value={list}>{children}</PartsCtx.Provider>
    </RegistryCtx.Provider>
  );
}

/**
 * Adds this page's sync, messages and facts to the status bar while it is mounted. Plain data
 * only; the newest part's sync wins over the app's, messages add up, the first two facts show.
 */
export function useStatus(part: StatusPart) {
  const registry = useContext(RegistryCtx);
  const id = useId();
  const key = JSON.stringify(part);
  useEffect(() => {
    if (!registry) return;
    registry.set(id, JSON.parse(key) as StatusPart);
    return () => registry.set(id, null);
  }, [registry, id, key]);
}

/** A TanStack Query result's freshness as a `StatusSync`: the page's main read, with no app code. */
export function querySync(
  q: {
    status: 'pending' | 'error' | 'success';
    fetchStatus: 'fetching' | 'paused' | 'idle';
    dataUpdatedAt: number;
    error?: unknown;
  },
  label?: string,
): StatusSync {
  const at = q.dataUpdatedAt || null;
  if (q.fetchStatus === 'paused') return { state: 'offline', label, at };
  if (q.fetchStatus === 'fetching') return { state: 'syncing', label, at };
  if (q.status === 'error') {
    const note = q.error instanceof Error ? q.error.message : undefined;
    return { state: at ? 'stale' : 'failed', label, at, note };
  }
  return { state: q.status === 'success' ? 'ok' : 'syncing', label, at };
}

const toMs = (at: number | string | null | undefined) =>
  at == null ? null : typeof at === 'number' ? at : Date.parse(at) || null;

/** `just now`, `3m ago`, `in 12m`, `2h ago`, `3d ago`. */
export function statusWhen(at: number | string | null | undefined, now = Date.now()): string {
  const ms = toMs(at);
  if (ms === null) return '—';
  const d = ms - now;
  const abs = Math.abs(d);
  if (abs < 45_000) return 'just now';
  const n =
    abs < 3_600_000
      ? `${Math.round(abs / 60_000)}m`
      : abs < 86_400_000
        ? `${Math.round(abs / 3_600_000)}h`
        : `${Math.round(abs / 86_400_000)}d`;
  return d > 0 ? `in ${n}` : `${n} ago`;
}

/** The clock relative times read, ticking every 30 s only while the tab shows. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), 30_000);
    };
    const stop = () => clearInterval(timer);
    const onVis = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return now;
}

type Tone = 'ok' | 'busy' | 'warning' | 'error' | 'none' | 'idle';

function Mark({ tone }: { tone: Tone }) {
  if (tone === 'none') return null;
  if (tone === 'busy')
    return (
      <span
        aria-hidden
        className="size-2.5 shrink-0 animate-spin rounded-full border-2 border-primary border-r-transparent motion-reduce:animate-none"
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 shrink-0 rounded-full',
        tone === 'ok' && 'bg-gain',
        tone === 'warning' && 'bg-warning',
        tone === 'error' && 'bg-destructive',
        tone === 'idle' && 'bg-muted-foreground/40',
      )}
    />
  );
}

const TONE_TEXT: Partial<Record<Tone, string>> = {
  warning: 'text-warning',
  error: 'text-destructive',
};

/** One entry of the bar: its urgency (lower first on a phone) and how it reads. */
interface Entry {
  id: string;
  rank: number;
  tone: Tone;
  text: string;
  /** The right side of its sheet row (`40%`, `3m ago`). */
  side?: string;
  /** More on hover or tap. */
  detail?: string;
  /** Desktop's own drawing, when it is more than a line (the message stack). */
  bar?: ReactNode;
}

function syncEntry(s: StatusSync, now: number): Entry {
  const when = statusWhen(s.at, now);
  const count =
    s.done != null && s.total ? `${s.done.toLocaleString()} of ${s.total.toLocaleString()}` : '';
  const base = { id: 'sync', detail: s.note };
  switch (s.state) {
    case 'syncing':
      return {
        ...base,
        rank: 5,
        tone: 'busy',
        text: s.label ? `Syncing ${s.label}` : 'Updating',
        side: count || undefined,
      };
    case 'stale':
      return { ...base, rank: 3, tone: 'warning', text: 'Saved copy', side: when };
    case 'offline':
      return { ...base, rank: 3, tone: 'warning', text: 'Offline · saved copy', side: when };
    case 'failed':
      return {
        ...base,
        rank: 1,
        tone: 'error',
        text: s.label ? `${s.label} did not update` : 'Did not update',
      };
    default:
      return {
        ...base,
        rank: 8,
        tone: 'ok',
        text: s.label ? `${s.label} synced` : 'Updated',
        side: when,
      };
  }
}

function factEntry(f: StatusFact, i: number, now: number): Entry {
  const when = f.at != null ? statusWhen(f.at, now) : '';
  const value = [f.value, when].filter((v) => v !== undefined && v !== '').join(' ');
  return {
    id: `fact:${i}`,
    rank: 6,
    tone: f.ok === undefined ? 'none' : f.ok === null ? 'idle' : f.ok ? 'ok' : 'error',
    text: f.label,
    side: value || undefined,
  };
}

/** Builds the bar's entries from the app's model and every posted part. */
function useEntries(model: StatusBarModel | undefined, app: string): Entry[] {
  const parts = useContext(PartsCtx);
  const tasks = useTasks();
  const now = useNow();
  const entries: Entry[] = [];

  const sync = [...parts].reverse().find((p) => p.sync)?.sync ?? model?.sync ?? null;
  if (sync) entries.push(syncEntry(sync, now));

  if (model?.work !== false && tasks?.list) {
    const mine = tasks.list.tasks.filter((t) => isActive(t) && (t.app === app || !t.app));
    const t = mine[0];
    if (t) {
      const share = t.total ? Math.round(((t.done ?? 0) / t.total) * 100) : null;
      entries.push({
        id: 'work',
        rank: 4,
        tone: 'busy',
        text: mine.length > 1 ? `${t.title} +${mine.length - 1}` : t.title,
        side:
          share !== null
            ? `${share}%`
            : t.done != null
              ? `${t.done.toLocaleString()} ${t.unit ?? ''}`.trim()
              : undefined,
      });
    }
  }

  const messages = [...parts.flatMap((p) => p.messages ?? []), ...(model?.messages ?? [])];
  const groups = groupStatusMessages(messages);
  const top = groups[0];
  if (top) {
    const tone: Tone = top.tone === 'error' ? 'error' : top.tone === 'warning' ? 'warning' : 'none';
    entries.push({
      id: 'messages',
      rank: tone === 'error' ? 0 : tone === 'warning' ? 2 : 7,
      tone,
      text: top.count > 1 ? `${top.text} ×${top.count}` : top.text,
      side: groups.length > 1 ? `+${groups.length - 1}` : undefined,
      bar: <StatusMessages messages={messages} />,
    });
  }

  parts
    .flatMap((p) => p.facts ?? [])
    .slice(0, MAX_FACTS)
    .forEach((f, i) => entries.push(factEntry(f, i, now)));
  return entries;
}

function EntryLine({ e }: { e: Entry }) {
  if (e.bar) return <>{e.bar}</>;
  const line = (
    <>
      <Mark tone={e.tone} />
      <span className={cn('min-w-0 truncate', TONE_TEXT[e.tone])}>{e.text}</span>
      {e.side && <span className="shrink-0 tabular-nums text-foreground/80">{e.side}</span>}
    </>
  );
  if (!e.detail)
    return <span className="flex h-6 min-w-0 items-center gap-1.5 px-1.5">{line}</span>;
  return (
    <StatusPop
      className={cn(STATUS_TRIGGER, 'min-w-0')}
      content={<p className={TONE_TEXT[e.tone]}>{e.detail}</p>}
    >
      {line}
    </StatusPop>
  );
}

function SheetRow({ e }: { e: Entry }) {
  return (
    <li className="flex items-start gap-2 border-b py-2 last:border-b-0">
      <span className="flex h-5 items-center">
        <Mark tone={e.tone === 'none' ? 'idle' : e.tone} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('break-words', TONE_TEXT[e.tone])}>{e.text}</span>
        {e.detail && <span className="block text-muted-foreground">{e.detail}</span>}
      </span>
      {e.side && <span className="shrink-0 tabular-nums text-muted-foreground">{e.side}</span>}
    </li>
  );
}

/** The bar itself; `LumenShell` renders it. */
export function LumenStatusBar({
  app,
  model,
  legacy,
  slot,
  end,
}: {
  app: string;
  model?: StatusBarModel;
  /** Items from the old `status` prop and pages' `status` (desktop only). */
  legacy?: ReactNode;
  /** The pages' old portal slot. */
  slot: (el: HTMLElement | null) => void;
  /** Health, What's new, the app's end items and the time zone, in that order. */
  end: ReactNode;
}) {
  const mobile = useIsMobile();
  const entries = useEntries(model, app);
  const [open, setOpen] = useState(false);
  const urgent = [...entries].sort((a, b) => a.rank - b.rank)[0];

  return (
    <footer
      data-slot="shell-status"
      aria-label="Status"
      className="sticky bottom-0 z-10 flex h-(--shell-status-height) shrink-0 items-center gap-3 overflow-hidden border-t bg-background px-(--shell-gutter) text-xs whitespace-nowrap text-muted-foreground"
    >
      {mobile ? (
        <>
          {urgent && (
            <span aria-live="polite" className="flex min-w-0 items-center">
              <EntryLine e={{ ...urgent, bar: undefined, detail: undefined }} />
            </span>
          )}
          {/* The pages' old slot stays mounted for their portals, and hidden on a phone. */}
          <div ref={slot} hidden />
          {entries.length > 0 ? (
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                className={cn(STATUS_TRIGGER, 'num ml-auto shrink-0 border text-foreground/80')}
                aria-label={`Status, ${entries.length} items`}
              >
                <InfoIcon className="size-3.5" />
                {entries.length}
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="max-h-[75svh] gap-0 rounded-t-2xl p-0 text-sm"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <SheetHeader className="border-b px-4 py-3">
                  <SheetTitle>Status</SheetTitle>
                  <SheetDescription className="sr-only">What is true right now</SheetDescription>
                </SheetHeader>
                <ul className="overflow-y-auto px-4">
                  {[...entries]
                    .sort((a, b) => a.rank - b.rank)
                    .map((e) => (
                      <SheetRow key={e.id} e={e} />
                    ))}
                </ul>
                <div className="flex items-center justify-end gap-1 border-t px-4 py-2 text-xs text-muted-foreground">
                  {end}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <span className="ml-auto flex shrink-0 items-center gap-1">{end}</span>
          )}
        </>
      ) : (
        <>
          <span aria-live="polite" className="flex min-w-0 items-center gap-3">
            {entries.map((e) => (
              <EntryLine key={e.id} e={e} />
            ))}
          </span>
          {legacy}
          <div ref={slot} className="flex shrink-0 items-center gap-4" />
          <span className="ml-auto flex shrink-0 items-center gap-1">{end}</span>
        </>
      )}
    </footer>
  );
}
