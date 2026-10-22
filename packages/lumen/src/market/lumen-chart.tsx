/**
 * LumenChart: the one price chart of every app, as a component
 * (`<LumenChart symbols={[…]} />`, an app's symbol page), the `chart` widget any view can add, and
 * the chart dialog (mockup "Symbol chart dialog"): any widget, legend name or
 * symbol on any app opens it. Windows 1D to Max, candles or line, crosshair, drag and zoom,
 * and the timeline under it. 1D shows today's live bars where the app has live data (an app);
 * every other window reads history from the app's `bars` route (the warehouse, or Yahoo labelled
 * Delayed for what the warehouse does not hold).
 *
 * Compare: up to 8 symbols. Two or more
 * draw as % from the left edge of what is visible (dragging the timeline moves the baseline) or as
 * Price, each on its own scale. Every indicator is made only when added, for one symbol or All
 * shown: computed ones in the browser from the bars plus warm-up bars before the window (SMA 200
 * draws from the first bar); P/E, IV and the EPS estimate read once from market data.
 */
import type { ChartFormula, IndicatorSpec } from '@columenlabs/lumen-types/chart-formula';
import {
  MARKET_SYMBOLS,
  type MarketBar,
  type MarketBarsResponse,
  type MarketIndicatorsResponse,
  type MarketSeries,
  type MarketWindow,
  isDailyMarketKey,
  marketWindows,
} from '@columenlabs/lumen-types/market';
import { queryOptions, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInView } from 'react-intersection-observer';
import { useAssistantMoves } from '../assistant-screen';
import { IconButton } from '../icon-button';
import { cn } from '../lib/utils';
import { type LumenLoad, useLumenLoad } from '../lumen-source';
import { usePrefs } from '../prefs';
import { refreshHeaders } from '../refresh';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { CompareChart, type CompareExtra, type ComparePane } from './compare-chart';
import { ALL_SHOWN, IndicatorPicker } from './indicator-picker';
import {
  CHART_INDICATORS,
  type ChartIndicator,
  type IndicatorValues,
  computeIndicators,
  formulaIndicator,
  lineColor,
  resolveIndicator,
} from './indicators';
import { extendedOf, todayOf, useMarket } from './live';
import { type ChartBar, PriceChart, type TimeSpan, indexSpan, secOf } from './price-chart';

/** Opens the chart dialog: one symbol, or up to 8 to compare, with its indicators if given. */
export type OpenChart = (symbols: string | string[], indicators?: IndicatorSpec[]) => void;

/**
 * The person's saved formulas (Mine): drawn by `mine:<id>`, listed first in the
 * picker; `save` and `remove` where the app keeps them.
 */
export interface MineIndicators {
  list: ChartIndicator[];
  save?: (f: ChartFormula) => Promise<void>;
  remove?: (id: string) => Promise<void>;
}

const ChartContext = createContext<OpenChart | null>(null);
const BarsContext = createContext<string | null>(null);
const IndicatorsContext = createContext<string | null>(null);
const MineContext = createContext<MineIndicators>({ list: [] });

/** A saved formula as the route returns it. */
type SavedFormula = ChartFormula & { id: string };

/** The person's saved formulas from `url` (`GET` lists, `POST` saves, `DELETE /:id`). */
function useMineIndicators(url: string | undefined): MineIndicators {
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ['chart-indicators', url],
    enabled: !!url,
    queryFn: async ({ signal }) => {
      const r = await fetch(url as string, { credentials: 'same-origin', signal });
      if (!r.ok) throw new Error(`saved indicators answered ${r.status}`);
      return ((await r.json()) as { indicators: SavedFormula[] }).indicators;
    },
  });
  const list = useMemo(
    () =>
      (q.data ?? []).flatMap((m) => {
        try {
          return [formulaIndicator(m, m.id)];
        } catch {
          return [];
        }
      }),
    [q.data],
  );
  const send = useCallback(
    async (path: string, init: RequestInit) => {
      const r = await fetch(`${url}${path}`, {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(e?.error ?? `saved indicators answered ${r.status}`);
      }
      await client.invalidateQueries({ queryKey: ['chart-indicators', url] });
    },
    [url, client],
  );
  return useMemo(
    () =>
      url
        ? {
            list,
            save: (f) => send('', { method: 'POST', body: JSON.stringify(f) }),
            remove: (id) =>
              send(`/${encodeURIComponent(id.replace(/^mine:/, ''))}`, { method: 'DELETE' }),
          }
        : { list },
    [url, list, send],
  );
}

/** Opens the chart dialog; null where no app mounted the dialog. */
export const useSymbolChart = () => useContext(ChartContext);
/** The app's history route (`bars`) the chart reads; null where no app mounted the dialog. */
export const useBarsUrl = () => useContext(BarsContext);

/** Symbols one chart compares at most. */
export const MAX_COMPARE = 8;
/** Each compared symbol's colour, by its place in the list. */
const SYMBOL_COLORS = [
  'var(--chart-1)',
  'var(--chart-3)',
  'var(--chart-6)',
  'var(--chart-5)',
  'var(--chart-2)',
  'var(--chart-4)',
  'var(--chart-9)',
  'var(--chart-8)',
];
/** A compared symbol's colour. */
const colorIn = (symbols: string[], s: string) =>
  SYMBOL_COLORS[symbols.indexOf(s)] ?? 'var(--primary)';
const SYMBOL_RE = /^[A-Za-z0-9.^$=:/-]{1,24}$/;
const tidy = (list: string[]) =>
  [...new Set(list.map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s)))].slice(
    0,
    MAX_COMPARE,
  );

/**
 * Mounts LumenChart once for an app, and its dialog: `bars` is the app's history route,
 * `indicators` its sourced indicator route (P/E, IV, EPS estimate); left out, those indicators are
 * not offered. `mine` is the route of the person's saved formulas; left out, there is no Mine.
 */
export function SymbolChartProvider({
  bars,
  indicators,
  mine,
  children,
}: { bars: string; indicators?: string; mine?: string; children: ReactNode }) {
  const [open, setOpen] = useState<{ symbols: string[]; indicators?: IndicatorSpec[] } | null>(
    null,
  );
  const show = useCallback<OpenChart>((s, i) => {
    const list = tidy([s].flat());
    setOpen(list.length ? { symbols: list, indicators: i?.length ? i : undefined } : null);
  }, []);
  const saved = useMineIndicators(mine);
  // The assistant opens a chart the same way, one symbol or a list, with any indicators it names (built-ins
  // with any window, saved ones, or formulas); Undo puts back what was open.
  useAssistantMoves('chart', {
    chart: show,
    snapshot: () => open,
    restore: (s) => setOpen((s as typeof open) ?? null),
  });
  const symbols = open?.symbols ?? null;
  return (
    <ChartContext.Provider value={show}>
      <BarsContext.Provider value={bars}>
        <IndicatorsContext.Provider value={indicators ?? null}>
          <MineContext.Provider value={saved}>
            {children}
            <Dialog open={symbols !== null} onOpenChange={(o) => !o && setOpen(null)}>
              <DialogContent
                showCloseButton={false}
                className="flex max-h-svh flex-col gap-3 overflow-y-auto max-sm:h-svh max-sm:max-w-full max-sm:rounded-none sm:max-w-5xl"
              >
                {open && (
                  <LumenChart
                    // A new list from outside (the assistant, a view) starts the chart over.
                    key={`${open.symbols.join(',')}|${JSON.stringify(open.indicators ?? null)}`}
                    symbols={open.symbols}
                    indicators={open.indicators}
                    variant="dialog"
                    onClose={() => setOpen(null)}
                  />
                )}
              </DialogContent>
            </Dialog>
          </MineContext.Provider>
        </IndicatorsContext.Provider>
      </BarsContext.Provider>
    </ChartContext.Provider>
  );
}

/** An indicator added for one symbol, or for every symbol shown (`all`). */
type Pick = { id: string; for: string };
const DEFAULT_PICKS: Pick[] = [
  { id: 'sma_20', for: ALL_SHOWN },
  { id: 'rsi_14', for: ALL_SHOWN },
];
/** Windows read at their own finer bars; every other window is a span of the daily history. */
const INTRADAY: MarketWindow[] = ['1D', '5D', '1M'];
const DAY = 86_400;
const ALL_TIME: TimeSpan = { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY };
/** The span a daily window shows, from today back; the chart snaps it to the bars it has. */
function spanOf(w: MarketWindow | null): TimeSpan {
  if (w === 'YTD') return { ...ALL_TIME, from: Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000 };
  const days = { '1M': 31, '6M': 183, '1Y': 366, '5Y': 5 * 366 }[w as string];
  return days ? { ...ALL_TIME, from: Date.now() / 1000 - days * DAY } : ALL_TIME;
}
const TYPES = [
  { id: 'candles', label: 'Candles' },
  { id: 'line', label: 'Line' },
] as const;
const MODES = [
  { id: 'pct', label: '%' },
  { id: 'price', label: 'Price' },
] as const;

export const toChart = (b: MarketBar): ChartBar => ({
  time: b.t,
  open: b.o,
  high: b.h,
  low: b.l,
  close: b.c,
});
/** Daily bars sit at UTC midnight; the chart reads them as days. */
export const toDaily = (b: MarketBar): ChartBar => ({
  ...toChart(b),
  time: new Date(b.t * 1000).toISOString().slice(0, 10),
});
// One ChartBar array per source, so a re-render hands the chart the same bars and does not
// rebuild it. New arrays on every render rebuilt it in a loop, which flashed.
const chartBars = new WeakMap<object, ChartBar[]>();
const once = (src: object, make: () => ChartBar[]) => {
  let bars = chartBars.get(src);
  if (!bars) {
    bars = make();
    chartBars.set(src, bars);
  }
  return bars;
};
const NO_BARS: ChartBar[] = [];

// History ends at the last nightly load; every other window ends on the live feed too, so its
// last price is the header's and the Symbol sheet's (one live source).
const tails = new WeakMap<object, WeakMap<object, ChartBar[]>>();
function liveTail(bars: ChartBar[], today: MarketSeries | undefined, date: string | undefined) {
  if (!today?.bars.length || !bars.length || !date) return bars;
  let byToday = tails.get(bars);
  if (!byToday) {
    byToday = new WeakMap();
    tails.set(bars, byToday);
  }
  const hit = byToday.get(today);
  if (hit) return hit;
  const after = (extendedOf(today)?.bars ?? []).filter((x) => x.t > (today.bars.at(-1)?.t ?? 0));
  const all = [...today.bars, ...after];
  let out: ChartBar[];
  if (typeof bars[0]?.time === 'string') {
    // Daily: today's bar from the session (and the trades since), replacing a stored one.
    const day: ChartBar = {
      time: date,
      open: today.bars[0]?.o ?? 0,
      high: Math.max(...all.map((b) => b.h)),
      low: Math.min(...all.map((b) => b.l)),
      close: all.at(-1)?.c ?? 0,
    };
    const last = bars.at(-1)?.time as string;
    out = last > date ? bars : [...(last === date ? bars.slice(0, -1) : bars), day];
  } else {
    const end = secOf(bars.at(-1)?.time ?? 0);
    out = [...bars, ...all.filter((b) => b.t > end).map(toChart)];
  }
  byToday.set(today, out);
  return out;
}
const NO_VALUES: IndicatorValues = {};
const barsOf = (d: MarketBarsResponse | null | undefined) =>
  d ? once(d, () => d.bars.map(d.resolution === '1d' ? toDaily : toChart)) : NO_BARS;

type Read = { data: MarketBarsResponse | null; error: string | null };
const NONE: Read = { data: null, error: null };
type Want = { symbol: string; window: MarketWindow; warm: boolean };

const barsQuery = (url: string, w: Want) =>
  queryOptions({
    queryKey: ['lumen-chart', url, w.symbol, w.window, w.warm] as const,
    queryFn: async ({ signal }) => {
      const r = await fetch(
        `${url}?symbol=${encodeURIComponent(w.symbol)}&window=${w.window}${w.warm ? '&warmup=1' : ''}`,
        { credentials: 'same-origin', headers: refreshHeaders(), signal },
      );
      if (!r.ok) throw new Error(`history answered ${r.status}`);
      return (await r.json()) as MarketBarsResponse;
    },
    staleTime: 5 * 60_000,
  });

/**
 * History reads per symbol, window and whether they carry warm-up bars. A read with warm-up not
 * back yet shows the same read without, so adding an indicator keeps the chart up while its bars
 * load.
 */
function useReads(url: string | null, wants: Want[], enabled: boolean) {
  const client = useQueryClient();
  const queries = useQueries({
    queries: wants.map((w) => ({
      ...barsQuery(url ?? '', w),
      enabled: enabled && !!url,
      placeholderData: w.warm
        ? () => client.getQueryData(barsQuery(url ?? '', { ...w, warm: false }).queryKey)
        : undefined,
    })),
  });
  const keyOf = (w: Want) => `${w.symbol}|${w.window}|${w.warm ? 1 : 0}`;
  const byKey = new Map(wants.map((w, i) => [keyOf(w), queries[i]]));
  const read = (w: Want): Read => {
    const q = byKey.get(keyOf(w));
    if (!q) return NONE;
    return { data: q.data ?? null, error: q.data ? null : (q.error?.message ?? null) };
  };
  return { read, queries };
}

/** Sourced lines (P/E, IV, EPS estimate) per symbol and indicator, each read once on add. */
function useSourced(url: string | null, wants: { symbol: string; id: string }[]) {
  const [store, setStore] = useState<Record<string, Map<string, number> | 'loading' | 'failed'>>(
    {},
  );
  const asked = useRef(new Set<string>());
  const want = wants.map((w) => `${w.symbol}|${w.id}`).join(';');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `want` names every read in `wants`
  useEffect(() => {
    if (!url) return;
    const bySymbol = new Map<string, string[]>();
    for (const w of wants) {
      const k = `${w.symbol}|${w.id}`;
      if (asked.current.has(k)) continue;
      asked.current.add(k);
      bySymbol.set(w.symbol, [...(bySymbol.get(w.symbol) ?? []), w.id]);
    }
    for (const [symbol, ids] of bySymbol) {
      setStore((s) => ({
        ...s,
        ...Object.fromEntries(ids.map((id) => [`${symbol}|${id}`, 'loading'])),
      }));
      fetch(`${url}?symbol=${encodeURIComponent(symbol)}&names=${ids.join(',')}`, {
        credentials: 'same-origin',
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const d = (await r.json()) as MarketIndicatorsResponse;
          setStore((s) => ({
            ...s,
            ...Object.fromEntries(
              ids.map((id) => [
                `${symbol}|${id}`,
                new Map(
                  (d.lines[id] ?? []).map(([t, v]) => [
                    new Date(t * 1000).toISOString().slice(0, 10),
                    v,
                  ]),
                ),
              ]),
            ),
          }));
        })
        .catch(() => {
          for (const id of ids) asked.current.delete(`${symbol}|${id}`);
          setStore((s) => ({
            ...s,
            ...Object.fromEntries(ids.map((id) => [`${symbol}|${id}`, 'failed'])),
          }));
        });
    }
  }, [url, want]);
  return store;
}

/** One symbol's bars and indicator values in the window shown. */
interface Shown {
  symbol: string;
  bars: ChartBar[];
  timeline: ChartBar[];
  values: IndicatorValues;
  read: Read;
  live: boolean;
  own: boolean;
}

/** What a LumenChart starts with; key it by them to start it over when they change. */
export interface LumenChartOptions {
  /** One symbol, or up to 8 to compare. */
  symbols: string[];
  /** The window it opens on; left out: 1D for one symbol, 1Y to compare, 6M for daily series. */
  window?: MarketWindow;
  type?: 'candles' | 'line';
  /**
   * Indicators drawn for every symbol shown: catalog ids, built-ins with any window (`ema_13`,
   * `bollinger_20_2p5`), saved formulas (`mine:<id>`) or formulas; left out: SMA 20 and RSI 14 for
   * one symbol.
   */
  indicators?: IndicatorSpec[];
  /** `dialog` inside the chart dialog; `card` (default) inside a page's card or a sheet. */
  variant?: 'dialog' | 'card';
  /** Reads nothing until the chart (`ref`) scrolls into view. */
  lazy?: boolean;
  /** Shows a Close button. */
  onClose?: () => void;
  /** The window buttons (a card's Window control); left out: shown. */
  windows?: boolean;
}

/** LumenChart as one symbol, or up to 8 compared, inside a card, a sheet or the chart dialog. */
export function LumenChart(props: LumenChartOptions) {
  const chart = useLumenChart(props);
  return (
    <div ref={chart.ref} className="flex flex-col gap-3">
      {chart.element}
    </div>
  );
}

/**
 * LumenChart's state and body, for a card that shows its source: `load` (its ↻ and load time),
 * `rows` (bars drawn), `ref` (for `lazy`) and `element`. `noDesk`: the app mounted no
 * SymbolChartProvider, so there is nothing to read.
 */
export function useLumenChart({
  symbols: initial,
  window: start,
  type: startType,
  indicators,
  variant = 'card',
  lazy = false,
  onClose,
  windows: showWindows = true,
}: LumenChartOptions): {
  load: LumenLoad;
  rows: number;
  ref: (el: Element | null) => void;
  element: ReactNode;
  noDesk: boolean;
} {
  const barsUrl = useBarsUrl();
  const indicatorsUrl = useContext(IndicatorsContext);
  const mine = useContext(MineContext);
  const { ref, inView: seen } = useInView({ triggerOnce: true, rootMargin: '200px', skip: !lazy });
  const enabled = !lazy || seen;
  const dialog = variant === 'dialog';
  const { timeZone } = usePrefs();
  const [symbols, setSymbols] = useState(() => tidy(initial));
  const compare = symbols.length > 1;
  // Breadth and macro series are daily: no intraday windows, and nothing live. One of them in a
  // compare makes the whole chart daily (one time axis).
  const daily = symbols.some(isDailyMarketKey);
  const windows = daily ? marketWindows.filter((w) => w !== '1D' && w !== '5D') : marketWindows;
  // What the chart reads and shows: a window button, or the span the timeline asked for outside an
  // intraday window's bars. `pressed` is the button lit; panning or zooming clears it.
  const [view, setView] = useState<{ window: MarketWindow | null; span?: TimeSpan }>({
    window: start ?? (daily ? '6M' : initial.length > 1 ? '1Y' : '1D'),
  });
  const [pressed, setPressed] = useState<MarketWindow | null>(view.window);
  const [shown, setShown] = useState<TimeSpan | null>(null);
  const window =
    view.window === '1D' || view.window === '5D' ? (daily ? '6M' : view.window) : view.window;
  // Null until someone picks: candles, or a line where every bar is flat (a fund priced by NAV).
  const [picked, setType] = useState<'candles' | 'line' | null>(
    daily ? 'line' : (startType ?? null),
  );
  const [mode, setMode] = useState<'pct' | 'price'>('pct');
  // Indicators that are not in the catalog or Mine: built-ins with their own window and formulas.
  const [made, setMade] = useState<ChartIndicator[]>(() =>
    (indicators ?? []).flatMap((spec) => {
      const i = typeof spec === 'string' ? null : resolveIndicator(spec);
      return i ? [i] : [];
    }),
  );
  const [picks, setPicks] = useState<Pick[]>(() =>
    indicators
      ? indicators.map((spec) => ({
          id: typeof spec === 'string' ? spec : (resolveIndicator(spec)?.id ?? ''),
          for: ALL_SHOWN,
        }))
      : initial.length > 1
        ? []
        : DEFAULT_PICKS,
  );
  const [target, setTarget] = useState(ALL_SHOWN);
  const live = useMarket(daily ? [] : symbols);

  const idsFor = useCallback(
    (s: string) =>
      new Set(picks.filter((p) => p.for === ALL_SHOWN || p.for === s).map((p) => p.id)),
    [picks],
  );
  // What an id draws: the catalog, a saved formula, one made here, or a built-in with its window.
  const resolve = useCallback(
    (id: string) => made.find((i) => i.id === id) ?? resolveIndicator(id, mine.list),
    [made, mine.list],
  );
  // The same array per symbol until the picks change, so the chart is not rebuilt each render.
  const chosenFor = useMemo(() => {
    const bySymbol = new Map<string, ChartIndicator[]>();
    return (s: string) => {
      let got = bySymbol.get(s);
      if (!got) {
        got = [...idsFor(s)].flatMap((id) => {
          const i = resolve(id);
          return i ? [i] : [];
        });
        bySymbol.set(s, got);
      }
      return got;
    };
  }, [idsFor, resolve]);
  const computedFor = (s: string) => chosenFor(s).some((i) => i.computed);

  // Every symbol's whole history, read once: the timeline under the chart,
  // and, when it is daily, the bars of every daily window, which the buttons, panning and zooming
  // move through. The delayed source answers Max in months: then each window reads its own days.
  const { read: reads, queries: fullQueries } = useReads(
    barsUrl,
    symbols.map((symbol) => ({ symbol, window: 'Max' as MarketWindow, warm: false })),
    enabled,
  );
  const coarse = (bars: ChartBar[]) => {
    const gaps = bars.slice(1).map((b, i) => secOf(b.time) - secOf(bars[i]?.time ?? 0));
    return (gaps.sort((x, y) => x - y)[gaps.length >> 1] ?? 0) > 5 * DAY;
  };
  const plan = symbols.map((symbol) => {
    const full = reads({ symbol, window: 'Max', warm: false });
    const timeline = barsOf(full.data);
    const own =
      window !== null &&
      ((!daily && INTRADAY.includes(window)) || (coarse(timeline) && window !== 'Max'));
    const today = live.series[symbol];
    const useLive = window === '1D' && !!today?.bars.length;
    const warm = computedFor(symbol);
    return { symbol, full, timeline, own, useLive, warm, today };
  });
  const { read: partReads, queries: partQueries } = useReads(
    barsUrl,
    plan
      .filter((p) => p.own && !(p.useLive && !p.warm) && window !== null)
      .map((p) => ({ symbol: p.symbol, window: window as MarketWindow, warm: p.warm })),
    enabled,
  );
  const load = useLumenLoad(...fullQueries, ...partQueries);
  const sourced = useSourced(
    indicatorsUrl,
    symbols.flatMap((symbol) =>
      chosenFor(symbol)
        .filter((i) => i.sourced && !isDailyMarketKey(symbol))
        .map((i) => ({ symbol, id: i.id })),
    ),
  );

  const series: Shown[] = plan.map((p) => {
    const part =
      p.own && window !== null ? partReads({ symbol: p.symbol, window, warm: p.warm }) : NONE;
    const read = p.own ? part : p.full;
    // 1D is the session's bars, then the trades since its close (pre-market, after hours,
    // overnight), all from the one live feed, so the chart ends where the header's price is.
    const bars = p.useLive
      ? p.today
        ? once(p.today, () => {
            const s = p.today as MarketSeries;
            const after = (extendedOf(s)?.bars ?? []).filter((x) => x.t > (s.bars.at(-1)?.t ?? 0));
            return [...s.bars, ...after].map(toChart);
          })
        : NO_BARS
      : liveTail(p.own ? barsOf(part.data) : p.timeline, p.today, live.session?.date);
    return {
      symbol: p.symbol,
      bars,
      timeline: p.timeline,
      values: {},
      read,
      live: p.useLive,
      own: p.own,
    };
  });
  // Indicator lines, worked out over warm-up + window so long lines (SMA 200) start on the first
  // bar, then the sourced lines of daily bars.
  const valueKey = series
    .map(
      (s) => `${s.symbol}:${s.bars.length}:${s.bars.at(-1)?.close}:${s.read.data?.warmup?.length}`,
    )
    .join('|');
  const sourcedKey = Object.entries(sourced)
    .map(([k, v]) => `${k}:${typeof v === 'string' ? v : v.size}`)
    .join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by what the lines read
  const values = useMemo(() => {
    const out: Record<string, IndicatorValues> = {};
    for (const s of series) {
      const d = s.read.data;
      let warm: ChartBar[] = [];
      if (s.live) {
        const first = s.bars[0]?.time ?? Number.POSITIVE_INFINITY;
        if (d?.resolution === '1m')
          warm = [...(d.warmup ?? []), ...d.bars]
            .filter((b) => b.t < (first as number))
            .slice(-250)
            .map(toChart);
      } else if (d && s.own) warm = (d.warmup ?? []).map(d.resolution === '1d' ? toDaily : toChart);
      const chosen = chosenFor(s.symbol).filter(
        (i) => i.computed && (!i.daily || typeof s.bars[0]?.time === 'string'),
      );
      const v = computeIndicators([...warm, ...s.bars], chosen);
      if (typeof s.bars[0]?.time === 'string')
        for (const i of chosenFor(s.symbol).filter((x) => x.sourced)) {
          const got = sourced[`${s.symbol}|${i.id}`];
          if (got instanceof Map) v[i.id] = got;
        }
      out[s.symbol] = v;
    }
    return out;
  }, [valueKey, sourcedKey, chosenFor]);

  // Which indicators the current window can draw, and why not.
  const dailyBars = !(window && INTRADAY.includes(window)) || daily;
  const reasons = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of CHART_INDICATORS) {
      if (i.sourced) {
        if (!indicatorsUrl) m.set(i.id, 'not on this desk');
        else if (!dailyBars) m.set(i.id, 'daily windows');
        else if (symbols.every(isDailyMarketKey)) m.set(i.id, 'stocks and ETFs');
      } else if (!i.computed) m.set(i.id, 'needs volume');
      else if (i.daily && !dailyBars) m.set(i.id, 'daily windows');
    }
    return m;
  }, [indicatorsUrl, dailyBars, symbols]);
  const available = useMemo(
    () => new Set(CHART_INDICATORS.filter((i) => !reasons.has(i.id)).map((i) => i.id)),
    [reasons],
  );
  const pickTarget = compare ? target : ALL_SHOWN;
  const selected = picks.filter((p) => p.for === pickTarget).map((p) => p.id);
  const toggle = (id: string) =>
    setPicks(
      selected.includes(id)
        ? picks.filter((p) => !(p.id === id && p.for === pickTarget))
        : [...picks, { id, for: pickTarget }],
    );
  // A built-in with its own window or a formula from the picker: added, and kept to resolve.
  const add = (i: ChartIndicator) => {
    if (!resolve(i.id)) setMade([...made, i]);
    if (!selected.includes(i.id)) setPicks([...picks, { id: i.id, for: pickTarget }]);
  };

  const range = useMemo(
    () => view.span ?? (window && INTRADAY.includes(window) && !daily ? ALL_TIME : spanOf(window)),
    [view, window, daily],
  );
  const pick = (w: MarketWindow) => {
    setView({ window: w });
    setPressed(w);
  };
  const addSymbol = (raw: string) => {
    const next = tidy([...symbols, ...raw.split(/[\s,]+/)]);
    if (next.length !== symbols.length) setSymbols(next);
  };
  const removeSymbol = (s: string) => {
    setSymbols(symbols.filter((x) => x !== s));
    setPicks(picks.filter((p) => p.for !== s));
    if (target === s) setTarget(ALL_SHOWN);
  };

  const windowButtons = (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={pressed ?? ''}
      onValueChange={(v) => v && pick(v as MarketWindow)}
      aria-label="Window"
      className="flex-wrap"
    >
      {windows.map((w) => (
        <ToggleGroupItem
          key={w}
          value={w}
          className="px-2.5"
          // A lit button pressed again goes back to its window after panning.
          onClick={() => w === pressed && pick(w)}
        >
          {w}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
  const pickChips = picks.map((p) => {
    const i = resolve(p.id);
    if (!i) return null;
    const loading =
      i.sourced &&
      symbols.some((s) => sourced[`${s}|${i.id}`] === 'loading' && idsFor(s).has(i.id));
    const color = compare
      ? p.for === ALL_SHOWN
        ? 'var(--muted-foreground)'
        : (SYMBOL_COLORS[symbols.indexOf(p.for)] ?? 'var(--primary)')
      : lineColor(i.lines[0]?.key ?? '');
    const label = i.formula ? `ƒ ${i.label}` : i.label;
    const name = compare ? `${label} · ${p.for === ALL_SHOWN ? 'All' : p.for}` : label;
    return (
      <Badge key={`${p.id}|${p.for}`} variant="secondary" className="h-7 gap-1.5 pr-1">
        <span aria-hidden className="h-0.5 w-2.5 rounded-full" style={{ background: color }} />
        {name}
        {loading && <span className="text-muted-foreground">loading…</span>}
        <IconButton
          icon={XIcon}
          size="icon-xs"
          label={`Remove ${name}`}
          onClick={() => setPicks(picks.filter((x) => x !== p))}
        />
      </Badge>
    );
  });
  const picker = (
    <IndicatorPicker
      selected={selected}
      available={available}
      reasons={reasons}
      mine={mine}
      onAdd={add}
      targets={compare ? symbols : undefined}
      target={pickTarget}
      onTarget={setTarget}
      onToggle={toggle}
    />
  );
  const adder =
    symbols.length < MAX_COMPARE ? (
      <Input
        aria-label="Add a symbol to compare"
        placeholder="＋ Compare"
        className="h-7 w-28 font-mono uppercase placeholder:normal-case"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          addSymbol(e.currentTarget.value);
          e.currentTarget.value = '';
        }}
      />
    ) : null;
  const footer = (
    <p className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {compare && mode === 'pct'
          ? '% from the left edge of the chart · drag the timeline to move the baseline'
          : compare
            ? 'Each symbol on its own scale · hover to read the day'
            : 'Hover to read a bar · drag to pan, scroll to zoom · drag the timeline window or its edges'}
      </span>
      {!series[0]?.live && series[0]?.read.data && (
        <span>
          {series.some((s) => s.read.data?.source === 'delayed') ? 'Delayed source' : 'History'} ·{' '}
          {series[0].read.data.resolution} bars
        </span>
      )}
    </p>
  );

  const result = (element: ReactNode) => ({
    load,
    rows: series[0]?.bars.length ?? 0,
    ref,
    element,
    noDesk: !barsUrl,
  });
  if (!barsUrl)
    return result(<p className="text-sm text-muted-foreground">Charts are not on this desk.</p>);

  if (compare)
    return result(
      <Compare
        dialog={dialog}
        symbols={symbols}
        series={series}
        values={values}
        chosenFor={chosenFor}
        mode={mode}
        timeZone={timeZone}
        range={range}
        onClose={onClose}
        onRemove={removeSymbol}
        header={
          <div className="flex flex-wrap items-center justify-between gap-2">
            {windowButtons}
            <div className="flex flex-wrap items-center gap-2">
              {pickChips}
              {picker}
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                spacing={0}
                value={mode}
                onValueChange={(v) => v && setMode(v as 'pct' | 'price')}
                aria-label="Scale"
              >
                {MODES.map((m) => (
                  <ToggleGroupItem key={m.id} value={m.id} className="px-2.5">
                    {m.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        }
        adder={adder}
        footer={footer}
        onRange={(span, byPerson) => {
          setShown(span);
          if (byPerson) setPressed(null);
        }}
        onOutside={(span) => {
          setView({ window: null, span });
          setPressed(null);
        }}
      />,
    );

  const one = series[0] as Shown;
  const symbol = one.symbol;
  const today = live.series[symbol];
  const meta = MARKET_SYMBOLS[symbol];
  const fmt = (v: number) =>
    `${today?.prefix ?? meta?.prefix ?? ''}${v.toLocaleString('en-US', {
      minimumFractionDigits: today?.decimals ?? meta?.decimals ?? 2,
      maximumFractionDigits: today?.decimals ?? meta?.decimals ?? 2,
    })}${today?.suffix ?? meta?.suffix ?? ''}`;
  const bars = one.bars;
  // The header reads the bars the chart shows, so its price, change, high and low match them.
  const secs = bars.map((b) => secOf(b.time));
  const [a, b] = shown && secs.length ? indexSpan(secs, shown) : [0, bars.length - 1];
  const inView = bars.slice(a, b + 1);
  const atEnd = b >= bars.length - 1;
  const last = inView.at(-1)?.close ?? null;
  // Live at the end: up or down today, from the same base the Outlook and Holdings use (the prior
  // close, or the session's close once the overnight session starts a new day).
  const day = one.live && today ? todayOf(today) : null;
  const base = day?.base ?? today?.prevClose ?? null;
  const prev = one.live && atEnd ? base : (inView[0]?.open ?? null);
  // Breadth and rates move in points (a % above the 50-day from 49 to 36 is −13 pts, not −26%).
  const points = !!meta?.daily?.points;
  const change = last !== null && prev ? (points ? last - prev : (last / prev - 1) * 100) : null;
  const delayed = one.live ? today?.delayed : one.read.data?.source === 'delayed';
  const hi = inView.length ? Math.max(...inView.map((x) => x.high)) : null;
  const lo = inView.length ? Math.min(...inView.map((x) => x.low)) : null;
  const endDay = inView.at(-1)?.time;
  const loading = !one.live && !one.read.data && !one.read.error;
  const chosen = chosenFor(symbol);
  const judged = one.timeline.length ? one.timeline : bars;
  const flat =
    judged.length > 1 &&
    judged.every((x) => x.open === x.high && x.high === x.low && x.low === x.close);
  const type = picked ?? (flat ? 'line' : 'candles');

  return result(
    <>
      <ChartHeader dialog={dialog}>
        <div className="flex min-w-0 flex-col gap-1">
          <ChartTitle dialog={dialog} className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-bold">{today?.label ?? meta?.label ?? symbol}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {today?.name ?? meta?.name ?? ''}
              {today?.via ? ` via ${today.via}` : ''}
            </span>
            {delayed ? (
              <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
                Delayed
              </Badge>
            ) : one.live && live.status === 'live' ? (
              <Badge variant="outline" className="gap-1.5 border-gain/40 text-gain">
                <span className="size-1.5 rounded-full bg-gain" />
                Live
              </Badge>
            ) : null}
          </ChartTitle>
          <ChartDescription dialog={dialog}>
            <div className="num flex flex-wrap items-baseline gap-x-3 gap-y-1 text-foreground">
              {last !== null && <span className="text-xl">{fmt(last)}</span>}
              {!atEnd && endDay !== undefined && (
                <span className="text-xs text-muted-foreground">
                  on{' '}
                  {typeof endDay === 'string'
                    ? endDay
                    : new Date(endDay * 1000).toLocaleString('en-US', {
                        timeZone,
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                </span>
              )}
              {one.live && atEnd && day?.label && (
                <span className="text-xs text-muted-foreground">{day.label}</span>
              )}
              {change !== null && (
                <span className={change >= 0 ? 'text-gain' : 'text-loss'}>
                  {change >= 0 ? '+' : '−'}
                  {points
                    ? `${Math.abs(change).toFixed(meta?.decimals ?? 2)}${meta?.suffix === '%' ? ' pts' : ''}`
                    : `${Math.abs(change).toFixed(2)}%`}{' '}
                  {change >= 0 ? '▲' : '▼'}
                </span>
              )}
              {hi !== null && lo !== null && (
                <span className="text-xs text-muted-foreground">
                  H {fmt(hi)} · L {fmt(lo)}
                  {prev
                    ? ` · ${one.live && atEnd ? (base === today?.prevClose ? 'Prev' : 'Close') : 'Start'} ${fmt(prev)}`
                    : ''}
                </span>
              )}
            </div>
          </ChartDescription>
        </div>
        <div className="flex items-center gap-2">
          {adder}
          {onClose && <IconButton icon={XIcon} label="Close" variant="outline" onClick={onClose} />}
        </div>
      </ChartHeader>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {showWindows ? windowButtons : <span />}
        <div className="flex flex-wrap items-center gap-2">
          {pickChips}
          {picker}
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            value={type}
            onValueChange={(v) => v && setType(v as 'candles' | 'line')}
            aria-label="Chart type"
          >
            {TYPES.map((t) => (
              <ToggleGroupItem key={t.id} value={t.id} className="px-2.5">
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : !bars.length ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {one.read.error ?? today?.error ?? `No bars for ${symbol} in this window.`}
        </p>
      ) : (
        <PriceChart
          bars={bars}
          type={type}
          chosen={chosen}
          values={values[symbol] ?? NO_VALUES}
          timeZone={timeZone}
          zoom
          navigator
          timeline={one.timeline}
          range={range}
          onRange={(span, byPerson) => {
            setShown(span);
            if (byPerson) setPressed(null);
          }}
          onOutside={(span) => {
            setView({ window: null, span });
            setPressed(null);
          }}
          baseline={one.live ? base : null}
        />
      )}
      {footer}
    </>,
  );
}

/** The chart's title row: the dialog's own header, title and description inside the dialog. */
function ChartHeader({ dialog, children }: { dialog: boolean; children: ReactNode }) {
  const className = 'flex-row items-start justify-between gap-3 space-y-0';
  return dialog ? (
    <DialogHeader className={className}>{children}</DialogHeader>
  ) : (
    <div className={cn('flex', className)}>{children}</div>
  );
}
function ChartTitle({
  dialog,
  className,
  children,
}: { dialog: boolean; className?: string; children: ReactNode }) {
  return dialog ? (
    <DialogTitle className={className}>{children}</DialogTitle>
  ) : (
    <div className={className}>{children}</div>
  );
}
function ChartDescription({ dialog, children }: { dialog: boolean; children: ReactElement }) {
  return dialog ? <DialogDescription asChild>{children}</DialogDescription> : children;
}

/** Two or more symbols: their chips, then the compare chart with each pick's lines. */
function Compare({
  dialog,
  symbols,
  series,
  values,
  chosenFor,
  mode,
  timeZone,
  range,
  header,
  adder,
  footer,
  onClose,
  onRemove,
  onRange,
  onOutside,
}: {
  dialog: boolean;
  symbols: string[];
  series: Shown[];
  values: Record<string, IndicatorValues>;
  chosenFor: (s: string) => ChartIndicator[];
  mode: 'pct' | 'price';
  timeZone: string;
  range: TimeSpan;
  header: ReactNode;
  adder: ReactNode;
  footer: ReactNode;
  onClose?: () => void;
  onRemove: (s: string) => void;
  onRange: (span: TimeSpan, byPerson: boolean) => void;
  onOutside: (span: TimeSpan) => void;
}) {
  const barsKey = series
    .map((s) => `${s.symbol}:${s.bars.length}:${s.bars.at(-1)?.close}`)
    .join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the bars drawn
  const lines = useMemo(
    () =>
      series
        .filter((s) => s.bars.length)
        .map((s) => ({ symbol: s.symbol, color: colorIn(symbols, s.symbol), bars: s.bars })),
    [barsKey],
  );
  const { overlays, panes } = useMemo(() => {
    const overlays: CompareExtra[] = [];
    const panes: ComparePane[] = [];
    const every = new Map(symbols.flatMap(chosenFor).map((i) => [i.id, i]));
    for (const i of every.values()) {
      const on = symbols.filter((s) => chosenFor(s).some((c) => c.id === i.id));
      if (!on.length) continue;
      const extras = on.flatMap((s) =>
        i.lines
          .filter((l) => !l.bar)
          .map((l) => ({
            key: `${s}:${l.key}`,
            label: i.lines.length === 1 ? s : `${s} ${l.label}`,
            symbol: s,
            color: colorIn(symbols, s),
            values: values[s]?.[l.key],
          })),
      );
      if (i.where === 'overlay') overlays.push(...extras);
      else
        panes.push({
          id: i.id,
          label: `${i.label} · ${on.length === symbols.length ? 'all symbols' : on.join(', ')}`,
          domain: i.domain,
          refs: i.refs,
          lines: extras,
        });
    }
    return { overlays, panes };
  }, [symbols, chosenFor, values]);
  const loading = series.some((s) => !s.live && !s.read.data && !s.read.error);
  const failed = series.filter((s) => s.read.error || (!s.bars.length && s.read.data));
  return (
    <>
      <ChartHeader dialog={dialog}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <ChartTitle dialog={dialog} className="text-lg font-bold">
            Compare
          </ChartTitle>
          <ChartDescription dialog={dialog}>
            <div className="flex flex-wrap items-center gap-1.5">
              {symbols.map((s) => (
                <Badge key={s} variant="outline" className="num h-7 gap-1.5 pr-1 font-mono">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: colorIn(symbols, s) }}
                  />
                  {s}
                  <IconButton
                    icon={XIcon}
                    size="icon-xs"
                    label={`Remove ${s}`}
                    onClick={() => onRemove(s)}
                  />
                </Badge>
              ))}
              {adder}
            </div>
          </ChartDescription>
        </div>
        {onClose && <IconButton icon={XIcon} label="Close" variant="outline" onClick={onClose} />}
      </ChartHeader>
      {header}
      {loading && !lines.length ? (
        <Skeleton className="h-[420px] w-full" />
      ) : !lines.length ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No bars in this window.</p>
      ) : (
        <CompareChart
          lines={lines}
          mode={mode}
          overlays={overlays}
          panes={panes}
          timeZone={timeZone}
          timeline={series.find((s) => s.timeline.length)?.timeline ?? []}
          range={range}
          onRange={onRange}
          onOutside={onOutside}
        />
      )}
      {failed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No bars for {failed.map((s) => s.symbol).join(', ')} in this window.
        </p>
      )}
      {footer}
    </>
  );
}
