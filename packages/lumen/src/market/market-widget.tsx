/**
 * Market widgets (mockup "Dashboard Outlook"): a view widget of kind `market`
 * shows symbols' 1m bars for the session, live while it trades. Three looks:
 *
 *   lines   one wide chart of each symbol's % change from the prior close (the indexes), with a
 *           legend of name, change and level; the crosshair reads every line at that minute
 *   tiles   one widget per symbol: change, a sparkline over the prior close, the value, and Live,
 *           "via ETF" or a gold Delayed chip
 *   today   one row per symbol: up or down today, by how much, and its price now
 *
 * While the session is shut, each draws the trades since its close (pre-market, after hours,
 * overnight; an index through its ETF) dashed after the session, and Today measures from the
 * session's close once the overnight session has begun.
 *
 * A name or a widget opens the chart dialog. Without a market provider (apps other than an app,
 * or the exported an app) the widget says live data is not available here.
 */
import { type MarketSeries, isDailyMarketKey } from '@columenlabs/lumen-ui-types/market';
import {
  ColorType,
  CrosshairMode,
  type IChartApi,
  LineSeries,
  type Time,
  createChart,
} from 'lightweight-charts';
import { CircleAlert, CircleSlash, LoaderCircle, RotateCw } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, ReferenceLine, YAxis } from 'recharts';
import { IconButton } from '../icon-button';
import { KIT } from '../kit-config';
import { cn } from '../lib/utils';
import { usePrefs } from '../prefs';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ChartContainer } from '../ui/chart';
import { Skeleton } from '../ui/skeleton';
import { type MarketStatus, extendedOf, todayOf, useMarket, useMarketDaily } from './live';
import { useSymbolChart } from './lumen-chart';
import { faint } from './price-chart';

const LINE_TOKENS = ['--chart-1', '--chart-3', '--chart-4', '--chart-6', '--chart-2', '--chart-5'];

const MINUS = '−';
export function fmtValue(s: Pick<MarketSeries, 'prefix' | 'suffix' | 'decimals'>, v: number) {
  return `${s.prefix}${v
    .toLocaleString('en-US', {
      minimumFractionDigits: s.decimals,
      maximumFractionDigits: s.decimals,
    })
    .replace('-', MINUS)}${s.suffix}`;
}
const fmtPct = (p: number) =>
  `${p >= 0 ? '+' : MINUS}${Math.abs(p).toFixed(2)}% ${p >= 0 ? '▲' : '▼'}`;
/** A daily series' change in its own units: points for a percentage (`+4.4 pts`). */
const fmtPts = (s: MarketSeries, p: number) =>
  `${p >= 0 ? '+' : MINUS}${Math.abs(p).toFixed(s.decimals)}${s.suffix === '%' ? ' pts' : ''}`;
const day = (iso: string) =>
  iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
/** Change from the prior close, in percent. */
export const changeOf = (s: MarketSeries) => {
  const last = s.bars.at(-1)?.c;
  return last !== undefined && s.prevClose ? (last / s.prevClose - 1) * 100 : null;
};

function clock(sec: number, zone: string) {
  return new Date(sec * 1000).toLocaleTimeString('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** "● Live · 10:18 AM PDT", or the closed line, for a page or card header. */
export function MarketBadge({ symbols }: { symbols: string[] }) {
  const { timeZone } = usePrefs();
  const m = useMarket(symbols);
  if (m.status === 'off') return null;
  const lastBar = Math.max(0, ...Object.values(m.series).map((s) => s.bars.at(-1)?.t ?? 0));
  const ext = Object.values(m.series)
    .map(extendedOf)
    .filter((x) => !!x)
    .sort((a, b) => b.at - a.at)[0];
  const live = m.status === 'live';
  const text =
    m.status === 'loading'
      ? 'Loading'
      : m.status === 'connecting'
        ? 'Connecting'
        : m.status === 'error'
          ? 'Not reachable'
          : live
            ? `Live${lastBar ? ` · ${clock(lastBar + 60, timeZone)}` : ''}`
            : ext
              ? `${ext.label} · ${clock(ext.at + 300, timeZone)}`
              : `Closed${m.session ? ` · last bar ${clock(m.session.close, timeZone)}` : ''}`;
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 font-normal',
        live ? 'border-gain/40 text-gain' : 'text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', live ? 'bg-gain' : 'bg-muted-foreground')} />
      {text}
    </Badge>
  );
}

function Unavailable({
  status,
  error,
  onRetry,
}: { status: MarketStatus; error: string | null; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
      <p>
        {status === 'off'
          ? KIT.marketOff
          : `Market data is not reachable · ${error ?? 'no answer'}`}
      </p>
      {status !== 'off' && onRetry && (
        <IconButton icon={RotateCw} label="Retry" variant="outline" onClick={onRetry} />
      )}
    </div>
  );
}

/** A widget of kind `market`. */
export function MarketWidget({
  symbols,
  style,
}: { symbols: string[]; style: 'lines' | 'tiles' | 'today' }) {
  if (style === 'lines') return <MarketLines symbols={symbols} />;
  if (style === 'today') return <MarketToday symbols={symbols} />;
  return <MarketTiles symbols={symbols} />;
}

/** One wide chart: each symbol's % change from the prior close, 1m. */
export function MarketLines({ symbols: all }: { symbols: string[] }) {
  const symbols = useMemo(() => all.filter((k) => !isDailyMarketKey(k)), [all]);
  const m = useMarket(symbols);
  const open = useSymbolChart();
  const { timeZone } = usePrefs();
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const lines = useRef(new Map<string, ReturnType<IChartApi['addSeries']>>());
  const extLines = useRef(new Map<string, ReturnType<IChartApi['addSeries']>>());
  const [hover, setHover] = useState<Record<string, number> | null>(null);
  const shown = symbols.map((s) => m.series[s]).filter((s): s is MarketSeries => !!s);
  const ready = shown.length > 0;

  // The chart itself, once; lines are added as their series arrive.
  useEffect(() => {
    const el = host.current;
    if (!el || !ready) return;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const c = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: v('--muted-foreground'),
        fontFamily: v('--font-mono'),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: faint(v('--border')) } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (t: Time) =>
          new Date((t as number) * 1000).toLocaleTimeString('en-US', {
            timeZone,
            hour: 'numeric',
            minute: '2-digit',
          }),
      },
      localization: {
        timeFormatter: (t: Time) => clock(t as number, timeZone),
        priceFormatter: (p: number) => `${p >= 0 ? '+' : MINUS}${Math.abs(p).toFixed(2)}%`,
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: false,
      handleScroll: false,
    });
    chart.current = c;
    c.subscribeCrosshairMove((p) => {
      if (!p.time) return setHover(null);
      const at: Record<string, number> = {};
      for (const [k, s] of lines.current) {
        const d = p.seriesData.get(s) as { value?: number } | undefined;
        if (d?.value !== undefined) at[k] = d.value;
      }
      for (const [k, s] of extLines.current) {
        const d = p.seriesData.get(s) as { value?: number } | undefined;
        if (d?.value !== undefined) at[k] = d.value;
      }
      setHover(at);
    });
    return () => {
      chart.current = null;
      lines.current.clear();
      extLines.current.clear();
      c.remove();
    };
  }, [ready, timeZone]);

  // Each symbol's line, redrawn as its bars change.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const css = getComputedStyle(document.documentElement);
    shown.forEach((s, i) => {
      let line = lines.current.get(s.key);
      if (!line) {
        line = c.addSeries(LineSeries, {
          color: css.getPropertyValue(LINE_TOKENS[i % LINE_TOKENS.length] as string).trim(),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        if (i === 0)
          line.createPriceLine({
            price: 0,
            color: css.getPropertyValue('--muted-foreground').trim(),
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: false,
          });
        lines.current.set(s.key, line);
      }
      const base = s.prevClose;
      line.setData(
        base ? s.bars.map((b) => ({ time: b.t as Time, value: (b.c / base - 1) * 100 })) : [],
      );
      // After the session, dashed: its last minute, then the trades since the close.
      const ext = extendedOf(s);

      const last = s.bars.at(-1);
      let dashed = extLines.current.get(s.key);
      if (ext && base && last) {
        if (!dashed) {
          dashed = c.addSeries(LineSeries, {
            color: css.getPropertyValue(LINE_TOKENS[i % LINE_TOKENS.length] as string).trim(),
            lineWidth: 2,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: true,
          });
          extLines.current.set(s.key, dashed);
        }
        dashed.setData(
          [{ t: last.t, c: last.c }, ...ext.bars.filter((b) => b.t > last.t)].map((b) => ({
            time: b.t as Time,
            value: (b.c / base - 1) * 100,
          })),
        );
        line.applyOptions({ lastValueVisible: false });
      } else if (dashed) {
        dashed.setData([]);
        line.applyOptions({ lastValueVisible: true });
      }
    });
    c.timeScale().fitContent();
  });

  if (m.status === 'off' || (m.status === 'error' && !ready))
    return <Unavailable status={m.status} error={m.error} onRetry={m.retry} />;
  if (!ready && symbols.length && m.missing.length === symbols.length)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No bars for this session yet.
      </p>
    );
  if (!ready) return <Skeleton aria-busy className="h-72 w-full sm:h-80" />;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* One line: the name and level drop out as the card narrows, and
          anything still too wide scrolls sideways instead of wrapping. */}
      <div className="flex flex-nowrap justify-between gap-x-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:justify-start sm:gap-x-3">
        {shown.map((s, i) => {
          const ch = hover?.[s.key] ?? changeOf(s);
          const last = s.bars.at(-1)?.c;
          const ext = extendedOf(s);
          return (
            <Button
              key={s.key}
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 shrink-0 justify-start gap-1 px-0 max-sm:text-xs sm:gap-1.5 sm:px-1.5"
              disabled={!open}
              onClick={() => open?.(s.key)}
              title={`Open ${s.label}'s chart`}
            >
              <span
                aria-hidden
                className="h-0.5 w-1.5 shrink-0 rounded-full sm:w-2.5"
                style={{ background: `var(${LINE_TOKENS[i % LINE_TOKENS.length]})` }}
              />
              <span className="font-semibold">{s.label}</span>
              <span className="hidden text-muted-foreground 2xl:inline">
                {s.via ? `via ${s.via}` : s.name}
              </span>
              {ch !== null && (
                <span className={cn('num', ch >= 0 ? 'text-gain' : 'text-loss')}>
                  {fmtPct(ch).slice(0, -2)}
                  <span className="max-sm:hidden"> {ch >= 0 ? '▲' : '▼'}</span>
                </span>
              )}
              {last !== undefined && !hover && (
                <span className="num hidden text-muted-foreground lg:inline">
                  {fmtValue(s, last)}
                </span>
              )}
              {ext && !hover && (
                <span className="num hidden text-muted-foreground lg:inline">
                  · {ext.label}{' '}
                  <span className={ext.change >= 0 ? 'text-gain' : 'text-loss'}>
                    {fmtPct(ext.change).slice(0, -2)}
                  </span>
                  {ext.via ? ` via ${ext.via}` : ''}
                </span>
              )}
              {s.delayed && <DelayedChip />}
            </Button>
          );
        })}
      </div>
      <div ref={host} className="h-72 w-full sm:h-80" />
      {shown.some((s) => s.extended) && (
        <p className="text-xs text-muted-foreground">
          Dashed: trades since the close (pre-market, after hours, overnight); an index reads
          through its ETF.
        </p>
      )}
      {shown.some((s) => s.error) && (
        <p className="text-xs text-muted-foreground">
          {shown
            .filter((s) => s.error)
            .map((s) => `${s.label}: ${s.error}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

/** A small status chip beside a symbol. */
const CHIP = 'h-4 px-1.5 text-[10px]';

/** "≈ SPY": the row is priced from that ETF. Purple, so it never reads as a warning. */
const ProxyChip = ({ text, title }: { text: string; title?: string }) => (
  <Badge
    variant="outline"
    title={title}
    className={cn(CHIP, 'num shrink-0 border-proxy/40 bg-proxy/10 text-proxy')}
  >
    {text}
  </Badge>
);

const DelayedChip = () => (
  <Badge variant="outline" className={cn(CHIP, 'border-warning/50 bg-warning/10 text-warning')}>
    Delayed
  </Badge>
);

/** One widget per symbol: change, sparkline over the prior close, value, and its source chip. */
export function MarketTiles({ symbols }: { symbols: string[] }) {
  const liveKeys = useMemo(() => symbols.filter((k) => !isDailyMarketKey(k)), [symbols]);
  const dailyKeys = useMemo(() => symbols.filter(isDailyMarketKey), [symbols]);
  const m = useMarket(liveKeys);
  const d = useMarketDaily(dailyKeys);
  const open = useSymbolChart();
  if (m.status === 'off') return <Unavailable status={m.status} error={m.error} />;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]">
      {symbols.map((k) => {
        const s = m.series[k] ?? d.series[k];
        if (!s) {
          const daily = isDailyMarketKey(k);
          const error = daily
            ? d.error
            : m.status === 'error'
              ? (m.error ?? 'not reachable')
              : null;
          if (error)
            return (
              <TileState key={k} label={k} tone="error" text={`Not reachable · ${error}`}>
                <IconButton
                  icon={RotateCw}
                  label="Retry"
                  variant="outline"
                  size="icon-xs"
                  onClick={daily ? d.retry : m.retry}
                />
              </TileState>
            );
          const none = daily ? !d.loading : m.missing.includes(k);
          if (none)
            return (
              <TileState
                key={k}
                label={k}
                text={m.status === 'closed' ? 'No data · market closed' : 'No data for today'}
              />
            );
          return <TileState key={k} label={k} text="Loading" loading />;
        }
        return (
          <Widget
            key={k}
            s={s}
            onOpen={open ? () => open(k) : undefined}
            live={m.status === 'live'}
          />
        );
      })}
    </div>
  );
}

/** A tile without a series yet: loading, no data, or failed with a reason and Retry. */
function TileState({
  label,
  text,
  tone,
  loading,
  children,
}: {
  label: string;
  text: string;
  tone?: 'error';
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      aria-busy={loading || undefined}
      className="flex h-[7.5rem] min-w-0 flex-col gap-1 rounded-lg border bg-card p-2.5"
    >
      <span className="truncate font-semibold">{label}</span>
      {loading ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <span className="flex h-14 items-center gap-1.5 text-xs text-muted-foreground">
          {tone === 'error' ? (
            <CircleAlert className="size-3.5 shrink-0 text-loss" />
          ) : (
            <CircleSlash className="size-3.5 shrink-0" />
          )}
          <span className="line-clamp-3">{text}</span>
        </span>
      )}
      <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        {loading ? (
          <span className="flex items-center gap-1">
            <LoaderCircle className="size-3 animate-spin" />
            {text}
          </span>
        ) : (
          <span />
        )}
        {children}
      </span>
    </div>
  );
}

function Widget({ s, onOpen, live }: { s: MarketSeries; onOpen?: () => void; live: boolean }) {
  const last = s.bars.at(-1)?.c;
  const ch =
    s.daily?.points && last !== undefined && s.prevClose !== null
      ? last - s.prevClose
      : changeOf(s);
  const up = (ch ?? 0) >= 0;
  const fmtCh = (c: number) => (s.daily?.points ? fmtPts(s, c) : fmtPct(c));
  const ext = useMemo(() => extendedOf(s), [s]);
  // The session's bars, then (dashed) the trades since its close, joined at its last minute.
  const data = useMemo(() => {
    const rows: { t: number; c?: number; e?: number }[] = s.bars.map((b) => ({ t: b.t, c: b.c }));
    const last = rows.at(-1);
    if (ext && last) {
      last.e = last.c;
      for (const b of ext.bars) if (b.t > last.t) rows.push({ t: b.t, e: b.c });
    }
    return rows;
  }, [s.bars, ext]);
  const values = data.flatMap((d) => [d.c, d.e]).filter((v): v is number => v !== undefined);
  const lo = Math.min(...values, s.prevClose ?? Number.POSITIVE_INFINITY);
  const hi = Math.max(...values, s.prevClose ?? Number.NEGATIVE_INFINITY);
  const pad = (hi - lo) * 0.12 || 1;
  const tone = up ? 'var(--gain)' : 'var(--loss)';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      aria-label={`${s.label} ${ch === null ? '' : fmtCh(ch)}, open chart`}
      className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-semibold">{s.label}</span>
        {ch !== null && (
          <span
            className={cn('num shrink-0 text-xs whitespace-nowrap', up ? 'text-gain' : 'text-loss')}
          >
            {fmtCh(ch)}
          </span>
        )}
      </span>
      {ext ? (
        <span className="num truncate text-xs text-muted-foreground">
          {ext.label}{' '}
          <span className={ext.change >= 0 ? 'text-gain' : 'text-loss'}>
            {fmtPct(ext.change).slice(0, -2)}
          </span>
        </span>
      ) : (
        <span className="truncate text-[11px] text-muted-foreground">{s.name}</span>
      )}
      {data.length > 1 ? (
        <ChartContainer
          config={{ c: { label: s.label, color: tone } }}
          className="aspect-auto h-14 w-full"
        >
          <AreaChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
            <YAxis hide domain={[lo - pad, hi + pad]} />
            {s.prevClose !== null && !s.daily && (
              <ReferenceLine
                y={s.prevClose}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
              />
            )}
            <Area
              dataKey="c"
              type="linear"
              stroke={tone}
              strokeWidth={1.5}
              fill={tone}
              fillOpacity={0.1}
              isAnimationActive={false}
              dot={false}
            />
            {ext && (
              <Area
                dataKey="e"
                type="linear"
                stroke={ext.change >= 0 ? 'var(--gain)' : 'var(--loss)'}
                strokeWidth={1.5}
                strokeDasharray="3 2"
                fill="none"
                isAnimationActive={false}
                dot={false}
              />
            )}
          </AreaChart>
        </ChartContainer>
      ) : (
        <span className="grid h-14 place-items-center text-xs text-muted-foreground">
          {s.error ?? 'No bars yet'}
        </span>
      )}
      <span className="flex items-baseline justify-between gap-2">
        <span className="num text-sm">{last !== undefined ? fmtValue(s, last) : '—'}</span>
        {s.daily ? (
          <span className="text-[10px] text-muted-foreground">Daily · {day(s.daily.asOf)}</span>
        ) : s.delayed ? (
          <DelayedChip />
        ) : s.via ? (
          <span className="text-[10px] text-muted-foreground">via {s.via}</span>
        ) : live ? (
          <span className="text-[10px] text-muted-foreground">Live</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Up or down today: one row per symbol with its price now and its change today,
 * in the session or since it closed (the session it traded in named), and how many are up and down.
 */
export function MarketToday({ symbols: all }: { symbols: string[] }) {
  const symbols = useMemo(() => all.filter((k) => !isDailyMarketKey(k)), [all]);
  const m = useMarket(symbols);
  const open = useSymbolChart();
  const rows = symbols
    .map((k) => m.series[k])
    .filter((s): s is MarketSeries => !!s)
    .map((s) => {
      const today = todayOf(s);
      // The ETF a row is priced from: an index outside the session, or a symbol the feed has
      // only through one (Gold through GLD).
      const proxy = (today?.label ? s.extended?.via : s.via) ?? null;
      return { s, today, proxy };
    });
  if (m.status === 'off' || (m.status === 'error' && !rows.length))
    return <Unavailable status={m.status} error={m.error} onRetry={m.retry} />;
  if (!rows.length && symbols.length && m.missing.length === symbols.length)
    return <p className="py-6 text-center text-sm text-muted-foreground">No prices yet.</p>;
  if (!rows.length) return <Skeleton aria-busy className="h-40 w-full" />;
  const up = rows.filter((r) => (r.today?.change ?? 0) > 0).length;
  const down = rows.filter((r) => (r.today?.change ?? 0) < 0).length;
  const session =
    rows.find((r) => r.today?.label)?.today?.label ?? (m.status === 'live' ? 'Live' : null);
  const proxied = rows.filter((r) => r.proxy);
  return (
    <div className="flex flex-col gap-1">
      <p className="num flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-gain">▲ {up} up</span>
        <span className="text-loss">▼ {down} down</span>
        {session && <span className="ml-auto font-sans">{session}</span>}
      </p>
      <div className="flex flex-col">
        {rows.map(({ s, today, proxy }) => {
          const ch = today?.change ?? null;
          const tone = ch === null ? 'text-muted-foreground' : ch >= 0 ? 'text-gain' : 'text-loss';
          return (
            <Button
              key={s.key}
              variant="ghost"
              className="h-auto min-w-0 justify-between gap-3 px-2 py-1.5 font-normal"
              disabled={!open}
              onClick={() => open?.(s.key)}
              title={`Open ${s.label}'s chart`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">{s.label}</span>
                {proxy && (
                  <ProxyChip
                    text={`≈ ${proxy}`}
                    title={`${s.label} is priced from ${proxy}'s move${today?.label ? ` ${today.label.toLowerCase()}` : ''}.`}
                  />
                )}
                {s.delayed && !today?.label && <DelayedChip />}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="num text-xs text-muted-foreground">
                  {today ? fmtValue(s, today.value) : '—'}
                </span>
                <span className={cn('num w-16 text-right text-sm font-semibold', tone)}>
                  {ch === null ? '—' : fmtPct(ch)}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
      {proxied.length > 0 && (
        <p className="flex items-start gap-2 border-t px-2 pt-2 text-xs text-muted-foreground">
          <ProxyChip text="≈" />
          <span>
            {proxied.length === 1
              ? `Proxy: ${proxied[0]?.s.label} moves with ${proxied[0]?.proxy}.`
              : "Proxy: these don't trade now, so each moves with its ETF."}
          </span>
        </p>
      )}
    </div>
  );
}
