/**
 * Sign in with ChatGPT: a person runs OpenAI models on their own ChatGPT plan instead of an API key
 * (OpenAI's "token sharing" flow, developers.openai.com/siwc). The sign-in opens in a new tab and
 * ends on a 127.0.0.1 address that loads nothing, since the app is not on the person's machine; the
 * person pastes that address back and the server finishes it. PKCE, a fresh state and nonce each
 * time, no client secret. The first sign-in registers the app (`dynamic_agent_client`) and OpenAI
 * issues a client id kept for later sign-ins.
 */

const AUTH = 'https://auth.openai.com/api/accounts';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
/** Only the port may change between sign-ins; `localhost` is refused. */
export const CHATGPT_REDIRECT = 'http://127.0.0.1:1455/auth/callback';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
/** The scope that lets the tokens run models on the plan. */
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
/** Refresh this long before the access token runs out. */
const EARLY_MS = 5 * 60_000;
/** A started sign-in is finished within this. */
const PENDING_MS = 15 * 60_000;

/** The app's registration with OpenAI for one person, kept across sign-outs. */
export interface ChatgptRegistration {
  /** This app's host id for this person (`urn:uuid:<uuid>`), the same on every sign-in. */
  host_id: string;
  /** The client id OpenAI issued on the first sign-in. */
  client_id?: string;
  /** A sign-in started and not yet finished. */
  pending?: { state: string; nonce: string; verifier: string; at: number };
}

/** A finished sign-in: kept sealed as the person's own OpenAI key. */
export interface ChatgptTokens {
  client_id: string;
  access_token: string;
  refresh_token: string;
  /** ms */
  expires_at: number;
  scope: string;
  email?: string;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const HOST_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export class SigninError extends Error {}

/** The sign-in address to open, and the registration with its new pending sign-in. */
export async function startChatgpt(
  reg: ChatgptRegistration | null,
  appName: string,
): Promise<{ url: string; reg: ChatgptRegistration }> {
  const pending = { state: random(), nonce: random(), verifier: random(48), at: Date.now() };
  const challenge = b64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier)),
  );
  // OpenAI refuses any other host id shape (`invalid_authorize_request`, param ext_agent_host_id),
  // so a registration made before this shape gets a new one; it never finished, so has no client id.
  const kept = reg && HOST_ID.test(reg.host_id) ? reg : null;
  const next: ChatgptRegistration = {
    ...kept,
    host_id: kept?.host_id ?? `urn:uuid:${crypto.randomUUID()}`,
    pending,
  };
  const q = new URLSearchParams({
    client_id: next.client_id ?? 'dynamic_agent_client',
    ...(next.client_id ? {} : { agent_name_hint: appName }),
    ext_agent_host_id: next.host_id,
    response_type: 'code',
    redirect_uri: CHATGPT_REDIRECT,
    scope: SCOPE,
    resource: CHATGPT_RESOURCE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return { url: `${AUTH}/authorize?${q}`, reg: next };
}

function claims(idToken: string): Record<string, unknown> {
  try {
    const part = idToken.split('.')[1] ?? '';
    const pad = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4)));
  } catch {
    return {};
  }
}

async function token(fetchFn: typeof fetch, form: Record<string, string>) {
  const res = await fetchFn(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof b.access_token !== 'string' || typeof b.refresh_token !== 'string') {
    const code = typeof b.error === 'string' ? b.error : `HTTP ${res.status}`;
    throw new SigninError(
      code === 'invalid_grant'
        ? 'That sign-in has expired or was used already: sign in again.'
        : `OpenAI refused the sign-in (${code}).`,
    );
  }
  return {
    access_token: b.access_token,
    refresh_token: b.refresh_token,
    expires_at: Date.now() + (typeof b.expires_in === 'number' ? b.expires_in : 3600) * 1000,
    scope: typeof b.scope === 'string' ? b.scope : '',
    id_token: typeof b.id_token === 'string' ? b.id_token : '',
  };
}

/**
 * Finishes a sign-in from the address it ended on: checks the state, trades the code for tokens and
 * checks they may run models on the plan. The ID token comes straight from OpenAI's token endpoint
 * over TLS, so its nonce and audience are checked and its signature is not (OIDC Core 3.1.3.7).
 */
export async function finishChatgpt(
  reg: ChatgptRegistration | null,
  pasted: string,
  fetchFn: typeof fetch,
): Promise<{ tokens: ChatgptTokens; reg: ChatgptRegistration }> {
  const pending = reg?.pending;
  if (!reg || !pending || Date.now() - pending.at > PENDING_MS)
    throw new SigninError('Start the sign-in again: this one is too old.');
  let q: URLSearchParams;
  try {
    q = new URL(pasted.trim()).searchParams;
  } catch {
    throw new SigninError('Paste the whole address from the tab the sign-in ended on.');
  }
  if (q.get('state') !== pending.state)
    throw new SigninError('That address is from another sign-in: start again.');
  if (q.get('error') === 'access_denied')
    throw new SigninError('ChatGPT said no: plan use may be off for this account.');
  if (q.get('error')) throw new SigninError(`ChatGPT stopped the sign-in (${q.get('error')}).`);
  const code = q.get('code');
  if (!code) throw new SigninError('That address has no sign-in code.');
  const returned = q.get('client_id');
  if (reg.client_id && returned && returned !== reg.client_id)
    throw new SigninError('That sign-in belongs to another registration: start again.');
  const clientId = reg.client_id ?? returned;
  if (!clientId) throw new SigninError('OpenAI sent no client id: start again.');
  const t = await token(fetchFn, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: pending.verifier,
    redirect_uri: CHATGPT_REDIRECT,
    resource: CHATGPT_RESOURCE,
  });
  const c = claims(t.id_token);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.nonce !== pending.nonce || !aud.includes(clientId))
    throw new SigninError('The sign-in did not match: start again.');
  if (!t.scope.split(' ').includes(PLAN_SCOPE))
    throw new SigninError('This ChatGPT account may not run models on its plan.');
  const { pending: _, ...kept } = reg;
  return {
    reg: { ...kept, client_id: clientId },
    tokens: {
      client_id: clientId,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at,
      scope: t.scope,
      ...(typeof c.email === 'string' ? { email: c.email } : {}),
    },
  };
}

/** Whether the access token needs a refresh before the next call. */
export const staleChatgpt = (t: ChatgptTokens) => t.expires_at - EARLY_MS < Date.now();

/** A new access token and the rotated refresh token that replaces the old one. */
export async function refreshChatgpt(
  t: ChatgptTokens,
  fetchFn: typeof fetch,
): Promise<ChatgptTokens> {
  const n = await token(fetchFn, {
    grant_type: 'refresh_token',
    client_id: t.client_id,
    refresh_token: t.refresh_token,
    resource: CHATGPT_RESOURCE,
  });
  return {
    ...t,
    access_token: n.access_token,
    refresh_token: n.refresh_token,
    expires_at: n.expires_at,
    ...(n.scope ? { scope: n.scope } : {}),
  };
}

/** One free read (the account's models) that says whether the plan sign-in still works. */
export async function testChatgpt(t: ChatgptTokens, fetchFn: typeof fetch) {
  const at = Date.now();
  const res = await fetchFn(`${CHATGPT_RESOURCE}/models`, {
    headers: { authorization: `Bearer ${t.access_token}` },
  }).catch(() => null);
  if (!res) return { ok: false, detail: 'OpenAI could not be reached.', at };
  if (!res.ok) return { ok: false, detail: `OpenAI refused the sign-in (HTTP ${res.status}).`, at };
  return { ok: true, detail: 'ChatGPT plan sign-in works.', at };
}
