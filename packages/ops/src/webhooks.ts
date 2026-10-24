/**
 * Webhooks out: one POST to an endpoint, signed per the Standard Webhooks spec
 * (https://www.standardwebhooks.com) when a secret is given, so any of its libraries verifies it.
 * The send never throws: it returns how it went, for the app's own delivery log and retries.
 */
import { Webhook } from 'standardwebhooks';

export interface WebhookSend {
  url: string;
  /** The body as sent and signed, usually JSON. */
  body: string;
  /** Signs the delivery: `whsec_…` (see `newWebhookSecret`). Left out, nothing is signed. */
  secret?: string;
  /** The message id the signature covers; the same id on a retry. Made up when left out. */
  id?: string;
  /** The endpoint's own headers (its auth). They can never replace the signature headers. */
  headers?: Record<string, string>;
  /** Default `application/json`. */
  contentType?: string;
  userAgent?: string;
  /** Default 10 s. */
  timeoutMs?: number;
  /** Default `manual`: a redirect counts as a failed delivery, never followed. */
  redirect?: RequestRedirect;
  /** For tests or a service binding; default the global fetch. */
  fetch?: typeof fetch;
}

export interface WebhookResult {
  ok: boolean;
  /** The endpoint's HTTP status; 0 when it never answered (timeout, DNS, refused). */
  status: number;
  ms: number;
  /** The message id sent. */
  id: string;
  /** On a failure: the first 200 characters of the answer, or why there was none. */
  error?: string;
}

/** A new signing secret, `whsec_` and 32 random bytes in base64. Show it to its owner once. */
export function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `whsec_${btoa(String.fromCharCode(...bytes))}`;
}

/** Sends one delivery. */
export async function sendWebhook(send: WebhookSend): Promise<WebhookResult> {
  const id = send.id ?? `msg_${crypto.randomUUID().replaceAll('-', '')}`;
  const at = new Date();
  const signed: Record<string, string> = send.secret
    ? {
        'webhook-id': id,
        'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
        'webhook-signature': new Webhook(send.secret).sign(id, at, send.body),
      }
    : {};
  const started = Date.now();
  try {
    const res = await (send.fetch ?? fetch)(send.url, {
      method: 'POST',
      redirect: send.redirect ?? 'manual',
      signal: AbortSignal.timeout(send.timeoutMs ?? 10_000),
      headers: {
        ...send.headers,
        'content-type': send.contentType ?? 'application/json',
        ...(send.userAgent ? { 'user-agent': send.userAgent } : {}),
        ...signed,
      },
      body: send.body,
    });
    const ok = res.status >= 200 && res.status < 300;
    let error: string | undefined;
    if (ok) await res.body?.cancel();
    else error = (await res.text().catch(() => '')).slice(0, 200) || `HTTP ${res.status}`;
    return { ok, status: res.status, ms: Date.now() - started, id, ...(error ? { error } : {}) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, ms: Date.now() - started, id, error: error.slice(0, 200) };
  }
}
