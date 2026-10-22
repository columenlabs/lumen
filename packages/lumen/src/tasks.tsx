import type { Task, TaskList } from '@columenlabs/lumen-ui-types/tasks';
import { isActive } from '@columenlabs/lumen-ui-types/tasks';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
  ArrowUpRightIcon,
  BrushCleaningIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  Clock3Icon,
  ListChecksIcon,
  XIcon,
} from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
// Tasks (in Lumen for
// every app): long work a person started on any of the product's apps (a Sweep, a
// backfill, a sync, a Search) in one list. The header button sits left of the assistant: a ring while anything runs, the count, and a gold dot when something
// ended unseen. It opens a popover on desktop and a bottom sheet on phone with the last 7 days;
// opening it marks the ended ones seen. ✕ clears one ended task, the brush every ended one
//. A task that ends while the page is open shows a toast with
// Open. The list polls one cheap read every 3 s only while something runs and the tab is visible;
// otherwise it reads again on focus. The product mounts `TasksProvider` and `TasksButton` in the
// shell's slots; where the API answers 404 nothing shows.
import { LumenConfirm } from './confirm';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import { IconButton } from './page';
import { useShell } from './shell';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Progress } from './ui/progress';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export interface TasksConfig {
  /** The app's Tasks API base, e.g. `/api/tasks`. */
  api: string;
  /** Each app's short name by its id, for a product whose tasks come from several apps: each row
   *  then names its app. Left out, rows name none. */
  apps?: Record<string, string>;
}

interface TasksState {
  list: TaskList | null;
  refresh: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
  seen: () => Promise<void>;
  /** Deletes one ended task, or every ended one; open tasks stay. */
  clear: (id?: string) => Promise<void>;
  open: (t: Task) => void;
  /** `TasksConfig.apps`. */
  apps?: Record<string, string>;
}

const TasksCtx = createContext<TasksState | null>(null);

/** The Tasks list, or null where the app has none; `refresh()` after starting one shows it at once. */
export function useTasks(): TasksState | null {
  return useContext(TasksCtx);
}

const POLL_MS = 3000;

export function TasksProvider({ config, children }: { config?: TasksConfig; children: ReactNode }) {
  if (!config) return children;
  return (
    <TasksLive api={config.api} apps={config.apps}>
      {children}
    </TasksLive>
  );
}

function TasksLive({
  api,
  apps,
  children,
}: { api: string; apps?: Record<string, string>; children: ReactNode }) {
  const [list, setList] = useState<TaskList | null>(null);
  const [gone, setGone] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const shell = useShell();
  // What was active at the last read, so a task that ends while the page is open gets a toast.
  const activeIds = useRef<Set<string> | null>(null);

  const open = useCallback(
    (t: Task) => {
      if (!t.link) return;
      const url = new URL(t.link, window.location.href);
      if (url.origin !== window.location.origin) {
        window.location.assign(url.href);
        return;
      }
      const section = url.searchParams.get('settings');
      if (section !== null) {
        shell.openSettings(section || undefined);
        return;
      }
      const base = (router.options.basepath ?? '/').replace(/\/$/, '');
      const path =
        base && url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
      void router.navigate({ href: `${path || '/'}${url.search}${url.hash}` } as never);
    },
    [router, shell],
  );

  const refresh = useCallback(async () => {
    const res = await fetch(api, { headers: { accept: 'application/json' } }).catch(() => null);
    if (!res) return;
    if (res.status === 404) {
      setGone(true);
      return;
    }
    if (!res.ok) return;
    const next = (await res.json()) as TaskList;
    const before = activeIds.current;
    if (before) {
      const ended = next.tasks.filter((t) => before.has(t.id) && !isActive(t));
      for (const t of ended) endedToast(t, open);
      // A task's results are new data: drop the cache once (query-client.ts).
      if (ended.length) void qc.invalidateQueries();
    }
    activeIds.current = new Set(next.tasks.filter(isActive).map((t) => t.id));
    setList(next);
  }, [api, open, qc]);

  const post = useCallback(
    async (path: string) => {
      await fetch(`${api}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    },
    [api],
  );
  const cancel = useCallback(
    async (id: string) => {
      await post(`/${encodeURIComponent(id)}/cancel`);
      await refresh();
    },
    [post, refresh],
  );
  // Gone from the list at once; the read after the POST confirms it.
  const clear = useCallback(
    async (id?: string) => {
      setList((l) => {
        if (!l) return l;
        const tasks = l.tasks.filter((t) => (id ? t.id !== id : isActive(t)));
        const unseen = tasks.filter((t) => t.finished_at && !t.seen_at).length;
        return { ...l, tasks, unseen };
      });
      await post(id ? `/${encodeURIComponent(id)}/clear` : '/clear');
      await refresh();
    },
    [post, refresh],
  );
  // Marked seen on the server at once; the list keeps its dots until the panel closes and reads again.
  const seen = useCallback(async () => {
    if (list?.unseen) await post('/seen');
  }, [list?.unseen, post]);

  // First read, then again whenever the tab comes back.
  useEffect(() => {
    void refresh();
    const again = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [refresh]);

  // Every 3 s only while something is queued or running and the tab is visible.
  const active = (list?.active ?? 0) > 0;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [active, refresh]);

  const value = useMemo(
    () => (gone ? null : { list, refresh, cancel, seen, clear, open, apps }),
    [gone, list, refresh, cancel, seen, clear, open, apps],
  );
  return <TasksCtx.Provider value={value}>{children}</TasksCtx.Provider>;
}

function endedToast(t: Task, open: (t: Task) => void) {
  const action = t.link ? { label: 'Open', onClick: () => open(t) } : undefined;
  const [kind, ...rest] = t.title.split(' · ');
  const detail = rest.join(' · ');
  if (t.state === 'done') {
    toast.success(`${kind} finished`, {
      description: [detail, t.summary].filter(Boolean).join(' · ') || undefined,
      action,
    });
  } else if (t.state === 'failed') {
    toast.error(`${kind} failed`, {
      description: [detail, t.error].filter(Boolean).join(' · ') || undefined,
      action,
    });
  }
}

/** The header button: a ring while anything runs, the count, a gold dot for ended unseen tasks. */
export function TasksButton() {
  const tasks = useTasks();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const list = tasks?.list;
  if (!tasks || !list || list.tasks.length === 0) return null;
  const onOpen = (o: boolean) => {
    setOpen(o);
    if (o) void tasks.seen();
    else void tasks.refresh();
  };
  const running = list.tasks.filter((t) => t.state === 'running' && t.total);
  const share = running.length
    ? running.reduce((s, t) => s + (t.done ?? 0) / (t.total || 1), 0) / running.length
    : null;
  const label = [
    'Tasks',
    list.active ? `${list.active} running` : null,
    list.unseen ? `${list.unseen} new` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const trigger = (
    <Button
      variant="ghost"
      size={list.active ? 'sm' : 'icon-sm'}
      className={cn('relative shrink-0', list.active > 0 && 'gap-1.5 px-2')}
      aria-label={label}
      data-slot="tasks-button"
    >
      {list.active > 0 ? <Ring share={share} /> : <ListChecksIcon />}
      {list.active > 0 && <span className="font-mono text-xs tabular-nums">{list.active}</span>}
      {list.unseen > 0 && (
        <span
          aria-hidden
          data-slot="tasks-unseen"
          className="absolute top-1 right-0.5 size-1.5 rounded-full bg-edge"
        />
      )}
    </Button>
  );
  const body = <TaskPanel list={list} onClose={() => setOpen(false)} />;
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[75svh] gap-0 rounded-t-2xl p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="flex-row items-baseline gap-2 border-b px-4 py-3">
            <SheetTitle>Tasks</SheetTitle>
            <SheetDescription>last 7 days</SheetDescription>
            <span className="mr-8 ml-auto flex items-center gap-2 self-center">
              {list.active > 0 && (
                <span className="text-xs text-muted-foreground">{list.active} running</span>
              )}
              <ClearAll list={list} />
            </span>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Tasks</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-100 gap-0 p-0"
        aria-label="Tasks"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-baseline gap-2 px-3.5 pt-3 pb-2">
          <span className="text-sm font-semibold">Tasks</span>
          <span className="text-xs text-muted-foreground">last 7 days</span>
          <span className="ml-auto flex items-center gap-2 self-center">
            {list.active > 0 && (
              <span className="text-xs text-muted-foreground">{list.active} running</span>
            )}
            <ClearAll list={list} />
          </span>
        </div>
        {body}
      </PopoverContent>
    </Popover>
  );
}

/** Clears every ended task after one confirm; shows only when there is one. */
function ClearAll({ list }: { list: TaskList }) {
  const tasks = useTasks();
  const [confirm, setConfirm] = useState(false);
  const ended = list.tasks.length - list.active;
  if (!ended) return null;
  return (
    <>
      <IconButton
        icon={BrushCleaningIcon}
        label="Clear finished"
        size="icon-xs"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setConfirm(true)}
      />
      <LumenConfirm
        open={confirm}
        onOpenChange={setConfirm}
        title={`Clear ${ended} finished ${ended === 1 ? 'task' : 'tasks'}?`}
        description="They leave this list for good. Running tasks stay."
        action="Clear"
        onConfirm={() => void tasks?.clear()}
      />
    </>
  );
}

/** A small progress ring: the share done of what runs, or a spinning arc when nothing says. */
function Ring({ share }: { share: number | null }) {
  const c = 2 * Math.PI * 7.5;
  const arc = share === null ? c / 4 : Math.max(0.04, Math.min(1, share)) * c;
  return (
    <svg
      viewBox="0 0 20 20"
      role="img"
      aria-label="Progress"
      className={cn('size-4.5', share === null && 'animate-spin motion-reduce:animate-none')}
    >
      <circle cx="10" cy="10" r="7.5" fill="none" className="stroke-muted" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        className="stroke-primary"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${c}`}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

function TaskPanel({ list, onClose }: { list: TaskList; onClose: () => void }) {
  const { openSettings } = useShell();
  return (
    <>
      <div className="max-h-[60svh] overflow-y-auto">
        {list.tasks.map((t) => (
          <TaskRow key={t.id} task={t} onClose={onClose} />
        ))}
      </div>
      <div className="border-t px-3.5 py-2.5 text-xs text-muted-foreground">
        Phone or email when a task ends:{' '}
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            onClose();
            openSettings('notifications');
          }}
        >
          Settings ▸ Notifications
        </button>
      </div>
    </>
  );
}

function TaskRow({ task: t, onClose }: { task: Task; onClose: () => void }) {
  const tasks = useTasks();
  const apps = tasks?.apps;
  const [confirm, setConfirm] = useState(false);
  const unseen = !!t.finished_at && !t.seen_at;
  const now = useNow(isActive(t));
  const done = t.done ?? 0;
  const pct = t.total ? Math.round((done / t.total) * 100) : null;
  return (
    <div
      data-slot="task-row"
      data-state={t.state}
      className={cn('flex flex-col gap-1.5 border-t px-3.5 py-2.5', unseen && 'bg-muted/40')}
    >
      <div className="flex min-w-0 items-center gap-2">
        {unseen && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-edge" />}
        {apps && (
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {apps[t.app] ?? t.app}
          </Badge>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={t.title}>
          {t.title}
        </span>
        {isActive(t) && t.cancellable ? (
          <>
            <IconButton
              icon={XIcon}
              label="Cancel task"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirm(true)}
            />
            <LumenConfirm
              open={confirm}
              onOpenChange={setConfirm}
              title={`Cancel ${t.title}?`}
              description="It stops at its next step; what it finished stays."
              action="Cancel task"
              onConfirm={() => void tasks?.cancel(t.id)}
            />
          </>
        ) : t.link ? (
          <IconButton
            icon={isActive(t) ? ChevronRightIcon : ArrowUpRightIcon}
            label="Open"
            size="icon-xs"
            onClick={() => {
              onClose();
              tasks?.open(t);
            }}
          />
        ) : null}
        {!isActive(t) && (
          <IconButton
            icon={XIcon}
            label="Clear"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => void tasks?.clear(t.id)}
          />
        )}
      </div>
      {t.state === 'running' && t.total ? (
        <>
          <Progress value={pct ?? 0} />
          <div className="flex gap-2.5 font-mono text-[11.5px] text-muted-foreground tabular-nums">
            <span>
              {done.toLocaleString('en-US')} / {t.total.toLocaleString('en-US')}
              {t.unit ? ` ${t.unit}` : ''}
            </span>
            <span>{pct}%</span>
            <span className="ml-auto">{timeLeft(t, now)}</span>
          </div>
        </>
      ) : t.state === 'running' ? (
        <>
          <Progress />
          <div className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
            {done ? `${done.toLocaleString('en-US')}${t.unit ? ` ${t.unit}` : ''} · ` : ''}
            running {took(Date.parse(t.started_at ?? t.created_at), now)}
          </div>
        </>
      ) : t.state === 'queued' ? (
        <Line icon={<Clock3Icon className="size-3" />}>Queued</Line>
      ) : t.state === 'done' ? (
        <Line icon={<CheckIcon className="size-3 text-gain" strokeWidth={2.5} />} mono>
          {[t.summary, tookLine(t), ago(t.finished_at, now)].filter(Boolean).join(' · ')}
        </Line>
      ) : (
        <Line
          icon={<CircleAlertIcon className="size-3" />}
          className={t.state === 'failed' ? 'text-loss' : undefined}
        >
          {[t.state === 'cancelled' ? 'Cancelled' : (t.error ?? 'Failed'), ago(t.finished_at, now)]
            .filter(Boolean)
            .join(' · ')}
        </Line>
      )}
    </div>
  );
}

function Line({
  icon,
  mono,
  className,
  children,
}: {
  icon: ReactNode;
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground',
        mono && 'font-mono tabular-nums',
        className,
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/** Ticks once a second while a task runs, so "left" and "running" count. */
function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  return now;
}

function took(from: number, to: number) {
  const s = Math.max(0, Math.round((to - from) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

function tookLine(t: Task) {
  if (!t.finished_at) return null;
  return `took ${took(Date.parse(t.started_at ?? t.created_at), Date.parse(t.finished_at))}`;
}

function ago(at: string | null, now: number) {
  if (!at) return null;
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** What is left at the pace so far; nothing until a first step is done. */
function timeLeft(t: Task, now: number) {
  if (!t.total || !t.done || t.done >= t.total || !t.started_at) return '';
  const spent = now - Date.parse(t.started_at);
  const left = (spent / t.done) * (t.total - t.done);
  return `~${took(0, left)} left`;
}
