// An app's Overview: a service-health page, not a decisions page. A stage map
// (each stage a chip with its status dot, name and a one-line verdict; arrows between; tap one to
// focus it) and then each stage's widgets, one LumenLayout card each with its own ↻ and states
// (on LumenLayout). Apps pass only their stages and data; the
// widget kinds are fixed here (stat, ring, bars, timeline), drawn with Recharts in shadcn's
// ChartContainer. An app is the first user (Queue, Runner, Results); an app's
// Overview moves onto it later (Sources, Pipelines, Storage, Coverage).
import { ArrowRightIcon, TriangleAlertIcon } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { Bar, BarChart, Cell, Label, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { cn } from './lib/utils';
import { LumenLayout, type LumenLayoutCard } from './lumen-layout';
import type { LumenLoad } from './lumen-source';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';

export type OverviewTone = 'ok' | 'warn' | 'bad' | 'idle';

interface WidgetBase {
  id: string;
  label: string;
  /** Small text on the right of the label (a count, an average). */
  aside?: ReactNode;
  /** One line under the widget. */
  caption?: ReactNode;
  /** `warn` or `bad` outlines the widget. */
  tone?: OverviewTone;
}

export type OverviewWidget = WidgetBase &
  (
    | { kind: 'stat'; value?: ReactNode; detail?: ReactNode }
    | {
        kind: 'ring';
        /** Each ring is a share (0 to 1) with the text shown in its middle. */
        rings: { label: string; value: number; text: string; tone?: OverviewTone }[];
        /** Beside the rings: a list (`OverviewList`), a line of text or a button. */
        detail?: ReactNode;
      }
    | {
        kind: 'bars';
        bars: { key: string; label: string; value: number }[];
        /** How a bar's value reads in its tooltip. */
        format?: (v: number) => string;
      }
    | {
        kind: 'timeline';
        /** The window in epoch ms, and the busy blocks inside it. */
        from: number;
        to: number;
        blocks: { start: number; end: number }[];
        ticks: { at: number; label: string }[];
      }
  );

export interface OverviewStage {
  id: string;
  name: string;
  tone: OverviewTone;
  /** One or two words on the stage map chip ("fresh", "2 stale"). */
  verdict: string;
  widgets: OverviewWidget[];
  /** This stage's own reads, when they differ from the page's (the runner's live health). */
  load?: LumenLoad;
}

const DOT: Record<OverviewTone, string> = {
  ok: 'bg-gain',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  idle: 'bg-muted-foreground',
};
const FILL: Record<OverviewTone, string> = {
  ok: 'var(--gain)',
  warn: 'var(--warning)',
  bad: 'var(--destructive)',
  idle: 'var(--primary)',
};

/** A stage's status mark: a dot, or ▲ when it needs a look. */
export function ToneDot({ tone, className }: { tone: OverviewTone; className?: string }) {
  if (tone === 'warn' || tone === 'bad') {
    return (
      <TriangleAlertIcon
        aria-hidden
        className={cn('size-3.5 shrink-0', tone === 'warn' ? 'text-warning' : 'text-destructive')}
      />
    );
  }
  return (
    <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', DOT[tone])} />
  );
}

/** Label and value rows for a widget's detail (schedules and their last tick, latencies). */
export function OverviewList({
  items,
}: {
  items: { label: ReactNode; value: ReactNode; tone?: OverviewTone }[];
}) {
  return (
    <dl className="flex min-w-0 flex-col gap-0.5 text-xs">
      {items.map((it, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reorder
          key={i}
          className={cn(
            'flex justify-between gap-2',
            it.tone === 'warn' && 'text-warning',
            it.tone === 'bad' && 'text-destructive',
          )}
        >
          <dt className="truncate">{it.label}</dt>
          <dd className="num shrink-0 text-muted-foreground">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Ring({ ring, size }: { ring: OverviewWidget & { kind: 'ring' }; size: number }) {
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
                          className="fill-foreground font-mono text-[11px]"
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

function Bars({ w }: { w: OverviewWidget & { kind: 'bars' } }) {
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
function Timeline({ w }: { w: OverviewWidget & { kind: 'timeline' } }) {
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

/** A widget's body: the card's frame, title and ↻ come from LumenLayout. */
function WidgetBody({ w }: { w: OverviewWidget }) {
  return (
    <div data-widget={w.id} className="flex min-w-0 flex-col gap-1.5">
      {w.aside && <span className="num text-xs text-muted-foreground">{w.aside}</span>}
      {w.kind === 'stat' && (
        <>
          {w.value !== undefined && (
            <span className="num truncate text-xl leading-7 font-semibold">{w.value}</span>
          )}
          {w.detail}
        </>
      )}
      {w.kind === 'ring' && <Ring ring={w} size={w.rings.length > 1 ? 64 : 56} />}
      {w.kind === 'bars' && <Bars w={w} />}
      {w.kind === 'timeline' && <Timeline w={w} />}
      {w.caption && <span className="text-xs text-muted-foreground">{w.caption}</span>}
    </div>
  );
}

/** A stage's widgets fill one row of thirds; four go two by two. */
const widthOf = (count: number) => (count === 3 ? 2 : 3);

export interface OverviewPageProps {
  stages: OverviewStage[];
  /** The reads the stages are built from: every widget's ↻, skeleton, error and load time. */
  load: LumenLoad;
  /** Beside the title: when the numbers were read. */
  updated?: ReactNode;
}

/** The Overview on LumenLayout: the stage map leads, each widget is a card. */
export function OverviewPage({ stages, load, updated }: OverviewPageProps) {
  const [focus, setFocus] = useState<string | null>(null);
  const warnings = stages.filter((s) => s.tone === 'warn' || s.tone === 'bad').length;
  const shown = focus ? stages.filter((s) => s.id === focus) : stages;
  const cards: LumenLayoutCard[] = stages.length
    ? shown.flatMap((s) =>
        s.widgets.map((w) => ({
          id: `${s.id}-${w.id}`,
          title: w.label,
          kind: 'widget' as const,
          w: widthOf(s.widgets.length),
          load: s.load ?? load,
          tools: (w.tone === 'warn' || w.tone === 'bad') && <ToneDot tone={w.tone} />,
          children: <WidgetBody w={w} />,
        })),
      )
    : [{ id: 'overview', title: 'Overview', kind: 'widget', load, children: null }];
  return (
    <LumenLayout
      crumbs={[{ label: 'Overview' }]}
      meta={
        <>
          {warnings > 0 && (
            <Badge variant="outline" className="border-warning/40 text-warning">
              <TriangleAlertIcon />
              {warnings} {warnings === 1 ? 'warning' : 'warnings'}
            </Badge>
          )}
          {updated}
        </>
      }
      intro={
        stages.length > 0 && (
          <fieldset className="m-0 flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden border-0 p-0 sm:gap-1.5">
            <legend className="sr-only">Stages</legend>
            {stages.map((s, i) => (
              <Fragment key={s.id}>
                <Button
                  variant="outline"
                  aria-pressed={focus === s.id}
                  onClick={() => setFocus(focus === s.id ? null : s.id)}
                  className={cn(
                    'h-9 shrink-0 gap-1.5 px-2.5 sm:h-11 sm:gap-2 sm:px-3',
                    focus === s.id && 'border-primary bg-primary/10',
                    s.tone === 'warn' && focus !== s.id && 'border-warning/60',
                    s.tone === 'bad' && focus !== s.id && 'border-destructive/60',
                  )}
                >
                  <ToneDot tone={s.tone} />
                  {s.name}
                  <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                    {s.verdict}
                  </span>
                </Button>
                {i < stages.length - 1 && (
                  <ArrowRightIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground sm:size-4"
                  />
                )}
              </Fragment>
            ))}
          </fieldset>
        )
      }
      cards={cards}
    />
  );
}
