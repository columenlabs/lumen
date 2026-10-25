// LumenEChart (mockup tune-charts): the shell's wrapper for Apache ECharts,
// for charts Recharts does not draw (heat landscapes, parallel lines, small multiples). ECharts
// loads in its own chunk the first time a page draws one. Colours come from the theme's tokens
// (`useChartTokens`), so callers build options from tokens and the chart redraws when the theme
// flips. A `var(--token)` colour in an option works too: it is resolved before drawing, so a
// sparkline in `var(--chart-1)` reads in light and dark. It sizes to its box and follows it.
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { useEffect, useRef, useState } from 'react';
import { cn } from './lib/utils';

export type EChartOption = EChartsCoreOption;
export type EChartHandlers = Record<string, (params: unknown, chart: ECharts) => void>;

/** The theme's colours as plain values, for chart options. */
export interface ChartTokens {
  fg: string;
  muted: string;
  border: string;
  card: string;
  popover: string;
  gain: string;
  loss: string;
  primary: string;
  /** --chart-1 … --chart-10. */
  series: string[];
  font: string;
  mono: string;
}

function readTokens(): ChartTokens {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    fg: v('--foreground', '#e6eaf2'),
    muted: v('--muted-foreground', '#9aa4b8'),
    border: v('--border', '#2a3242'),
    card: v('--card', '#121826'),
    popover: v('--popover', '#121826'),
    gain: v('--gain', '#22c55e'),
    loss: v('--loss', '#ef4444'),
    primary: v('--primary', '#5b8cff'),
    series: Array.from({ length: 10 }, (_, i) => v(`--chart-${i + 1}`, '#5b8cff')),
    font: getComputedStyle(document.body).fontFamily || 'sans-serif',
    mono: v('--font-mono', 'monospace'),
  };
}

/** The theme's chart colours; new ones when light and dark flip. */
export function useChartTokens(): ChartTokens {
  const [t, setT] = useState(readTokens);
  useEffect(() => {
    const o = new MutationObserver(() => setT(readTokens()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => o.disconnect();
  }, []);
  return t;
}

/** The parts of ECharts the shell draws with, registered once. */
let loading: Promise<typeof import('echarts/core')> | null = null;
function loadECharts() {
  loading ??= Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]).then(([core, charts, comps, renderers]) => {
    core.use([
      charts.HeatmapChart,
      charts.ScatterChart,
      charts.LineChart,
      charts.BarChart,
      charts.ParallelChart,
      comps.GridComponent,
      comps.TooltipComponent,
      comps.VisualMapComponent,
      comps.ParallelComponent,
      comps.MarkLineComponent,
      comps.TitleComponent,
      comps.LegendComponent,
      renderers.CanvasRenderer,
    ]);
    return core;
  });
  return loading;
}

/** The look every chart shares: text, axes and tooltip in the theme's colours. */
export function baseOption(t: ChartTokens): EChartOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: t.muted, fontFamily: t.font, fontSize: 11 },
    color: t.series,
    animation: false,
    tooltip: {
      backgroundColor: t.popover,
      borderColor: t.border,
      textStyle: { color: t.fg, fontSize: 12 },
      confine: true,
    },
  };
}

/** `option` with every `var(--name)` string (also inside `color-mix()`) replaced by its value. */
function resolveVars<T>(option: T): T {
  const css = getComputedStyle(document.documentElement);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string')
      return v.includes('var(--')
        ? v.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name: string, fb?: string) => {
            return css.getPropertyValue(name).trim() || fb?.trim() || '';
          })
        : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(option) as T;
}

/** An axis in the theme's colours (merge into xAxis or yAxis). */
export function axisStyle(t: ChartTokens) {
  return {
    axisLine: { lineStyle: { color: t.border } },
    axisTick: { lineStyle: { color: t.border } },
    axisLabel: { color: t.muted, fontSize: 10 },
    splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
}

export function LumenEChart({
  option,
  height = 260,
  on,
  className,
  label,
}: {
  option: EChartOption;
  height?: number;
  /** Event handlers by ECharts event name ('click', 'axisareaselected'). */
  on?: EChartHandlers;
  className?: string;
  /** What the chart shows, for screen readers. */
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef(on);
  handlers.current = on;

  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    loadECharts().then((core) => {
      if (!alive || !box.current) return;
      const c = core.init(box.current, undefined, { renderer: 'canvas' });
      chart.current = c;
      ro = new ResizeObserver(() => c.resize());
      ro.observe(box.current);
      setReady(true);
    });
    return () => {
      alive = false;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  // Canvas can't read CSS variables: `var(--chart-1)` in an option would draw black. Each one is
  // swapped for its value, again whenever the theme flips.
  const tokens = useChartTokens();
  // biome-ignore lint/correctness/useExhaustiveDependencies: tokens change when the theme flips.
  useEffect(() => {
    if (ready) chart.current?.setOption(resolveVars(option), { notMerge: true });
  }, [ready, option, tokens]);

  const names = Object.keys(on ?? {}).join();
  useEffect(() => {
    const c = chart.current;
    if (!ready || !c || !names) return;
    const bound = names.split(',').map((name) => {
      const f = (p: unknown) => handlers.current?.[name]?.(p, c);
      c.on(name, f);
      return [name, f] as const;
    });
    return () => {
      for (const [name, f] of bound) c.off(name, f);
    };
  }, [ready, names]);

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      className={cn('w-full', !ready && 'animate-pulse rounded-md bg-muted/40', className)}
      style={{ height }}
    />
  );
}
