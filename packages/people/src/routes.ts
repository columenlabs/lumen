/**
 * The HTTP routes the People screens call (`peopleClient(url)` in `@columenlabs/lumen-ui/people`),
 * as one fetch handler on Web `Request`/`Response`, so it mounts in any router:
 *
 *   app.all('/api/people/*', (c) => people(c.req.raw));        // Hono
 *
 * Everything but `GET /me` and the invitee's `/invite/:token` routes needs an admin. Writes must
 * be same-origin JSON: a signed-in browser session is a cookie, so a foreign page's form or fetch
 * is refused before it reaches a rule.
 */
import {
  type BulkOp,
  type BulkResult,
  type Grant,
  type InviteInput,
  type InviteLink,
  type InviteResult,
  type PeopleView,
  type Person,
  type RemovePlan,
  type Scope,
  type SyncStatus,
  levelLabel,
  levelOf,
  normEmail,
} from '@columenlabs/lumen-ui-types/people';
import {
  type EmailOptions,
  checkResend,
  emailView,
  resolveDraft,
  storedMailer,
  testResend,
} from './email';
import { type InviteTemplate, type Mailer, inviteTemplate } from './mailer';
import type { Actor, InviteOutcome, PeopleService, Result } from './service';

type Awaitable<T> = T | Promise<T>;
type Methods =
  | 'list'
  | 'invite'
  | 'resend'
  | 'revoke'
  | 'update'
  | 'setAccess'
  | 'removable'
  | 'remove'
  | 'linkFor'
  | 'accept'
  | 'audit'
  | 'log';
/** The service's calls the routes make: the service itself, or a stub that forwards to it
 *  (a Durable Object that runs it). */
export type PeopleApi = { [K in Methods]: PeopleService[K] };

export interface PeopleRoutesOptions {
  /** Where the routes are mounted (`/api/people`). */
  base: string;
  /** The people service for this request. */
  people: (req: Request) => Awaitable<PeopleApi>;
  /** The verified caller, or null (403). The app decides who is an admin. */
  actor: (req: Request) => Awaitable<Actor | null>;
  /** The same scopes, link life and built-in admins the service was made with. */
  scopes: readonly Scope[];
  inviteDays?: number;
  fixedAdmins?: readonly string[];
  /** The app's name in the invite email. */
  appName: string;
  /** The page an invite link opens, with its token (`https://app.example.com/invite/<token>`). */
  link: (token: string, req: Request) => string;
  /** Sends an email; null or left out: no mail, every invite gives its link instead. */
  mailer?: (req: Request) => Awaitable<Mailer | null>;
  /** Shown beside Send in the invite drawer (`hello@example.com`). */
  mailFrom?: (req: Request) => Awaitable<string | undefined>;
  template?: InviteTemplate;
  /** What removing a person does in the app, shown before Remove (one line per app part). */
  removeSteps?: (person: Person, req: Request) => Awaitable<RemovePlan['steps']>;
  /** The app's own clean-up, before the person is dropped (delete their data). */
  onRemove?: (person: Person, req: Request) => Promise<void>;
  /** Email through a Resend-style API, set in the app's settings (`/email` routes); also the
   *  invites' mailer when `mailer` is left out. */
  email?: EmailOptions;
  /** Keeps an outside sign-in provider's allow list in step; run after every change to who may sign in. */
  sync?: {
    run: (req: Request, by: string) => Promise<SyncStatus>;
    status: (req: Request) => Promise<SyncStatus | null>;
  };
}

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (error: string, status = 400) => json({ error }, status);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const grantsIn = (v: unknown): Grant[] =>
  Array.isArray(v)
    ? v
        .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
        .map((g) => ({
          scope: String(g.scope ?? ''),
          level: String(g.level ?? ''),
          ...(typeof g.resource === 'string' && g.resource ? { resource: g.resource } : {}),
        }))
    : [];

export function peopleRoutes(o: PeopleRoutesOptions): (req: Request) => Promise<Response> {
  const base = o.base.replace(/\/+$/, '');
  const fixed = (o.fixedAdmins ?? []).map((e) => e.toLowerCase());
  const template = o.template ?? inviteTemplate;
  const email = o.email;
  const mailerFor = async (req: Request) =>
    o.mailer
      ? await o.mailer(req)
      : email
        ? ((await storedMailer(email, req))?.mailer ?? null)
        : null;
  const fromFor = async (req: Request) =>
    o.mailFrom ? await o.mailFrom(req) : email ? (await storedMailer(email, req))?.from : undefined;

  /** What the person gets, in words, for the email. */
  const accessText = (p: Person) =>
    p.role === 'admin'
      ? ['Admin on everything']
      : o.scopes
          .filter((s) => !s.parent)
          .map((s) => ({ s, l: levelOf(p, s, o.scopes) }))
          .filter(({ s, l }) => l !== (s.levels?.[0]?.id ?? 'none'))
          .map(({ s, l }) => `${s.name} (${levelLabel(s, l)})`);

  /** The link, and the email when a mailer is set up; a failed send never undoes the invite. */
  const deliver = async (
    req: Request,
    by: string,
    r: InviteOutcome,
    note?: string,
  ): Promise<InviteResult> => {
    const { token, ...rest } = r;
    if (!r.ok || !token || !r.person) return rest;
    const link = o.link(token, req);
    const mailer = await mailerFor(req);
    if (!mailer) return { ...rest, link, mail: { ok: false, detail: 'Email is not set up' } };
    const msg = template({
      to: r.email,
      appName: o.appName,
      inviter: by,
      url: link,
      access: accessText(r.person),
      expiresAt: r.person.expiresAt,
      note: note?.trim().slice(0, 500) || undefined,
    });
    let mail: InviteResult['mail'];
    try {
      mail = await mailer({ to: r.email, ...msg });
    } catch {
      mail = { ok: false, detail: 'The email could not be sent' };
    }
    return { ...rest, link, mail };
  };

  const sync = async (req: Request, by: string) => {
    if (!o.sync) return null;
    try {
      return await o.sync.run(req, by);
    } catch {
      return { configured: true, ok: false, detail: 'Sign-in sync failed', at: Date.now() };
    }
  };

  const out = <T>(r: Result<T>, extra: Record<string, unknown> = {}) =>
    r.ok ? json({ ...(r.value as object), ...extra }) : fail(r.error);

  return async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(base)) return fail('not_found', 404);
    const path = url.pathname.slice(base.length).replace(/\/+$/, '') || '/';
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const m = req.method;

    if (MUTATING.has(m)) {
      const origin = req.headers.get('origin');
      if (origin !== url.origin) return fail('forbidden_origin', 403);
      if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
        return fail('Use Content-Type: application/json.', 415);
    }

    const actor = await o.actor(req);
    if (!actor) return fail('forbidden', 403);
    const people = await o.people(req);
    const via = { ...actor, via: actor.via ?? 'app' };

    // The invitee's own routes: who the link is for, and accept it.
    if (parts[0] === 'invite' && parts[1]) {
      const token = parts[1];
      if (m === 'GET' && parts.length === 2) {
        const p = await people.linkFor(token);
        if (!p) return fail('This invite link is not valid any more.', 404);
        const link: InviteLink = {
          email: p.email,
          invitedBy: p.invitedBy,
          status: p.status,
          expiresAt: p.expiresAt,
          access: accessText(p),
          signedInAs: actor.email,
          appName: o.appName,
        };
        return json(link);
      }
      if (m === 'POST' && parts[2] === 'accept')
        return out(await people.accept(token, actor.email));
      return fail('not_found', 404);
    }
    if (m === 'GET' && parts[0] === 'me' && parts.length === 1)
      return json({ id: actor.email, email: actor.email, admin: actor.admin });

    if (!actor.admin) return fail('forbidden', 403);

    if (m === 'GET' && parts.length === 0) {
      const [list, from, mailer, status] = await Promise.all([
        people.list(),
        fromFor(req),
        mailerFor(req),
        o.sync?.status(req) ?? null,
      ]);
      const view: PeopleView = {
        me: { id: actor.email, email: actor.email, admin: true },
        people: list,
        scopes: [...o.scopes],
        inviteDays: o.inviteDays ?? 7,
        mail: { configured: !!mailer, ...(from ? { from } : {}) },
        sync: status,
        fixedAdmins: fixed,
      };
      return json(view);
    }

    if (m === 'GET' && parts[0] === 'audit' && parts.length === 1) {
      const n = (k: string) =>
        url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined;
      return json({
        events: await people.audit({
          since: n('since'),
          limit: n('limit'),
          target: url.searchParams.get('target') ?? undefined,
        }),
      });
    }

    if (m === 'POST' && parts[0] === 'sync' && parts.length === 1) {
      const s = await sync(req, actor.email);
      if (!s) return fail('No sign-in sync is set up.', 404);
      await people.log(via, {
        kind: 'sync',
        op: 'sync',
        target: 'Sign-in sync',
        detail: s.detail,
        ...(s.ok ? {} : { refused: s.detail }),
      });
      return json(s);
    }

    if (m === 'POST' && parts[0] === 'invites' && parts.length === 1) {
      const b = (await body(req)) as Partial<InviteInput>;
      const r = await people.invite(via, {
        emails: Array.isArray(b.emails) ? b.emails.map(String) : [],
        name: typeof b.name === 'string' ? b.name : undefined,
        role: b.role === 'admin' ? 'admin' : 'member',
        grants: grantsIn(b.grants),
        days: typeof b.days === 'number' ? b.days : undefined,
      });
      if (!r.ok) return fail(r.error);
      const note = typeof b.note === 'string' ? b.note : undefined;
      const results = await Promise.all(r.value.map((x) => deliver(req, actor.email, x, note)));
      const access = results.some((x) => x.ok) ? await sync(req, actor.email) : null;
      return json({ results, access }, 201);
    }

    if (m === 'POST' && parts[0] === 'bulk' && parts.length === 1) {
      const b = await body(req);
      const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 200) : [];
      const op = b.op as BulkOp | undefined;
      if (!op || typeof op !== 'object') return fail('Pick what to do.');
      const res: BulkResult = { done: [], failed: [] };
      for (const id of ids) {
        let r: Result<unknown>;
        if (op.op === 'access') r = await people.setAccess(via, id, grantsIn(op.grants));
        else if (op.op === 'role') r = await people.update(via, id, { role: op.role });
        else if (op.op === 'status') r = await people.update(via, id, { status: op.status });
        else if (op.op === 'resend') {
          const x = await people.resend(via, id);
          r = x.ok ? { ok: true, value: await deliver(req, actor.email, x.value) } : x;
        } else if (op.op === 'remove') {
          const pre = await people.removable(via, id);
          let cleaned = true;
          if (pre.ok)
            await o.onRemove?.(pre.value, req).catch(() => {
              cleaned = false;
            });
          r = !pre.ok
            ? pre
            : cleaned
              ? await people.remove(via, id)
              : {
                  ok: false,
                  error: 'The app could not delete their data, so nothing was removed.',
                };
        } else return fail('Unknown bulk action.');
        if (r.ok) res.done.push(id);
        else res.failed.push({ id, error: r.error });
      }
      const access = op.op === 'access' || op.op === 'role' ? null : await sync(req, actor.email);
      return json({ ...res, access });
    }

    if (parts[0] === 'email' && email) {
      if (m === 'GET' && parts.length === 1) return json(await emailView(email, req, actor.email));
      if (m === 'DELETE' && parts.length === 1) {
        await email.store.clear?.(req);
        await people.log(via, {
          kind: 'mail',
          op: 'clear',
          target: 'Email',
          detail: 'Email settings removed',
        });
        return json({ ok: true });
      }
      const draft = await body(req);
      const r = await resolveDraft(email, req, draft);
      if (!r.ok) return fail(r.error);
      if (m === 'POST' && (parts[1] === 'check' || parts[1] === 'test') && parts.length === 2) {
        const to = draft.testTo ? normEmail(draft.testTo) : actor.email;
        if (!to) return fail('Enter one email address to send the test to.');
        const res =
          parts[1] === 'check'
            ? await checkResend(r.config, r.where)
            : await testResend(r.config, r.where, to, o.appName);
        const t = { ...res, by: actor.email };
        await email.store.putTest?.(req, t);
        await people.log(via, {
          kind: 'mail',
          op: t.kind,
          target: 'Email',
          detail: `${t.kind === 'test' ? `Test email to ${to}` : 'Connection check'} ${t.ok ? 'passed' : 'failed'} · ${r.where}`,
          ...(t.ok ? {} : { refused: t.steps.find((s) => s.ok === false)?.text ?? 'failed' }),
        });
        return json(t);
      }
      if (m === 'PUT' && parts.length === 1) {
        // Saved only once it works: the server checks again rather than trusting the page.
        const t = await checkResend(r.config, r.where);
        if (!t.ok)
          return fail(t.steps.find((s) => s.ok === false)?.text ?? 'The check did not pass.');
        await email.store.put(req, r.settings, actor.email);
        await people.log(via, {
          kind: 'mail',
          op: 'save',
          target: 'Email',
          detail: `Email set to ${r.where} as ${r.settings.from}`,
        });
        return json(await emailView(email, req, actor.email));
      }
      return fail('not_found', 404);
    }

    const id = parts[0];
    if (!id) return fail('not_found', 404);

    if (m === 'PATCH' && parts.length === 1) {
      const b = await body(req);
      const r = await people.update(via, id, {
        ...(typeof b.name === 'string' ? { name: b.name } : {}),
        ...(b.role !== undefined ? { role: b.role as Person['role'] } : {}),
        ...(b.status !== undefined ? { status: b.status as 'active' | 'disabled' } : {}),
      });
      const access = r.ok && b.status !== undefined ? await sync(req, actor.email) : null;
      return r.ok ? json({ person: r.value, access }) : fail(r.error);
    }

    if (m === 'PUT' && parts[1] === 'access' && parts.length === 2) {
      const r = await people.setAccess(via, id, grantsIn((await body(req)).grants));
      return r.ok ? json({ person: r.value }) : fail(r.error);
    }

    if (m === 'POST' && parts[1] === 'resend' && parts.length === 2) {
      const r = await people.resend(via, id);
      if (!r.ok) return fail(r.error);
      const result = await deliver(req, actor.email, r.value);
      return json({ result, access: await sync(req, actor.email) });
    }

    if (m === 'POST' && parts[1] === 'revoke' && parts.length === 2) {
      const r = await people.revoke(via, id);
      return r.ok ? json({ ok: true, access: await sync(req, actor.email) }) : fail(r.error);
    }

    if (m === 'GET' && parts[1] === 'remove-plan' && parts.length === 2) {
      const r = await people.removable(via, id);
      if (!r.ok) return fail(r.error);
      const steps = [
        ...((await o.removeSteps?.(r.value, req)) ?? []),
        ...(o.sync ? [{ label: 'Sign-in provider', outcome: 'removed' }] : []),
        { label: 'People and access', outcome: 'removed' },
      ];
      const plan: RemovePlan = { person: r.value, steps };
      return json(plan);
    }

    if (m === 'DELETE' && parts.length === 1) {
      const pre = await people.removable(via, id);
      if (!pre.ok) {
        // Logged by remove(): the refusal goes through it.
        const r = await people.remove(via, id);
        return fail(r.ok ? 'Refused.' : r.error);
      }
      try {
        await o.onRemove?.(pre.value, req);
      } catch {
        return fail('The app could not delete their data, so nothing was removed.', 502);
      }
      const r = await people.remove(via, id);
      return r.ok ? json({ ok: true, access: await sync(req, actor.email) }) : fail(r.error);
    }

    return fail('not_found', 404);
  };
}
