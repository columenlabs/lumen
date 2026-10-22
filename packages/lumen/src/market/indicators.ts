/**
 * Indicators the chart can draw (moved from an app's Chart tab, 2026-10-12). `lines` are output
 * series keyed like an app's stored `indicators_1d` names, so an app with stored values (an app's
 * daily chart) passes those. The chart dialog makes each one only when it is added: `computed` ones in the browser with indicatorts over warm-up bars before the window,
 * `sourced` ones (P/E, IV, EPS estimate) read once from market data, since bars cannot give them.
 */
import {
  type ChartFormula,
  type ChartIndicatorId,
  type FormulaNode,
  type IndicatorSpec,
  builtinParams,
  parseChartFormula,
} from '@columenlabs/lumen-ui-types/chart-formula';
import { atr, bb, ema, macd, mmax, mmin, mstd, msum, rsi, sma } from 'indicatorts';

export type ChartIndicator = {
  id: string;
  label: string;
  /** overlay: drawn on the price; pane: its own chart under the price. */
  where: 'overlay' | 'pane';
  lines: { key: string; label: string; bar?: boolean }[];
  /** Reference levels drawn as dashed lines in a pane. */
  refs?: number[];
  /** Fixed value axis for a pane; otherwise it follows the data. */
  domain?: [number, number];
  /** The browser can work it out from bars alone (no volume). */
  computed?: boolean;
  /** Read from market data when added (`market/indicators`); daily, stocks and ETFs only. */
  sourced?: boolean;
  /** Only on daily bars (52 weeks is a count of days). */
  daily?: boolean;
  /** A formula's tree (the assistant's or the person's), run over the bars; `lookback` bars come first. */
  formula?: FormulaNode;
  /** A saved formula's text, for the picker and the assistant. */
  f?: string;
};

const one = <I extends string>(
  id: I,
  label: string,
  where: ChartIndicator['where'],
  extra: Pick<ChartIndicator, 'refs' | 'domain' | 'computed' | 'sourced'> = { computed: true },
): ChartIndicator & { id: I } => ({ id, label, where, lines: [{ key: id, label }], ...extra });

/** Every catalog id is in `CHART_INDICATOR_IDS`, which the server checks the assistant's specs against. */
export const CHART_INDICATORS: (ChartIndicator & { id: ChartIndicatorId })[] = [
  one('sma_20', 'SMA 20', 'overlay'),
  one('sma_50', 'SMA 50', 'overlay'),
  one('sma_200', 'SMA 200', 'overlay'),
  one('ema_9', 'EMA 9', 'overlay'),
  one('ema_21', 'EMA 21', 'overlay'),
  one('ema_50', 'EMA 50', 'overlay'),
  {
    id: 'bollinger',
    label: 'Bollinger Bands 20, 2',
    where: 'overlay',
    computed: true,
    lines: [
      { key: 'bb_upper', label: 'Upper' },
      { key: 'bb_mid', label: 'Middle' },
      { key: 'bb_lower', label: 'Lower' },
    ],
  },
  {
    id: 'high_low_52w',
    label: '52-week high / low',
    where: 'overlay',
    computed: true,
    daily: true,
    lines: [
      { key: 'high_52w', label: '52w high' },
      { key: 'low_52w', label: '52w low' },
    ],
  },
  one('rsi_14', 'RSI 14', 'pane', { refs: [30, 70], domain: [0, 100], computed: true }),
  {
    id: 'macd',
    label: 'MACD 12, 26, 9',
    where: 'pane',
    computed: true,
    lines: [
      { key: 'macd_hist', label: 'Histogram', bar: true },
      { key: 'macd_line', label: 'MACD' },
      { key: 'macd_signal', label: 'Signal' },
    ],
    refs: [0],
  },
  one('atr_14', 'ATR 14', 'pane', { computed: true }),
  one('rel_volume_20', 'Relative volume 20', 'pane', { refs: [1] }),
  {
    id: 'vwap_distance',
    label: 'Distance from VWAP %',
    where: 'pane',
    lines: [{ key: 'vwap_dist_pct', label: 'VWAP distance %' }],
    refs: [0],
  },
  one('pe_trailing', 'P/E ttm', 'pane', { sourced: true }),
  one('pe_forward', 'P/E forward', 'pane', { sourced: true }),
  one('iv30', 'IV 30d', 'pane', { sourced: true }),
  one('est_eps', 'EPS estimate', 'pane', { sourced: true }),
];

/** Theme tokens handed out to lines by catalog position. */
const LINE_COLORS = [
  'var(--warning)',
  'var(--chart-2)',
  'var(--gain)',
  'var(--chart-6)',
  'var(--loss)',
  'var(--chart-4)',
];

/** Colour of each line, fixed by its place in the catalog so a new pick never recolours the others. */
export const LINE_COLOR: Record<string, string> = Object.fromEntries(
  CHART_INDICATORS.flatMap((i) => i.lines).map((l, n) => [
    l.key,
    LINE_COLORS[n % LINE_COLORS.length] ?? 'var(--primary)',
  ]),
);

/** A line's colour: its catalog place, else one picked from its key so it stays put. */
export function lineColor(key: string): string {
  const fixed = LINE_COLOR[key];
  if (fixed) return fixed;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LINE_COLORS[h % LINE_COLORS.length] ?? 'var(--primary)';
}

const NAMES: Record<string, string> = { sma: 'SMA', ema: 'EMA', rsi: 'RSI', atr: 'ATR' };

/** A built-in with its own window (`ema_13`, `bollinger_20_2p5`, `macd_8_21_5`), as the catalog's. */
function builtin(id: string): ChartIndicator | null {
  const b = builtinParams(id);
  if (!b) return null;
  const [n = 0, k = 0, g = 0] = b.params;
  if (b.kind === 'sma' || b.kind === 'ema') return one(id, `${NAMES[b.kind]} ${n}`, 'overlay');
  if (b.kind === 'rsi')
    return one(id, `RSI ${n}`, 'pane', { refs: [30, 70], domain: [0, 100], computed: true });
  if (b.kind === 'atr') return one(id, `ATR ${n}`, 'pane', { computed: true });
  if (b.kind === 'bollinger')
    return {
      id,
      label: `Bollinger Bands ${n}, ${k}`,
      where: 'overlay',
      computed: true,
      lines: [
        { key: `${id}_upper`, label: 'Upper' },
        { key: `${id}_mid`, label: 'Middle' },
        { key: `${id}_lower`, label: 'Lower' },
      ],
    };
  return {
    id,
    label: `MACD ${n}, ${k}, ${g}`,
    where: 'pane',
    computed: true,
    lines: [
      { key: `${id}_hist`, label: 'Histogram', bar: true },
      { key: `${id}_line`, label: 'MACD' },
      { key: `${id}_signal`, label: 'Signal' },
    ],
    refs: [0],
  };
}

/** A formula's id on the chart: the same label and formula are the same line. */
export function formulaId(f: ChartFormula): string {
  let h = 0;
  for (const c of `${f.label}|${f.f}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `f:${h.toString(36)}`;
}

/** A formula as a chart line; throws with why it can't run. */
export function formulaIndicator(f: ChartFormula, id = formulaId(f)): ChartIndicator {
  const { node } = parseChartFormula(f.f);
  return {
    id,
    label: f.label,
    where: f.where ?? 'pane',
    lines: [{ key: id, label: f.label }],
    refs: f.refs,
    computed: true,
    formula: node,
    f: f.f,
  };
}

/**
 * What a spec draws: a catalog indicator, a built-in with any window, a saved formula (`mine:<id>`,
 * looked up in `mine`) or a formula; null when it is none of them.
 */
export function resolveIndicator(
  spec: IndicatorSpec,
  mine: ChartIndicator[] = [],
): ChartIndicator | null {
  try {
    if (typeof spec !== 'string') return formulaIndicator(spec);
    return (
      CHART_INDICATORS.find((i) => i.id === spec) ??
      mine.find((i) => i.id === spec) ??
      builtin(spec)
    );
  } catch {
    return null;
  }
}

/** Values per line key, per bar time. */
export type IndicatorValues = Record<string, Map<string | number, number>>;

interface Ohlc {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** `fn` over `x` from its first number on, NaN before; the first `skip` values are left out too. */
function from(x: number[], fn: (v: number[]) => number[], skip: number): number[] {
  const at = x.findIndex(Number.isFinite);
  if (at < 0) return x.map(() => Number.NaN);
  const out = fn(x.slice(at));
  return x.map((_, i) => (i - at < skip || i < at ? Number.NaN : (out[i - at] ?? Number.NaN)));
}

const BINARY: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '^': (a, b) => a ** b,
  '==': (a, b) => +(a === b),
  '!=': (a, b) => +(a !== b),
  '>': (a, b) => +(a > b),
  '>=': (a, b) => +(a >= b),
  '<': (a, b) => +(a < b),
  '<=': (a, b) => +(a <= b),
  '&&': (a, b) => +(!!a && !!b),
  '||': (a, b) => +(!!a || !!b),
};

/** A formula's values per bar (NaN where it has none yet), with indicatorts doing the series math. */
export function runFormula(node: FormulaNode, bars: Ohlc[]): number[] {
  const go = (n: FormulaNode): number[] => {
    switch (n.k) {
      case 'num':
        return bars.map(() => n.v);
      case 'field':
        return bars.map((b) => b[n.name]);
      case 'op': {
        const a = go(n.a);
        const b = go(n.b);
        const f = BINARY[n.op] as (a: number, b: number) => number;
        return a.map((v, i) => {
          const w = b[i] ?? Number.NaN;
          return Number.isFinite(v) && Number.isFinite(w) ? f(v, w) : Number.NaN;
        });
      }
      case 'not':
        return go(n.a).map((v) => (Number.isFinite(v) ? +!v : Number.NaN));
      case 'if': {
        const t = go(n.test);
        const y = go(n.yes);
        const o = go(n.no);
        return t.map((v, i) =>
          Number.isFinite(v) ? ((v ? y[i] : o[i]) ?? Number.NaN) : Number.NaN,
        );
      }
      case 'call': {
        const [x = [], y = []] = n.args.map(go);
        const period = n.n;
        switch (n.fn) {
          case 'sma':
            return from(x, (v) => sma(v, { period }), period - 1);
          case 'ema':
            return from(x, (v) => ema(v, { period }), period - 1);
          case 'rsi':
            return from(x, (v) => rsi(v, { period }), period);
          case 'stdev':
            return from(x, (v) => mstd(v, { period }), period - 1);
          case 'highest':
            return from(x, (v) => mmax(v, { period }), period - 1);
          case 'lowest':
            return from(x, (v) => mmin(v, { period }), period - 1);
          case 'sum':
            return from(x, (v) => msum(v, { period }), period - 1);
          case 'ref':
            return x.map((_, i) => x[i - period] ?? Number.NaN);
          case 'change':
            return x.map((v, i) => {
              const p = x[i - period] ?? Number.NaN;
              return Number.isFinite(v) && Number.isFinite(p) && p ? (v / p - 1) * 100 : Number.NaN;
            });
          case 'atr':
            return atr(
              bars.map((b) => b.high),
              bars.map((b) => b.low),
              bars.map((b) => b.close),
              { period },
            ).atrLine.map((v, i) => (i < period ? Number.NaN : v));
          case 'abs':
            return x.map(Math.abs);
          case 'min':
            return x.map((v, i) => Math.min(v, y[i] ?? Number.NaN));
          case 'max':
            return x.map((v, i) => Math.max(v, y[i] ?? Number.NaN));
        }
      }
    }
  };
  return go(node);
}

/** A computed indicator's kind and numbers: a built-in by its id, or the catalog's fixed ones. */
const calcOf = (i: ChartIndicator) =>
  i.id === 'bollinger'
    ? { kind: 'bollinger', params: [20, 2] }
    : i.id === 'macd'
      ? { kind: 'macd', params: [12, 26, 9] }
      : builtinParams(i.id);

/** The chosen indicators' lines worked out from `bars`, skipping each one's warm-up bars. */
export function computeIndicators(bars: Ohlc[], chosen: ChartIndicator[]): IndicatorValues {
  const closes = bars.map((b) => b.close);
  const out: IndicatorValues = {};
  const put = (key: string | undefined, vs: number[], skip: number) => {
    if (!key) return;
    const m = new Map<string | number, number>();
    vs.forEach((v, i) => {
      const b = bars[i];
      if (b && i >= skip && Number.isFinite(v)) m.set(b.time, v);
    });
    out[key] = m;
  };
  const [k0, k1, k2] = [0, 1, 2];
  for (const i of chosen) {
    const key = (n: number) => i.lines[n]?.key;
    if (i.formula) {
      put(key(k0), runFormula(i.formula, bars), 0);
      continue;
    }
    if (i.id === 'high_low_52w') {
      // 252 sessions, from the first bar once a year of them is in.
      put(
        'high_52w',
        mmax(
          bars.map((b) => b.high),
          { period: 252 },
        ),
        251,
      );
      put(
        'low_52w',
        mmin(
          bars.map((b) => b.low),
          { period: 252 },
        ),
        251,
      );
      continue;
    }
    const c = calcOf(i);
    if (!c) continue;
    const [n = 0, m = 0, g = 0] = c.params;
    if (c.kind === 'sma' || c.kind === 'ema')
      put(key(k0), (c.kind === 'sma' ? sma : ema)(closes, { period: n }), n - 1);
    else if (c.kind === 'rsi') put(key(k0), rsi(closes, { period: n }), n);
    else if (c.kind === 'atr')
      put(
        key(k0),
        atr(
          bars.map((b) => b.high),
          bars.map((b) => b.low),
          closes,
          { period: n },
        ).atrLine,
        n,
      );
    else if (c.kind === 'bollinger') {
      const r = bb(closes, { period: n });
      // indicatorts' bands are 2 standard deviations; other widths move them from the middle.
      const wide = (side: number[]) =>
        side.map((v, k) => (r.middle[k] ?? 0) + ((v - (r.middle[k] ?? 0)) * m) / 2);
      put(key(k0), wide(r.upper), n - 1);
      put(key(k1), r.middle, n - 1);
      put(key(k2), wide(r.lower), n - 1);
    } else if (c.kind === 'macd') {
      const r = macd(closes, { fast: n, slow: m, signal: g });
      put(
        key(k0),
        r.macdLine.map((v, k) => v - (r.signalLine[k] ?? 0)),
        m + g - 2,
      );
      put(key(k1), r.macdLine, m - 1);
      put(key(k2), r.signalLine, m + g - 2);
    }
  }
  return out;
}
