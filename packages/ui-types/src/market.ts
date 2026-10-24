/**
 * Live market outlook: the
 * symbols the market widgets and the chart dialog know, and the shapes the Worker sends.
 *
 * Sources per symbol (his pick, 17:48Z): a broker index quote (live) → a broker quote of a stock
 * or ETF (live, "via <ETF>" when it stands in for an index) → Yahoo (real value, Delayed chip).
 * A data feed covers crypto, and stands in for a broker when a person has no a broker sign-in.
 */

/** One bar: `t` is its start in Unix seconds (UTC). */
export interface MarketBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** One symbol's bars for a session, as a block or the chart dialog draws it. */
export interface MarketSeries {
  key: string;
  /** What the person reads: `SPX`, `Gold`. */
  label: string;
  name: string;
  /** The ETF the value comes from when it stands in for an index (`IWM` for RUT), else null. */
  via: string | null;
  /** True for Yahoo values (10-15 minutes late): the widget shows the Delayed chip. */
  delayed: boolean;
  /** Printed before or after the value: `$` for prices, `%` for yields. */
  prefix: string;
  suffix: string;
  decimals: number;
  /** The prior session's close, what the change is measured from. */
  prevClose: number | null;
  bars: MarketBar[];
  /** Why there are no bars (no source answered), in plain words. */
  error?: string;
  /**
   * Set for daily breadth and macro series (stored, not live): bars are days, `prevClose` is the
   * day before, and the change reads in points when `points` (a % above the 50-day moving 3 points,
   * not 5%). `asOf` is the last day, `YYYY-MM-DD`.
   */
  daily?: { asOf: string; points: boolean };
  /** Trades since the session closed (pre-market, after hours, overnight), read while it is shut. */
  extended?: MarketExtended;
}

/** The regular session the widgets show: today's while it trades, else the last one. */
export interface MarketSession {
  /** `YYYY-MM-DD`, US/Eastern. */
  date: string;
  /** Unix seconds. */
  open: number;
  close: number;
  /** The session is trading now: the live socket is worth opening. */
  live: boolean;
}

/** `GET /api/v1/market/session?symbols=`: the session, and its bars when it is not live. */
/** A trading session outside the regular hours (a broker's `pre`, `post`, `overnight`). */
export type ExtendedSession = 'pre' | 'post' | 'overnight';
export const EXTENDED_LABEL: Record<ExtendedSession, string> = {
  pre: 'Pre-market',
  post: 'After hours',
  overnight: 'Overnight',
};

/**
 * One symbol's trades since the session's close (a broker's extended and
 * overnight hours). `base` is the source's own regular close, so the browser scales these bars to
 * the series (an index's stand-in ETF, SPY for SPX) by the series' close / `base`.
 */
export interface MarketExtended {
  /** The ETF the bars come from when it stands in for an index, else null. */
  via: string | null;
  base: number;
  /** 5m bars, oldest first; `s` is the session each one traded in. */
  bars: (MarketBar & { s: ExtendedSession })[];
}

/** `GET /api/v1/market/extended?symbols=`: the trades since the last close, per key. */
export interface MarketExtendedResponse {
  /** The regular session the bars follow. */
  session: string;
  extended: Record<string, MarketExtended>;
}

export interface MarketSessionResponse {
  session: MarketSession;
  /** Left out while the session trades: the live socket sends them. */
  series?: MarketSeries[];
}

/** Messages on the live socket (`/api/v1/market/live`). The browser sends `sub` only. */
export type MarketClientMessage = { type: 'sub'; symbols: string[] };
export type MarketServerMessage =
  | { type: 'session'; session: MarketSession }
  /** Full series for symbols just subscribed (or after the feed restarted). */
  | { type: 'snapshot'; series: MarketSeries[] }
  /** Bars that changed since the last message, newest last, per symbol key. */
  | { type: 'bars'; bars: Record<string, MarketBar[]>; at: number };

/** Chart dialog windows. */
export const marketWindows = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'] as const;
export type MarketWindow = (typeof marketWindows)[number];

/** `GET /api/v1/market/bars?symbol=&window=`: one symbol's history over a window. */
export interface MarketBarsResponse {
  symbol: string;
  window: MarketWindow;
  /** `1m`, `5m`, `1h` or `1d`. */
  resolution: '1m' | '5m' | '1h' | '1d';
  /** `history` (the warehouse) or `delayed` (Yahoo, for what the warehouse does not hold). */
  source: 'history' | 'delayed';
  bars: MarketBar[];
  /**
   * Up to 250 bars at the same resolution just before the window, asked for with `warmup=1`: the
   * browser works its indicator lines out over warm-up + window, then draws the window only, so
   * SMA 200 starts on the first bar.
   */
  warmup?: MarketBar[];
}

/**
 * Indicator lines bars cannot give, read from the warehouse once when the person adds one to the
 * chart: P/E trailing and forward, IV 30d, the EPS estimate.
 */
export const SOURCED_INDICATORS = ['pe_trailing', 'pe_forward', 'iv30', 'est_eps'] as const;
export type SourcedIndicator = (typeof SOURCED_INDICATORS)[number];
export const isSourcedIndicator = (s: string): s is SourcedIndicator =>
  (SOURCED_INDICATORS as readonly string[]).includes(s);

/** `GET /api/v1/market/indicators?symbol=&names=`: one symbol's sourced lines, `[t, value]` a day. */
export interface MarketIndicatorsResponse {
  symbol: string;
  lines: Record<string, [number, number][]>;
}

/** The symbols with a known source; any other ticker is read as a stock or ETF. */
export const MARKET_SYMBOLS: Record<
  string,
  {
    label: string;
    name: string;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    /** A daily breadth or macro series from an app (never live); `points`: change in points. */
    daily?: { points: boolean };
  }
> = {
  SPX: { label: 'SPX', name: 'S&P 500' },
  NDX: { label: 'NDX', name: 'Nasdaq 100' },
  DJI: { label: 'DJI', name: 'Dow 30' },
  RUT: { label: 'RUT', name: 'Russell 2000' },
  VIX: { label: 'VIX', name: 'Volatility' },
  '10Y': { label: '10Y', name: '10-year yield', suffix: '%', decimals: 3 },
  DXY: { label: 'DXY', name: 'US dollar' },
  WTI: { label: 'WTI', name: 'Crude oil', prefix: '$' },
  GOLD: { label: 'Gold', name: 'Gold', prefix: '$' },
  HYG: { label: 'HYG', name: 'High yield', prefix: '$' },
  BTC: { label: 'BTC', name: 'Bitcoin', prefix: '$', decimals: 0 },
  // Breadth and macro: the daily series an app already stores.
  SPX50: {
    label: 'SPX >50d',
    name: 'S&P 500 % above 50-day',
    suffix: '%',
    decimals: 1,
    daily: { points: true },
  },
  SPX200: {
    label: 'SPX >200d',
    name: 'S&P 500 % above 200-day',
    suffix: '%',
    decimals: 1,
    daily: { points: true },
  },
  NDX50: {
    label: 'NDX >50d',
    name: 'Nasdaq 100 % above 50-day',
    suffix: '%',
    decimals: 1,
    daily: { points: true },
  },
  NDX200: {
    label: 'NDX >200d',
    name: 'Nasdaq 100 % above 200-day',
    suffix: '%',
    decimals: 1,
    daily: { points: true },
  },
  BPNDX: {
    label: 'NDX bull %',
    name: 'Nasdaq 100 bullish percent',
    suffix: '%',
    decimals: 1,
    daily: { points: true },
  },
  NAAD: {
    label: 'Nasdaq A−D',
    name: 'Advancing minus declining issues',
    decimals: 0,
    daily: { points: true },
  },
  '2Y': { label: '2Y', name: '2-year yield', suffix: '%', decimals: 2, daily: { points: true } },
  '2S10S': {
    label: '10Y−2Y',
    name: 'Yield curve, 10-year minus 2-year',
    suffix: '%',
    decimals: 2,
    daily: { points: true },
  },
  FEDFUNDS: {
    label: 'Fed funds',
    name: 'Effective fed funds rate',
    suffix: '%',
    decimals: 2,
    daily: { points: true },
  },
  BE10Y: {
    label: 'Breakeven',
    name: '10-year breakeven inflation',
    suffix: '%',
    decimals: 2,
    daily: { points: true },
  },
  FWDPE: {
    label: 'Fwd P/E',
    name: 'S&P 500 forward 12-month P/E',
    decimals: 1,
    daily: { points: true },
  },
  CAPE: { label: 'CAPE', name: 'Shiller CAPE (monthly)', decimals: 1, daily: { points: true } },
};

/** True for a daily breadth or macro key (read from an app, never from the live feed). */
export const isDailyMarketKey = (k: string) => !!MARKET_SYMBOLS[k]?.daily;

/** The Outlook's defaults: the index chart, then one widget each. */
export const OUTLOOK_INDEXES = ['SPX', 'NDX', 'DJI', 'RUT'];
/** The Outlook's Today card: up or down today, overnight included. */
export const OUTLOOK_TODAY = ['SPX', 'NDX', 'DJI', 'RUT', 'VIX', 'GOLD', 'HYG'];
export const OUTLOOK_WIDGETS = ['VIX', '10Y', 'DXY', 'GOLD', 'WTI', 'HYG', 'BTC'];
/** The Outlook's breadth and macro row (daily). */
export const OUTLOOK_DAILY = [
  'SPX50',
  'SPX200',
  'NDX50',
  'NDX200',
  'BPNDX',
  'NAAD',
  '2Y',
  '2S10S',
  'FEDFUNDS',
  'BE10Y',
  'FWDPE',
  'CAPE',
];

/** `GET /api/v1/market/daily?symbols=`: daily breadth and macro series, the last 90 days. */
export interface MarketDailyResponse {
  series: MarketSeries[];
}

/** A symbol key as widgets store it: upper case, letters, digits and `.`. */
export const marketKey = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, '');
export const MARKET_KEY_RE = /^[A-Z0-9.]{1,10}$/;
