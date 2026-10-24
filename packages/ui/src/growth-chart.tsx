// The growth chart every app shares (moved in from an app): Recharts in
// shadcn's ChartContainer. An app draws growth of $1 for variants and benchmarks with it;
// An app's Portfolio ▸ Performance draws a portfolio's value and money in (an area and a dashed
// line) or its time-weighted growth next to any symbol. Key dates (FOMC, CPI, Jobs) are thin markers,
// each turned on by its chip (all start off); the app fetches the days and hands them in.
import { type ReactNode, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from './lib/utils';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from './ui/chart';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** Ten distinct colours. A variant, an asset or a start keeps one colour on every card and table. */
export const PALETTE = Array.from({ length: 10 }, (_, i) => `var(--chart-${i + 1})`);
export const paletteAt = (i: number) => PALETTE[i % PALETTE.length] ?? '';
/** Benchmarks take the palette's second half, so they never share a colour with a run's lines. */
const BENCH_COLOURS = [5, 6, 7, 8, 9].map((i) => PALETTE[i] ?? '');
export const benchColour = (i: number) => BENCH_COLOURS[i % BENCH_COLOURS.length] ?? '';
/** `log` and `linear` (from 0) for growth of $1; `fit` is linear around the data (Performance). */
export type Scale = 'log' | 'linear' | 'fit';
const YTD_START = '2026-01-01';
/** Log ticks per decade: 1-2-3-5 up to about 300×, then one a decade so labels never collide. */
const decadeSteps = (decades: number) => (decades <= 2.5 ? [1, 2, 3, 5] : [1]);

/** Log axis ticks covering `lo` to `hi`: from the tick at or under the low to the one at or over the high. */
function logTicks(lo: number, hi: number): number[] {
  if (!(lo > 0) || !(hi >= lo)) return [0.5, 1, 2];
  const from = Math.floor(Math.log10(lo));
  const to = Math.ceil(Math.log10(hi));
  const steps = decadeSteps(Math.log10(hi / lo));
  const all: number[] = [];
  for (let e = from; e <= to; e++) {
    // Rounded so 0.1 × 3 reads 0.3, not 0.30000000000000004.
    for (const m of steps) all.push(Number((m * 10 ** e).toPrecision(6)));
  }
  const floor = all.filter((t) => t <= lo).pop() ?? all[0] ?? lo;
  const ceil = all.find((t) => t >= hi) ?? all[all.length - 1] ?? hi;
  return all.filter((t) => t >= floor && t <= ceil);
}
const MINUS = '−';

export type Series = {
  key: string;
  label: string;
  color: string;
  hold: boolean;
  dashed: boolean;
  /** Filled under the line (a portfolio's value). */
  area?: boolean;
  points: [string, number][];
};

// ── Key dates ──

export const KEY_DATE_KINDS = [
  { kind: 'fomc', label: 'FOMC', color: 'var(--key-date-fomc)' },
  { kind: 'cpi', label: 'CPI', color: 'var(--key-date-cpi)' },
  { kind: 'jobs', label: 'Jobs', color: 'var(--key-date-jobs)' },
] as const;
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number]['kind'];
/** A thin vertical line on the chart; its label shows in the tooltip. */
export type ChartMarker = {
  date: string;
  label: string;
  color: string;
  kind?: string;
};
export type KeyDateMarker = ChartMarker & { kind: KeyDateKind };
/**
 * A dashed, labelled line at `from` with the stretch before it shaded: the in-sample part ahead of
 * an out-of-sample date, so the blind part reads plain (shade left of OOS). With `onDrag` the line drags along the dates and the
 * day it lands on is handed back.
 */
export type ChartBand = {
  key: string;
  from: string;
  label: string;
  color: string;
  onDrag?: (date: string) => void;
  /** The line's tag as a control (a button that opens a date picker) in place of its label. */
  tag?: ReactNode;
};

/** The markers the chips turn on, from each kind's days. */
export function keyDateMarkers(
  on: KeyDateKind[],
  dates: Partial<Record<KeyDateKind, string[]>> | undefined,
): KeyDateMarker[] {
  return KEY_DATE_KINDS.filter((k) => on.includes(k.kind)).flatMap((k) =>
    (dates?.[k.kind] ?? []).map((date) => ({ date, ...k })),
  );
}

/** FOMC / CPI / Jobs toggle chips, for a chart card's header. */
export function KeyDateChips({
  on,
  setOn,
}: {
  on: KeyDateKind[];
  setOn: (on: KeyDateKind[]) => void;
}) {
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      size="sm"
      value={on}
      onValueChange={(v) => setOn(v as KeyDateKind[])}
      aria-label="Key dates"
    >
      {KEY_DATE_KINDS.map((k) => (
        <ToggleGroupItem key={k.kind} value={k.kind} aria-label={`${k.label} days`}>
          <span className="h-3 w-0.5 rounded-full" style={{ background: k.color }} />
          {k.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ── The chart ──

/** `1.23×`: growth of $1, the default axis and tooltip. */
const times = (v: number) =>
  `${v < 0 ? MINUS : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
/** Axis ticks stay short (`0.5×`, `20×`, `10K×`) so they fit the axis. */
const shortTimes = (v: number) =>
  `${v < 0 ? MINUS : ''}${Math.abs(v).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    ...(Math.abs(v) >= 1000 ? { notation: 'compact' } : {}),
  })}×`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Growth of $1 (or any values) for a set of lines. `sinceYears` trims to the last N years (the
 * expand view). `markers` are drawn as thin vertical lines, each on the first charted day at or
 * after it. `format` labels the axis and tooltip (default `1.23×`); `ytd` marks this year's start.
 */
export function GrowthChart({
  lines,
  scale,
  className,
  sinceYears,
  markers = [],
  format = times,
  ytd = true,
  bands = [],
}: {
  lines: Series[];
  scale: Scale;
  className: string;
  sinceYears?: number;
  markers?: ChartMarker[];
  format?: (v: number) => string;
  ytd?: boolean;
  bands?: ChartBand[];
}) {
  const config = Object.fromEntries(
    lines.map((l) => [l.key, { label: l.label, color: l.color }]),
  ) satisfies ChartConfig;
  const { rows, ticks, xTicks, monthly, dates, ytdStart } = useMemo(() => {
    let from = '';
    if (sinceYears) {
      const end = lines
        .flatMap((l) => l.points.map((p) => p[0]))
        .sort()
        .pop();
      if (end) {
        const d = new Date(`${end}T00:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() - sinceYears);
        from = d.toISOString().slice(0, 10);
      }
    }
    const byDate = new Map<string, Record<string, number | string>>();
    let lo = Number.POSITIVE_INFINITY;
    let hi = 0;
    for (const l of lines) {
      for (const [d, g] of l.points) {
        if (d < from) continue;
        const row = byDate.get(d) ?? { date: d };
        row[l.key] = g;
        byDate.set(d, row);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
    }
    const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const ticks = logTicks(lo, hi);
    const dates = rows.map((r) => String(r.date));
    // Under about two years the axis marks months (each quarter's past a year), else years.
    const first = dates[0] ?? '';
    const last = dates[dates.length - 1] ?? '';
    const days = first ? (Date.parse(last) - Date.parse(first)) / 86_400_000 : 0;
    const monthly = days < 400;
    const step = days < 120 ? 1 : 3;
    const xTicks = monthly
      ? dates.filter(
          (d, i, a) =>
            i > 0 &&
            d.slice(0, 7) !== a[i - 1]?.slice(0, 7) &&
            (Number(d.slice(5, 7)) - 1) % step === 0,
        )
      : dates.filter((d, i, a) => d.slice(0, 4) !== a[i - 1]?.slice(0, 4));
    return {
      rows,
      ticks,
      xTicks,
      monthly,
      dates,
      ytdStart: ytd ? dates.find((d) => d >= YTD_START) : undefined,
    };
  }, [lines, sinceYears, ytd]);
  // A thinned curve skips days, so each marker snaps to the next charted day; days outside it drop.
  const { snapped, eventsOn } = useMemo(() => {
    const snapped: (ChartMarker & { x: string })[] = [];
    const eventsOn = new Map<string, string[]>();
    const first = dates[0];
    if (!first) return { snapped, eventsOn };
    let i = 0;
    for (const m of [...markers].sort((a, b) => a.date.localeCompare(b.date))) {
      if (m.date < first) continue;
      while (i < dates.length && (dates[i] ?? '') < m.date) i++;
      const x = dates[i];
      if (!x) break;
      snapped.push({ ...m, x });
      eventsOn.set(x, [...(eventsOn.get(x) ?? []), m.label]);
    }
    return { snapped, eventsOn };
  }, [markers, dates]);
  // A band's line drags: a press near it picks it up, the move shows where it goes, release hands it back.
  const [drag, setDrag] = useState<{ key: string; at: string } | null>(null);
  const snap = (d: string) => dates.find((x) => x >= d);
  const near = (label: unknown) => {
    const i = dates.indexOf(String(label));
    if (i < 0) return null;
    const reach = Math.max(2, Math.round(dates.length / 40));
    return (
      bands.find((b) => {
        const at = snap(b.from);
        return b.onDrag && at !== undefined && Math.abs(dates.indexOf(at) - i) <= reach;
      }) ?? null
    );
  };
  const label = (s: unknown) =>
    s && typeof s === 'object' && 'activeLabel' in s
      ? (s as { activeLabel?: unknown }).activeLabel
      : null;
  const last = dates[dates.length - 1];
  return (
    <ChartContainer
      config={config}
      className={cn(className, drag && 'cursor-col-resize select-none')}
    >
      <ComposedChart
        data={rows}
        margin={{ left: 0, right: 8 }}
        onMouseDown={(s) => {
          const b = near(label(s));
          if (b) setDrag({ key: b.key, at: String(label(s)) });
        }}
        onMouseMove={(s) => {
          const at = label(s);
          if (drag && at) setDrag({ ...drag, at: String(at) });
        }}
        onMouseUp={() => {
          if (!drag) return;
          bands.find((b) => b.key === drag.key)?.onDrag?.(drag.at);
          setDrag(null);
        }}
        onMouseLeave={() => setDrag(null)}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          ticks={xTicks}
          tickFormatter={(d: string) =>
            monthly ? (MONTHS[Number(d.slice(5, 7)) - 1] ?? '') : d.slice(0, 4)
          }
          tickLine={false}
          axisLine={false}
        />
        {scale === 'log' ? (
          <YAxis
            scale="log"
            domain={[ticks[0] ?? 0.5, ticks[ticks.length - 1] ?? 10]}
            ticks={ticks}
            tickFormatter={format === times ? shortTimes : format}
            tickLine={false}
            axisLine={false}
            width={40}
            allowDataOverflow
          />
        ) : (
          <YAxis
            domain={scale === 'fit' ? ['auto', 'auto'] : [0, 'auto']}
            tickFormatter={format}
            tickLine={false}
            axisLine={false}
            width={scale === 'fit' ? 56 : 40}
          />
        )}
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(label) => {
                const events = eventsOn.get(String(label));
                return events ? `${label} · ${events.join(', ')}` : label;
              }}
              formatter={(value, name) => (
                <div className="flex w-full items-center gap-2">
                  <span
                    className="h-0.5 w-3 shrink-0 rounded-full"
                    style={{ background: `var(--color-${name})` }}
                  />
                  <span className="flex-1 text-muted-foreground">
                    {config[name as keyof typeof config]?.label}
                  </span>
                  <span className="num">{format(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {ytdStart && (
          <ReferenceLine
            x={ytdStart}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
            label={{ value: '2026 YTD', position: 'insideTopRight', fontSize: 11 }}
          />
        )}
        {bands.map((b) => {
          const x = drag?.key === b.key ? drag.at : snap(b.from);
          if (!x || !last) return null;
          return [
            <ReferenceArea
              key={`${b.key}-area`}
              x1={dates[0]}
              x2={x}
              fill={b.color}
              fillOpacity={0.07}
              ifOverflow="hidden"
            />,
            <ReferenceLine
              key={`${b.key}-line`}
              x={x}
              stroke={b.color}
              strokeWidth={drag?.key === b.key ? 2 : 1.25}
              strokeDasharray="4 3"
              label={
                b.tag && drag?.key !== b.key
                  ? (p: { viewBox?: { x?: number; y?: number } }) => (
                      <BandTag
                        x={p.viewBox?.x ?? 0}
                        y={p.viewBox?.y ?? 0}
                        left={dates.indexOf(x) > dates.length * 0.7}
                      >
                        {b.tag}
                      </BandTag>
                    )
                  : {
                      value: drag?.key === b.key ? `${b.label} ${x}` : b.label,
                      // Late in the chart the label sits left of its line, so it stays on the chart.
                      position:
                        dates.indexOf(x) > dates.length * 0.7 ? 'insideTopRight' : 'insideTopLeft',
                      fontSize: 11,
                      fill: b.color,
                    }
              }
            />,
          ];
        })}
        {snapped.map((m) => (
          <ReferenceLine
            key={`${m.kind ?? m.label}-${m.date}`}
            x={m.x}
            stroke={m.color}
            strokeOpacity={0.45}
            strokeWidth={1}
            ifOverflow="extendDomain"
          />
        ))}
        {lines.map((l) =>
          l.area ? (
            <Area
              key={l.key}
              dataKey={l.key}
              type="linear"
              stroke={`var(--color-${l.key})`}
              fill={`var(--color-${l.key})`}
              fillOpacity={0.12}
              strokeWidth={l.hold ? 1.5 : 2.2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={l.key}
              dataKey={l.key}
              stroke={`var(--color-${l.key})`}
              strokeWidth={l.hold ? 1.5 : 2.2}
              strokeDasharray={l.dashed ? '5 3' : undefined}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ),
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

/** A band's tag beside its line: HTML in the chart, kept out of the line's drag. */
function BandTag({
  x,
  y,
  left,
  children,
}: {
  x: number;
  y: number;
  left: boolean;
  children: ReactNode;
}) {
  const w = 168;
  return (
    <foreignObject x={left ? x - w - 4 : x + 4} y={y + 2} width={w} height={28}>
      <div
        className={cn('flex', left && 'justify-end')}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </foreignObject>
  );
}
