// Chart widgets: each leads with a headline number; bars are a ranked
// list on full tracks (or split into parts by a text field), the donut carries its total in the
// middle, allocation names its wide slices. Flat marks, no glow. Recharts only.
import { type ReactNode, useId, useState } from 'react';
import {
  Bar,
  BarChart,
  type BarShapeProps,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  Rectangle,
  XAxis,
  YAxis,
  type YAxisTickContentProps,
  usePlotArea,
} from 'recharts';
import { cn } from './lib/utils';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';

/** Parts a split bar shows on their own; the rest fold into Other. */
export const STACK_MAX = 5;

type Item = { name: string; v: number; fill: string };
type Fmt = (v: number) => string;

/** A column's rounded top. */
const CAP: [number, number, number, number] = [3, 3, 0, 0];

/** The widget's lead number over its chart: total and a short caption. */
export function Headline({
  value,
  caption,
  tone,
}: {
  value: string;
  caption: ReactNode;
  tone?: 'gain' | 'loss';
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span
        className={cn(
          'num font-semibold tracking-tight',
          'text-2xl',
          tone === 'gain' && 'text-gain',
          tone === 'loss' && 'text-loss',
        )}
      >
        {value}
      </span>
      <span className="truncate text-xs text-muted-foreground">{caption}</span>
    </div>
  );
}

/** Name and share over each bar, value at the track's right end. */
function RankLabel(p: {
  x?: number;
  y?: number;
  index?: number;
  items: Item[];
  fmt: Fmt;
  share: (v: number) => string;
}) {
  const area = usePlotArea();
  const it = p.items[p.index ?? 0];
  if (!it || !area) return null;
  const y = Number(p.y) - 6;
  return (
    <g>
      <text x={area.x} y={y} className="fill-foreground" fontSize={12} fontWeight={500}>
        {it.name.length > 26 ? `${it.name.slice(0, 25)}…` : it.name}
      </text>
      <text
        x={area.x + area.width}
        y={y}
        textAnchor="end"
        fontSize={12}
        className="num fill-foreground"
      >
        <tspan className="fill-muted-foreground" fontSize={11}>
          {p.share(it.v)}
          {'  '}
        </tspan>
        {p.fmt(it.v)}
      </text>
    </g>
  );
}

/** Each bar split into parts (an account's sectors) on a full track; name and total over it. */
export function StackedBars({
  rows,
  parts,
  fmt,
  exact,
  share,
}: {
  rows: Record<string, number | string>[];
  parts: { name: string; key: string; fill: string }[];
  fmt: Fmt;
  exact: Fmt;
  share: (v: number) => string;
}) {
  const hi = Math.max(0, ...rows.map((r) => Number(r.total)));
  const config: ChartConfig = Object.fromEntries(
    parts.map((p) => [p.key, { label: p.name, color: p.fill }]),
  );
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => {
        const total = Number(r.total);
        return (
          <div key={String(r.name)} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="truncate font-medium">{String(r.name)}</span>
              <span className="num ml-auto text-[11px] text-muted-foreground">{share(total)}</span>
              <span className="num">{fmt(total)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <ChartContainer config={config} className="aspect-auto h-full w-full">
                <BarChart
                  data={[r]}
                  layout="vertical"
                  margin={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  barCategoryGap={0}
                >
                  <XAxis type="number" hide domain={[0, hi]} />
                  <YAxis type="category" hide />
                  <ChartTooltip
                    cursor={false}
                    shared={false}
                    allowEscapeViewBox={{ x: false, y: true }}
                    wrapperStyle={{ zIndex: 50 }}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(v, name) => (
                          <span className="flex w-full items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: config[String(name)]?.color }}
                            />
                            <span>{config[String(name)]?.label}</span>
                            <span className="num ml-auto pl-3 whitespace-nowrap">
                              {exact(Number(v))} ·{' '}
                              {total ? ((Number(v) / total) * 100).toFixed(1) : 0}%
                            </span>
                          </span>
                        )}
                      />
                    }
                  />
                  {parts.map((p) => (
                    <Bar
                      key={p.key}
                      dataKey={p.key}
                      stackId="a"
                      fill={p.fill}
                      stroke="var(--card)"
                      strokeWidth={1}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        );
      })}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: p.fill }} />
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Columns over time (one per day, week or month), each split into stacked parts: what worked and
 * what failed per day, spend per category per month. Oldest on the left; the top part gets the
 * rounded cap; the tooltip lists every part and the column's total.
 */
export function StackedColumns({
  rows,
  x,
  parts,
  label,
  height = 220,
  tick = String,
  fmt = (v) => v.toLocaleString(),
  legend = true,
}: {
  /** One row per period, oldest first: the `x` field plus a number for each part's key. */
  rows: Record<string, number | string>[];
  /** The field that names each column (a date, a month). */
  x: string;
  parts: { name: string; key: string; fill: string }[];
  /** What the chart shows, for screen readers. */
  label: string;
  height?: number;
  /** How a column's name reads under it (a date as `10-22`). */
  tick?: (v: string) => string;
  fmt?: Fmt;
  /** The parts' names under the columns. */
  legend?: boolean;
}) {
  const config: ChartConfig = Object.fromEntries(
    parts.map((p) => [p.key, { label: p.name, color: p.fill }]),
  );
  const total = (r: Record<string, number | string>) =>
    parts.reduce((n, p) => n + (Number(r[p.key]) || 0), 0);
  // The highest part with a value carries the column's rounded cap.
  const top = (r: Record<string, number | string>) =>
    parts.findLast((p) => Number(r[p.key]) > 0)?.key;
  const ticks = niceTicks(
    Math.max(0, ...rows.map(total)),
    4,
    rows.every((r) => Number.isInteger(total(r))),
  );
  return (
    <div className="flex flex-col gap-2">
      <ChartContainer
        config={config}
        role="img"
        aria-label={label}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <BarChart data={rows} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={x}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={12}
            tickFormatter={(v) => tick(String(v))}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            domain={[0, ticks.at(-1) ?? 'auto']}
            ticks={ticks}
            width={axisWidth(ticks.map(fmt))}
            tick={axisTick(fmt)}
          />
          <ChartTooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const r = payload?.[0]?.payload as Record<string, number | string> | undefined;
                  return r ? (
                    <span className="flex w-full gap-3">
                      <span>{tick(String(r[x]))}</span>
                      <span className="num ml-auto">{fmt(total(r))}</span>
                    </span>
                  ) : null;
                }}
                formatter={(v, name) => (
                  <span className="flex w-full items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{ background: config[String(name)]?.color }}
                    />
                    <span>{config[String(name)]?.label}</span>
                    <span className="num ml-auto pl-3">{fmt(Number(v))}</span>
                  </span>
                )}
              />
            }
          />
          {parts.map((p) => (
            <Bar
              key={p.key}
              dataKey={p.key}
              stackId="a"
              fill={p.fill}
              isAnimationActive={false}
              shape={(b: BarShapeProps) => (
                <Rectangle
                  {...b}
                  radius={top(b.payload as Record<string, number | string>) === p.key ? CAP : 0}
                />
              )}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {legend && (
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: p.fill }} />
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lines over time (visits, sign-ups per day), each its own colour; a line with `right` reads off a
 *  second axis on the right, for a count far smaller than the others. */
export function TimeLines({
  rows,
  x,
  lines,
  label,
  height = 220,
  tick = String,
  fmt = (v) => v.toLocaleString(),
  legend = true,
}: {
  /** One row per period, oldest first: the `x` field plus a number (or null for no data) for
   *  each line's key. */
  rows: Record<string, number | string | null>[];
  /** The field that names each period (a date, a month). */
  x: string;
  lines: { name: string; key: string; fill: string; right?: boolean }[];
  /** What the chart shows, for screen readers. */
  label: string;
  height?: number;
  /** How a period's name reads under the chart (a date as `10-22`). */
  tick?: (v: string) => string;
  fmt?: Fmt;
  /** The lines' names under the chart. */
  legend?: boolean;
}) {
  const config: ChartConfig = Object.fromEntries(
    lines.map((l) => [l.key, { label: l.name, color: l.fill }]),
  );
  const axis = (right: boolean) => {
    const keys = lines.filter((l) => !!l.right === right).map((l) => l.key);
    const values = rows.flatMap((r) => keys.map((k) => Number(r[k]) || 0));
    return niceTicks(Math.max(0, ...values), 4, values.every(Number.isInteger));
  };
  const left = axis(false);
  const hasRight = lines.some((l) => l.right);
  const right = hasRight ? axis(true) : [];
  return (
    <div className="flex flex-col gap-2">
      <ChartContainer
        config={config}
        role="img"
        aria-label={label}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <LineChart data={rows} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={x}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={12}
            tickFormatter={(v) => tick(String(v))}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            domain={[0, left.at(-1) ?? 'auto']}
            ticks={left}
            width={axisWidth(left.map(fmt))}
            tick={axisTick(fmt)}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              domain={[0, right.at(-1) ?? 'auto']}
              ticks={right}
              width={axisWidth(right.map(fmt))}
              tick={axisTick(fmt)}
            />
          )}
          <ChartTooltip
            cursor={{ stroke: 'var(--border)' }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const r = payload?.[0]?.payload as Record<string, unknown> | undefined;
                  return r ? tick(String(r[x])) : null;
                }}
                formatter={(v, name) => (
                  <span className="flex w-full items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{ background: config[String(name)]?.color }}
                    />
                    <span>{config[String(name)]?.label}</span>
                    <span className="num ml-auto pl-3">{fmt(Number(v))}</span>
                  </span>
                )}
              />
            }
          />
          {lines.map((l) => (
            <Line
              key={l.key}
              dataKey={l.key}
              yAxisId={l.right ? 'right' : 'left'}
              type="monotone"
              stroke={l.fill}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      {legend && (
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: l.fill }} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Horizontal bars as a ranked list: a full track per row, each bar its own colour. */
export function RankedBars({
  id,
  items,
  signed = false,
  fmt = (v) => v.toLocaleString(),
  share = 'total',
  empty = 'None yet.',
  label,
}: {
  /** Keeps the bars' gradients apart when one page draws several; one is made when left out. */
  id?: string;
  items: Item[];
  /** Bars can go below zero (a loss); otherwise they start at zero. */
  signed?: boolean;
  fmt?: Fmt;
  /** The small figure before each value: its % of all bars (`total`), of the first bar
   *  (`first`, for a funnel), the app's own text, or `false` for none. */
  share?: 'total' | 'first' | false | ((v: number) => string);
  /** Shown in place of the bars when there are none. */
  empty?: ReactNode;
  /** What the bars show, for screen readers. */
  label?: string;
}) {
  const ownId = useId();
  const gid = id ?? ownId;
  if (!items.length) return <p className="p-3 text-sm text-muted-foreground">{empty}</p>;
  const base =
    share === 'first' ? (items[0]?.v ?? 0) : items.reduce((t, i) => t + Math.abs(i.v), 0);
  const shareText =
    typeof share === 'function'
      ? share
      : share === false
        ? () => ''
        : (v: number) => (base ? `${Math.round((v / base) * 100)}%` : '');
  const ROW = 34;
  const lo = Math.min(0, ...items.map((i) => i.v));
  const hi = Math.max(0, ...items.map((i) => i.v));
  const config: ChartConfig = { v: { label: 'Value', color: 'var(--chart-1)' } };
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: items.length * ROW + 14 }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <BarChart
        data={items}
        layout="vertical"
        margin={{ left: 0, right: 0, top: 14, bottom: 0 }}
        barCategoryGap={0}
      >
        <defs>
          {items.map((it, i) => (
            <linearGradient key={it.name} id={`rb-${gid}-${i}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={it.fill} stopOpacity={it.v < 0 ? 1 : 0.35} />
              <stop offset="100%" stopColor={it.fill} stopOpacity={it.v < 0 ? 0.35 : 1} />
            </linearGradient>
          ))}
        </defs>
        <XAxis type="number" hide domain={signed ? [lo, hi] : [0, hi]} />
        <YAxis type="category" dataKey="name" hide />
        <Bar
          dataKey="v"
          barSize={10}
          radius={5}
          background={{ fill: 'var(--muted)', radius: 5 }}
          isAnimationActive={false}
        >
          {items.map((it, i) => (
            <Cell key={it.name} fill={`url(#rb-${gid}-${i})`} style={{ color: it.fill }} />
          ))}
          <LabelList
            dataKey="v"
            content={<RankLabel items={items} fmt={fmt} share={shareText} />}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** A donut with its total in the middle; hovering a slice or its legend line shows its share. */
export function Donut({
  items,
  total,
  fmt,
  share,
  caption,
  legend = true,
}: {
  items: Item[];
  total: number;
  fmt: Fmt;
  share: (v: number) => string;
  caption: string;
  /** Its lines under the ring (Edit widget ▸ Controls ▸ Legend). */
  legend?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const config: ChartConfig = Object.fromEntries(
    items.map((s) => [s.name, { label: s.name, color: s.fill }]),
  );
  const hot = active === null ? null : items[active];
  return (
    <div className="flex flex-col items-center gap-4">
      <ChartContainer
        config={config}
        className={cn('aspect-square shrink-0 [&_.recharts-surface]:overflow-visible', 'size-44')}
      >
        <PieChart>
          <Pie
            data={items}
            dataKey="v"
            nameKey="name"
            innerRadius={54}
            outerRadius={78}
            paddingAngle={2}
            cornerRadius={4}
            stroke="none"
            isAnimationActive={false}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            {items.map((s) => (
              <Cell
                key={s.name}
                fill={s.fill}
                fillOpacity={active === null || items[active] === s ? 1 : 0.3}
                style={{ color: s.fill }}
              />
            ))}
            <Label
              position="center"
              content={() => {
                const cx = '50%';
                const cy = '50%';
                return (
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan
                      x={cx}
                      dy="-0.4em"
                      className="num fill-foreground"
                      fontSize={16}
                      fontWeight={600}
                    >
                      {hot ? share(hot.v) : fmt(total)}
                    </tspan>
                    <tspan x={cx} dy="1.5em" className="fill-muted-foreground" fontSize={11}>
                      {hot
                        ? hot.name.length > 14
                          ? `${hot.name.slice(0, 13)}…`
                          : hot.name
                        : caption}
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      {legend && (
        <ul className="grid w-full min-w-0 grid-cols-2 gap-x-5 gap-y-1.5 text-xs">
          {items.map((s, i) => (
            <li
              key={s.name}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded px-1 transition-opacity',
                active !== null && active !== i && 'opacity-40',
              )}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.fill }} />
              <span className="truncate font-medium">{s.name}</span>
              <span className="num ml-auto pl-2 text-muted-foreground">{share(s.v)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One stacked bar with gaps, the name and share inside each slice wide enough for them. */
export function AllocationBar({
  items,
  total,
  config,
  tooltip,
  share,
}: {
  items: (Item & { key: string })[];
  total: number;
  config: ChartConfig;
  tooltip: ReactNode;
  share: (v: number) => string;
}) {
  const row = Object.fromEntries(items.map((s) => [s.key, s.v]));
  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto h-9 w-full [&_.recharts-surface]:[clip-path:inset(0_round_8px)]')}
    >
      <BarChart data={[row]} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
        <defs>
          {items.map((s) => (
            <linearGradient key={s.key} id={`al-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.fill} stopOpacity={1} />
              <stop offset="100%" stopColor={s.fill} stopOpacity={0.6} />
            </linearGradient>
          ))}
        </defs>
        <XAxis type="number" hide domain={[0, total]} />
        <YAxis type="category" hide />
        {tooltip}
        {items.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="a"
            fill={`url(#al-${s.key})`}
            stroke="var(--card)"
            strokeWidth={3}
            isAnimationActive={false}
          >
            <LabelList
              dataKey={s.key}
              content={(p) => {
                const w = Number(p.width);
                const text = `${s.name} ${share(s.v)}`;
                if (w < text.length * 7 + 16) return null;
                const name =
                  s.name.length > Math.floor(w / 8)
                    ? `${s.name.slice(0, Math.floor(w / 8) - 1)}…`
                    : s.name;
                return (
                  <text
                    x={Number(p.x) + 8}
                    y={Number(p.y) + Number(p.height) / 2}
                    dy="0.35em"
                    fontSize={11}
                    fontWeight={600}
                    style={{ fill: 'var(--background)' }}
                  >
                    {name}
                    <tspan fontWeight={400} dx={6} className="num">
                      {share(s.v)}
                    </tspan>
                  </text>
                );
              }}
            />
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Round axis steps (1, 2, 2.5 or 5 times a power of ten) from 0 to just above `max`, about four
 * of them, so a value axis reads 0, 100k, 200k, 300k rather than 95k, 190k, 285k. When every value
 * is a whole number (a count), so is every step: 0, 1, 2 rather than 0, 0.5, 1, 1.5.
 */
function niceTicks(max: number, count = 4, whole = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const steps = whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = Math.max(whole ? 1 : 0, (steps.find((m) => m * pow >= raw) ?? 10) * pow);
  const n = Math.ceil(max / step - 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
}

/** Room for the widest tick label (about 7.5px a character at text-xs), so none is clipped. */
const axisWidth = (labels: string[]) =>
  Math.max(24, Math.max(0, ...labels.map((l) => l.length)) * 7.5 + 8);

/**
 * A value axis's tick on one line: the chart's own text breaks a label at its space (`300` over
 * `GB`) when the axis is a hair too narrow, and the top one then runs off the chart.
 */
const axisTick =
  (fmt: Fmt) =>
  ({ x, y, payload, textAnchor }: YAxisTickContentProps) => (
    <text
      x={x}
      y={y}
      dy="0.355em"
      textAnchor={(textAnchor as 'start' | 'middle' | 'end' | undefined) ?? 'end'}
      className="fill-muted-foreground"
      style={{ whiteSpace: 'pre' }}
    >
      {fmt(Number(payload.value))}
    </text>
  );
