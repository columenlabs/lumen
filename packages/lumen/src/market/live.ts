/**
 * Live market data in the browser (design market-live): one hub per tab, one
 * socket per tab however many widgets show, subscriptions counted per symbol across widgets. The socket
 * opens only while the session trades and the tab is visible: it closes 30 s after the tab is hidden
 * and reconnects with backoff, and every (re)connect gets a fresh snapshot, so gaps fill themselves.
 * Outside the session the widgets read the last session's bars over REST (cached by the Worker until
 * the next open). Each device and tab is its own viewer of the person's feed on the server.
 * While the session is shut they also read the trades since its close (pre-market, after hours,
 * overnight) once a minute, which the widgets draw after the session.
 */
import {
  EXTENDED_LABEL,
  type MarketBar,
  type MarketDailyResponse,
  type MarketExtendedResponse,
  type MarketSeries,
  type MarketServerMessage,
  type MarketSession,
  type MarketSessionResponse,
} from '@columenlabs/lumen-ui-types/market';
import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

export type MarketStatus = 'loading' | 'live' | 'closed' | 'connecting' | 'off' | 'error';

const HIDDEN_CLOSE_MS = 30_000;
const CLOSED_CHECK_MS = 60_000;

/** Folds changed bars into a series (same minute replaced, new ones appended in order). */
function merge(into: MarketBar[], add: MarketBar[]) {
  const out = into.slice();
  for (const b of add) {
    const i = out.findIndex((x) => x.t === b.t);
    if (i >= 0) out[i] = b;
    else {
      const at = out.findIndex((x) => x.t > b.t);
      out.splice(at < 0 ? out.length : at, 0, b);
    }
  }
  return out;
}

class MarketHub {
  session: MarketSession | null = null;
  status: MarketStatus = 'loading';
  error: string | null = null;
  readonly series = new Map<string, MarketSeries>();
  private want = new Map<string, number>();
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private closedTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private fetching: Promise<void> | null = null;
  private onVisibility = () => this.visibility();

  constructor(private readonly api: string) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  snapshot = () => this.version;
  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  private probe: Promise<boolean> | null = null;
  private days = new Map<string, Promise<MarketSeries[]>>();
  /** Daily breadth and macro series, read once per set of keys per tab (they change once a day). */
  daily(keys: string[]) {
    const k = keys.join(',');
    let p = this.days.get(k);
    if (!p) {
      p = fetch(`${this.api}/daily?symbols=${encodeURIComponent(k)}`, {
        credentials: 'same-origin',
      }).then(async (r) => {
        if (!r.ok) throw new Error(`server answered ${r.status}`);
        return ((await r.json()) as MarketDailyResponse).series;
      });
      p.catch(() => this.days.delete(k));
      this.days.set(k, p);
    }
    return p;
  }
  /** Whether the app serves market data at all (a 404 means no feed here), read once. */
  available() {
    this.probe ??= fetch(`${this.api}/session`, { credentials: 'same-origin' })
      .then((r) => r.status !== 404)
      .catch(() => true);
    return this.probe;
  }

  /** A widget shows these symbols; returns its release. */
  hold(keys: string[]) {
    let added = false;
    for (const k of keys) {
      const n = this.want.get(k) ?? 0;
      this.want.set(k, n + 1);
      if (!n) added = true;
    }
    if (added) this.sync();
    return () => {
      for (const k of keys) {
        const n = (this.want.get(k) ?? 1) - 1;
        if (n <= 0) this.want.delete(k);
        else this.want.set(k, n);
      }
      if (!this.want.size) this.stop();
      else this.sendSub();
    };
  }

  private keys() {
    return [...this.want.keys()].sort();
  }

  /** Reads the session (and its bars when it is not trading), then opens the socket if it trades. */
  private sync() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN && this.session?.live) {
      this.sendSub();
      return;
    }
    if (this.fetching) return;
    this.fetching = this.read().finally(() => {
      this.fetching = null;
      // Symbols a widget added while that read was in flight (the Outlook's tiles mount just after
      // its chart): read them now. Each is asked once, so a symbol the server leaves out ends as
      // "No data" instead of a loop.
      if (!this.session?.live && this.status !== 'error' && this.unasked().length) this.sync();
    });
  }

  /** Symbols asked for and read, so a widget can tell "still loading" from "the server had none". */
  private asked = new Set<string>();
  private unasked() {
    return this.keys().filter((k) => !this.series.has(k) && !this.asked.has(k));
  }
  /** True once `key` was read and the server sent no series for it. */
  missing(key: string) {
    return this.status !== 'loading' && this.asked.has(key) && !this.series.has(key);
  }

  /** Reads again after a failure (a widget's Retry). */
  retry() {
    for (const k of this.keys()) if (!this.series.has(k)) this.asked.delete(k);
    this.status = 'loading';
    this.error = null;
    this.changed();
    this.sync();
  }

  private async read() {
    const missing = this.unasked();
    try {
      const q = missing.length ? `?symbols=${encodeURIComponent(missing.join(','))}` : '';
      const res = await fetch(`${this.api}/session${q}`, { credentials: 'same-origin' });
      if (res.status === 404) {
        this.status = 'off';
        this.changed();
        return;
      }
      if (!res.ok) throw new Error(`server answered ${res.status}`);
      const body = (await res.json()) as MarketSessionResponse;
      this.session = body.session;
      this.error = null;
      for (const s of body.series ?? []) this.series.set(s.key, s);
      for (const k of missing) this.asked.add(k);
      if (body.session.live && document.visibilityState === 'visible') this.open();
      else {
        this.status = body.session.live ? 'connecting' : 'closed';
        this.watchClosed();
        if (!body.session.live) void this.readExtended();
      }
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).message;
    }
    this.changed();
  }

  /** The trades since the session's close, folded into each series (none without a source). */
  private async readExtended() {
    const keys = this.keys().filter((k) => this.series.has(k));
    if (!keys.length || this.session?.live) return;
    const res = await fetch(`${this.api}/extended?symbols=${encodeURIComponent(keys.join(','))}`, {
      credentials: 'same-origin',
    }).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as MarketExtendedResponse;
    if (body.session !== this.session?.date) return;
    for (const [k, extended] of Object.entries(body.extended)) {
      const s = this.series.get(k);
      if (s) this.series.set(k, { ...s, extended });
    }
    this.changed();
  }

  /**
   * While closed, check once a minute (a cheap read: no bars) whether the session has opened, and
   * read the trades since the close again.
   */
  private watchClosed() {
    if (this.closedTimer) return;
    this.closedTimer = setInterval(async () => {
      if (!this.want.size || document.visibilityState !== 'visible') return;
      const res = await fetch(`${this.api}/session`, { credentials: 'same-origin' }).catch(
        () => null,
      );
      const body = res?.ok ? ((await res.json()) as MarketSessionResponse) : null;
      if (!body) return;
      if (body.session.date === this.session?.date) {
        if (!body.session.live) void this.readExtended();
        return;
      }
      this.series.clear();
      this.asked.clear();
      this.sync();
    }, CLOSED_CHECK_MS);
  }

  private open() {
    if (this.closedTimer) {
      clearInterval(this.closedTimer);
      this.closedTimer = null;
    }
    if (this.ws) return;
    this.status = 'connecting';
    const url = new URL(`${this.api}/live`, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.sendSub();
    };
    ws.onmessage = (e) => {
      let m: MarketServerMessage;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === 'session') {
        this.session = m.session;
        if (!m.session.live) {
          // The session closed: drop the socket and read the day's bars instead.
          this.close();
          this.series.clear();
          this.asked.clear();
          this.sync();
          return;
        }
        this.status = 'live';
      } else if (m.type === 'snapshot') {
        for (const s of m.series) this.series.set(s.key, s);
        this.status = 'live';
      } else if (m.type === 'bars') {
        for (const [k, bars] of Object.entries(m.bars)) {
          const s = this.series.get(k);
          if (s) this.series.set(k, { ...s, bars: merge(s.bars, bars) });
        }
      }
      this.changed();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.want.size || document.visibilityState !== 'visible') return;
      this.status = 'connecting';
      this.changed();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.sync();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
  }

  private sendSub() {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'sub', symbols: this.keys() }));
  }

  private close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'done');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private stop() {
    this.close();
    if (this.closedTimer) clearInterval(this.closedTimer);
    this.closedTimer = null;
  }

  private visibility() {
    if (document.visibilityState === 'hidden') {
      this.hiddenTimer ??= setTimeout(() => {
        this.hiddenTimer = null;
        this.close();
      }, HIDDEN_CLOSE_MS);
      return;
    }
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
    if (this.want.size && !this.ws && this.session?.live) this.sync();
  }
}

/** The trades since the close, scaled to the series (a stand-in ETF to its index), or null. */
export function extendedOf(s: MarketSeries) {
  const ext = s.extended;
  const close = s.bars.at(-1)?.c;
  const lastBar = ext?.bars.at(-1);
  if (!ext || !lastBar || close === undefined || !ext.base) return null;
  const k = close / ext.base;
  return {
    via: ext.via,
    close,
    bars: ext.bars.map((b) => ({ t: b.t, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k })),
    last: lastBar.c * k,
    at: lastBar.t,
    label: EXTENDED_LABEL[lastBar.s],
    /** Change from the session's close, in percent. */
    change: (lastBar.c / ext.base - 1) * 100,
  };
}

/**
 * Up or down today: the price now against the close before today's trading. A broker's trading
 * day starts with the overnight session, so from then on it is the session's close; before (the
 * session, after hours) it is the prior close.
 */
export function todayOf(s: MarketSeries) {
  const ext = extendedOf(s);
  const close = s.bars.at(-1)?.c;
  const newDay = s.extended?.bars.some((b) => b.s !== 'post');
  const base = newDay ? close : s.prevClose;
  const value = ext?.last ?? close;
  if (value === undefined || !base) return null;
  return {
    value,
    base,
    change: (value / base - 1) * 100,
    label: ext?.label ?? null,
    at: ext?.at,
  };
}

const MarketContext = createContext<MarketHub | null>(null);

/** Gives market widgets and the chart dialog live data from `api` (`/api/v1/market`). */
export function MarketProvider({ api, children }: { api: string; children: ReactNode }) {
  const hub = useMemo(() => new MarketHub(api), [api]);
  return createElement(MarketContext.Provider, { value: hub }, children);
}

/** Today's (or the last) session of `symbols`, live while it trades. */
export function useMarket(symbols: string[]) {
  const hub = useContext(MarketContext);
  const key = symbols.join(',');
  useEffect(() => (hub && key ? hub.hold(key.split(',')) : undefined), [hub, key]);
  useSyncExternalStore(hub?.subscribe ?? (() => () => {}), hub?.snapshot ?? (() => 0), () => 0);
  if (!hub)
    return {
      status: 'off' as MarketStatus,
      session: null,
      series: {},
      missing: [] as string[],
      error: null,
      retry: () => {},
    };
  const series: Record<string, MarketSeries> = {};
  for (const s of symbols) {
    const x = hub.series.get(s);
    if (x) series[s] = x;
  }
  return {
    status: hub.status,
    session: hub.session,
    series,
    missing: symbols.filter((s) => hub.missing(s)),
    error: hub.error,
    retry: () => hub.retry(),
  };
}

/** Daily breadth and macro series of `keys` (never live); `error` when they could not be read. */
export function useMarketDaily(keys: string[]) {
  const hub = useContext(MarketContext);
  const k = keys.join(',');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    series: Record<string, MarketSeries>;
    loading: boolean;
    error: string | null;
  }>({ series: {}, loading: true, error: null });
  useEffect(() => {
    if (!hub || !k) return;
    let on = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    void attempt;
    hub
      .daily(k.split(','))
      .then(
        (list) =>
          on &&
          setState({
            series: Object.fromEntries(list.map((s) => [s.key, s])),
            loading: false,
            error: null,
          }),
      )
      .catch((e) => on && setState({ series: {}, loading: false, error: (e as Error).message }));
    return () => {
      on = false;
    };
  }, [hub, k, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/** True where a market provider is mounted (an app, suite or not). */
export const useHasMarket = () => useContext(MarketContext) !== null;

/** Whether this app has a market feed, without subscribing to anything: null while checking. */
export function useMarketFeed() {
  const hub = useContext(MarketContext);
  const [has, setHas] = useState<boolean | null>(hub ? null : false);
  useEffect(() => {
    if (!hub) return;
    let on = true;
    void hub.available().then((v) => on && setHas(v));
    return () => {
      on = false;
    };
  }, [hub]);
  return has;
}
