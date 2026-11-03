// Signals: every warning and error an app raises, as data, in one place (DESIGN.md, Signals).
// A signal names what happened (kind · what · where) and its numbers (pace, share of a limit used
// and where it lands, when it runs out), never a sentence. Three levels: Needs action (something
// is broken or a limit is burning fast), Worth a look (climbing toward a limit), Harmless (unusual,
// lands low). The status bar shows the counts and the top signal; a tap opens the Signals panel,
// grouped and one line a row, with Open, Mute and Dismiss. Signals marked `banner` show above the
// page until fixed. Dismiss and the short mutes are kept on this device; a repeat of the same key
// shows once with its count, and a later occurrence (a newer `at`) reopens a dismissed one.
import {
  ArrowLeftIcon,
  BellOffIcon,
  ExternalLinkIcon,
  SettingsIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { LumenDrawer } from './lumen-drawer';
import { lumenToast } from './lumen-toast';
import { METER_LEVEL_COLOR, meterLevel } from './meter-level';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { TooltipProvider } from './ui/tooltip';

/** Needs action, Worth a look, Harmless. */
export type SignalLevel = 'act' | 'look' | 'fyi';

export interface Signal {
  /** One row per key (kind + scope + meter + resource): a repeat adds to its count. */
  key: string;
  level: SignalLevel;
  /** What kind of event, short (`Burning fast`, `Over a limit`, `Can't see`). */
  kind: string;
  /** The meter or thing it is about (`KV reads`). */
  what: string;
  /** The resource or place (`usageflare`). */
  where?: string;
  /** What it belongs to (an account, a desk); the panel can group by it. */
  group?: string;
  /** How fast, as a share of the limit in a window (`11% in 15m`), or the plain numbers (`1,040 / 1,000`). */
  pace?: string;
  /** Share of the limit used now (0 to 1). */
  used?: number;
  /** Share of the limit at reset at this pace. */
  lands?: number;
  /** When the limit runs out at this pace (`2h`); shown instead of `lands`. */
  runsOut?: string;
  /** When it last happened (ms or ISO). */
  at: number | string;
  /** How many times it happened; repeats in the list add up too. */
  count?: number;
  /** Where Open goes: an in-app route (`to`, the router's link) or any address (`href`). */
  to?: string;
  href?: string;
  /** One or two plain lines for the hover and the phone's detail. */
  why?: string;
  /** The one action that ends it (`Fix token`), on the banner and the row. */
  fix?: {
    label: string;
    href?: string;
    onClick?: () => void /** A Settings section to open. */;
    settings?: string;
  };
  /** Shows above the page until it is fixed (only for Needs action: blind, over a limit). */
  banner?: boolean;
}

/** How long a mute lasts: an hour, until the limit resets (00:00 UTC), or for good (the app keeps it). */
export type SignalMute = 'hour' | 'reset' | 'always';

/** The app's hooks into the panel, on `LumenShell bar`. */
export interface SignalsOptions {
  /** A mute the app keeps (an alert rule). Left out, only the hour and until-reset mutes show, kept on this device. */
  onMute?: (s: Signal, until: SignalMute) => void;
  /** The panel's gear: the Settings section where the app's alerts live (`alerts`). */
  settings?: string;
  /** The name of `group` in the panel's Group by (`Account`). */
  groupLabel?: string;
}

export const SIGNAL_LEVELS: Record<
  SignalLevel,
  { label: string; short: string; dot: string; text?: string }
> = {
  act: { label: 'Needs action', short: 'Act', dot: 'bg-destructive', text: 'text-destructive' },
  look: { label: 'Worth a look', short: 'Look', dot: 'bg-warning', text: 'text-warning' },
  fyi: { label: 'Harmless', short: 'Harmless', dot: 'bg-muted-foreground/40' },
};
const ORDER: SignalLevel[] = ['act', 'look', 'fyi'];

const HOUR = 3_600_000;
const toMs = (at: number | string) => (typeof at === 'number' ? at : Date.parse(at) || 0);
const nextReset = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
const pct = (v: number) => (v >= 10 ? '>999%' : `${Math.round(v * 100)}%`);

/** `3m`, `2h`, `4d`: how long ago. */
export function signalAge(at: number | string, now = Date.now()): string {
  const d = Math.max(0, now - toMs(at));
  if (d < 60_000) return 'now';
  if (d < HOUR) return `${Math.round(d / 60_000)}m`;
  if (d < 24 * HOUR) return `${Math.round(d / HOUR)}h`;
  return `${Math.round(d / (24 * HOUR))}d`;
}

/** One entry per key, counted, latest numbers kept; ordered by level, then by where it lands. */
export function groupSignals(list: readonly Signal[]): Signal[] {
  const map = new Map<string, Signal>();
  for (const s of list) {
    const prev = map.get(s.key);
    const count = Math.max(1, s.count ?? 1);
    if (!prev) map.set(s.key, { ...s, count });
    else {
      const newer = toMs(s.at) > toMs(prev.at) ? s : prev;
      map.set(s.key, { ...newer, count: (prev.count ?? 1) + count });
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      ORDER.indexOf(a.level) - ORDER.indexOf(b.level) ||
      (b.runsOut ? 99 : (b.lands ?? -1)) - (a.runsOut ? 99 : (a.lands ?? -1)) ||
      toMs(b.at) - toMs(a.at),
  );
}

interface Kept {
  dismissed: Record<string, number>;
  muted: Record<string, number>;
  banner: Record<string, number>;
}
const EMPTY: Kept = { dismissed: {}, muted: {}, banner: {} };
const storeKey = (app: string) => `lumen:signals:${app}`;

function readKept(app: string): Kept {
  try {
    const raw = window.localStorage.getItem(storeKey(app));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Kept>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

interface SignalsValue {
  /** Open signals, grouped and ordered. */
  items: Signal[];
  /** Muted ones, still listed under Muted. */
  muted: Signal[];
  banners: Signal[];
  open: boolean;
  setOpen: (open: boolean) => void;
  dismiss: (list: Signal[]) => void;
  mute: (s: Signal, until: SignalMute) => void;
  unmute: (s: Signal) => void;
  hideBanner: (s: Signal) => void;
  options: SignalsOptions;
  openSettings?: (section?: string) => void;
}
const Ctx = createContext<SignalsValue | null>(null);

/** The open signals and the panel's state; `null` outside the shell. */
export function useSignals(): SignalsValue | null {
  return useContext(Ctx);
}

/** Holds the app's and pages' signals and what this device dismissed or muted. The shell mounts it. */
export function SignalsProvider({
  app,
  signals,
  options,
  openSettings,
  children,
}: {
  app: string;
  signals: readonly Signal[];
  options?: SignalsOptions;
  /** The shell's Settings opener, for a fix or the gear that names a section. */
  openSettings?: (section?: string) => void;
  children: ReactNode;
}) {
  const [kept, setKept] = useState<Kept>(EMPTY);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setKept(readKept(app)), [app]);
  // Mutes end on their own: look again each minute while the tab shows.
  useEffect(() => {
    const t = setInterval(() => !document.hidden && setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const save = useCallback(
    (next: (k: Kept) => Kept) =>
      setKept((prev) => {
        const k = next(prev);
        try {
          window.localStorage.setItem(storeKey(app), JSON.stringify(k));
        } catch {}
        return k;
      }),
    [app],
  );

  const all = useMemo(() => groupSignals(signals), [signals]);
  const live = all.filter((s) => (kept.dismissed[s.key] ?? 0) < toMs(s.at));
  const items = live.filter((s) => (kept.muted[s.key] ?? 0) <= now);
  const muted = live.filter((s) => (kept.muted[s.key] ?? 0) > now);
  const banners = items.filter(
    (s) => s.banner && s.level === 'act' && (kept.banner[s.key] ?? 0) <= now,
  );

  const dismiss = useCallback(
    (list: Signal[]) => {
      if (!list.length) return;
      let before: Kept = EMPTY;
      save((k) => {
        before = k;
        const dismissed = { ...k.dismissed };
        for (const s of list) dismissed[s.key] = toMs(s.at);
        return { ...k, dismissed };
      });
      const n = list.length;
      lumenToast.undo(
        n === 1 ? `Dismissed ${list[0]?.what ?? 'signal'}` : `Dismissed ${n} signals`,
        () => save(() => before),
      );
    },
    [save],
  );
  const mute = useCallback(
    (s: Signal, until: SignalMute) => {
      const t = Date.now();
      const end =
        until === 'hour' ? t + HOUR : until === 'reset' ? nextReset(t) : t + 365 * 24 * HOUR;
      save((k) => ({ ...k, muted: { ...k.muted, [s.key]: end } }));
      options?.onMute?.(s, until);
      lumenToast.undo(`Muted ${s.what}`, () =>
        save((k) => {
          const { [s.key]: _, ...rest } = k.muted;
          return { ...k, muted: rest };
        }),
      );
    },
    [save, options],
  );
  const unmute = useCallback(
    (s: Signal) =>
      save((k) => {
        const { [s.key]: _, ...rest } = k.muted;
        return { ...k, muted: rest };
      }),
    [save],
  );
  const hideBanner = useCallback(
    (s: Signal) => save((k) => ({ ...k, banner: { ...k.banner, [s.key]: Date.now() + HOUR } })),
    [save],
  );

  const value = useMemo(
    () => ({
      items,
      muted,
      banners,
      open,
      setOpen,
      dismiss,
      mute,
      unmute,
      hideBanner,
      options: options ?? {},
      openSettings,
    }),
    [items, muted, banners, open, dismiss, mute, unmute, hideBanner, options, openSettings],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {(items.length > 0 || muted.length > 0) && (
        <TooltipProvider delayDuration={200}>
          <SignalsPanel />
        </TooltipProvider>
      )}
    </Ctx.Provider>
  );
}

function Dot({ level }: { level: SignalLevel }) {
  return (
    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', SIGNAL_LEVELS[level].dot)} />
  );
}

/** Where it lands at reset, in its meter colour. */
function landColor(s: Signal) {
  const v = s.runsOut ? 2 : s.lands;
  return v == null ? undefined : METER_LEVEL_COLOR[meterLevel(v)];
}

/** `34% → out 2h`, `88% → 96%`. */
function LimitCell({ s }: { s: Signal }) {
  if (s.used == null && s.lands == null && !s.runsOut)
    return <span className="text-muted-foreground">—</span>;
  const end = s.runsOut ? `out ${s.runsOut}` : s.lands != null ? pct(s.lands) : '';
  return (
    <span className="num">
      {s.used != null && <span>{pct(s.used)} → </span>}
      <span className="font-medium" style={{ color: landColor(s) }}>
        {end}
      </span>
    </span>
  );
}

/** The top signal in short form, for the bar. */
export function signalShort(s: Signal) {
  return [s.kind, s.what, s.where].filter(Boolean).join(' · ');
}

/** The status bar's chip: counts by level and the top signal; opens the panel. */
export function SignalsChip({ className }: { className?: string }) {
  const ctx = useSignals();
  if (!ctx || (!ctx.items.length && !ctx.muted.length)) return null;
  const top = ctx.items.find((s) => s.kind && !s.banner) ?? ctx.items[0];
  return (
    <button
      type="button"
      onClick={() => ctx.setOpen(!ctx.open)}
      aria-label={`Signals, ${ctx.items.length} open`}
      aria-expanded={ctx.open}
      className={cn(
        'flex h-6 min-w-0 overflow-hidden max-w-(--status-message-max) items-center gap-2 rounded-md border bg-muted/60 px-1.5 text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      <span className="num flex shrink-0 items-center gap-1.5">
        {ORDER.map((l) => {
          const n = ctx.items.filter((s) => s.level === l).length;
          return n ? (
            <span key={l} className={cn('flex items-center gap-1', SIGNAL_LEVELS[l].text)}>
              <Dot level={l} />
              {n}
            </span>
          ) : null;
        })}
        {!ctx.items.length && <span className="text-muted-foreground">0</span>}
      </span>
      {top && (
        <>
          <span aria-hidden className="h-3.5 w-px shrink-0 bg-border" />
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">{top.kind}</span>{' '}
            {[top.what, top.where].filter(Boolean).join(' · ')}
          </span>
          {(top.pace || top.runsOut) && (
            <span className="num min-w-0 truncate text-foreground/80">
              {[top.pace, top.runsOut && `out ${top.runsOut}`].filter(Boolean).join(' · ')}
            </span>
          )}
        </>
      )}
    </button>
  );
}

/** Banners for signals that block the page's job (an unreadable account, a limit already passed). */
export function SignalBanners() {
  const ctx = useSignals();
  if (!ctx?.banners.length) return null;
  return (
    <div data-slot="signal-banners" className="flex flex-col">
      {ctx.banners.slice(0, 2).map((s) => (
        <div
          key={s.key}
          role="alert"
          className="flex h-10 items-center gap-2 border-b border-destructive/25 bg-destructive/10 px-(--shell-gutter) text-sm whitespace-nowrap text-destructive"
        >
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 truncate font-medium" title={s.why}>
            {[s.what, s.where].filter(Boolean).join(' · ')}
            {s.group && s.group !== s.where && s.group !== s.what && (
              <span className="font-normal text-foreground/80"> · {s.group}</span>
            )}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {s.fix && <FixButton s={s} size="sm" />}
            <IconButton
              icon={XIcon}
              label="Hide for 1 hour"
              size="icon-sm"
              onClick={() => ctx.hideBanner(s)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function FixButton({ s, size = 'xs' }: { s: Signal; size?: 'xs' | 'sm' }) {
  const ctx = useSignals();
  if (!s.fix) return null;
  const { label, href, settings } = s.fix;
  const onClick = settings
    ? () => {
        ctx?.setOpen(false);
        ctx?.openSettings?.(settings);
      }
    : s.fix.onClick;
  return href ? (
    <Button size={size} asChild>
      <a href={href}>{label}</a>
    </Button>
  ) : (
    <Button size={size} onClick={onClick}>
      {label}
    </Button>
  );
}

function Facts({ s }: { s: Signal }) {
  const rows: [string, ReactNode][] = [];
  if (s.group) rows.push(['In', s.group]);
  if (s.where) rows.push(['Where', s.where]);
  if (s.pace) rows.push(['Pace', s.pace]);
  if (s.used != null) rows.push(['Limit used', pct(s.used)]);
  if (s.runsOut) rows.push(['Runs out', `in about ${s.runsOut}`]);
  else if (s.lands != null) rows.push(['At reset', pct(s.lands)]);
  rows.push(['Last', `${signalAge(s.at)} ago${(s.count ?? 1) > 1 ? ` · ${s.count} times` : ''}`]);
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="num truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {s.why && <p className="text-muted-foreground">{s.why}</p>}
    </div>
  );
}

function MuteMenu({ s, ctx }: { s: Signal; ctx: SignalsValue }) {
  if (ctx.muted.includes(s))
    return (
      <IconButton
        icon={BellOffIcon}
        label="Unmute"
        size="icon-xs"
        pressed
        onClick={() => ctx.unmute(s)}
      />
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={BellOffIcon} label="Mute" size="icon-xs" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => ctx.mute(s, 'hour')}>For 1 hour</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ctx.mute(s, 'reset')}>
          Until reset (00:00 UTC)
        </DropdownMenuItem>
        {ctx.options.onMute && (
          <DropdownMenuItem onSelect={() => ctx.mute(s, 'always')}>
            Always, for this meter
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One signal, one line: level, kind, what · where, pace, limit used → at reset, age; actions on hover. */
function SignalRow({
  s,
  ctx,
  onPick,
}: { s: Signal; ctx: SignalsValue; onPick?: (s: Signal) => void }) {
  const isMuted = ctx.muted.includes(s);
  const line = (
    <>
      <Dot level={s.level} />
      <span className="truncate text-muted-foreground" data-signal-col="kind">
        {s.kind}
      </span>
      <HoverCardTrigger asChild>
        <button type="button" className="flex min-w-0 items-center gap-1.5 text-left">
          <span className="truncate">{s.what}</span>
          {s.where && (
            <span className="min-w-8 shrink-[3] truncate text-muted-foreground">{s.where}</span>
          )}
          {(s.count ?? 1) > 1 && (
            <span className="num shrink-0 rounded-full bg-muted px-1.5 text-muted-foreground text-xs">
              ×{s.count}
            </span>
          )}
        </button>
      </HoverCardTrigger>
      <span
        data-signal-col="pace"
        className={cn(
          'num truncate text-right',
          s.level === 'act' ? 'text-destructive' : s.level === 'fyi' && 'text-muted-foreground',
        )}
      >
        {s.pace ?? '—'}
      </span>
      <span className="truncate text-right">
        <LimitCell s={s} />
      </span>
      <span data-signal-col="age" className="num text-right text-muted-foreground">
        {signalAge(s.at)}
      </span>
    </>
  );
  if (onPick)
    return (
      <button
        type="button"
        onClick={() => onPick(s)}
        data-signal-grid="phone"
        className={cn(
          'grid h-11 w-full items-center gap-2 border-b px-4 text-left whitespace-nowrap ',
          isMuted && 'opacity-60',
        )}
      >
        <Dot level={s.level} />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{s.what}</span>
          {s.where && (
            <span className="min-w-8 shrink-[3] truncate text-muted-foreground">{s.where}</span>
          )}
          {(s.count ?? 1) > 1 && (
            <span className="num shrink-0 rounded-full bg-muted px-1.5 text-muted-foreground text-xs">
              ×{s.count}
            </span>
          )}
        </span>
        <span className="num text-right text-xs" style={{ color: landColor(s) }}>
          {s.runsOut ? `out ${s.runsOut}` : s.lands != null ? `→${pct(s.lands)}` : s.kind}
        </span>
      </button>
    );
  return (
    <div
      data-signal-grid
      className={cn(
        'group/sig relative grid h-9 items-center gap-2 border-b px-4 whitespace-nowrap hover:bg-muted/50 focus-within:bg-muted/50',
        isMuted && 'opacity-60',
      )}
    >
      <HoverCard openDelay={300} closeDelay={80}>
        {line}
        <HoverCardContent side="left" align="start" className="w-80 text-xs">
          <p className="mb-2 flex items-center gap-1.5 font-medium text-sm">
            <Dot level={s.level} />
            <span className="truncate">{signalShort(s)}</span>
          </p>
          <Facts s={s} />
        </HoverCardContent>
      </HoverCard>
      <span className="absolute top-1 right-2 hidden items-center gap-0.5 rounded-md border bg-background px-0.5 shadow-xs group-hover/sig:flex group-focus-within/sig:flex">
        {s.fix && <FixButton s={s} />}
        {(s.to || s.href) && (
          <IconButton
            icon={ExternalLinkIcon}
            label="Open"
            size="icon-xs"
            to={s.to}
            href={s.to ? undefined : s.href}
          />
        )}
        <MuteMenu s={s} ctx={ctx} />
        <IconButton icon={XIcon} label="Dismiss" size="icon-xs" onClick={() => ctx.dismiss([s])} />
      </span>
    </div>
  );
}

type Filter = 'all' | SignalLevel | 'muted';

/** The Signals panel: a docked drawer on desktop, a bottom sheet on a phone. */
function SignalsPanel() {
  const ctx = useSignals() as SignalsValue;
  const mobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>('all');
  const [by, setBy] = useState<'level' | 'group'>('level');
  const [picked, setPicked] = useState<string | null>(null);
  const hasGroups = ctx.items.some((s) => s.group);
  const list =
    filter === 'muted'
      ? ctx.muted
      : ctx.items.filter((s) => filter === 'all' || s.level === filter);
  const groups = new Map<string, Signal[]>();
  for (const s of list) {
    const k = by === 'group' && hasGroups ? (s.group ?? 'Other') : s.level;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const pick = [...ctx.items, ...ctx.muted].find((s) => s.key === picked);
  const close = () => {
    ctx.setOpen(false);
    setPicked(null);
  };

  return (
    <LumenDrawer
      open={ctx.open}
      onClose={close}
      dock="signals"
      defaultSize="40%"
      minSize="420px"
      title={pick && mobile ? signalShort(pick) : 'Signals'}
      description={`${ctx.items.length} open`}
      footerStart={pick && mobile ? undefined : 'Dismiss and short mutes are kept on this device'}
      actions={[
        ...(pick && mobile
          ? [{ icon: ArrowLeftIcon, label: 'Back to the list', onClick: () => setPicked(null) }]
          : []),
        ...(ctx.options.settings && ctx.openSettings
          ? [
              {
                icon: SettingsIcon,
                label: 'Alert settings',
                onClick: () => {
                  close();
                  ctx.openSettings?.(ctx.options.settings);
                },
              },
            ]
          : []),
      ]}
    >
      {pick && mobile ? (
        <div className="flex flex-col gap-4 pt-1 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Dot level={pick.level} />
            {SIGNAL_LEVELS[pick.level].label}
          </p>
          <Facts s={pick} />
          <div className="grid grid-cols-3 gap-2">
            {pick.to || pick.href ? (
              <Button asChild>
                <a href={pick.to ?? pick.href}>Open</a>
              </Button>
            ) : (
              <FixButton s={pick} size="sm" />
            )}
            <Button
              variant="outline"
              onClick={() => {
                ctx.mute(pick, 'reset');
                setPicked(null);
              }}
            >
              Mute
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                ctx.dismiss([pick]);
                setPicked(null);
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : (
        <div data-slot="signals" className="-mx-4 flex flex-col text-sm">
          <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={filter}
              onValueChange={(v) => v && setFilter(v as Filter)}
              aria-label="Show"
            >
              <ToggleGroupItem value="all">
                All <span className="num text-muted-foreground">{ctx.items.length}</span>
              </ToggleGroupItem>
              {ORDER.map((l) => (
                <ToggleGroupItem key={l} value={l}>
                  <Dot level={l} />
                  {SIGNAL_LEVELS[l].short}{' '}
                  <span className="num text-muted-foreground">
                    {ctx.items.filter((s) => s.level === l).length}
                  </span>
                </ToggleGroupItem>
              ))}
              {ctx.muted.length > 0 && (
                <ToggleGroupItem value="muted">
                  Muted <span className="num text-muted-foreground">{ctx.muted.length}</span>
                </ToggleGroupItem>
              )}
            </ToggleGroup>
            {hasGroups && !mobile && (
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={by}
                onValueChange={(v) => v && setBy(v as 'level' | 'group')}
                aria-label="Group by"
                className="ml-auto"
              >
                <ToggleGroupItem value="level">By level</ToggleGroupItem>
                <ToggleGroupItem value="group">
                  By {ctx.options.groupLabel?.toLowerCase() ?? 'group'}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
          {!mobile && list.length > 0 && (
            <div
              data-signal-grid
              className="sticky top-0 z-1 grid h-7 items-center gap-2 border-y bg-background px-4 text-muted-foreground text-xs whitespace-nowrap"
            >
              <span />
              <span data-signal-col="kind">Kind</span>
              <span>What · where</span>
              <span data-signal-col="pace" className="text-right">
                Pace
              </span>
              <span className="text-right">Used → at reset</span>
              <span data-signal-col="age" className="text-right">
                Age
              </span>
            </div>
          )}
          {list.length === 0 && (
            <p className="px-4 py-8 text-center text-muted-foreground">
              {filter === 'muted' ? 'Nothing muted.' : 'All clear. New signals show here.'}
            </p>
          )}
          {[...groups].map(([k, rows]) => {
            const level = (ORDER as string[]).includes(k) ? (k as SignalLevel) : null;
            return (
              <section key={k} aria-label={level ? SIGNAL_LEVELS[level].label : k}>
                <div className="flex h-8 items-center gap-2 bg-muted px-4 font-medium text-xs whitespace-nowrap">
                  {level && <Dot level={level} />}
                  <span className="truncate">{level ? SIGNAL_LEVELS[level].label : k}</span>
                  <span className="num text-muted-foreground">{rows.length}</span>
                  {filter !== 'muted' && (
                    <button
                      type="button"
                      onClick={() => ctx.dismiss(rows)}
                      className="ml-auto rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      Dismiss all
                    </button>
                  )}
                </div>
                {rows.map((s) => (
                  <SignalRow
                    key={s.key}
                    s={s}
                    ctx={ctx}
                    onPick={mobile ? (x) => setPicked(x.key) : undefined}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </LumenDrawer>
  );
}
