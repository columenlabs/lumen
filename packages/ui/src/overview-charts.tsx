// The Overview's chart widgets (ring, bars, timeline), drawn with Recharts in shadcn's
// ChartContainer; overview.tsx loads them only when a stage shows one.
import { Bar, BarChart, Cell, Label, Pie, PieChart, XAxis, YAxis } from 'recharts';
import type { OverviewTone, OverviewWidget } from './overview';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';

const FILL: Record<OverviewTone, string> = {
  ok: 'var(--gain)',
  warn: 'var(--warning)',
  bad: 'var(--destructive)',
  idle: 'var(--primary)',
};

export function Ring({ ring, size }: { ring: OverviewWidget & { kind: 'ring' }; size: number }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      {ring.rings.map((r) => {
        const v = Math.max(0, Math.min(1, r.value));
        const data = [
          { key: 'value', value: v, fill: FILL[r.tone ?? 'idle'] },
          { key: 'rest', value: 1 - v, fill: 'var(--muted)' },
        ];
        return (
          <ChartContainer
            key={r.label}
            config={{ value: { label: r.label } } satisfies ChartConfig}
            className="aspect-square shrink-0"
            style={{ width: size, height: size }}
            role="img"
            aria-label={`${r.label} ${r.text}`}
          >
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="key"
                innerRadius={size / 2 - 9}
                outerRadius={size / 2 - 2}
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={d.fill} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !('cx' in viewBox)) return null;
                    const many = ring.rings.length > 1;
                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                        <tspan
                          x={viewBox.cx}
                          dy={many ? '-0.1em' : '0.35em'}
                          className="fill-foreground font-num text-[11px]"
                        >
                          {r.text}
                        </tspan>
                        {many && (
                          <tspan
                            x={viewBox.cx}
                            dy="1.2em"
                            className="fill-muted-foreground text-[9px]"
                          >
                            {r.label}
                          </tspan>
                        )}
                      </text>
                    );
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        );
      })}
      {ring.detail && <div className="min-w-36 flex-1">{ring.detail}</div>}
    </div>
  );
}

export function Bars({ w }: { w: OverviewWidget & { kind: 'bars' } }) {
  const config = { value: { label: 'Value', color: 'var(--chart-1)' } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-16 w-full">
      <BarChart data={w.bars} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" hide />
        <YAxis hide domain={[0, 'dataMax']} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(v) => (w.format ? w.format(Number(v)) : String(v))}
            />
          }
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={2} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

/** Busy blocks over a window: one stacked bar of idle and busy segments, in order. */
export function Timeline({ w }: { w: OverviewWidget & { kind: 'timeline' } }) {
  const span = Math.max(1, w.to - w.from);
  const segments: { key: string; size: number; busy: boolean }[] = [];
  let at = w.from;
  const blocks = [...w.blocks]
    .map((b) => ({ start: Math.max(w.from, b.start), end: Math.min(w.to, b.end) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  for (const b of blocks) {
    const start = Math.max(at, b.start);
    if (b.end <= start) continue;
    if (start > at) segments.push({ key: `s${segments.length}`, size: start - at, busy: false });
    segments.push({ key: `s${segments.length}`, size: b.end - start, busy: true });
    at = b.end;
  }
  if (at < w.to) segments.push({ key: `s${segments.length}`, size: w.to - at, busy: false });
  const row = Object.fromEntries(segments.map((s) => [s.key, s.size / span]));
  return (
    <div className="flex flex-col gap-1">
      <ChartContainer config={{}} className="aspect-auto h-6 w-full">
        <BarChart
          data={[row]}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={0}
        >
          <XAxis type="number" hide domain={[0, 1]} />
          <YAxis type="category" hide />
          {segments.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="t"
              fill={s.busy ? 'var(--chart-1)' : 'var(--muted)'}
              radius={i === 0 ? [3, 0, 0, 3] : i === segments.length - 1 ? [0, 3, 3, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <div className="relative h-4 text-[10px] text-muted-foreground">
        {w.ticks.map((t) => (
          <span
            key={t.at}
            className="num absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            style={{ left: `${((t.at - w.from) / span) * 100}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
