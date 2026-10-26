import { cap, codeOf, num } from './fields';
/**
 * The event meter: the things an app does that are not a request it answers, one Analytics Engine
 * point each. A call to another service (`bank.call`, `billing.call`), a webhook in or out, a
 * sync's start and end, a sign-in. With the request meter they let anyone check that what came in
 * was acted on: a webhook received and a sync finished, an event paid for and a plan changed.
 *
 * A point holds an event name, a code (an upstream's error code or endpoint), counts and ids the
 * app makes. Never the payload, a token, or a person's name or email.
 */
import type { PointSink } from './points';
import { addUpstream, currentRequest, logLine } from './requests';

export interface EventPoint {
  /** What happened, dotted: `bank.call`, `bank.webhook`, `sync.done`, `webhook.out`, `auth.sign_in`. */
  event: string;
  /** The detail as a code: an endpoint path, an upstream's error code, a webhook's type. */
  code?: string;
  ok: boolean;
  /** An opaque id the app makes for whom it happened to, or empty. */
  subject?: string;
  /** The thing it happened to, an id the app makes (a connection's, an endpoint's). */
  ref?: string;
  /** What started it: schedule, webhook, link, manual, or your own. */
  trigger?: string;
  /** The other service's own request id, for its support. */
  upstreamId?: string;
  ms?: number;
  status?: number;
  /** Up to three counts, named by the event (a sync: added, modified, removed). */
  counts?: [number?, number?, number?];
  attempt?: number;
  /** `true` when the event was a call to another service: its time adds to the request's. */
  upstream?: boolean;
  /** Defaults to the request in scope; pass these from a Durable Object or a job. */
  app?: string;
  requestId?: string;
  env?: string;
  version?: string;
}

let sink: PointSink | undefined;

/** The entry point (and each Durable Object) sets the dataset once per isolate. */
export function setEventSink(s: PointSink | undefined) {
  sink = s;
}

/**
 * Column order is the contract with whoever reads the dataset back: index1 subject (or `anon`);
 * blobs app, event, code, outcome, ref, trigger, request id, upstream id, env, version; doubles
 * ms, status, count1, count2, count3, attempt.
 */
export function meterEvent(p: EventPoint) {
  try {
    const r = currentRequest();
    if (p.upstream && p.ms !== undefined) addUpstream(p.ms);
    const fields = {
      app: p.app ?? r?.app,
      requestId: p.requestId ?? r?.requestId,
      env: p.env ?? r?.env,
      version: p.version ?? r?.version,
    };
    const code = codeOf(p.code);
    sink?.writeDataPoint({
      indexes: [cap(p.subject || 'anon')],
      blobs: [
        cap(fields.app),
        codeOf(p.event, 'other'),
        code,
        p.ok ? 'ok' : 'error',
        cap(p.ref),
        cap(p.trigger),
        cap(fields.requestId),
        cap(p.upstreamId),
        cap(fields.env),
        cap(fields.version),
      ],
      doubles: [
        num(p.ms),
        num(p.status),
        num(p.counts?.[0]),
        num(p.counts?.[1]),
        num(p.counts?.[2]),
        num(p.attempt),
      ],
    });
    logLine('event', {
      id: fields.requestId,
      event: p.event,
      code,
      ok: p.ok,
      ref: p.ref,
      ms: p.ms === undefined ? undefined : Math.round(p.ms),
      status: p.status,
    });
  } catch (err) {
    console.error('meterEvent', err);
  }
}
