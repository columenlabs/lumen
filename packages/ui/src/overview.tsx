// An app's Overview: a service-health page, not a decisions page. A stage map
// (each stage a chip with its status dot, name and a one-line verdict; arrows between; tap one to
// focus it) and then each stage's widgets, one LumenLayout card each with its own ↻ and states
// (on LumenLayout). Apps pass only their stages and data; the
// widget kinds are fixed here (stat, ring, bars, timeline), drawn with Recharts in shadcn's
// ChartContainer. An app is the first user (Queue, Runner, Results); an app's
// Overview moves onto it later (Sources, Pipelines, Storage, Coverage).
import { ArrowRightIcon, TriangleAlertIcon } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { lazyPart } from './lazy-part';
import { cn } from './lib/utils';
import { LumenLayout, type LumenLayoutCard } from './lumen-layout';
import type { LumenLoad } from './lumen-source';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

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

// The ring, bar and timeline widgets draw with the charts library, so they load only when a stage
// shows one.
const Ring = lazyPart(() => import('./overview-charts').then((m) => m.Ring));
const Bars = lazyPart(() => import('./overview-charts').then((m) => m.Bars));
const Timeline = lazyPart(() => import('./overview-charts').then((m) => m.Timeline));

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
