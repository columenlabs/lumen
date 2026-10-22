// Trend widgets: up to 4 number fields over a date field of the view's rows, rolled up per day, week,
// month or year, drawn as a line, area, stacked area, bars over time, combo, a spark or a tracker.
// With the allocation, donut, bars and card styles they cover every Tremor visualization, drawn on
// our own Recharts in ChartContainer. Worked out in the browser from the rows; nothing is fetched.
import {
  type TrendBucket,
  type TrendStyle,
  type ViewFormat,
  isDollarFormat,
} from '@columenlabs/lumen-types/views';
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from './lib/utils';
import { Headline } from './lumen-widget-charts';
import { maskAmount, useAmountsHidden } from './shell';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from './ui/chart';
import type { ViewCellValue, ViewField } from './view-model';

const MINUS = '−';
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
// Chart 2 is skipped: it is green, and an app whose accent (chart 1) is green drew its first two
// series alike (an app's Income and Spend).
const COLORS = [1, 3, 4, 5].map((i) => `var(--chart-${i})`);
/** Blocks a tracker shows, the newest last. */
const TRACKER_MAX = 60;

function short(v: number, format: ViewFormat, hidden: boolean) {
  if (hidden) return maskAmount('0');
  const sign = v < 0 ? MINUS : '';
  const abs = Math.abs(v);
  if (format === 'percent' || format === 'weight') return `${sign}${abs.toFixed(1)}%`;
  if (isDollarFormat(format)) return `${sign}$${COMPACT.format(abs)}`;
  return `${sign}${COMPACT.format(abs)}`;
}

/** A row's date as a bucket key (`2026-10-16`, `2026-10-12` the week's Monday, `2026-10`, `2026`). */
export function bucketOf(v: ViewCellValue, bucket: TrendBucket): string | null {
  if (v === null || v === '') return null;
  const ms =
    typeof v === 'number' ? v : Date.parse(String(v).length === 10 ? `${v}T12:00:00Z` : String(v));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const day = d.toISOString().slice(0, 10);
  if (bucket === 'day') return day;
  if (bucket === 'month') return day.slice(0, 7);
  if (bucket === 'year') return day.slice(0, 4);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(ms - back * 86_400_000).toISOString().slice(0, 10);
}

type Agg = 'sum' | 'mean' | 'last' | 'count';

/** The rows rolled up per bucket, oldest first: `{at, v0, v1, ...}`. */
export function trendPoints<T>(
  rows: T[],
  date: ViewField<T>,
  values: ViewField<T>[],
  bucket: TrendBucket,
  agg: Agg,
  read: (f: ViewField<T>, r: T) => ViewCellValue,
) {
  const m = new Map<string, { sum: number[]; n: number[]; last: number[] }>();
  // Rows in date order, so `last` is the latest in each bucket.
  const dated = rows
    .map((r) => ({ r, at: bucketOf(read(date, r), bucket), raw: String(read(date, r) ?? '') }))
    .filter((x): x is { r: T; at: string; raw: string } => x.at !== null)
    .sort((a, b) => a.raw.localeCompare(b.raw));
  for (const { r, at } of dated) {
    const b = m.get(at) ?? {
      sum: values.map(() => 0),
      n: values.map(() => 0),
      last: values.map(() => 0),
    };
    values.forEach((f, i) => {
      const v = read(f, r);
      if (agg === 'count') {
        b.n[i] = (b.n[i] ?? 0) + 1;
        return;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      b.sum[i] = (b.sum[i] ?? 0) + v;
      b.n[i] = (b.n[i] ?? 0) + 1;
      b.last[i] = v;
    });
    m.set(at, b);
  }
  return [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([at, b]) => {
      const out: Record<string, number | string> = { at };
      values.forEach((_, i) => {
        const n = b.n[i] ?? 0;
        out[`v${i}`] =
          agg === 'count'
            ? n
            : agg === 'mean'
              ? n
                ? (b.sum[i] ?? 0) / n
                : 0
              : agg === 'last'
                ? (b.last[i] ?? 0)
                : (b.sum[i] ?? 0);
      });
      return out;
    });
}

/** A bucket key as an axis label: `Oct 16`, `Oct 2026`, `2026`. */
function tick(at: string, bucket: TrendBucket) {
  if (bucket === 'year') return at;
  if (bucket === 'month')
    return new Date(`${at}-15T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  return new Date(`${at}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function TrendBody<T>({
  style,
  date,
  values,
  bucket,
  agg,
  rows,
  read,
  legend = true,
}: {
  style: TrendStyle;
  date: ViewField<T>;
  values: ViewField<T>[];
  bucket: TrendBucket;
  agg: Agg;
  rows: T[];
  read: (f: ViewField<T>, r: T) => ViewCellValue;
  legend?: boolean;
}) {
  const hidden = useAmountsHidden();
  const points = useMemo(
    () => trendPoints(rows, date, values, bucket, agg, read),
    [rows, date, values, bucket, agg, read],
  );
  const first = values[0];
  if (!points.length || !first)
    return <p className="py-6 text-center text-sm text-muted-foreground">No dated rows to draw.</p>;
  const masked = (f: ViewField<T>) => hidden && !!f.amount && agg !== 'count';
  const fmt = (v: number, f: ViewField<T> = first) =>
    short(v, agg === 'count' ? 'rounded' : f.format, masked(f));
  const config: ChartConfig = Object.fromEntries(
    values.map((f, i) => [
      `v${i}`,
      { label: agg === 'count' ? `${f.label} (count)` : f.label, color: COLORS[i] },
    ]),
  );
  const last = Number(points[points.length - 1]?.v0 ?? 0);
  const start = Number(points[0]?.v0 ?? 0);

  if (style === 'tracker') {
    // One block per bucket, the newest last: green where the first value rose or is positive.
    const shown = points.slice(-TRACKER_MAX);
    const up = shown.filter((p) => Number(p.v0) > 0).length;
    return (
      <div className="flex flex-col gap-2">
        <Headline
          value={fmt(last)}
          caption={`${first.label} · ${up} of ${shown.length} ${bucket}s up`}
          tone={last > 0 ? 'gain' : last < 0 ? 'loss' : undefined}
        />
        <div
          className="flex h-8 w-full gap-0.5"
          role="img"
          aria-label={`${first.label} by ${bucket}`}
        >
          {shown.map((p) => {
            const v = Number(p.v0);
            return (
              <span
                key={String(p.at)}
                title={`${tick(String(p.at), bucket)} · ${fmt(v)}`}
                className={cn(
                  'h-full min-w-0 flex-1 rounded-[2px]',
                  v > 0 ? 'bg-gain' : v < 0 ? 'bg-loss' : 'bg-muted',
                )}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (style === 'spark') {
    const change = last - start;
    return (
      <div className="flex flex-col gap-1">
        <Headline
          value={fmt(last)}
          caption={`${change >= 0 ? '+' : ''}${fmt(change)} since ${tick(String(points[0]?.at), bucket)}`}
          tone={change > 0 ? 'gain' : change < 0 ? 'loss' : undefined}
        />
        <ChartContainer config={config} className="aspect-auto h-12 w-full">
          <AreaChart data={points} margin={{ left: 0, right: 0, top: 2, bottom: 2 }}>
            <Area
              dataKey="v0"
              type="monotone"
              stroke="var(--color-v0)"
              fill="var(--color-v0)"
              fillOpacity={0.15}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    );
  }

  const axes = [
    <CartesianGrid key="g" vertical={false} strokeDasharray="3 3" />,
    <XAxis
      key="x"
      dataKey="at"
      tickLine={false}
      axisLine={false}
      minTickGap={24}
      tickFormatter={(v) => tick(String(v), bucket)}
      fontSize={11}
    />,
    <YAxis
      key="y"
      tickLine={false}
      axisLine={false}
      width={48}
      tickFormatter={(v) => fmt(Number(v))}
      fontSize={11}
    />,
    <ChartTooltip
      key="t"
      content={
        <ChartTooltipContent
          labelFormatter={(v) => tick(String(v), bucket)}
          formatter={(v, name) => {
            const i = Number(String(name).slice(1));
            const f = values[i] ?? first;
            return (
              <span className="flex w-full items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: COLORS[i] }} />
                <span className="truncate">{config[String(name)]?.label}</span>
                <span className="num ml-auto pl-3">{fmt(Number(v), f)}</span>
              </span>
            );
          }}
        />
      }
    />,
    ...(legend && values.length > 1
      ? [<ChartLegend key="l" content={<ChartLegendContent />} />]
      : []),
  ];
  const lead = (
    <Headline
      value={fmt(last)}
      caption={`${config.v0?.label} · ${tick(String(points[points.length - 1]?.at), bucket)}`}
    />
  );
  const box = 'aspect-auto h-56 w-full';
  const keys = values.map((_, i) => `v${i}`);
  return (
    <div className="flex flex-col">
      {lead}
      <ChartContainer config={config} className={box}>
        {style === 'bars' ? (
          <BarChart data={points} margin={{ left: 0, right: 4 }}>
            {axes}
            {keys.map((k) => (
              <Bar
                key={k}
                dataKey={k}
                fill={`var(--color-${k})`}
                radius={2}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : style === 'combo' ? (
          <ComposedChart data={points} margin={{ left: 0, right: 4 }}>
            {axes}
            {keys.map((k, i) =>
              i === 0 ? (
                <Bar
                  key={k}
                  dataKey={k}
                  fill={`var(--color-${k})`}
                  radius={2}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={k}
                  dataKey={k}
                  type="monotone"
                  stroke={`var(--color-${k})`}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        ) : style === 'area' || style === 'stacked' ? (
          <AreaChart data={points} margin={{ left: 0, right: 4 }}>
            {axes}
            {keys.map((k) => (
              <Area
                key={k}
                dataKey={k}
                type="monotone"
                stackId={style === 'stacked' ? 'a' : undefined}
                stroke={`var(--color-${k})`}
                fill={`var(--color-${k})`}
                fillOpacity={0.15}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={points} margin={{ left: 0, right: 4 }}>
            {axes}
            {keys.map((k) => (
              <Line
                key={k}
                dataKey={k}
                type="monotone"
                stroke={`var(--color-${k})`}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </div>
  );
}
