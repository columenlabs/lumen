// LumenCalendar: an events calendar over plain data. Month, Week (with a time axis) and Agenda,
// switched with LumenTabs; Today, previous and next as icon buttons; category chips that filter.
// Every day is worked out in the passed time zone without a date library: an event's instant is
// read into that zone's calendar day and minute with Intl, and the grid counts whole days.
// On a narrow box (a phone, or a narrow drawer) Month shows dots with the picked day's list under
// it, and Agenda is the view it opens on. Nothing here fetches: `onRangeChange` tells the app which
// days are on screen, so it can read just those.
import {
  CalendarCheckIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ColorChip, ColorDot } from './color-dot';
import { useNarrow } from './hooks/use-narrow';
import { cn } from './lib/utils';
import { LumenBoundary } from './lumen-boundary';
import { type LumenTab, LumenTabs } from './lumen-tabs';
import { IconButton } from './page';
import { Empty, EmptyHeader, EmptyTitle } from './ui/empty';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

export interface CalendarEvent {
  id: string;
  title: string;
  /** An instant (`Date` or ISO string), or a plain `YYYY-MM-DD` for a whole day. */
  start: Date | string;
  /** Inclusive for a plain `YYYY-MM-DD`; an end at midnight does not reach the next day. */
  end?: Date | string;
  allDay?: boolean;
  /** A `categories` id: its colour and filter chip. */
  category?: string;
  /** Any CSS colour; the category's colour by default. */
  color?: string;
}

export interface CalendarCategory {
  id: string;
  label: string;
  color: string;
}

export type CalendarView = 'month' | 'week' | 'agenda';

export interface CalendarRange {
  /** The first instant on screen (midnight of the first day in `timeZone`). */
  start: Date;
  /** The instant after the last day on screen. */
  end: Date;
  view: CalendarView;
}

export interface LumenCalendarProps<E extends CalendarEvent = CalendarEvent> {
  events: readonly E[];
  categories?: readonly CalendarCategory[];
  /** The open view, controlled; or `defaultView` (Agenda on a narrow box, else Month). */
  view?: CalendarView;
  defaultView?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  /** A day in the period shown, controlled; or `defaultDate` (today). */
  date?: Date;
  defaultDate?: Date;
  onDateChange?: (date: Date) => void;
  /** An event was clicked: open the app's drawer. */
  onSelect?: (event: E) => void;
  /** The days on screen changed (and once at first): fetch by range. */
  onRangeChange?: (range: CalendarRange) => void;
  /** An IANA zone every day and time is shown in; the browser's by default. */
  timeZone?: string;
  /** 0 Sunday (default) or 1 Monday. */
  weekStartsOn?: 0 | 1;
  /** Shown when the period has no events. */
  empty?: string;
  className?: string;
}

const DAY_MS = 86_400_000;
/** Most days one event may cover on the grid, so a bad end date never loops for long. */
const MAX_SPAN = 62;
/** Events a month cell draws before "+N". */
const CELL_EVENTS = 3;
/** The hour the week's time axis opens at when nothing starts earlier. */
const OPEN_HOUR = 7;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// ── Civil days ────────────────────────────────────────────────────────────────
// A civil day is a whole number: days since 1970-01-01. Its Date at UTC midnight formats with
// `timeZone: 'UTC'`, so labels never shift by the viewer's own zone.

const dayOf = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY_MS;
const asDate = (day: number, minute = 0) => new Date(day * DAY_MS + minute * 60_000);
const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;
const ymd = (day: number) => {
  const d = asDate(day);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addMonths = (day: number, n: number) => {
  const c = ymd(day);
  const t = new Date(Date.UTC(c.y, c.m - 1 + n, 1));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  return dayOf(y, m, Math.min(c.d, daysIn(y, m)));
};

const zoneParts = new Map<string, Intl.DateTimeFormat>();
/** The instant's calendar day and minute of the day in `zone`. */
function zoned(ms: number, zone: string): { day: number; minute: number } {
  let f = zoneParts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    zoneParts.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = +x.value;
  return {
    day: dayOf(p.year ?? 1970, p.month ?? 1, p.day ?? 1),
    minute: ((p.hour ?? 0) % 24) * 60 + (p.minute ?? 0),
  };
}

/** Midnight of a civil day in `zone`, as an instant. */
function midnight(day: number, zone: string): Date {
  const guess = day * DAY_MS;
  const offset = (ms: number) => {
    const z = zoned(ms, zone);
    return z.day * DAY_MS + z.minute * 60_000 - Math.floor(ms / 60_000) * 60_000;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

interface Placed<E> {
  ev: E;
  startDay: number;
  endDay: number;
  /** Minutes into the start day, and the end's minutes counted from the start day. */
  startMin: number;
  endMin: number;
  allDay: boolean;
  color: string;
}

function place<E extends CalendarEvent>(
  ev: E,
  zone: string,
  colors: Map<string, string>,
): Placed<E> | null {
  const read = (v: Date | string): { day: number; minute: number; plain: boolean } | null => {
    if (typeof v === 'string') {
      const m = v.match(DATE_ONLY);
      if (m)
        return { day: dayOf(Number(m[1]), Number(m[2]), Number(m[3])), minute: 0, plain: true };
    }
    const ms = (v instanceof Date ? v : new Date(v)).getTime();
    return Number.isFinite(ms) ? { ...zoned(ms, zone), plain: false } : null;
  };
  const s = read(ev.start);
  if (!s) return null;
  const e = ev.end ? read(ev.end) : null;
  const allDay = !!ev.allDay || s.plain;
  let endDay = s.day;
  let endMin = s.minute + 30;
  if (e) {
    endDay = e.day;
    endMin = (e.day - s.day) * 1440 + e.minute;
    // A timed end at midnight closes the day before.
    if (!e.plain && e.minute === 0 && e.day > s.day) endDay = e.day - 1;
  }
  endDay = Math.min(Math.max(endDay, s.day), s.day + MAX_SPAN);
  return {
    ev,
    startDay: s.day,
    endDay,
    startMin: allDay ? 0 : s.minute,
    endMin: allDay ? 1440 : Math.max(endMin, s.minute + 15),
    allDay,
    color: ev.color ?? (ev.category && colors.get(ev.category)) ?? 'var(--primary)',
  };
}

/** Side-by-side lanes for one day's timed events that overlap. */
function lanes<E>(list: Placed<E>[]): { p: Placed<E>; lane: number; of: number }[] {
  const out: { p: Placed<E>; lane: number; of: number }[] = [];
  let group: { p: Placed<E>; lane: number; of: number }[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const g of group) g.of = ends.length;
    out.push(...group);
    group = [];
    ends = [];
  };
  for (const p of [...list].sort((a, b) => a.startMin - b.startMin)) {
    if (p.startMin >= groupEnd) close();
    let lane = ends.findIndex((end) => end <= p.startMin);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = p.endMin;
    groupEnd = Math.max(groupEnd, p.endMin);
    group.push({ p, lane, of: 0 });
  }
  close();
  return out;
}

function useControlled<T>(value: T | undefined, initial: () => T, onChange?: (v: T) => void) {
  const [own, setOwn] = useState<T>(initial);
  const set = (v: T) => {
    if (value === undefined) setOwn(v);
    onChange?.(v);
  };
  return [value ?? own, set] as const;
}

// ── The part ──────────────────────────────────────────────────────────────────

export function LumenCalendar<E extends CalendarEvent>({
  events,
  categories,
  view: viewProp,
  defaultView,
  onViewChange,
  date: dateProp,
  defaultDate,
  onDateChange,
  onSelect,
  onRangeChange,
  timeZone,
  weekStartsOn = 0,
  empty = 'No events',
  className,
}: LumenCalendarProps<E>) {
  const box = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(box);
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [view, setView] = useControlled<CalendarView>(
    viewProp,
    () =>
      defaultView ??
      (typeof window !== 'undefined' && window.innerWidth < 640 ? 'agenda' : 'month'),
    onViewChange,
  );
  const [date, setDate] = useControlled<Date>(
    dateProp,
    () => defaultDate ?? new Date(),
    onDateChange,
  );
  const anchor = zoned(date.getTime(), zone).day;
  const today = zoned(Date.now(), zone).day;
  const [picked, setPicked] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const colors = useMemo(
    () => new Map((categories ?? []).map((c) => [c.id, c.color] as const)),
    [categories],
  );
  const catLabel = useMemo(
    () => new Map((categories ?? []).map((c) => [c.id, c.label] as const)),
    [categories],
  );
  // Each event on every day it covers, whole days first, then by start.
  const byDay = useMemo(() => {
    const map = new Map<number, Placed<E>[]>();
    for (const ev of events) {
      if (ev.category && hidden.has(ev.category)) continue;
      const p = place(ev, zone, colors);
      if (!p) continue;
      for (let d = p.startDay; d <= p.endDay; d++) {
        const list = map.get(d);
        if (list) list.push(p);
        else map.set(d, [p]);
      }
    }
    for (const list of map.values())
      list.sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          a.startDay - b.startDay ||
          a.startMin - b.startMin ||
          a.ev.title.localeCompare(b.ev.title),
      );
    return map;
  }, [events, hidden, zone, colors]);

  // The days on screen: whole weeks around the month, one week, or the month as a list.
  const { y, m } = ymd(anchor);
  const first = dayOf(y, m, 1);
  const lead = (d: number) => (weekday(d) - weekStartsOn + 7) % 7;
  const [from, to] =
    view === 'week'
      ? [anchor - lead(anchor), anchor - lead(anchor) + 7]
      : view === 'month'
        ? [
            first - lead(first),
            first - lead(first) + Math.ceil((lead(first) + daysIn(y, m)) / 7) * 7,
          ]
        : [first, first + daysIn(y, m)];

  const ranged = useRef(onRangeChange);
  ranged.current = onRangeChange;
  useEffect(() => {
    ranged.current?.({ start: midnight(from, zone), end: midnight(to, zone), view });
  }, [from, to, zone, view]);

  const fmt = useMemo(() => {
    const f = (o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...o });
    return {
      month: f({ month: 'long', year: 'numeric' }),
      range: f({ month: 'short', day: 'numeric', year: 'numeric' }),
      weekday: f({ weekday: narrow ? 'narrow' : 'short' }),
      dayLong: f({ weekday: 'short', month: 'short', day: 'numeric' }),
      time: f({ hour: 'numeric', minute: '2-digit' }),
      hour: f({ hour: 'numeric' }),
    };
  }, [narrow]);
  const timeOf = (p: Placed<E>, day: number) =>
    p.allDay || day !== p.startDay ? 'All day' : fmt.time.format(asDate(p.startDay, p.startMin));

  const title =
    view === 'week'
      ? fmt.range.formatRange(asDate(from), asDate(to - 1))
      : fmt.month.format(asDate(first));
  const step = (n: number) => {
    const next = view === 'week' ? anchor + n * 7 : addMonths(anchor, n);
    setPicked(null);
    setDate(midnight(next, zone));
  };
  const unit = view === 'week' ? 'week' : 'month';
  const tabs: LumenTab<CalendarView>[] = [
    { value: 'month', label: 'Month', icon: CalendarDaysIcon },
    { value: 'week', label: 'Week', icon: CalendarRangeIcon },
    { value: 'agenda', label: 'Agenda', icon: ListIcon },
  ];
  // On a narrow month the picked day's list sits under the dots: today when it is on screen.
  const listDay =
    picked ??
    (view === 'month' && narrow
      ? today >= first && today < first + daysIn(y, m)
        ? today
        : first
      : null);

  const row = (p: Placed<E>, day: number) => (
    <li key={`${p.ev.id}:${day}`}>
      <button
        type="button"
        onClick={() => onSelect?.(p.ev)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <time className="w-16 shrink-0 truncate text-muted-foreground">{timeOf(p, day)}</time>
        <ColorDot color={p.color} />
        <span className="min-w-0 flex-1 truncate" title={p.ev.title}>
          {p.ev.title}
        </span>
        {!narrow && p.ev.category && catLabel.has(p.ev.category) ? (
          <span className="max-w-40 shrink truncate text-xs text-muted-foreground">
            {catLabel.get(p.ev.category)}
          </span>
        ) : null}
      </button>
    </li>
  );
  const dayList = (day: number, list: Placed<E>[]) => (
    <section key={day} aria-label={fmt.dayLong.format(asDate(day))}>
      <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
        <span className="truncate">{fmt.dayLong.format(asDate(day))}</span>
        {day === today ? <span className="text-primary">Today</span> : null}
      </h3>
      <ul>{list.map((p) => row(p, day))}</ul>
    </section>
  );
  const nothing = (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyTitle className="text-sm font-normal text-muted-foreground">{empty}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );

  let body: ReactNode;
  if (view === 'agenda') {
    const days: ReactNode[] = [];
    for (let d = from; d < to; d++) {
      const list = byDay.get(d);
      if (list?.length) days.push(dayList(d, list));
    }
    body = days.length ? <div className="flex flex-col gap-2">{days}</div> : nothing;
  } else if (view === 'month') {
    const cells: ReactNode[] = [];
    for (let d = from; d < to; d++) {
      const list = byDay.get(d) ?? [];
      const out = d < first || d >= first + daysIn(y, m);
      const day = ymd(d).d;
      const pick = () => setPicked(d === picked ? null : d);
      cells.push(
        <div
          key={d}
          className={cn(
            'flex min-w-0 flex-col gap-0.5 border-t border-l p-1',
            narrow ? 'min-h-12 items-center' : 'min-h-24',
            out && 'bg-muted/40 text-muted-foreground',
            d === listDay && 'bg-accent',
          )}
        >
          <button
            type="button"
            onClick={pick}
            aria-label={`${fmt.dayLong.format(asDate(d))}, ${list.length} events`}
            aria-pressed={d === listDay}
            className={cn(
              'num flex size-6 shrink-0 items-center justify-center rounded-full text-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              d === today ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {day}
          </button>
          {narrow ? (
            <span className="flex h-2 items-center gap-0.5" aria-hidden>
              {list.slice(0, CELL_EVENTS).map((p) => (
                <span
                  key={p.ev.id}
                  className="size-1.5 rounded-full"
                  style={{ background: p.color }}
                />
              ))}
            </span>
          ) : (
            <>
              {list.slice(0, CELL_EVENTS).map((p) => (
                <button
                  key={p.ev.id}
                  type="button"
                  onClick={() => onSelect?.(p.ev)}
                  title={p.ev.title}
                  className="flex w-full min-w-0 items-center gap-1 rounded-sm px-1 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                  {!p.allDay && d === p.startDay ? (
                    <time className="num shrink-0 text-muted-foreground">
                      {fmt.time.format(asDate(d, p.startMin))}
                    </time>
                  ) : null}
                  <span className="min-w-0 truncate">{p.ev.title}</span>
                </button>
              ))}
              {list.length > CELL_EVENTS ? (
                <button
                  type="button"
                  onClick={pick}
                  className="num truncate rounded-sm px-1 text-left text-xs text-muted-foreground hover:bg-muted"
                >
                  +{list.length - CELL_EVENTS} more
                </button>
              ) : null}
            </>
          )}
        </div>,
      );
    }
    const heads: ReactNode[] = [];
    for (let i = 0; i < 7; i++)
      heads.push(
        <div key={i} className="truncate px-1 py-1 text-center text-xs text-muted-foreground">
          {fmt.weekday.format(asDate(from + i))}
        </div>,
      );
    const listed = listDay !== null ? (byDay.get(listDay) ?? []) : null;
    body = (
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-md border-r border-b">
          <div className="grid grid-cols-7">{heads}</div>
          <div className="grid grid-cols-7">{cells}</div>
        </div>
        {listed !== null && listDay !== null ? (
          listed.length ? (
            dayList(listDay, listed)
          ) : (
            <p className="px-2 text-sm text-muted-foreground">
              {fmt.dayLong.format(asDate(listDay))}: {empty}
            </p>
          )
        ) : null}
      </div>
    );
  } else {
    body = (
      <WeekGrid
        from={from}
        today={today}
        byDay={byDay}
        fmt={fmt}
        onSelect={onSelect}
        timeOf={timeOf}
      />
    );
  }

  return (
    <div ref={box} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <LumenTabs
        tabs={tabs}
        value={view}
        onChange={(v) => {
          setPicked(null);
          setView(v);
        }}
        actions={
          <>
            <IconButton
              icon={CalendarCheckIcon}
              label="Today"
              onClick={() => {
                setPicked(null);
                setDate(new Date());
              }}
            />
            <IconButton
              icon={ChevronLeftIcon}
              label={`Previous ${unit}`}
              onClick={() => step(-1)}
            />
            <IconButton icon={ChevronRightIcon} label={`Next ${unit}`} onClick={() => step(1)} />
          </>
        }
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 truncate text-sm font-semibold" aria-live="polite">
          {title}
        </h2>
        {categories?.length ? (
          <ToggleGroup
            type="multiple"
            size="sm"
            aria-label="Categories"
            value={categories.filter((c) => !hidden.has(c.id)).map((c) => c.id)}
            onValueChange={(on) =>
              setHidden(new Set(categories.filter((c) => !on.includes(c.id)).map((c) => c.id)))
            }
            className="flex-wrap gap-1"
          >
            {categories.map((c) => (
              <ToggleGroupItem
                key={c.id}
                value={c.id}
                aria-label={c.label}
                className="h-auto rounded-sm p-0 data-[state=off]:opacity-50 data-[state=on]:bg-transparent"
              >
                <ColorChip color={c.color}>{c.label}</ColorChip>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>
      <LumenBoundary where="calendar">{body}</LumenBoundary>
    </div>
  );
}

// ── Week ──────────────────────────────────────────────────────────────────────

function WeekGrid<E extends CalendarEvent>({
  from,
  today,
  byDay,
  fmt,
  onSelect,
  timeOf,
}: {
  from: number;
  today: number;
  byDay: Map<number, Placed<E>[]>;
  fmt: Record<'weekday' | 'time' | 'hour' | 'dayLong', Intl.DateTimeFormat>;
  onSelect?: (event: E) => void;
  timeOf: (p: Placed<E>, day: number) => string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: 7 }, (_, i) => from + i);
  const timed = days.map((d) => (byDay.get(d) ?? []).filter((p) => !p.allDay && p.startDay === d));
  const whole = days.map((d) => (byDay.get(d) ?? []).filter((p) => p.allDay || p.startDay !== d));
  const earliest = Math.min(OPEN_HOUR, ...timed.flat().map((p) => Math.floor(p.startMin / 60)));
  // Opening a week scrolls the axis to its first event, or to the morning.
  useLayoutEffect(() => {
    const el = scroller.current;
    const hour = el?.querySelector<HTMLElement>('[data-hour]');
    if (el && hour) el.scrollTop = Math.max(0, (earliest - 0.25) * hour.offsetHeight);
  }, [earliest]);
  const cols = { gridTemplateColumns: '3rem repeat(7, minmax(0, 1fr))' };
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="flex flex-col rounded-md border" style={{ ['--cal-hour' as string]: '3rem' }}>
      <div className="grid border-b" style={cols}>
        <div />
        {days.map((d) => (
          <div key={d} className="flex min-w-0 flex-col items-center py-1 text-xs">
            <span className="truncate text-muted-foreground">{fmt.weekday.format(asDate(d))}</span>
            <span
              className={cn(
                'num flex size-6 items-center justify-center rounded-full',
                d === today && 'bg-primary font-semibold text-primary-foreground',
              )}
            >
              {ymd(d).d}
            </span>
          </div>
        ))}
      </div>
      {whole.some((l) => l.length) ? (
        <div className="grid border-b" style={cols}>
          <div className="truncate px-1 py-1 text-right text-xs text-muted-foreground">All day</div>
          {whole.map((list, i) => (
            <div key={days[i]} className="flex min-w-0 flex-col gap-0.5 border-l p-0.5">
              {list.map((p) => (
                <WeekEvent key={p.ev.id} p={p} onSelect={onSelect} label={p.ev.title} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div ref={scroller} className="max-h-[60vh] overflow-y-auto">
        <div className="relative grid" style={cols}>
          <div>
            {hours.map((h) => (
              <div
                key={h}
                data-hour
                className="relative pr-1 text-right text-xs text-muted-foreground"
                style={{ height: 'var(--cal-hour)' }}
              >
                {h ? (
                  <span className="num -translate-y-1/2 absolute right-1 whitespace-nowrap">
                    {fmt.hour.format(asDate(0, h * 60))}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {days.map((d, i) => (
            <div key={d} className={cn('relative border-l', d === today && 'bg-accent/40')}>
              {hours.map((h) => (
                <div key={h} className="border-t" style={{ height: 'var(--cal-hour)' }} />
              ))}
              {lanes(timed[i] ?? []).map(({ p, lane, of }) => (
                <div
                  key={p.ev.id}
                  className="absolute px-px"
                  style={{
                    top: `calc(${p.startMin / 60} * var(--cal-hour))`,
                    height: `calc(${(Math.min(p.endMin, 1440) - p.startMin) / 60} * var(--cal-hour))`,
                    left: `${(lane / of) * 100}%`,
                    width: `${100 / of}%`,
                  }}
                >
                  <WeekEvent
                    p={p}
                    onSelect={onSelect}
                    label={`${timeOf(p, d)} ${p.ev.title}`}
                    tall
                    time={
                      p.endMin - p.startMin >= 45
                        ? fmt.time.format(asDate(d, p.startMin))
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekEvent<E extends CalendarEvent>({
  p,
  onSelect,
  label,
  tall,
  time,
}: {
  p: Placed<E>;
  onSelect?: (event: E) => void;
  label: string;
  tall?: boolean;
  time?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onSelect?.(p.ev)}
      className={cn(
        'flex w-full min-w-0 flex-col overflow-hidden rounded-sm border-l-2 px-1 text-left text-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        tall && 'h-full',
      )}
      style={{
        borderColor: p.color,
        background: `color-mix(in oklab, ${p.color} 16%, var(--background))`,
        color: `color-mix(in oklab, ${p.color} 45%, var(--foreground))`,
      }}
    >
      <span className="w-full truncate font-medium">{p.ev.title}</span>
      {time ? <time className="num w-full truncate opacity-80">{time}</time> : null}
    </button>
  );
}
