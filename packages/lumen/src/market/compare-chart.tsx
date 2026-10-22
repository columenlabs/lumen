/**
 * The compare chart: two to eight symbols on
 * one time axis. In % each line is its change from the left edge of what is visible, so panning,
 * zooming or dragging the timeline moves the baseline and every % re-reads from there; in Price each
 * symbol sits on its own scale. Overlays (SMA 50 on NVDA) follow their symbol's colour, dashed and,
 * in %, measured from the same baseline as their symbol; panes draw one line per symbol.
 */
import {
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type LogicalRange,
  type SeriesType,
  type Time,
  createChart,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AXIS,
  type ChartBar,
  Navigator,
  OSC_PANE,
  PRICE_PANE,
  type TimeSpan,
  price,
  secOf,
  showSpan,
  timeText,
  useTheme,
} from './price-chart';

/** One symbol's line: its bars (closes are drawn) and its colour token (`var(--chart-1)`). */
export interface CompareLine {
  symbol: string;
  color: string;
  bars: ChartBar[];
}
/** An indicator line of one symbol: values per bar time, in its symbol's colour. */
export interface CompareExtra {
  key: string;
  label: string;
  symbol: string;
  color: string;
  values?: Map<string | number, number>;
}
export interface ComparePane {
  id: string;
  label: string;
  domain?: [number, number];
  refs?: number[];
  lines: CompareExtra[];
}

const MINUS = '−';
const pct = (n: number) => `${n >= 0 ? '+' : MINUS}${Math.abs(n).toFixed(2)}%`;

/** First index of `secs` at or after `t`; the last when none is. */
function from(secs: number[], t: number) {
  let lo = 0;
  let hi = secs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((secs[mid] as number) < t) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, secs.length - 1);
}
/** Last index of `secs` at or before `t`; -1 when none is. */
function upTo(secs: number[], t: number) {
  let lo = 0;
  let hi = secs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((secs[mid] as number) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function CompareChart({
  lines,
  mode,
  overlays,
  panes,
  timeZone = 'America/Los_Angeles',
  timeline,
  range,
  onRange,
  onOutside,
}: {
  lines: CompareLine[];
  mode: 'pct' | 'price';
  overlays: CompareExtra[];
  panes: ComparePane[];
  timeZone?: string;
  /** The navigator's bars: the first symbol's whole history. */
  timeline: ChartBar[];
  range?: TimeSpan;
  onRange?: (span: TimeSpan, byPerson: boolean) => void;
  onOutside?: (span: TimeSpan) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  // One time axis: every time any symbol has a bar.
  const axis = useMemo(() => {
    const seen = new Map<number, string | number>();
    for (const l of lines) for (const b of l.bars) seen.set(secOf(b.time), b.time);
    return [...seen.entries()].sort((a, b) => a[0] - b[0]);
  }, [lines]);
  const secs = useMemo(() => axis.map(([s]) => s), [axis]);
  const axisBars: ChartBar[] = useMemo(
    () => axis.map(([, t]) => ({ time: t, open: 0, high: 0, low: 0, close: 0 })),
    [axis],
  );
  const own = useMemo(() => lines.map((l) => l.bars.map((b) => secOf(b.time))), [lines]);
  const intraday = typeof axis[0]?.[1] === 'number';
  const multiDay = intraday && secs.length > 1 && (secs.at(-1) ?? 0) - (secs[0] ?? 0) > 86_400;
  const target = useRef<TimeSpan | null>(null);
  const applied = useRef<TimeSpan | undefined>(undefined);
  const touch = useRef({ down: false, at: 0 });
  const report = useRef(onRange);
  report.current = onRange;
  const [api, setApi] = useState<IChartApi | null>(null);
  const live = useRef<IChartApi | null>(null);
  const [legend, setLegend] = useState<{
    date: string;
    rows: { s: string; c: string; v: string }[];
  }>({ date: '', rows: [] });
  const height = PRICE_PANE + panes.length * OSC_PANE + AXIS;

  // biome-ignore lint/correctness/useExhaustiveDependencies: range is applied by the effect below
  useEffect(() => {
    const el = host.current;
    if (!el || !secs.length) return;
    const css = (c: string) => theme.css(c.replace(/^var\((.*)\)$/, '$1'));
    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme.text,
        fontFamily: theme.css('--font-mono'),
        fontSize: 11,
        panes: { separatorColor: theme.border, enableResize: false },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        rightOffset: 2,
        minBarSpacing: 0.001,
        timeVisible: intraday,
        tickMarkFormatter: intraday ? (t: Time) => timeText(t, timeZone, false) : undefined,
      },
      localization: { timeFormatter: (t: Time) => timeText(t, timeZone, true) },
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: false },
    });
    const percent = mode === 'pct';
    const format = percent
      ? { type: 'custom' as const, formatter: (v: number) => pct(v) }
      : { type: 'price' as const, precision: 2, minMove: 0.01 };
    const scaleOf = (i: number) => (percent || i === 0 ? 'right' : `p${i}`);
    // The price pane: each symbol, then its overlays, which take its baseline in %.
    const priced = lines.map((l, i) => {
      const s = chart.addSeries(
        LineSeries,
        {
          color: css(l.color),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceScaleId: scaleOf(i),
          priceFormat: format,
        },
        0,
      );
      if (scaleOf(i) !== 'right')
        chart.priceScale(scaleOf(i)).applyOptions({ visible: false, borderVisible: false });
      return s;
    });
    const over = overlays.map((o) => {
      const i = lines.findIndex((l) => l.symbol === o.symbol);
      return {
        o,
        i,
        s: chart.addSeries(
          LineSeries,
          {
            color: css(o.color),
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: scaleOf(Math.max(0, i)),
            priceFormat: format,
          },
          0,
        ),
      };
    });
    if (percent)
      priced[0]?.createPriceLine({
        price: 0,
        color: theme.text,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });

    // Each symbol's baseline: its close at or after the axis bar `a`.
    let base = -1;
    const draw = (a: number) => {
      if (a === base) return;
      base = a;
      const t0 = secs[a] ?? 0;
      const bases = lines.map((l, i) => {
        const k = l.bars.length ? from(own[i] ?? [], t0) : -1;
        return l.bars[k]?.close ?? 1;
      });
      const val = (v: number, i: number) => (percent ? (v / (bases[i] ?? 1) - 1) * 100 : v);
      lines.forEach((l, i) =>
        priced[i]?.setData(l.bars.map((b) => ({ time: b.time as Time, value: val(b.close, i) }))),
      );
      for (const { o, i, s } of over) {
        const bars = lines[i]?.bars ?? [];
        s.setData(
          bars.flatMap((b) => {
            const v = o.values?.get(b.time);
            return v === undefined ? [] : [{ time: b.time as Time, value: val(v, i) }];
          }),
        );
      }
    };
    draw(0);

    panes.forEach((p, n) => {
      let anchor: ISeriesApi<SeriesType> | null = null;
      for (const x of p.lines) {
        const bars = lines.find((l) => l.symbol === x.symbol)?.bars ?? [];
        const s = chart.addSeries(
          LineSeries,
          { color: css(x.color), lineWidth: 2, priceLineVisible: false, lastValueVisible: false },
          n + 1,
        );
        s.setData(
          bars.flatMap((b) => {
            const v = x.values?.get(b.time);
            return v === undefined ? [] : [{ time: b.time as Time, value: v }];
          }),
        );
        const domain = p.domain;
        if (domain)
          s.applyOptions({
            autoscaleInfoProvider: () => ({
              priceRange: { minValue: domain[0], maxValue: domain[1] },
            }),
          });
        anchor ??= s;
      }
      for (const r of p.refs ?? [])
        anchor?.createPriceLine({
          price: r,
          color: theme.border,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
    });
    chart.panes()[0]?.setStretchFactor(PRICE_PANE);
    panes.forEach((_, n) => chart.panes()[n + 1]?.setStretchFactor(OSC_PANE));

    if (range && range !== applied.current) {
      applied.current = range;
      target.current = range;
    }
    target.current ??= range ?? { from: secs[0] ?? 0, to: Number.POSITIVE_INFINITY };
    const show = () => target.current && showSpan(chart, secs, target.current);
    show();
    let frame = 0;
    const sized = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(show);
    });
    sized.observe(el);
    const press = () => {
      touch.current.down = true;
    };
    const release = () => {
      if (touch.current.down) touch.current = { down: false, at: performance.now() };
    };
    const wheel = () => {
      touch.current.at = performance.now();
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // The values at the axis bar `i`: each symbol's last close at or before it.
    let shownEnd = secs.length - 1;
    const legendAt = (i: number) => {
      const t = secs[i] ?? 0;
      const rows = lines.map((l, k) => {
        const j = upTo(own[k] ?? [], t);
        const c = l.bars[j]?.close;
        const b = l.bars[from(own[k] ?? [], secs[base] ?? 0)]?.close;
        return {
          s: l.symbol,
          c: css(l.color),
          v: c === undefined ? '—' : percent && b ? pct((c / b - 1) * 100) : price(c),
        };
      });
      const at = axis[i]?.[1];
      setLegend({ date: at === undefined ? '' : timeText(at as Time, timeZone, true), rows });
    };
    let pending = 0;
    const moved = (r: LogicalRange | null) => {
      if (!r || !secs.length) return;
      const last = secs.length - 1;
      const a = Math.max(0, Math.min(last, Math.round(r.from)));
      const b = Math.max(a, Math.min(last, Math.round(r.to)));
      shownEnd = b;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        draw(a);
        legendAt(shownEnd);
      });
      const span = { from: secs[a] as number, to: secs[b] as number };
      const person = touch.current.down || performance.now() - touch.current.at < 400;
      if (person) target.current = span;
      report.current?.(span, person);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(moved);
    chart.subscribeCrosshairMove((p) => {
      const i = p.time === undefined ? -1 : from(secs, secOf(p.time));
      legendAt(i < 0 ? shownEnd : i);
    });
    legendAt(shownEnd);
    live.current = chart;
    setApi(chart);
    return () => {
      sized.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pending);
      el.removeEventListener('pointerdown', press);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      chart.remove();
    };
  }, [lines, own, secs, axis, mode, overlays, panes, theme, timeZone, intraday]);

  useEffect(() => {
    if (!api || !range || range === applied.current) return;
    applied.current = range;
    target.current = range;
    showSpan(api, secs, range);
  }, [api, range, secs]);

  const goTo = (span: TimeSpan) => {
    touch.current.at = performance.now();
    const day = 86_400;
    if (
      onOutside &&
      secs.length &&
      (span.from < (secs[0] as number) - day ||
        (Number.isFinite(span.to) && span.to > (secs.at(-1) as number) + day))
    ) {
      onOutside(span);
      return;
    }
    if (live.current) showSpan(live.current, secs, span);
  };

  return (
    <div data-testid="compare-chart" data-mode={mode} className="flex flex-col gap-1">
      <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-0.5 px-2 text-xs">
        <span className="num text-muted-foreground">{legend.date}</span>
        {legend.rows.map((r) => (
          <span key={r.s} className="num flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: r.c }}
            />
            <span className="text-muted-foreground">{r.s}</span>
            <span
              className={
                r.v.startsWith('+') ? 'text-gain' : r.v.startsWith(MINUS) ? 'text-loss' : ''
              }
            >
              {r.v}
            </span>
          </span>
        ))}
      </div>
      <div className="relative">
        <div ref={host} style={{ height }} />
        <div className="pointer-events-none absolute inset-0 text-muted-foreground text-xs">
          {panes.map((p, n) => (
            <div
              key={p.id}
              className="absolute inset-x-0"
              style={{ top: PRICE_PANE + n * OSC_PANE, height: OSC_PANE }}
            >
              <h3 className="px-2 pt-2">{p.label}</h3>
            </div>
          ))}
        </div>
      </div>
      {api && timeline.length > 2 && (
        <Navigator
          chart={api}
          bars={axisBars}
          secs={secs}
          timeline={timeline}
          theme={theme}
          timeZone={timeZone}
          multiDay={multiDay}
          goTo={goTo}
        />
      )}
    </div>
  );
}
