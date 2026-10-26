/**
 * The HTTP routes the assistant's panel and Settings call, as one fetch handler on Web
 * `Request`/`Response`, so it mounts in any router:
 *
 *   app.all('/api/assistant/*', (c) => assistant(c.req.raw));   // Hono
 *
 *   GET    /status                  what the panel and Settings show
 *   PUT    /settings                the person's tiers, tasks, hand off, advice, tool access, web, payer
 *   PUT    /app {cap_usd}           admin: what each person may spend a month on the app's key
 *   PUT    /key {api_key}           admin: the app's Claude key, tested before it is kept
 *   DELETE /key, POST /key/test     admin
 *   PUT    /my-key {api_key, cap_usd?}, PUT /my-key/cap {cap_usd}, DELETE /my-key, POST /my-key/test
 *   PUT    /web/scrapeql {client_id, client_secret}, DELETE /web/scrapeql, POST /web/test   admin
 *   POST   /chat                    one answer as server-sent events; closing the request stops it
 *   GET    /chats, GET|DELETE /chats/:id
 *   POST   /chats/:id/drafts/:draft {action: save | dismiss}
 *
 * Writes must be same-origin JSON: a signed-in browser session is a cookie, so a foreign page's
 * form or fetch is refused before it reaches a rule. Keys and tokens are write-only: no route
 * returns one, only a hint (`sk-ant-…abcd`).
 */
import {
  ASSISTANT_ACCESS,
  ASSISTANT_EFFORTS,
  ASSISTANT_PAYERS,
  type AssistantMessage,
  type AssistantSettingsPatch,
  HAND_OFF_POLICIES,
} from '@columenlabs/lumen-ui-types/assistant';
import { type Assistant, AssistantError, type Caller } from './engine';
import type { KeyDoc, PersonDoc, TokenDoc } from './state';
import { APP_SCOPE } from './store';

type Awaitable<T> = T | Promise<T>;

export interface AssistantRoutesOptions {
  /** Where the routes are mounted (`/api/assistant`). */
  base: string;
  /** The verified caller, or null (403). The app decides who is an admin. */
  caller: (req: Request) => Awaitable<Caller | null>;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_MESSAGE = 20_000;
const MAX_CAP = 10_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const fail = (error: string, status = 400, code?: string) =>
  json({ error, ...(code ? { code } : {}) }, status);

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max = 500) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
const cap = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_CAP
    ? Math.round(v * 100) / 100
    : null;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.find((x) => x === v);

/** Checks a settings change against the app's tiers, tasks, models and tool groups. */
function settingsChange(a: Assistant, groups: string[], b: Record<string, unknown>) {
  const p = b as AssistantSettingsPatch;
  const tierIds = new Set(a.tiers.map((t) => t.id));
  const modelIds = new Set(a.models.map((m) => m.id));
  if (p.tier !== undefined && !tierIds.has(p.tier)) return 'No such tier.';
  if (p.tiers !== undefined) {
    if (!p.tiers || typeof p.tiers !== 'object') return 'tiers is {tier: {model, effort}}.';
    for (const [id, t] of Object.entries(p.tiers)) {
      if (!tierIds.has(id)) return `No tier ${id}.`;
      if (t.model !== undefined && !modelIds.has(t.model)) return `No model ${t.model}.`;
      if (t.effort !== undefined && !oneOf(ASSISTANT_EFFORTS, t.effort))
        return `No effort ${t.effort}.`;
    }
  }
  if (p.tasks !== undefined) {
    if (!p.tasks || typeof p.tasks !== 'object') return 'tasks is {task: tier}.';
    for (const [id, tier] of Object.entries(p.tasks)) {
      if (!a.tasks.some((t) => t.id === id)) return `No task ${id}.`;
      if (!tierIds.has(tier)) return `No tier ${tier}.`;
    }
  }
  if (p.hand_off !== undefined && !oneOf(HAND_OFF_POLICIES, p.hand_off)) return 'No such hand off.';
  if (p.advice !== undefined && p.advice !== 'off' && !tierIds.has(p.advice))
    return 'Advice is off or a tier.';
  if (p.access !== undefined) {
    if (!p.access || typeof p.access !== 'object') return 'access is {group: off | read | draft}.';
    for (const [g, v] of Object.entries(p.access)) {
      if (!groups.includes(g)) return `No tool group ${g}.`;
      if (!oneOf(ASSISTANT_ACCESS, v)) return `No access ${v}.`;
    }
  }
  if (p.web !== undefined && (typeof p.web !== 'object' || typeof p.web?.fetch !== 'boolean'))
    return 'web is {fetch: true | false}.';
  if (p.pay !== undefined && !oneOf(ASSISTANT_PAYERS, p.pay)) return 'pay is app or own.';
  return (d: PersonDoc): PersonDoc => {
    const tiers = { ...(d.tiers ?? {}) };
    for (const [id, t] of Object.entries(p.tiers ?? {})) {
      const tier = a.tiers.find((x) => x.id === id);
      const prev = tiers[id] ?? { model: tier?.model ?? '', effort: 'default' };
      tiers[id] = { model: t.model ?? prev.model, effort: t.effort ?? prev.effort };
    }
    return {
      ...d,
      ...(p.tier !== undefined ? { tier: p.tier } : {}),
      ...(p.tiers !== undefined ? { tiers } : {}),
      ...(p.tasks !== undefined ? { tasks: { ...(d.tasks ?? {}), ...p.tasks } } : {}),
      ...(p.hand_off !== undefined ? { hand_off: p.hand_off } : {}),
      ...(p.advice !== undefined ? { advice: p.advice } : {}),
      ...(p.access !== undefined ? { access: { ...(d.access ?? {}), ...p.access } } : {}),
      ...(p.web !== undefined ? { web: p.web.fetch } : {}),
      ...(p.pay !== undefined ? { pay: p.pay } : {}),
    };
  };
}

export function assistantRoutes(
  a: Assistant,
  o: AssistantRoutesOptions,
): (req: Request) => Promise<Response> {
  const base = o.base.replace(/\/+$/, '');
  const docs = a.state.docs;

  return async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(base)) return fail('Not found.', 404);
    const parts = url.pathname
      .slice(base.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const m = req.method;
    const route = `${m} /${parts.join('/')}`;

    if (MUTATING.has(m)) {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin)
        return fail('Not from this site.', 403, 'forbidden_origin');
      if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
        return fail('Use Content-Type: application/json.', 415);
    }
    const caller = await o.caller(req);
    if (!caller) return fail('Sign in first.', 403, 'forbidden');
    const admin = () => (caller.admin ? null : fail('Admins only.', 403, 'forbidden'));
    const status = async () => json(await a.status(caller));

    try {
      switch (route) {
        case 'GET /status':
          return status();

        case 'PUT /settings': {
          const groups = (await a.status(caller)).groups.map((g) => g.id);
          const change = settingsChange(a, groups, await body(req));
          if (typeof change === 'string') return fail(change);
          await a.state.setPerson(caller.id, change);
          return status();
        }

        case 'PUT /app': {
          const no = admin();
          if (no) return no;
          const c = cap((await body(req)).cap_usd);
          if (c === null) return fail(`cap_usd is a number of dollars, 0 to ${MAX_CAP}.`);
          await a.state.setApp((d) => ({ ...d, cap_usd: c }));
          return status();
        }

        case 'PUT /key':
        case 'PUT /my-key': {
          const mine = route === 'PUT /my-key';
          if (!mine) {
            const no = admin();
            if (no) return no;
          }
          const b = await body(req);
          const key = str(b.api_key, 400);
          if (!key) return fail('Paste the key (sk-ant-…).');
          const c = b.cap_usd === undefined ? undefined : cap(b.cap_usd);
          if (c === null) return fail(`cap_usd is a number of dollars, 0 to ${MAX_CAP}.`);
          const test = await a.testKey(key);
          if (!test.ok) return fail(test.detail, 400, 'key_refused');
          const scope = mine ? caller.id : APP_SCOPE;
          await docs.update<KeyDoc>(scope, 'key', (d) => ({
            api_key: key,
            saved_at: Date.now(),
            test,
            ...(mine ? { cap_usd: c ?? d?.cap_usd ?? a.state.defaultCap } : {}),
          }));
          return status();
        }

        case 'PUT /my-key/cap': {
          const c = cap((await body(req)).cap_usd);
          if (c === null) return fail(`cap_usd is a number of dollars, 0 to ${MAX_CAP}.`);
          const d = await a.state.ownKey(caller.id);
          if (!d) return fail('Add your key first.', 404);
          await docs.write<KeyDoc>(caller.id, 'key', { ...d, cap_usd: c });
          return status();
        }

        case 'DELETE /key':
        case 'DELETE /my-key': {
          const mine = route === 'DELETE /my-key';
          if (!mine) {
            const no = admin();
            if (no) return no;
          }
          await docs.remove(mine ? caller.id : APP_SCOPE, 'key');
          return status();
        }

        case 'POST /key/test':
        case 'POST /my-key/test': {
          const mine = route === 'POST /my-key/test';
          if (!mine) {
            const no = admin();
            if (no) return no;
          }
          const scope = mine ? caller.id : APP_SCOPE;
          const d = await docs.read<KeyDoc>(scope, 'key');
          const key = d?.api_key ?? (mine ? null : (await a.state.appApiKey())?.key);
          if (!key) return fail('No key is set.', 404);
          const test = await a.testKey(key);
          if (d) await docs.write<KeyDoc>(scope, 'key', { ...d, test });
          return json(test);
        }

        case 'PUT /web/scrapeql': {
          const no = admin();
          if (no) return no;
          const b = await body(req);
          const client_id = str(b.client_id, 200);
          const client_secret = str(b.client_secret, 400);
          if (!client_id || !client_secret) return fail('Paste the Client ID and Client Secret.');
          const test = await a.testScrapeql({ client_id, client_secret });
          if (!test.ok) return fail(test.detail, 400, 'token_refused');
          await docs.write<TokenDoc>(APP_SCOPE, 'scrapeql', {
            client_id,
            client_secret,
            saved_at: Date.now(),
            test,
          });
          return status();
        }

        case 'DELETE /web/scrapeql': {
          const no = admin();
          if (no) return no;
          await docs.remove(APP_SCOPE, 'scrapeql');
          return status();
        }

        case 'POST /web/test': {
          const no = admin();
          if (no) return no;
          const d = await a.state.scrapeql();
          if (!d) return fail('No ScrapeQL token is set.', 404);
          const test = await a.testScrapeql(d);
          await docs.write<TokenDoc>(APP_SCOPE, 'scrapeql', { ...d, test });
          return json(test);
        }

        case 'POST /chat': {
          const b = (await body(req)) as Partial<AssistantMessage>;
          const message = typeof b.message === 'string' ? b.message.trim() : '';
          if (!message || message.length > MAX_MESSAGE)
            return fail(`Write a message of up to ${MAX_MESSAGE} characters.`);
          const msg: AssistantMessage = {
            message,
            ...(typeof b.chat_id === 'string' ? { chat_id: b.chat_id } : {}),
            ...(b.context && typeof b.context === 'object' ? { context: b.context } : {}),
            ...(Array.isArray(b.refs) ? { refs: b.refs.slice(0, 20) } : {}),
            ...(typeof b.tier === 'string' ? { tier: b.tier } : {}),
          };
          return new Response(a.turnStream(caller, msg, req.signal), {
            headers: {
              'content-type': 'text/event-stream',
              'cache-control': 'no-store',
              'x-accel-buffering': 'no',
            },
          });
        }

        case 'GET /chats':
          return json(await a.listChats(caller));
      }

      if (parts[0] === 'chats' && parts[1]) {
        const id = parts[1];
        if (parts.length === 2 && m === 'GET') {
          const chat = await a.readChat(caller, id);
          return chat ? json(chat) : fail('That chat is gone.', 404, 'not_found');
        }
        if (parts.length === 2 && m === 'DELETE') {
          await a.removeChat(caller, id);
          return json({ ok: true });
        }
        if (parts.length === 4 && parts[2] === 'drafts' && m === 'POST') {
          const action = (await body(req)).action;
          if (action !== 'save' && action !== 'dismiss') return fail('action is save or dismiss.');
          return json(await a.settleDraft(caller, id, parts[3] as string, action));
        }
      }
      return fail('Not found.', 404);
    } catch (err) {
      if (err instanceof AssistantError) return fail(err.message, err.status, err.code);
      console.error(
        JSON.stringify({
          event: 'assistant_route_error',
          route,
          error: String((err as Error)?.stack ?? err).slice(0, 2000),
        }),
      );
      return fail('Something went wrong.', 500);
    }
  };
}
