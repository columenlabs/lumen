/**
 * The shell's price chart (moved from an app's Chart tab): price in the chosen
 * type, volume when the bars have it, then a pane per oscillator, all on one time axis; crosshair
 * legend, drag to pan, wheel or pinch to zoom, and an optional timeline navigator under it.
 * lightweight-charts is the one place the shell draws with something other than Recharts: it has the
 * financial time axis and panning (approved in the market-live design).
 */
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  createChart,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { type ChartIndicator, type IndicatorValues, lineColor } from './indicators';

/** One bar: `time` is a `YYYY-MM-DD` day or Unix seconds. */
export interface ChartBar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** How the price is drawn: the basics every charting tool offers. */
export const CHART_TYPES = [
  { id: 'candles', label: 'Candles' },
  { id: 'ohlc', label: 'OHLC bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'heikin', label: 'Heikin-Ashi' },
] as const;
export type ChartType = (typeof CHART_TYPES)[number]['id'];

/** Heikin-Ashi candles: each bar averages itself with the one before, which smooths the trend. */
export function heikinAshi(bars: ChartBar[]): ChartBar[] {
  const out: ChartBar[] = [];
  for (const b of bars) {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const prev = out.at(-1);
    const open = prev ? (prev.open + prev.close) / 2 : (b.open + b.close) / 2;
    out.push({
      time: b.time,
      open,
      high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close),
      close,
    });
  }
  return out;
}

export const PRICE_PANE = 288;
const VOLUME_PANE = 80;
export const OSC_PANE = 112;
export const AXIS = 28;
const NAV = 56;

const MINUS = '−';
export const price = (n: number) =>
  n
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace('-', MINUS);
const signed = (n: number) => (n > 0 ? `+${price(n)}` : price(n));
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** A colour at half strength (grid lines fainter than borders). */
export const faint = (color: string) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}80` : color);

/** Theme tokens as concrete colours: the canvas cannot read `var(--x)`. */
function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: v('--muted-foreground'),
    border: v('--border'),
    grid: faint(v('--border')),
    up: v('--gain'),
    down: v('--loss'),
    primary: v('--primary'),
    css: v,
  };
}
export type Theme = ReturnType<typeof readTheme>;

/** Colours follow the light/dark switch, which sets the `dark` class on the root. */
export function useTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const refresh = () => setTheme(readTheme());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', refresh);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', refresh);
    };
  }, []);
  return theme;
}

const colorOf = (theme: Theme, key: string) =>
  theme.css(lineColor(key).replace(/^var\((.*)\)$/, '$1'));
const labelOf = (i: ChartIndicator, l: ChartIndicator['lines'][number]) =>
  i.lines.length === 1 ? i.label : `${i.label} · ${l.label}`;

/** A hex token with alpha (the shell's colour tokens are hex). */
export const alpha = (c: string, a: number) =>
  /^#[0-9a-f]{6}$/i.test(c)
    ? `${c}${Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')}`
    : c;

/** Time labels in the person's zone (the axis would otherwise read UTC). */
export function timeText(t: Time, zone: string, withDay: boolean) {
  if (typeof t === 'string') return t;
  if (typeof t !== 'number') return `${t.year}-${t.month}-${t.day}`;
  return new Date(t * 1000).toLocaleString('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    ...(withDay ? { month: 'short', day: 'numeric' } : {}),
  });
}

/** A bar's time as Unix seconds (days read as UTC midnight). */
export const secOf = (t: string | number | Time) =>
  typeof t === 'number'
    ? t
    : typeof t === 'string'
      ? Date.parse(`${t}T00:00:00Z`) / 1000
      : Date.UTC(t.year, t.month - 1, t.day) / 1000;

/** A span of time in Unix seconds; either end may be infinite (from the first bar, to the last). */
export interface TimeSpan {
  from: number;
  to: number;
}

/** First index whose time is at or after `t` (`secs` ascending); `secs.length` when none is. */
function lowerBound(secs: number[], t: number) {
  let lo = 0;
  let hi = secs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((secs[mid] as number) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The bars of `secs` inside `span`, as an index range (at least one bar). */
export function indexSpan(secs: number[], span: TimeSpan): [number, number] {
  const last = secs.length - 1;
  const a = Math.min(last, lowerBound(secs, span.from));
  const b = Math.max(a, Math.min(last, lowerBound(secs, span.to + 1) - 1));
  return [a, b];
}

/** One legend item; `dot` items are indicator rows with a colour swatch. */
type Legend = { key: string; label?: string; color?: string; value: string; dot?: boolean };

export interface PriceChartProps {
  bars: ChartBar[];
  /** Bars shown at first, counted from the latest; left out: all of them. */
  visible?: number;
  type: ChartType;
  /** Overlays drawn on the price and oscillators in their own panes. */
  chosen: ChartIndicator[];
  values: IndicatorValues;
  /** The person's time zone, for intraday bars (Unix seconds). */
  timeZone?: string;
  /** Wheel and pinch zoom (off where the page itself scrolls under the chart). */
  zoom?: boolean;
  /** The timeline under the chart: drag its window to move, its edges to zoom. */
  navigator?: boolean;
  /** Draws this level as a dashed line (the prior close). */
  baseline?: number | null;
  /**
   * The navigator's bars when they differ from the chart's: the symbol's whole history, coarser,
   * with the shown span cut out of it. Left out: the chart's own bars.
   */
  timeline?: ChartBar[];
  /** The span to show; a new object moves the chart there, panning and zooming move it after. */
  range?: TimeSpan;
  /** The shown span (first and last bar), and whether the person moved it (drag, wheel, timeline). */
  onRange?: (span: TimeSpan, byPerson: boolean) => void;
  /** The timeline asked for a span the chart's bars do not cover (intraday bars, older days). */
  onOutside?: (span: TimeSpan) => void;
  className?: string;
}

/** One chart: price in the chosen type, volume, then a pane per oscillator, all sharing the time axis. */
export function PriceChart({
  bars,
  visible,
  type,
  chosen,
  values,
  timeZone = 'America/Los_Angeles',
  zoom = false,
  navigator = false,
  baseline = null,
  timeline,
  range,
  onRange,
  onOutside,
  className,
}: PriceChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const secs = useMemo(() => bars.map((b) => secOf(b.time)), [bars]);
  // The span the chart keeps showing: set by `range`, by the person, and kept through rebuilds
  // (a new indicator) and resizes (the dialog opening at zero width moved it before).
  const target = useRef<TimeSpan | null>(null);
  const applied = useRef<TimeSpan | undefined>(undefined);
  const touch = useRef({ down: false, at: 0 });
  const byPerson = () => touch.current.down || performance.now() - touch.current.at < 400;
  const report = useRef(onRange);
  report.current = onRange;
  const theme = useTheme();
  const [legend, setLegend] = useState<Legend[]>([]);
  const [api, setApi] = useState<IChartApi | null>(null);
  const live = useRef<IChartApi | null>(null);
  const hasVolume = bars.some((b) => (b.volume ?? 0) > 0);
  const intraday = typeof bars[0]?.time === 'number';
  const multiDay =
    intraday &&
    bars.length > 1 &&
    (bars.at(-1)?.time as number) - (bars[0]?.time as number) > 86_400;

  const panes = useMemo(() => chosen.filter((i) => i.where === 'pane'), [chosen]);
  const height = PRICE_PANE + (hasVolume ? VOLUME_PANE : 0) + panes.length * OSC_PANE + AXIS;
  const drawn = useMemo(() => (type === 'heikin' ? heikinAshi(bars) : bars), [bars, type]);

  // The chart is rebuilt whenever the type, picks, data or theme change. `range` is read through
  // `applied`: a new span is shown by the effect below, not by a rebuild.
  // biome-ignore lint/correctness/useExhaustiveDependencies: range, see above
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const overlays = chosen.filter((i) => i.where === 'overlay');
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
        // Max shows every bar on a phone too (the default 0.5 px stops at ~700).
        minBarSpacing: 0.001,
        timeVisible: intraday,
        tickMarkFormatter: intraday ? (t: Time) => timeText(t, timeZone, false) : undefined,
      },
      localization: { timeFormatter: (t: Time) => timeText(t, timeZone, true) },
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: { mouseWheel: zoom, pinch: zoom },
      handleScroll: { mouseWheel: false },
    });

    const main = addPrice(chart, type, drawn, theme);
    if (baseline !== null)
      main.createPriceLine({
        price: baseline,
        color: theme.text,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
    const tracked: { key: string; label: string; color: string; series: ISeriesApi<SeriesType> }[] =
      [];
    for (const i of overlays) {
      for (const l of i.lines) {
        const color = colorOf(theme, l.key);
        const s = chart.addSeries(
          LineSeries,
          {
            color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          0,
        );
        s.setData(points(bars, values[l.key]));
        tracked.push({ key: l.key, label: labelOf(i, l), color, series: s });
      }
    }

    const first = hasVolume ? 2 : 1;
    if (hasVolume) {
      const volume = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        1,
      );
      volume.setData(
        bars.map((b) => ({
          time: b.time as Time,
          value: b.volume ?? 0,
          color: alpha(b.close >= b.open ? theme.up : theme.down, 0.5),
        })),
      );
    }

    panes.forEach((i, n) => {
      for (const l of i.lines) {
        const color = colorOf(theme, l.key);
        const s = l.bar
          ? chart.addSeries(
              HistogramSeries,
              { priceLineVisible: false, lastValueVisible: false },
              n + first,
            )
          : chart.addSeries(
              LineSeries,
              { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false },
              n + first,
            );
        if (l.bar) {
          (s as ISeriesApi<'Histogram'>).setData(
            points(bars, values[l.key]).map((p) => ({
              ...p,
              color: p.value < 0 ? theme.down : theme.up,
            })),
          );
        } else {
          (s as ISeriesApi<'Line'>).setData(points(bars, values[l.key]));
        }
        tracked.push({ key: l.key, label: labelOf(i, l), color, series: s });
        const domain = i.domain;
        if (domain && !l.bar) {
          s.applyOptions({
            autoscaleInfoProvider: () => ({
              priceRange: { minValue: domain[0], maxValue: domain[1] },
            }),
          });
        }
      }
      const anchor = tracked.find((t) => t.key === i.lines[0]?.key)?.series;
      for (const r of i.refs ?? []) {
        anchor?.createPriceLine({
          price: r,
          color: theme.border,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
      }
    });

    // Stretch factors keep the panes in these proportions at any chart height.
    chart.panes()[0]?.setStretchFactor(PRICE_PANE);
    if (hasVolume) chart.panes()[1]?.setStretchFactor(VOLUME_PANE);
    panes.forEach((_, n) => chart.panes()[n + first]?.setStretchFactor(OSC_PANE));
    if (range && range !== applied.current) {
      applied.current = range;
      target.current = range;
    } else if (!target.current) {
      const n = visible && visible < bars.length ? bars.length - visible : 0;
      target.current = range ?? { from: secs[n] ?? 0, to: Number.POSITIVE_INFINITY };
    }
    const show = () => {
      if (target.current) showSpan(chart, secs, target.current);
    };
    show();
    // The host can be 0 wide when the chart is made (a dialog still opening): show the span again
    // once it has its size, and after any resize, rather than keep the bar spacing.
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
    const moved = (r: LogicalRange | null) => {
      if (!r || !secs.length) return;
      const last = secs.length - 1;
      const a = Math.max(0, Math.min(last, Math.round(r.from)));
      const b = Math.max(a, Math.min(last, Math.round(r.to)));
      const span = { from: secs[a] as number, to: secs[b] as number };
      const person = byPerson();
      if (person) target.current = span;
      report.current?.(span, person);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(moved);

    const at = (t: Time | undefined) => {
      const i = t === undefined ? -1 : bars.findIndex((b) => b.time === t);
      return i < 0 ? bars.length - 1 : i;
    };
    const legendFor = (param: MouseEventParams<Time> | null) => {
      const i = at(param?.time);
      const bar = bars[i];
      const draw = drawn[i];
      const rows: Legend[] = [];
      if (bar && draw) {
        // From the baseline when there is one (the prior close, as the header measures), else
        // from the bar before.
        const prev = baseline ?? bars[i - 1]?.close ?? bar.open;
        const change = bar.close - prev;
        const tone = change >= 0 ? theme.up : theme.down;
        const prefix = type === 'heikin' ? 'HA ' : '';
        rows.push({ key: 'date', value: timeText(bar.time as Time, timeZone, true) });
        rows.push({
          key: 'ohlc',
          color: tone,
          value:
            type === 'line' || type === 'area'
              ? `C ${price(bar.close)}`
              : `${prefix}O ${price(draw.open)}  H ${price(draw.high)}  L ${price(draw.low)}  C ${price(draw.close)}`,
        });
        rows.push({
          key: 'change',
          color: tone,
          value: `${change >= 0 ? '▲' : '▼'} ${signed(change)}${
            baseline ? ` (${signed((change / baseline) * 100)}%)` : ''
          }`,
        });
        if (hasVolume)
          rows.push({ key: 'volume', value: `Vol ${COMPACT.format(bar.volume ?? 0)}` });
        for (const t2 of tracked) {
          const v = values[t2.key]?.get(bar.time);
          if (v !== undefined)
            rows.push({
              key: t2.key,
              label: t2.label,
              color: t2.color,
              value: price(v),
              dot: true,
            });
        }
      }
      return rows;
    };
    setLegend(legendFor(null));
    chart.subscribeCrosshairMove((p) => setLegend(legendFor(p.time ? p : null)));
    live.current = chart;
    setApi(chart);
    return () => {
      sized.disconnect();
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', press);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      // The navigator stays up (and keeps a drag going) while the chart is rebuilt under it.
      chart.remove();
    };
  }, [
    bars,
    secs,
    drawn,
    visible,
    type,
    chosen,
    panes,
    values,
    theme,
    timeZone,
    zoom,
    baseline,
    hasVolume,
    intraday,
  ]);

  // A new `range` (a window button) moves the chart there.
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
    <div
      data-testid="price-chart"
      data-chart-type={type}
      data-bars={bars.length}
      className={cn('flex flex-col gap-1', className)}
    >
      <div
        className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-0.5 px-2 text-xs"
        data-testid="chart-legend"
      >
        {legend.map(({ key, label, color, value, dot }) => (
          <div
            key={key}
            className="num flex items-center gap-2 whitespace-nowrap text-muted-foreground"
          >
            {dot && (
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ background: color }}
              />
            )}
            {label && <span>{label}</span>}
            <span
              className={dot ? 'text-foreground' : undefined}
              style={dot ? undefined : { color }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <div className="relative">
        <div ref={host} style={{ height }} />
        <div className="pointer-events-none absolute inset-0 text-muted-foreground text-xs">
          {hasVolume && (
            <span className="absolute left-2" style={{ top: PRICE_PANE + 8 }}>
              Volume
            </span>
          )}
          {panes.map((p, n) => (
            <div
              key={p.id}
              className="absolute inset-x-0"
              style={{
                top: PRICE_PANE + (hasVolume ? VOLUME_PANE : 0) + n * OSC_PANE,
                height: OSC_PANE,
              }}
            >
              <h3 className="px-2 pt-2">{p.label}</h3>
            </div>
          ))}
        </div>
      </div>
      {navigator && api && (timeline ?? bars).length > 2 && (
        <Navigator
          chart={api}
          bars={bars}
          secs={secs}
          timeline={timeline ?? bars}
          theme={theme}
          timeZone={timeZone}
          multiDay={multiDay}
          goTo={goTo}
        />
      )}
    </div>
  );
}

/** Shows the bars inside `span` (at least one), edge to edge. */
export function showSpan(chart: IChartApi, secs: number[], span: TimeSpan) {
  if (!secs.length) return;
  const [a, b] = indexSpan(secs, span);
  const pad = b === secs.length - 1 ? 2 : 0.5;
  chart.timeScale().setVisibleLogicalRange({ from: a - 0.5, to: b + pad });
}

const points = (bars: ChartBar[], by?: Map<string | number, number>) =>
  bars.flatMap((b) => {
    const v = by?.get(b.time);
    return v === undefined ? [] : [{ time: b.time as Time, value: v }];
  });

function addPrice(chart: IChartApi, type: ChartType, data: ChartBar[], theme: Theme) {
  const ohlc = data.map((b) => ({
    time: b.time as Time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
  // Heikin-Ashi closes are averages, so the axis tag would not match the real last price.
  const common = { priceLineVisible: false, lastValueVisible: type !== 'heikin' } as const;
  if (type === 'line') {
    const s = chart.addSeries(LineSeries, { ...common, color: theme.primary, lineWidth: 2 }, 0);
    s.setData(data.map((b) => ({ time: b.time as Time, value: b.close })));
    return s as ISeriesApi<SeriesType>;
  }
  if (type === 'area') {
    const s = chart.addSeries(
      AreaSeries,
      {
        ...common,
        lineColor: theme.primary,
        topColor: alpha(theme.primary, 0.33),
        bottomColor: alpha(theme.primary, 0.02),
        lineWidth: 2,
      },
      0,
    );
    s.setData(data.map((b) => ({ time: b.time as Time, value: b.close })));
    return s as ISeriesApi<SeriesType>;
  }
  if (type === 'ohlc') {
    const s = chart.addSeries(
      BarSeries,
      { ...common, upColor: theme.up, downColor: theme.down },
      0,
    );
    s.setData(ohlc);
    return s as ISeriesApi<SeriesType>;
  }
  const s = chart.addSeries(
    CandlestickSeries,
    {
      ...common,
      upColor: theme.up,
      downColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      borderVisible: false,
    },
    0,
  );
  s.setData(ohlc);
  return s as ISeriesApi<SeriesType>;
}

/**
 * The timeline under the chart (whole history): the symbol's whole
 * history as a small area chart, with the span the chart shows cut out of it. Drag the window to
 * move, drag its edges to zoom, click outside it to jump there. lightweight-charts has no
 * navigator, so this is a second chart kept in step by time.
 */
export function Navigator({
  chart,
  bars,
  secs,
  timeline,
  theme,
  timeZone,
  multiDay,
  goTo,
}: {
  chart: IChartApi;
  bars: ChartBar[];
  secs: number[];
  timeline: ChartBar[];
  theme: Theme;
  timeZone: string;
  multiDay: boolean;
  goTo: (span: TimeSpan) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const tSecs = useMemo(() => timeline.map((b) => secOf(b.time)), [timeline]);
  const last = timeline.length - 1;
  const [shown, setShown] = useState<[number, number] | null>(null);
  const drag = useRef<{ mode: 'l' | 'r' | 'm'; x: number; from: number; to: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const nav = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme.text,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false, rightOffset: 0, minBarSpacing: 0.001 },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScale: false,
      handleScroll: false,
    });
    const s = nav.addSeries(AreaSeries, {
      lineColor: theme.primary,
      topColor: alpha(theme.primary, 0.25),
      bottomColor: alpha(theme.primary, 0.02),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    s.setData(timeline.map((b) => ({ time: b.time as Time, value: b.close })));
    // Stretch the whole history edge to edge, again once the strip has its width.
    const fit = () =>
      nav.timeScale().setVisibleLogicalRange({ from: -0.5, to: timeline.length - 0.5 });
    fit();
    const sized = new ResizeObserver(() => requestAnimationFrame(fit));
    sized.observe(el);
    return () => {
      sized.disconnect();
      nav.remove();
    };
  }, [timeline, theme]);

  // The chart's shown bars, as main-chart indexes.
  useEffect(() => {
    const ts = chart.timeScale();
    const on = (r: LogicalRange | null) => {
      if (!r || !secs.length) return;
      const n = secs.length - 1;
      const a = Math.max(0, Math.min(n, Math.round(r.from)));
      setShown([a, Math.max(a, Math.min(n, Math.round(r.to)))]);
    };
    on(ts.getVisibleLogicalRange());
    ts.subscribeVisibleLogicalRangeChange(on);
    return () => {
      // The chart may already be rebuilt and gone.
      try {
        ts.unsubscribeVisibleLogicalRangeChange(on);
      } catch {}
    };
  }, [chart, secs]);

  /** Where a time sits on the timeline, as a fractional index. */
  const pos = (t: number) => {
    const i = lowerBound(tSecs, t);
    if (i <= 0) return 0;
    if (i > last) return last;
    const a = tSecs[i - 1] as number;
    const b = tSecs[i] as number;
    return i - 1 + (b > a ? (t - a) / (b - a) : 0);
  };
  /** The time at a fractional timeline index. */
  const timeAt = (x: number) => {
    const i = Math.max(0, Math.min(last, Math.floor(x)));
    const a = tSecs[i] as number;
    const b = tSecs[Math.min(last, i + 1)] as number;
    return a + (b - a) * (x - i);
  };
  const startSec = shown ? (secs[shown[0]] as number) : (tSecs[0] as number);
  const endSec = shown ? (secs[shown[1]] as number) : (tSecs[last] as number);
  const from = pos(startSec);
  const to = Math.max(from, pos(endSec));
  const pct = (i: number) => (last ? (i / last) * 100 : 0);
  const indexAt = (clientX: number) => {
    const r = strip.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(last, ((clientX - r.left) / r.width) * last));
  };
  // A window reaching the last timeline day runs to the chart's last bar (today's intraday bars
  // sit after the last daily one).
  const set = (a: number, b: number) =>
    goTo({ from: timeAt(a), to: b >= last ? Number.POSITIVE_INFINITY : timeAt(b) });
  const MIN = Math.min(10, last);

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const i = indexAt(e.clientX);
    const near = (last / 100) * 2;
    let mode: 'l' | 'r' | 'm' = 'm';
    if (Math.abs(i - from) <= near && Math.abs(i - to) <= near) mode = i < from ? 'l' : 'r';
    else if (Math.abs(i - from) <= near) mode = 'l';
    else if (Math.abs(i - to) <= near) mode = 'r';
    else if (i < from || i > to) {
      // Jump: centre the window where the timeline was clicked.
      const w = Math.max(to - from, MIN);
      const a = Math.max(0, Math.min(last - w, i - w / 2));
      set(a, a + w);
      drag.current = { mode: 'm', x: i, from: a, to: a + w };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    drag.current = { mode, x: i, from, to };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const i = indexAt(e.clientX);
    if (d.mode === 'l') set(Math.min(i, d.to - MIN), d.to);
    else if (d.mode === 'r') set(d.from, Math.max(i, d.from + MIN));
    else {
      const w = d.to - d.from;
      const a = Math.max(0, Math.min(last - w, d.from + (i - d.x)));
      set(a, a + w);
    }
  };
  const up = () => {
    drag.current = null;
  };
  const edge = (b: ChartBar | undefined) =>
    b ? timeText(b.time as Time, timeZone, multiDay || typeof b.time === 'string') : '';
  const shownLabel = (i: number | undefined) => edge(i === undefined ? undefined : bars[i]);

  return (
    <div className="flex flex-col gap-0.5 pr-14">
      <div
        ref={strip}
        role="slider"
        aria-label="Timeline: drag the window or its edges"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={Math.round(from)}
        aria-valuetext={`${shownLabel(shown?.[0])} to ${shownLabel(shown?.[1])}`}
        tabIndex={0}
        onKeyDown={(e) => {
          const w = to - from;
          const step = Math.max(1, Math.round(w / 10));
          if (e.key === 'ArrowLeft') set(Math.max(0, from - step), Math.max(0, from - step) + w);
          if (e.key === 'ArrowRight')
            set(Math.min(last - w, from + step), Math.min(last, to + step));
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="relative cursor-grab touch-none overflow-hidden rounded-md border bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
        style={{ height: NAV }}
      >
        <div ref={host} className="pointer-events-none absolute inset-0" />
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-background/60"
          style={{ width: `${pct(from)}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-background/60"
          style={{ width: `${100 - pct(to)}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-px min-w-1.5 rounded-sm border border-muted-foreground/60"
          style={{
            left: `min(${pct(from)}%, calc(100% - 0.375rem))`,
            width: `${pct(to) - pct(from)}%`,
          }}
        >
          <span className="absolute top-1/2 -left-1 h-6 w-1.5 -translate-y-1/2 rounded-sm bg-muted-foreground" />
          <span className="absolute top-1/2 -right-1 h-6 w-1.5 -translate-y-1/2 rounded-sm bg-muted-foreground" />
        </div>
      </div>
      <div className="num flex justify-between text-[10px] text-muted-foreground">
        <span>{edge(timeline[0])}</span>
        <span>
          {shownLabel(shown?.[0])} to {shownLabel(shown?.[1])}
        </span>
        <span>{edge(timeline[last])}</span>
      </div>
    </div>
  );
}
