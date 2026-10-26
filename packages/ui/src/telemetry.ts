/**
 * The app's own telemetry from the browser: screens opened, uncaught errors, failed requests and
 * Web Vitals, sent in batches to the app's Worker (by default `POST /api/t`), which checks each
 * point and writes it with `meterClientBatch` from `@columenlabs/lumen-ops/client`.
 *
 * It is first party and keeps nothing in the browser: no cookie, no storage, no third party. A
 * point holds a route template, an error's class and a hash of its stack, a status and a number.
 * Never an error's message, a URL's query, page text or anything typed.
 */
import { useEffect } from 'react';
import { type Metric, onCLS, onINP, onLCP } from 'web-vitals';

export type ClientPointKind = 'view' | 'error' | 'fetch_fail' | 'vital';

export interface ClientPoint {
  kind: ClientPointKind;
  /** The screen's route template (`/connections/$id`), never the address with its ids. */
  route: string;
  /** An error's class, an API route, or a vital's name (LCP, INP, CLS). */
  name?: string;
  /** A hash of the error's stack frames. */
  fingerprint?: string;
  /** The `X-Request-Id` of the failed answer, to find its server side. */
  requestId?: string;
  /** ms, or a vital's score. */
  value?: number;
  status?: number;
  device?: 'phone' | 'desktop';
}

const MAX_BATCH = 50;
const FLUSH_MS = 15_000;
const CODE = /^[A-Za-z0-9_.:/$-]{1,64}$/;

let endpoint = '/api/t';
let app = '';
let version = '';
let route = '';
const queue: ClientPoint[] = [];
let started = false;

const fnv = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** The stack's frames only (a message can carry anything), with each file's query dropped. */
export function stackFingerprint(error: unknown): string {
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const frames = stack
    .split('\n')
    .filter((l) => /^\s*at\s|@/.test(l))
    .slice(0, 8)
    .map((l) => l.replace(/\?[^:)\s]*/g, '').trim());
  return fnv(frames.join('\n'));
}

const device = (): 'phone' | 'desktop' =>
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches
    ? 'phone'
    : 'desktop';

const code = (s: string | undefined) => (s && CODE.test(s) ? s : undefined);

function flush() {
  if (!app || queue.length === 0) return;
  const points = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({ app, version: code(version), points });
  try {
    const sent = navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }));
    if (!sent)
      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
  } catch {
    // Telemetry must never break the page.
  }
  if (queue.length) flush();
}

/** Queues one point; the batch goes out every 15 s, at 50 points, or when the tab is hidden. */
export function reportClient(p: Omit<ClientPoint, 'device' | 'route'> & { route?: string }) {
  queue.push({
    ...p,
    route: p.route ?? route,
    name: code(p.name),
    requestId: code(p.requestId),
    device: device(),
  });
  if (queue.length >= MAX_BATCH) flush();
}

/** A request that failed: its API route template, status (0 when it never answered) and id. */
export function reportFailedFetch(apiRoute: string, status: number, requestId?: string | null) {
  reportClient({ kind: 'fetch_fail', name: apiRoute, status, requestId: requestId ?? undefined });
}

/** An error the page caught or didn't: its class and stack hash only. */
export function reportClientError(error: unknown) {
  reportClient({
    kind: 'error',
    name: error instanceof Error ? error.name : 'Error',
    fingerprint: stackFingerprint(error),
  });
}

const vital = (m: Metric) => reportClient({ kind: 'vital', name: m.name, value: m.value });

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('error', (e) => reportClientError(e.error ?? new Error('script')));
  window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  setInterval(flush, FLUSH_MS);
  onLCP(vital);
  onINP(vital);
  onCLS(vital);
}

export interface LumenTelemetryOptions {
  /** The app's name in the points (`console`, `admin`). */
  app: string;
  /** The current screen's route template, from the app's router. */
  route: string;
  /** The build or deploy the page runs. */
  version?: string;
  /** Where batches go; `/api/t` by default. */
  endpoint?: string;
}

/** Mount once at the app's root: every screen change is a view, and errors and vitals follow. */
export function useLumenTelemetry(opts: LumenTelemetryOptions) {
  useEffect(() => {
    app = opts.app;
    version = opts.version ?? '';
    endpoint = opts.endpoint ?? '/api/t';
    start();
  }, [opts.app, opts.version, opts.endpoint]);
  useEffect(() => {
    route = opts.route;
    reportClient({ kind: 'view', route: opts.route });
  }, [opts.route]);
}
