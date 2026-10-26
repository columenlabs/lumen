/**
 * The people rules over a store: who may do what, the one-admin floor, invites with
 * single-use links, and an audit row for every change and every refusal. The rules live here,
 * never in an app, so a script or a token gets the same answers the screens do.
 *
 * Run it where writes are serialised (a Durable Object, or one database transaction per call)
 * so the floor check and the write it guards cannot interleave with another admin's.
 */
import {
  type AuditEvent,
  type AuditQuery,
  DAY_MS,
  type Grant,
  type InviteInput,
  type Person,
  type Role,
  type Scope,
  checkAdminFloor,
  inviteExpired,
  levelLabel,
  levelOf,
  levelsOf,
  normEmail,
} from '@columenlabs/lumen-ui-types/people';
import type { PeopleStore, StoredPerson } from './store';

/** Who is asking: their verified email and whether they manage people. */
export interface Actor {
  email: string;
  admin: boolean;
  /** Where the call came from, for the audit log: `app` (default), `api`, `schedule`. */
  via?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** One email's invite: the raw link token is returned once, to build the link; only its hash is kept. */
export interface InviteOutcome {
  email: string;
  ok: boolean;
  detail: string;
  person?: Person;
  token?: string;
}

export interface PeopleOptions {
  store: PeopleStore;
  scopes: readonly Scope[];
  /** Emails that are always active admins (an app's built-in admin). */
  fixedAdmins?: readonly string[];
  /** How long an invite link works, in days (7). */
  inviteDays?: number;
  /** A pending invite turns active when that email signs in, link or not (true). */
  acceptOnSignIn?: boolean;
  now?: () => number;
}

const SEEN_EVERY_MS = 5 * 60_000;
const MAX_INVITES = 50;

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export type PeopleService = ReturnType<typeof createPeople>;

export function createPeople(opts: PeopleOptions) {
  const { store, scopes } = opts;
  const fixed = (opts.fixedAdmins ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const days = opts.inviteDays ?? 7;
  const now = opts.now ?? Date.now;
  const scopeOf = (id: string) => scopes.find((s) => s.id === id);

  const toPerson = (p: StoredPerson, grants: Grant[]): Person => {
    const expiresAt =
      p.status === 'invited' ? (p.expires_at ?? p.invited_at + days * DAY_MS) : null;
    const status = inviteExpired({ status: p.status, expiresAt }, now()) ? 'expired' : p.status;
    return {
      id: p.email,
      email: p.email,
      name: p.name,
      role: p.role,
      status,
      grants,
      invitedAt: p.invited_at,
      invitedBy: p.invited_by,
      expiresAt,
      lastSeen: p.last_seen,
    };
  };

  /** The built-in admins exist and are active admins before any read or write. */
  const ensureFixed = async () => {
    for (const email of fixed) {
      const p = await store.get(email);
      if (!p)
        await store.insert({
          email,
          name: email.split('@')[0] ?? email,
          role: 'admin',
          status: 'active',
          invited_at: now(),
          invited_by: null,
          expires_at: null,
          last_seen: null,
        });
      else if (p.role !== 'admin' || p.status !== 'active')
        await store.patch(email, { role: 'admin', status: 'active', expires_at: null });
    }
  };

  const everyone = async (): Promise<Person[]> => {
    await ensureFixed();
    const [rows, grants] = await Promise.all([store.all(), store.grants()]);
    return rows.map((p) => toPerson(p, grants.get(p.email) ?? []));
  };

  const one = async (raw: string): Promise<Person | null> => {
    const email = normEmail(raw);
    if (!email) return null;
    return (await everyone()).find((p) => p.id === email) ?? null;
  };

  const log = (actor: Actor | 'system', e: Omit<AuditEvent, 'id' | 'at' | 'actor' | 'via'>) =>
    store.log({
      ...e,
      at: now(),
      actor: actor === 'system' ? 'system' : actor.email,
      via: actor === 'system' ? 'system' : (actor.via ?? 'app'),
    });

  /** Logs the refusal and returns it. */
  const refuse = async <T>(
    actor: Actor,
    e: Omit<AuditEvent, 'id' | 'at' | 'actor' | 'via' | 'refused'>,
    why: string,
  ): Promise<Result<T>> => {
    await log(actor, { ...e, refused: why });
    return { ok: false, error: why };
  };

  /** A grant names a known scope and one of its levels. */
  const checkGrant = (g: Grant): string | null => {
    const s = scopeOf(g.scope);
    if (!s) return `No such scope: ${g.scope}.`;
    if (!levelsOf(s).some((l) => l.id === g.level)) return `${s.name} has no level ${g.level}.`;
    if (g.resource !== undefined && !s.parent) return `${s.name} has no resources.`;
    return null;
  };

  const lowest = (g: Grant) => levelsOf(scopeOf(g.scope))[0]?.id === g.level;

  const describeGrant = (before: Person | null, g: Grant) => {
    const s = scopeOf(g.scope);
    const name = `${s?.name ?? g.scope}${g.resource ? ` › ${g.resource}` : ''}`;
    const was = before && s ? levelLabel(s, levelOf(before, s, scopes, g.resource)) : null;
    return `${name} ${was ? `${was} → ` : ''}${levelLabel(s, g.level)}`;
  };

  const issueLink = async (email: string, expiresAt: number) => {
    const token = newToken();
    await store.putLink(email, await sha256(token), expiresAt);
    return token;
  };

  return {
    scopes,
    inviteDays: days,
    fixedAdmins: fixed,

    async list(): Promise<Person[]> {
      return everyone();
    },

    async get(id: string): Promise<Person | null> {
      return one(id);
    },

    /**
     * The person behind a verified sign-in, or null when they may not come in (unknown, expired,
     * disabled come back as they are so the app can tell why). Notes when they were last seen and,
     * with `acceptOnSignIn`, turns a pending invite active.
     */
    async seen(raw: string): Promise<Person | null> {
      const p = await one(raw);
      if (!p) return null;
      const t = now();
      if (p.status === 'invited' && opts.acceptOnSignIn !== false) {
        await store.patch(p.id, { status: 'active', last_seen: t, expires_at: null });
        await store.dropLinks(p.id);
        await log(
          { email: p.id, admin: false, via: 'sign-in' },
          { kind: 'invite', op: 'accept', target: p.id, detail: 'Signed in: invite accepted' },
        );
        return { ...p, status: 'active', lastSeen: t, expiresAt: null };
      }
      if (p.status === 'active' && (p.lastSeen ?? 0) < t - SEEN_EVERY_MS)
        await store.patch(p.id, { last_seen: t });
      return p;
    },

    /** Emails a sign-in provider should let in: everyone not disabled and not expired. */
    async allowedEmails(): Promise<string[]> {
      return (await everyone())
        .filter((p) => p.status === 'active' || p.status === 'invited')
        .map((p) => p.id);
    },

    async invite(actor: Actor, input: InviteInput): Promise<Result<InviteOutcome[]>> {
      const base = { kind: 'invite' as const, op: 'invite', detail: 'Invite' };
      if (!actor.admin) return refuse(actor, { ...base, target: '—' }, 'Only admins can invite.');
      const role: Role = input.role === 'admin' ? 'admin' : 'member';
      const grants = role === 'admin' ? [] : (input.grants ?? []);
      for (const g of grants) {
        const bad = checkGrant(g);
        if (bad) return refuse(actor, { ...base, target: '—' }, bad);
      }
      const life = Math.min(Math.max(Math.round(input.days ?? days), 1), 30);
      const raw = [...new Set(input.emails ?? [])];
      if (!raw.length) return { ok: false, error: 'Enter at least one email.' };
      if (raw.length > MAX_INVITES)
        return { ok: false, error: `At most ${MAX_INVITES} invites at once.` };
      const all = await everyone();
      const out: InviteOutcome[] = [];
      for (const r of raw) {
        const email = normEmail(r);
        if (!email) {
          out.push({ email: String(r), ok: false, detail: 'Not an email address.' });
          continue;
        }
        const had = all.find((p) => p.id === email);
        if (had) {
          out.push({
            email,
            ok: false,
            detail:
              had.status === 'invited' || had.status === 'expired'
                ? 'Already invited: resend it instead.'
                : 'Already a member.',
          });
          continue;
        }
        const t = now();
        const expires = t + life * DAY_MS;
        const name = (raw.length === 1 ? input.name?.trim() : '') || (email.split('@')[0] ?? email);
        await store.insert({
          email,
          name: name.slice(0, 60),
          role,
          status: 'invited',
          invited_at: t,
          invited_by: actor.email,
          expires_at: expires,
          last_seen: null,
        });
        for (const g of grants) await store.setGrant(email, g, lowest(g));
        const token = await issueLink(email, expires);
        const detail = [
          role === 'admin' ? 'Admin' : 'Member',
          ...grants.filter((g) => !lowest(g)).map((g) => describeGrant(null, g)),
        ].join(' · ');
        await log(actor, {
          kind: 'invite',
          op: 'invite',
          target: email,
          detail: `Invited: ${detail}`,
        });
        const person = (await one(email)) ?? undefined;
        out.push({
          email,
          ok: true,
          detail: `Invited until ${new Date(expires).toISOString().slice(0, 10)}`,
          person,
          token,
        });
      }
      return { ok: true, value: out };
    },

    /** A pending or expired invite: a new link, the old one stops working, the clock restarts. */
    async resend(actor: Actor, id: string, inviteDays?: number): Promise<Result<InviteOutcome>> {
      const p = await one(id);
      const base = { kind: 'invite' as const, op: 'resend', target: p?.id ?? id, detail: 'Resend' };
      if (!actor.admin) return refuse(actor, base, 'Only admins can resend invites.');
      if (!p) return { ok: false, error: 'No such person.' };
      if (p.status !== 'invited' && p.status !== 'expired')
        return refuse(actor, base, `${p.id} has already signed in or is disabled.`);
      const t = now();
      const expires = t + Math.min(Math.max(Math.round(inviteDays ?? days), 1), 30) * DAY_MS;
      await store.patch(p.id, { invited_at: t, expires_at: expires, status: 'invited' });
      const token = await issueLink(p.id, expires);
      await log(actor, { ...base, detail: 'New link, clock restarted' });
      return {
        ok: true,
        value: {
          email: p.id,
          ok: true,
          detail: 'Invite renewed',
          person: (await one(p.id)) ?? p,
          token,
        },
      };
    },

    /** Takes back a pending invite: the person and their link go at once. */
    async revoke(actor: Actor, id: string): Promise<Result<null>> {
      const p = await one(id);
      const base = { kind: 'invite' as const, op: 'revoke', target: p?.id ?? id, detail: 'Revoke' };
      if (!actor.admin) return refuse(actor, base, 'Only admins can revoke invites.');
      if (!p) return { ok: false, error: 'No such person.' };
      if (p.status !== 'invited' && p.status !== 'expired')
        return refuse(actor, base, `${p.id} already signed in: remove them instead.`);
      await store.remove(p.id);
      await log(actor, { ...base, detail: 'Invite revoked' });
      return { ok: true, value: null };
    },

    async update(
      actor: Actor,
      id: string,
      change: { name?: string; role?: Role; status?: 'active' | 'disabled' },
    ): Promise<Result<Person>> {
      const all = await everyone();
      const p = all.find((x) => x.id === normEmail(id));
      const what = [
        change.role ? `Role ${p?.role ?? '?'} → ${change.role}` : null,
        change.status ? (change.status === 'disabled' ? 'Disabled' : 'Enabled') : null,
        change.name !== undefined ? `Renamed to ${change.name.trim()}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const base = {
        kind: 'people' as const,
        op: 'update',
        target: p?.id ?? id,
        detail: what || 'Update',
      };
      if (!actor.admin) return refuse(actor, base, 'Only admins can change people.');
      if (!p) return { ok: false, error: 'No such person.' };
      if (change.role !== undefined && change.role !== 'admin' && change.role !== 'member')
        return { ok: false, error: 'Role must be admin or member.' };
      if (change.status !== undefined && change.status !== 'active' && change.status !== 'disabled')
        return { ok: false, error: 'Status must be active or disabled.' };
      if (change.status === 'active' && p.status !== 'disabled')
        return { ok: false, error: 'Only a disabled person can be enabled.' };
      const floor = checkAdminFloor(all, { id: p.id, ...change }, fixed);
      if (floor) return refuse(actor, base, floor);
      const patch: Partial<StoredPerson> = {};
      if (change.role) patch.role = change.role;
      if (change.status) patch.status = change.status;
      if (change.name?.trim()) patch.name = change.name.trim().slice(0, 60);
      await store.patch(p.id, patch);
      await log(actor, base);
      return { ok: true, value: (await one(p.id)) ?? p };
    },

    /** Sets levels on scopes (or resources); the lowest level removes the grant. */
    async setAccess(actor: Actor, id: string, grants: Grant[]): Promise<Result<Person>> {
      const p = await one(id);
      const target = p?.id ?? id;
      const detail = grants.map((g) => describeGrant(p, g)).join(' · ') || 'Access';
      const base = { kind: 'access' as const, op: 'access', target, detail };
      if (!actor.admin) return refuse(actor, base, 'Only admins can change access.');
      if (!p) return { ok: false, error: 'No such person.' };
      for (const g of grants) {
        const bad = checkGrant(g);
        if (bad) return refuse(actor, base, bad);
      }
      for (const g of grants) await store.setGrant(p.id, g, lowest(g));
      await log(actor, base);
      return { ok: true, value: (await one(p.id)) ?? p };
    },

    /** Whether the person may be removed, before anything is done. */
    async removable(actor: Actor, id: string): Promise<Result<Person>> {
      const all = await everyone();
      const p = all.find((x) => x.id === normEmail(id));
      if (!actor.admin) return { ok: false, error: 'Only admins can remove people.' };
      if (!p) return { ok: false, error: 'No such person.' };
      const floor = checkAdminFloor(all, { id: p.id, remove: true }, fixed);
      return floor ? { ok: false, error: floor } : { ok: true, value: p };
    },

    /** Drops the person (call the app's own clean-up first). */
    async remove(actor: Actor, id: string, detail = 'Removed'): Promise<Result<Person>> {
      const all = await everyone();
      const p = all.find((x) => x.id === normEmail(id));
      const base = { kind: 'people' as const, op: 'remove', target: p?.id ?? id, detail };
      if (!actor.admin) return refuse(actor, base, 'Only admins can remove people.');
      if (!p) return { ok: false, error: 'No such person.' };
      const floor = checkAdminFloor(all, { id: p.id, remove: true }, fixed);
      if (floor) return refuse(actor, base, floor);
      await store.remove(p.id);
      await log(actor, base);
      return { ok: true, value: p };
    },

    /** Who an invite link is for, without using it. */
    async linkFor(token: string): Promise<Person | null> {
      const row = await store.linkEmail(await sha256(token));
      return row ? one(row.email) : null;
    },

    /** Uses an invite link: only the invited email, signed in, before it expires. Single use. */
    async accept(token: string, signedInAs: string): Promise<Result<Person>> {
      const row = await store.linkEmail(await sha256(token));
      if (!row) return { ok: false, error: 'This invite link is not valid any more.' };
      const p = await one(row.email);
      if (!p) return { ok: false, error: 'This invite was revoked.' };
      if (p.status === 'expired' || row.expires_at <= now())
        return { ok: false, error: 'This invite expired.' };
      const me = normEmail(signedInAs);
      if (me !== p.id) return { ok: false, error: `This invite is for ${p.id}.` };
      if (p.status === 'invited')
        await store.patch(p.id, { status: 'active', last_seen: now(), expires_at: null });
      await store.dropLinks(p.id);
      await log(
        { email: p.id, admin: false, via: 'link' },
        { kind: 'invite', op: 'accept', target: p.id, detail: 'Invite accepted' },
      );
      return { ok: true, value: (await one(p.id)) ?? p };
    },

    audit(q: AuditQuery): Promise<AuditEvent[]> {
      return store.audit(q);
    },

    /** Logs something the app did around people (a sign-in sync, a mail that failed). */
    log(actor: Actor | 'system', e: Omit<AuditEvent, 'id' | 'at' | 'actor' | 'via'>) {
      return log(actor, e);
    },
  };
}
