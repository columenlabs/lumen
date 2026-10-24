// LumenAssistant's frame (was the assistant panel's): what any app's AI assistant sits
// in, with nothing of the assistant itself. Docked right of the page on desktop (drag its left edge
// for ASSISTANT_WIDTH, never past half the window), a full-height sheet on phone; the header's ✦
// button with an unread dot; ⌘J; and the chat history menu grouped by when each chat was last used.
// Open or closed and the width are each browser tab's own (sessionStorage). The
// product fills the body (the product's assistant: its chat, composer, cards and spend).
import { HistoryIcon, SparklesIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import { LumenBoundary } from './lumen-boundary';
import { LumenSelector } from './lumen-selector';
import { ASSISTANT_WIDTH, usePrefs } from './prefs';
import { Button } from './ui/button';
import { Kbd } from './ui/kbd';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** A value kept for this browser tab (sessionStorage), read with `use` and set with `write`. */
export function tabState<T>(key: string, fallback: T, parse: (raw: string) => T | null) {
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw == null ? fallback : (parse(raw) ?? fallback);
    } catch {
      return fallback;
    }
  };
  let state = typeof sessionStorage === 'undefined' ? fallback : read();
  const write = (next: T) => {
    state = next;
    try {
      sessionStorage.setItem(key, String(next));
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

/** Whether the assistant is open in this tab. */
export const assistantOpen = tabState('assistant_open', false, (raw) => raw === '1');
/** Dragged width in px, within ASSISTANT_WIDTH; 0 is the shell's default. */
const assistantWidth = tabState('assistant_width', 0, (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= ASSISTANT_WIDTH.min
    ? Math.min(Math.round(n), ASSISTANT_WIDTH.max)
    : 0;
});

/** ⌘J (Ctrl+J) calls `toggle` anywhere in the app. */
export function useAssistantHotkey(toggle: () => void) {
  const ref = useRef(toggle);
  ref.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The page header's ✦ button: shown while the assistant is closed, with a dot when a reply came. */
export function LumenAssistantButton({
  name,
  open,
  unread,
  onOpen,
  className,
}: {
  name: string;
  open: boolean;
  unread?: boolean;
  onOpen: () => void;
  className?: string;
}) {
  if (open) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={cn('relative shrink-0', className)}
          aria-label={name}
          onClick={onOpen}
        >
          <SparklesIcon className="text-edge" />
          {unread && (
            <span
              aria-hidden
              data-slot="assistant-unread"
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary"
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {name} <Kbd>⌘J</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Docked right of the page on desktop (nothing while closed); a full-height sheet on phone, with
 * `closedBar` under the page while it is closed. `children` draws the body; it is told which.
 */
export function LumenAssistantPanel({
  name,
  open,
  onOpenChange,
  closedBar,
  children,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown on phone while closed (the product's one-line screen-move bar). */
  closedBar?: ReactNode;
  children: (phone: boolean) => ReactNode;
}) {
  const phone = useIsMobile();
  if (phone)
    return (
      <>
        {!open && closedBar}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none"
          >
            <SheetTitle className="sr-only">{name}</SheetTitle>
            <SheetDescription className="sr-only">
              Chat with {name} about your data.
            </SheetDescription>
            <LumenBoundary where="assistant" what="panel">
              {children(true)}
            </LumenBoundary>
          </SheetContent>
        </Sheet>
      </>
    );
  if (!open) return null;
  return <Docked name={name}>{children(false)}</Docked>;
}

function Docked({ name, children }: { name: string; children: ReactNode }) {
  const saved = assistantWidth.use();
  const [drag, setDrag] = useState<number | null>(null);
  const width = drag ?? saved;
  const ref = useRef<HTMLElement>(null);
  // Side sheets open left of the assistant, never over it: they read its width
  // from `--assistant-docked` (ui/sheet.tsx), which is 0 while it is closed or on phone.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--assistant-docked', `${el.offsetWidth}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => {
      watch.disconnect();
      root.style.removeProperty('--assistant-docked');
    };
  }, []);
  return (
    <aside
      ref={ref}
      aria-label={name}
      data-assistant-docked=""
      // Its width is the dragged one (or the shell's default), within ASSISTANT_WIDTH and half the window.
      style={width ? { width } : undefined}
      className="pointer-events-auto sticky top-0 h-svh w-(--shell-assistant-width) max-w-[50vw] min-w-80 shrink-0 border-l bg-background"
    >
      <ResizeEdge
        name={name}
        width={width || 416}
        onWidth={(w) => {
          setDrag(null);
          assistantWidth.write(w);
        }}
        onDrag={setDrag}
      />
      <LumenBoundary where="assistant" what="panel">
        {children}
      </LumenBoundary>
    </aside>
  );
}

/**
 * The panel's left edge: drag it, or focus it and use the arrow keys, to set the width; a double
 * click goes back to the default. While dragging only `onDrag` hears it.
 */
function ResizeEdge({
  name,
  width,
  onDrag,
  onWidth,
}: {
  name: string;
  width: number;
  onDrag: (w: number | null) => void;
  onWidth: (w: number) => void;
}) {
  const clamp = (w: number) =>
    Math.round(
      Math.max(
        ASSISTANT_WIDTH.min,
        Math.min(w, ASSISTANT_WIDTH.max, Math.floor(window.innerWidth / 2)),
      ),
    );
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
      aria-valuemin={ASSISTANT_WIDTH.min}
      aria-valuemax={ASSISTANT_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      data-slot="assistant-resize"
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

/** One chat in the history menu. */
export interface AssistantChat {
  id: string;
  title: string;
  /** ISO time of its last message. */
  updated_at: string;
}

/** The history groups, newest first. */
const GROUPS = ['Today', 'Yesterday', 'This week', 'Last week', 'Last month'] as const;
type Group = (typeof GROUPS)[number];
/** Under this age a chat's time reads relative ("12m ago"), past it the clock, day or date. */
const RELATIVE_MS = 6 * 3600_000;
const DAY_MS = 86_400_000;

/** `2026-10-14` in the person's time zone. */
const dayOf = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

/** Which group a chat last used at `at` falls in, by calendar days in `timeZone`; weeks start Monday. */
function groupOf(at: Date, now: Date, timeZone: string): Group {
  const days = Math.round(
    (Date.parse(dayOf(now, timeZone)) - Date.parse(dayOf(at, timeZone))) / DAY_MS,
  );
  const weekday = new Date(dayOf(now, timeZone)).getUTCDay(); // 0 Sunday
  const sinceMonday = (weekday + 6) % 7;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= sinceMonday) return 'This week';
  if (days <= sinceMonday + 7) return 'Last week';
  return 'Last month';
}

/** `now`, `12m ago`, `3h ago`, then `06:15` (today, yesterday), `Thu` (the weeks) or `28 Sep`. */
function whenOf(at: Date, now: Date, group: Group, timeZone: string) {
  const ago = now.getTime() - at.getTime();
  if (ago < 60_000) return 'now';
  if (ago < 3600_000) return `${Math.floor(ago / 60_000)}m ago`;
  if (ago < RELATIVE_MS) return `${Math.floor(ago / 3600_000)}h ago`;
  if (group === 'Today' || group === 'Yesterday')
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  if (group === 'This week' || group === 'Last week')
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(at);
}

/**
 * Chats, a dropdown from the panel header: chats grouped by when they were
 * last used, searched by title. A row is read ahead when highlighted, so picking it opens at once.
 */
export function LumenAssistantChats<C extends AssistantChat>({
  chats,
  value,
  note,
  disabled,
  onOpen,
  onRefresh,
  onHighlight,
}: {
  /** null while loading. */
  chats: C[] | null;
  value?: string;
  /** A line above the list: how long chats are kept. */
  note?: ReactNode;
  disabled?: boolean;
  onOpen: (chat: C) => void;
  /** The menu opened: read the list again. */
  onRefresh?: () => void;
  onHighlight?: (chat: C) => void;
}) {
  const { timeZone } = usePrefs();
  const now = new Date();
  const byId = new Map((chats ?? []).map((c) => [c.id, c]));
  const groups = GROUPS.map((group) => ({
    label: group,
    options: (chats ?? []).flatMap((c) => {
      const at = new Date(c.updated_at);
      const g = groupOf(at, now, timeZone);
      return g === group
        ? [{ value: c.id, label: c.title, detail: whenOf(at, now, g, timeZone) }]
        : [];
    }),
  })).filter((g) => g.options.length > 0);
  return (
    <LumenSelector
      trigger="icon"
      icon={HistoryIcon}
      label="Chats"
      search
      align="end"
      groups={groups}
      empty={chats === null ? 'Loading…' : 'No chats yet'}
      header={note && <p className="px-2 pt-1 text-xs text-muted-foreground">{note}</p>}
      value={value}
      disabled={disabled}
      onOpenChange={(o) => o && onRefresh?.()}
      onHighlight={(id) => {
        const c = byId.get(id);
        if (c) onHighlight?.(c);
      }}
      onChange={(id) => {
        const c = byId.get(id);
        if (c) onOpen(c);
      }}
    />
  );
}
