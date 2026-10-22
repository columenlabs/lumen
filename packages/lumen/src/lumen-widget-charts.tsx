// Chart widgets: each leads with a headline number; bars are a ranked
// list on full tracks (or split into parts by a text field), the donut carries its total in the
// middle, allocation names its wide slices. Flat marks, no glow. Recharts only.
import { type ReactNode, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Label,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  usePlotArea,
} from 'recharts';
import { cn } from './lib/utils';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';

/** Parts a split bar shows on their own; the rest fold into Other. */
export const STACK_MAX = 5;

type Item = { name: string; v: number; fill: string };
type Fmt = (v: number) => string;

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

/** Horizontal bars as a ranked list: a full track per row, each bar its own colour. */
export function RankedBars({
  id,
  items,
  signed,
  fmt,
  share,
}: {
  id: string;
  items: Item[];
  signed: boolean;
  fmt: Fmt;
  share: (v: number) => string;
}) {
  const ROW = 34;
  const lo = Math.min(0, ...items.map((i) => i.v));
  const hi = Math.max(0, ...items.map((i) => i.v));
  const config: ChartConfig = { v: { label: 'Value', color: 'var(--chart-1)' } };
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: items.length * ROW + 14 }}
    >
      <BarChart
        data={items}
        layout="vertical"
        margin={{ left: 0, right: 0, top: 14, bottom: 0 }}
        barCategoryGap={0}
      >
        <defs>
          {items.map((it, i) => (
            <linearGradient key={it.name} id={`rb-${id}-${i}`} x1="0" x2="1" y1="0" y2="0">
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
            <Cell key={it.name} fill={`url(#rb-${id}-${i})`} style={{ color: it.fill }} />
          ))}
          <LabelList dataKey="v" content={<RankLabel items={items} fmt={fmt} share={share} />} />
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
