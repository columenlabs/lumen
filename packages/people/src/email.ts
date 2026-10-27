/**
 * Email through a Resend-style API: `POST {url}/emails` with `Authorization: Bearer <key>`, which
 * Resend and self-hosted servers that copy its API both answer. No SMTP. The app keeps the settings
 * (sealed: the key never comes back) and says how each route is reached, e.g. a private tunnel's
 * own fetch; the kit sends, checks and tests.
 */
import type {
  EmailCheck,
  EmailCheckStep,
  EmailCurrent,
  EmailDraft,
  EmailRoute,
  EmailSettingsView,
  MailOutcome,
} from '@columenlabs/lumen-ui-types/people';
import type { MailMessage, Mailer } from './mailer';

type Fetch = (req: Request) => Promise<Response>;
type Awaitable<T> = T | Promise<T>;

export interface ResendConfig {
  /** The API base without `/emails`: `https://api.resend.com`, `http://localhost:5000/api`. */
  url: string;
  apiKey: string;
  from: string;
  fromName?: string;
  /** How requests reach the server (a tunnel binding's fetch); the global fetch by default. */
  fetch?: Fetch;
  timeoutMs?: number;
}

const TIMEOUT_MS = 15_000;

/** `https://api.resend.com/emails/` → `https://api.resend.com`; null for anything but a plain URL. */
export function emailApiUrl(v: string): string | null {
  try {
    const u = new URL(v.trim());
    if (u.search || u.hash || u.username || u.password) return null;
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '').replace(/\/emails$/, '');
  } catch {
    return null;
  }
}

const fromHeader = (c: ResendConfig) =>
  c.fromName ? `"${c.fromName.replace(/["<>]/g, '')}" <${c.from}>` : c.from;

async function call(c: ResendConfig, path: string, init: RequestInit) {
  const t0 = Date.now();
  const req = new Request(`${c.url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(c.timeoutMs ?? TIMEOUT_MS),
  });
  try {
    const res = await (c.fetch ?? ((r: Request) => fetch(r)))(req);
    return { res, ms: Date.now() - t0 };
  } catch {
    return { res: null, ms: Date.now() - t0 };
  }
}

/** A 3xx: the address leads to a sign-in page (Cloudflare Access, a login proxy), not the API. */
const redirected = (res: Response) => {
  let to = '';
  try {
    to = new URL(res.headers.get('location') ?? '').host;
  } catch {}
  return `The address redirects${to ? ` to ${to}` : ''} (a sign-in page?), not to the email API`;
};

const refused = (status: number) =>
  status === 401 || status === 403
    ? 'The server refused the API key'
    : status === 400 || status === 422
      ? 'The server refused the email (check the sender)'
      : status === 429
        ? 'The server is rate limiting; try again soon'
        : `The server answered ${status}`;

/** One email; never throws. */
export async function sendResend(c: ResendConfig, msg: MailMessage): Promise<MailOutcome> {
  const { res } = await call(c, '/emails', {
    method: 'POST',
    body: JSON.stringify({
      from: fromHeader(c),
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res) return { ok: false, detail: 'Could not reach the email server' };
  if (res.ok) {
    await res.body?.cancel();
    return { ok: true, detail: `Emailed ${msg.to}` };
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    return { ok: false, detail: redirected(res) };
  }
  const why = await serverSays(res);
  return { ok: false, detail: why ? `${refused(res.status)}: ${why}` : refused(res.status) };
}

/** The server's own reason in a Resend-style error body (`message` or `error`), short and on one line. */
async function serverSays(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as {
    message?: unknown;
    error?: unknown;
  } | null;
  const said =
    typeof body?.message === 'string'
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : '';
  const line = said.replace(/\s+/g, ' ').trim();
  return line ? (line.length > 200 ? `${line.slice(0, 199)}…` : line) : null;
}

export const resendMailer =
  (c: ResendConfig): Mailer =>
  (msg) =>
    sendResend(c, msg);

/** Reached the server and key accepted, from one request that cannot send: an empty email to
 *  `/emails`. A refused key answers 401 or 403; a key that passes gets the empty email refused. */
async function reachAndKey(c: ResendConfig, where: string): Promise<EmailCheckStep[]> {
  const { res, ms } = await call(c, '/emails', { method: 'POST', body: '{}' });
  if (!res) return [{ id: 'reach', ok: false, text: `Could not reach ${where}`, ms }];
  await res.body?.cancel();
  const reach: EmailCheckStep = { id: 'reach', ok: true, text: `Reached ${where}`, ms };
  if (res.status >= 300 && res.status < 400)
    return [{ ...reach, ok: false, text: redirected(res) }];
  if (res.status === 404 || res.status === 405)
    return [{ ...reach, ok: false, text: `${where} has no email API at this address` }];
  if (res.status === 401 || res.status === 403)
    return [reach, { id: 'key', ok: false, text: 'The server refused the API key', ms: null }];
  if (res.status >= 500)
    return [reach, { id: 'key', ok: false, text: `The server answered ${res.status}`, ms: null }];
  if (res.status === 429)
    return [reach, { id: 'key', ok: null, text: 'Rate limited: try again soon', ms: null }];
  return [reach, { id: 'key', ok: true, text: 'API key accepted', ms: null }];
}

/** The sender's domain among the server's verified domains (`GET /domains`), where it lists them. */
async function sender(c: ResendConfig): Promise<EmailCheckStep> {
  const { res, ms } = await call(c, '/domains', { method: 'GET' });
  const unknown: EmailCheckStep = {
    id: 'sender',
    ok: null,
    text: `${c.from}: this server does not list its senders, so Send test confirms it`,
    ms,
  };
  if (!res?.ok) {
    await res?.body?.cancel();
    return unknown;
  }
  const body = (await res.json().catch(() => null)) as {
    data?: { name?: string; status?: string }[];
  } | null;
  if (!Array.isArray(body?.data)) return unknown;
  const domain = c.from.split('@')[1]?.toLowerCase();
  const d = body.data.find((x) => x.name?.toLowerCase() === domain);
  if (!d) return { id: 'sender', ok: false, text: `${domain} is not a domain on this server`, ms };
  const ok = !d.status || d.status === 'verified';
  return {
    id: 'sender',
    ok,
    text: ok ? `${c.from} is allowed to send` : `${domain} is ${d.status} on this server`,
    ms,
  };
}

const passed = (steps: EmailCheckStep[]) =>
  steps.every((s) => s.ok !== false) && steps.some((s) => s.ok === true);

/** Check connection: every step but sending. */
export async function checkResend(c: ResendConfig, where: string): Promise<EmailCheck> {
  const steps = await reachAndKey(c, where);
  if (passed(steps)) steps.push(await sender(c));
  return {
    ok: passed(steps) && steps.some((s) => s.id === 'key' && s.ok),
    kind: 'check',
    steps,
    at: Date.now(),
  };
}

/** Send test: a real email to `to`. */
export async function testResend(
  c: ResendConfig,
  where: string,
  to: string,
  appName: string,
): Promise<EmailCheck> {
  const t0 = Date.now();
  const r = await sendResend(c, {
    to,
    subject: `${appName} email test`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5"><p>This is a test from ${appName} settings.</p><p style="color:#78716c;font-size:13px">Sent as ${c.from}.</p></body></html>`,
    text: `This is a test from ${appName} settings. Sent as ${c.from}.`,
  });
  const ms = Date.now() - t0;
  const steps: EmailCheckStep[] = r.ok
    ? [
        { id: 'reach', ok: true, text: `Reached ${where}`, ms: null },
        { id: 'key', ok: true, text: 'API key accepted', ms: null },
        { id: 'send', ok: true, text: `Sent to ${to} · check the inbox`, ms },
      ]
    : [{ id: 'send', ok: false, text: r.detail, ms }];
  return { ok: r.ok, kind: 'test', steps, at: Date.now() };
}

/** What the app stores: the draft with its key, sealed by the app. */
export interface StoredEmail {
  route: string;
  url: string;
  apiKey: string;
  from: string;
  fromName: string;
}

export interface EmailRouteDef extends EmailRoute {
  /** Why an address will not do on this route (a tunnel that allows one port), or null. */
  checkUrl?: (url: string) => string | null;
  /** How this route reaches the server; the global fetch by default (then https only). */
  fetch?: (req: Request) => Awaitable<Fetch | null>;
  /** The server named in check lines ("the tunnel's machine"); the address's host by default. */
  where?: string;
}

export interface EmailOptions {
  routes: EmailRouteDef[];
  store: {
    get: (req: Request) => Promise<{
      settings: StoredEmail;
      updatedAt: number | null;
      updatedBy: string | null;
    } | null>;
    put: (req: Request, settings: StoredEmail, by: string) => Promise<void>;
    clear?: (req: Request) => Promise<void>;
    lastTest?: (req: Request) => Promise<EmailCheck | null>;
    putTest?: (req: Request, test: EmailCheck) => Promise<void>;
  };
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The draft as settings to try, with the saved key when the draft left it out; or why not. */
export async function resolveDraft(
  o: EmailOptions,
  req: Request,
  draft: Partial<EmailDraft>,
): Promise<
  | { ok: true; settings: StoredEmail; config: ResendConfig; where: string }
  | { ok: false; error: string }
> {
  const route = o.routes.find((r) => r.id === draft.route);
  if (!route) return { ok: false, error: 'Pick how to reach the server.' };
  const url = emailApiUrl(String(draft.url ?? ''));
  if (!url) return { ok: false, error: 'Enter the server address, like https://api.resend.com.' };
  const own = route.checkUrl?.(url);
  if (own) return { ok: false, error: own };
  const f = route.fetch ? await route.fetch(req) : null;
  if (route.fetch && !f) return { ok: false, error: `${route.label} is not connected.` };
  if (!route.fetch && !url.startsWith('https://'))
    return { ok: false, error: 'Use an https address on the public internet.' };
  const saved = (await o.store.get(req))?.settings;
  const apiKey = String(draft.apiKey ?? '').trim() || saved?.apiKey || '';
  if (!apiKey || apiKey.length > 300) return { ok: false, error: 'Enter the API key.' };
  const from = String(draft.from ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(from)) return { ok: false, error: 'Enter the address mail is sent from.' };
  const fromName = String(draft.fromName ?? '')
    .trim()
    .slice(0, 80);
  const settings: StoredEmail = { route: route.id, url, apiKey, from, fromName };
  return {
    ok: true,
    settings,
    config: { url, apiKey, from, fromName, ...(f ? { fetch: f } : {}) },
    where: route.where ?? new URL(url).host,
  };
}

/** The saved settings as a mailer, or null when none are saved or their route is gone. */
export async function storedMailer(
  o: EmailOptions,
  req: Request,
): Promise<{ mailer: Mailer; from: string } | null> {
  const s = (await o.store.get(req))?.settings;
  if (!s) return null;
  const r = await resolveDraft(o, req, s);
  return r.ok
    ? { mailer: resendMailer(r.config), from: s.fromName ? `${s.fromName} <${s.from}>` : s.from }
    : null;
}

export async function emailView(
  o: EmailOptions,
  req: Request,
  me: string,
): Promise<EmailSettingsView> {
  const [got, lastTest] = await Promise.all([o.store.get(req), o.store.lastTest?.(req) ?? null]);
  const current: EmailCurrent | null = got
    ? {
        route: got.settings.route,
        url: got.settings.url,
        keyHint: `…${got.settings.apiKey.slice(-4)}`,
        from: got.settings.from,
        fromName: got.settings.fromName,
        updatedAt: got.updatedAt,
        updatedBy: got.updatedBy,
      }
    : null;
  return {
    routes: o.routes.map(({ id, label, state, urlInfo, url }) => ({
      id,
      label,
      state,
      urlInfo,
      url,
    })),
    current,
    lastTest,
    me,
  };
}
