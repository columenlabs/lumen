/**
 * Sign in with Grok: a person runs xAI's Grok models on their own SuperGrok or X Premium plan instead
 * of an API key. xAI's sign-in is a device code (OAuth 2.0 device authorization, RFC 8628): the server
 * asks xAI for a short code and a link, the person opens the link and approves, and the server asks
 * xAI's token endpoint at its interval until the approval lands. Nothing is pasted back, so it works
 * from an app on any host. Endpoints are from https://auth.x.ai/.well-known/openid-configuration
 * (checked 2026-11-24). xAI offers no client registration, so this is the one public client xAI's own
 * Grok CLI and the other tools that sign in to Grok use; no client secret. Tokens run models on
 * xAI's Grok CLI proxy (`GROK_PLAN_BASE_URL`), the route that bills the plan, with the CLI's headers.
 */

const AUTH = 'https://auth.x.ai/oauth2';
/** xAI's public sign-in client, shared by every tool that signs in to Grok (no registration exists). */
export const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** Refresh this long before the access token runs out. */
const EARLY_MS = 5 * 60_000;
/** The model a sign-in's test runs: the smallest Grok, one short answer. */
const TEST_MODEL = 'grok-4.3';

/**
 * The Grok CLI release plan calls name. The proxy refuses an outdated one (426), so the version is read
 * from xAI's own release feed (what its installer reads), kept for `VERSION_MS`, and read again at once
 * when the proxy says it is outdated. This one is only the start until the feed answers.
 */
let cliVersion = { v: '1.0.92', at: 0 };
const VERSION_FEEDS = [
  'https://x.ai/cli/stable',
  'https://storage.googleapis.com/grok-build-public-artifacts/cli/stable',
];
const VERSION_MS = 6 * 3_600_000;

async function currentCliVersion(fetchFn: typeof fetch, fresh = false): Promise<string> {
  if (!fresh && Date.now() - cliVersion.at < VERSION_MS) return cliVersion.v;
  for (const url of VERSION_FEEDS) {
    const text = await fetchFn(url, { signal: AbortSignal.timeout(5_000) })
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '');
    const v = text.trim().split(/\s/)[0] ?? '';
    if (/^\d+\.\d+\.\d+(-[A-Za-z0-9._]+)?$/.test(v)) {
      cliVersion = { v, at: Date.now() };
      return v;
    }
  }
  // The feed is down: keep the last version and ask again in a minute, not on every call.
  cliVersion = { v: cliVersion.v, at: Date.now() - VERSION_MS + 60_000 };
  return cliVersion.v;
}

/** The headers xAI's Grok CLI sends its proxy; the proxy reads a plan token only with them. */
const planHeaders = (model: string, version: string): Record<string, string> => ({
  'user-agent': `grok-shell/${version}`,
  'x-grok-client-identifier': 'grok-shell',
  'x-grok-client-version': version,
  'x-grok-client-mode': 'interactive',
  'x-xai-token-auth': 'xai-grok-cli',
  'x-authenticateresponse': 'authenticate-response',
  'x-grok-model-override': model,
});

/**
 * A fetch for Grok plan calls: each carries the Grok CLI's headers at xAI's current CLI version, and
 * a 426 (CLI outdated) reads the version again and sends the call once more.
 */
export function grokPlanFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    let model = '';
    try {
      const b = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (b && typeof b.model === 'string') model = b.model;
    } catch {}
    const send = (version: string) => {
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(planHeaders(model, version))) headers.set(k, v);
      return base(input, { ...init, headers });
    };
    const sent = await currentCliVersion(base);
    const res = await send(sent);
    if (res.status !== 426) return res;
    const now = await currentCliVersion(base, true);
    if (now === sent) return res;
    console.log(JSON.stringify({ event: 'grok_cli_version', from: sent, to: now }));
    return send(now);
  };
}

/** A started sign-in, kept sealed until it is approved or runs out. */
export interface GrokPending {
  device_code: string;
  user_code: string;
  url: string;
  /** ms */
  expires_at: number;
  /** Seconds between asks; xAI may raise it (`slow_down`). */
  interval: number;
  /** ms: the last time xAI was asked. */
  asked_at: number;
}

/** A finished sign-in: kept sealed as the person's plan. */
export interface GrokTokens {
  access_token: string;
  refresh_token: string;
  /** ms */
  expires_at: number;
  scope: string;
  email?: string;
}

/** What a person sees while a sign-in waits: never the device code itself. */
export interface GrokStarted {
  url: string;
  code: string;
  expires_at: number;
  interval: number;
}

export class GrokSigninError extends Error {}

const form = (fetchFn: typeof fetch, path: string, body: Record<string, string>) =>
  fetchFn(`${AUTH}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });

const json = async (res: Response) =>
  (await res.json().catch(() => ({}))) as Record<string, unknown>;

/** Asks xAI for a code and link to approve. */
export async function startGrok(
  fetchFn: typeof fetch,
): Promise<{ pending: GrokPending; shown: GrokStarted }> {
  const res = await form(fetchFn, 'device/code', { client_id: GROK_CLIENT_ID, scope: SCOPE }).catch(
    () => null,
  );
  if (!res) throw new GrokSigninError('xAI could not be reached: try again.');
  const b = await json(res);
  if (
    !res.ok ||
    typeof b.device_code !== 'string' ||
    typeof b.user_code !== 'string' ||
    typeof b.verification_uri !== 'string'
  )
    throw new GrokSigninError(`xAI would not start a sign-in (HTTP ${res.status}).`);
  const url =
    typeof b.verification_uri_complete === 'string'
      ? b.verification_uri_complete
      : b.verification_uri;
  const now = Date.now();
  const pending: GrokPending = {
    device_code: b.device_code,
    user_code: b.user_code,
    url,
    expires_at: now + (typeof b.expires_in === 'number' ? b.expires_in : 900) * 1000,
    interval: typeof b.interval === 'number' && b.interval > 0 ? b.interval : 5,
    asked_at: 0,
  };
  return { pending, shown: shownOf(pending) };
}

export const shownOf = (p: GrokPending): GrokStarted => ({
  url: p.url,
  code: p.user_code,
  expires_at: p.expires_at,
  interval: p.interval,
});

function claims(idToken: unknown): Record<string, unknown> {
  if (typeof idToken !== 'string') return {};
  try {
    const part = idToken.split('.')[1] ?? '';
    const pad = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4)));
  } catch {
    return {};
  }
}

function tokensOf(b: Record<string, unknown>, keep?: GrokTokens): GrokTokens | null {
  if (typeof b.access_token !== 'string') return null;
  const refresh = typeof b.refresh_token === 'string' ? b.refresh_token : keep?.refresh_token;
  if (!refresh) return null;
  const email = claims(b.id_token).email;
  return {
    access_token: b.access_token,
    refresh_token: refresh,
    expires_at: Date.now() + (typeof b.expires_in === 'number' ? b.expires_in : 3600) * 1000,
    scope: typeof b.scope === 'string' ? b.scope : (keep?.scope ?? ''),
    ...(typeof email === 'string' ? { email } : keep?.email ? { email: keep.email } : {}),
  };
}

/**
 * Asks once whether the person approved. `wait`: not yet (the pending sign-in comes back with its
 * time of asking, and a longer interval when xAI said to slow down); `done`: the tokens. Asking
 * sooner than xAI's interval does not call xAI. A denied or expired code throws in plain words.
 */
export async function pollGrok(
  pending: GrokPending,
  fetchFn: typeof fetch,
): Promise<{ wait: GrokPending } | { done: GrokTokens }> {
  const now = Date.now();
  if (now > pending.expires_at)
    throw new GrokSigninError('That code ran out before it was approved: start again.');
  if (now - pending.asked_at < pending.interval * 1000) return { wait: pending };
  const asked = { ...pending, asked_at: now };
  const res = await form(fetchFn, 'token', {
    grant_type: DEVICE_GRANT,
    client_id: GROK_CLIENT_ID,
    device_code: pending.device_code,
  }).catch(() => null);
  if (!res) return { wait: asked };
  const b = await json(res);
  if (res.ok) {
    const t = tokensOf(b);
    if (!t) throw new GrokSigninError('xAI sent no sign-in tokens: start again.');
    return { done: t };
  }
  const code = typeof b.error === 'string' ? b.error : '';
  if (code === 'authorization_pending') return { wait: asked };
  if (code === 'slow_down') return { wait: { ...asked, interval: pending.interval + 5 } };
  if (code === 'access_denied') throw new GrokSigninError('The sign-in was declined on xAI.');
  if (code === 'expired_token')
    throw new GrokSigninError('That code ran out before it was approved: start again.');
  throw new GrokSigninError(`xAI stopped the sign-in (${code || `HTTP ${res.status}`}).`);
}

/** Whether the access token needs a refresh before the next call. */
export const staleGrok = (t: GrokTokens) => t.expires_at - EARLY_MS < Date.now();

/** A new access token (and the refresh token, when xAI rotates it). */
export async function refreshGrok(t: GrokTokens, fetchFn: typeof fetch): Promise<GrokTokens> {
  const res = await form(fetchFn, 'token', {
    grant_type: 'refresh_token',
    client_id: GROK_CLIENT_ID,
    refresh_token: t.refresh_token,
  }).catch(() => null);
  if (!res) throw new GrokSigninError('xAI could not be reached.');
  const b = await json(res);
  const n = res.ok ? tokensOf(b, t) : null;
  if (!n)
    throw new GrokSigninError(
      b.error === 'invalid_grant'
        ? 'The Grok sign-in has ended: sign in again.'
        : `xAI refused the sign-in (${typeof b.error === 'string' ? b.error : `HTTP ${res.status}`}).`,
    );
  return n;
}

/** Ends the sign-in at xAI too (best effort: the tokens are dropped either way). */
export async function revokeGrok(t: GrokTokens, fetchFn: typeof fetch): Promise<void> {
  await form(fetchFn, 'revoke', {
    client_id: GROK_CLIENT_ID,
    token: t.refresh_token,
    token_type_hint: 'refresh_token',
  }).catch(() => null);
}

/** xAI's own words on a refused call, short and on one line (its errors carry no token). */
async function xaiSaid(res: Response): Promise<string> {
  const b = await json(res);
  const e = b.error;
  const m =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
        ? (e as { message: string }).message
        : typeof b.message === 'string'
          ? b.message
          : '';
  const one = m.replace(/\s+/g, ' ').trim().slice(0, 160);
  return one ? `: ${one}` : '';
}

/**
 * One short answer from the smallest Grok on the plan: xAI decides per account whether a plan may run
 * models over the API, and a list of models answers even when it may not, so only a real call tells.
 */
export async function testGrok(t: GrokTokens, fetchFn: typeof fetch, base: string) {
  const at = Date.now();
  const res = await grokPlanFetch(fetchFn)(`${base}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${t.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: TEST_MODEL,
      input: 'Say OK.',
      max_output_tokens: 16,
      store: false,
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) return { ok: false, detail: 'xAI could not be reached.', at };
  if (res.status === 403)
    return {
      ok: false,
      detail:
        "Signed in, but xAI doesn't let this plan run models here. Use an xAI API key instead.",
      at,
    };
  if (res.status === 402)
    return {
      ok: false,
      detail: 'Signed in, but xAI says the plan has no Grok use left. Check the plan on grok.com.',
      at,
    };
  if (!res.ok) {
    const said = await xaiSaid(res);
    return { ok: false, detail: `xAI refused the call (HTTP ${res.status}${said}).`, at };
  }
  return { ok: true, detail: 'Grok plan sign-in works.', at };
}
