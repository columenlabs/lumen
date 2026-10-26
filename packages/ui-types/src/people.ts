/**
 * People, access and invites: the shapes `@columenlabs/lumen-people` (server) and
 * `@columenlabs/lumen-ui/people` (screens) share, and the pure rules both read. No storage, no React.
 *
 * A scope is anything access is given on: an app, or a construct inside one (a folder, a
 * collection), each with its own ordered levels. A person holds one level per scope (and per
 * resource of a scope); no grant is the scope's lowest level. Admins hold the top level everywhere.
 */

export interface LevelDef {
  id: string;
  label: string;
  /** What the level allows, shown in the picker's (i) hover. */
  description?: string;
}

/** The levels a scope gets when it names none: lowest to highest, each includes the ones below. */
export const DEFAULT_LEVELS: readonly LevelDef[] = [
  { id: 'none', label: 'None', description: 'Cannot open it' },
  { id: 'view', label: 'View', description: 'See everything, change nothing' },
  { id: 'edit', label: 'Edit', description: 'Add and change their own work' },
  { id: 'admin', label: 'Admin', description: 'Everything, and the scope’s settings' },
];

export interface Scope {
  id: string;
  name: string;
  /** A lucide icon name the screens may map; the kit draws a dot without one. */
  icon?: string;
  /** A short line under the name. */
  description?: string;
  /** Lowest first. Left out: `DEFAULT_LEVELS`. */
  levels?: readonly LevelDef[];
  /** A construct inside another scope (an app's folders): grants name one of its resources. */
  parent?: string;
  /** What one resource is called ("Collection"). */
  resourceLabel?: string;
}

export interface Grant {
  scope: string;
  /** One resource of a construct scope (a folder's id); left out for an app-wide grant. */
  resource?: string;
  level: string;
}

export type Role = 'admin' | 'member';
/** `expired`: an invite past its life, refused at sign-in until resent. Worked out on read. */
export type PersonStatus = 'active' | 'invited' | 'expired' | 'disabled';

export interface Person {
  /** The normalised email: the one key. */
  id: string;
  email: string;
  name: string;
  role: Role;
  status: PersonStatus;
  grants: Grant[];
  invitedAt: number;
  invitedBy: string | null;
  /** When a pending invite stops letting them in; null once they signed in. */
  expiresAt: number | null;
  lastSeen: number | null;
}

/** Who is looking, as the screens need it. */
export interface PeopleMe {
  id: string;
  email: string;
  admin: boolean;
}

export type AuditKind = 'people' | 'access' | 'invite' | 'sync' | 'mail';

export interface AuditEvent {
  id: string;
  at: number;
  /** The actor's email, or `system`. */
  actor: string;
  kind: AuditKind;
  /** `invite`, `resend`, `revoke`, `accept`, `update`, `access`, `remove`, `sync`. */
  op: string;
  /** The person changed (an email), or what else was (`Sign-in sync`). */
  target: string;
  /** What changed, in words: `Tools View → Edit`. Never a password or an email body. */
  detail: string;
  /** Why it was refused; refusals are logged too. */
  refused?: string;
  /** Where it came from: `app`, `api`, `schedule`. */
  via: string;
}

export interface InviteInput {
  emails: string[];
  name?: string;
  role: Role;
  grants: Grant[];
  /** How long the link works; the server's default when left out. */
  days?: number;
  /** A line from the inviter, put in the email. */
  note?: string;
}

export interface MailOutcome {
  ok: boolean;
  detail: string;
}

export interface InviteResult {
  email: string;
  /** Invited (or re-sent). False: skipped, with why in `detail`. */
  ok: boolean;
  detail: string;
  person?: Person;
  /** The single-use link, to send by hand when the email did not go. */
  link?: string;
  mail?: MailOutcome;
}

/** What removing a person does, app by app, before it is done. */
export interface RemovePlan {
  person: Person;
  steps: { label: string; outcome: string }[];
}

export interface SyncStatus {
  configured: boolean;
  ok: boolean;
  detail: string;
  at: number | null;
}

/** Everything the People screens read in one call. */
export interface PeopleView {
  me: PeopleMe;
  people: Person[];
  scopes: Scope[];
  /** The invite link's life in days. */
  inviteDays: number;
  /** An email sender is set up: invites are emailed, else each gives a link. */
  mail: { configured: boolean; from?: string };
  sync: SyncStatus | null;
  /** Who can never lose admin (the built-in admin). */
  fixedAdmins: string[];
}

/** What an invite link opens: who it is for, from whom, and the access it gives. */
export interface InviteLink {
  email: string;
  invitedBy: string | null;
  status: PersonStatus;
  expiresAt: number | null;
  /** The access in words: `Tools (Edit)`. */
  access: string[];
  /** Who is signed in now; the link works only for its own email. */
  signedInAs: string;
  appName: string;
}

export type BulkOp =
  | { op: 'access'; grants: Grant[] }
  | { op: 'role'; role: Role }
  | { op: 'status'; status: 'active' | 'disabled' }
  | { op: 'resend' }
  | { op: 'remove' };

export interface BulkResult {
  done: string[];
  failed: { id: string; error: string }[];
}

export interface AuditQuery {
  since?: number;
  target?: string;
  limit?: number;
}

export const DAY_MS = 24 * 60 * 60_000;

export function levelsOf(scope: Pick<Scope, 'levels'> | undefined): readonly LevelDef[] {
  return scope?.levels?.length ? scope.levels : DEFAULT_LEVELS;
}

export function levelLabel(scope: Pick<Scope, 'levels'> | undefined, id: string): string {
  return levelsOf(scope).find((l) => l.id === id)?.label ?? id;
}

/** `a@B.com ` → `a@b.com`, or null for anything that is not one email. */
export function normEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Every email in pasted text (commas, spaces, new lines, `Name <a@b.com>`), once each. */
export function emailsIn(text: string): string[] {
  const out = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const e = normEmail(part.replace(/^<|>$/g, ''));
    if (e) out.add(e);
  }
  return [...out];
}

/** A pending invite past its life. */
export function inviteExpired(
  p: { status: string; expiresAt: number | null },
  now = Date.now(),
): boolean {
  return p.status === 'invited' && p.expiresAt !== null && p.expiresAt <= now;
}

/** The level a person holds on a scope (or one resource of it), as the server enforces it:
 *  disabled and expired people hold the lowest, admins the highest; a resource with no grant of
 *  its own takes the parent scope's level. */
export function levelOf(
  person: Pick<Person, 'role' | 'status' | 'grants'>,
  scope: Scope,
  scopes: readonly Scope[],
  resource?: string,
): string {
  const levels = levelsOf(scope);
  const low = levels[0]?.id ?? 'none';
  if (person.status === 'disabled' || person.status === 'expired') return low;
  if (person.role === 'admin') return levels[levels.length - 1]?.id ?? low;
  const own = person.grants.find(
    (g) => g.scope === scope.id && (g.resource ?? '') === (resource ?? ''),
  );
  if (own && levels.some((l) => l.id === own.level)) return own.level;
  if (scope.parent) {
    const parent = scopes.find((s) => s.id === scope.parent);
    // A construct with no grant of its own inherits through its parent, by rank.
    if (parent) {
      const at = levelsOf(parent).findIndex((l) => l.id === levelOf(person, parent, scopes));
      const mine = levels[Math.min(Math.max(at, 0), levels.length - 1)];
      return mine?.id ?? low;
    }
  }
  return low;
}

/** Whether `have` reaches `need` on this scope's ladder. */
export function atLeast(scope: Pick<Scope, 'levels'>, have: string, need: string): boolean {
  const ids = levelsOf(scope).map((l) => l.id);
  return ids.indexOf(have) >= ids.indexOf(need) && ids.includes(need);
}

/** Whether a person may use a scope at a level: the one check an app's routes call. */
export function can(
  person: Pick<Person, 'role' | 'status' | 'grants'> | null | undefined,
  scope: Scope,
  need: string,
  scopes: readonly Scope[],
  resource?: string,
): boolean {
  if (!person) return false;
  return atLeast(scope, levelOf(person, scope, scopes, resource), need);
}

/**
 * The one-admin floor: there is always one active admin, and the built-in admins always are.
 * Returns why a change is refused, or null.
 */
export function checkAdminFloor(
  people: readonly Pick<Person, 'id' | 'role' | 'status'>[],
  change: { id: string; role?: Role; status?: PersonStatus; remove?: boolean },
  fixedAdmins: readonly string[],
): string | null {
  const target = people.find((p) => p.id === change.id);
  if (!target) return 'No such person.';
  const losesAdmin =
    change.remove === true ||
    (change.role !== undefined && change.role !== 'admin') ||
    (change.status !== undefined && change.status !== 'active');
  if (!losesAdmin) return null;
  if (fixedAdmins.includes(target.id))
    return `${target.id} is the built-in admin and always stays one.`;
  if (target.role !== 'admin' || target.status !== 'active') return null;
  const others = people.filter(
    (p) => p.id !== target.id && p.role === 'admin' && p.status === 'active',
  );
  if (others.length === 0)
    return 'Someone must always be able to manage people. Make another person admin first.';
  return null;
}

/**
 * Email through a Resend-style API (`POST {url}/emails` with a Bearer key): Resend itself, or a
 * self-hosted server that speaks its API. A route is how the app reaches the server (the public
 * internet, or a private tunnel the app names); the key is sealed and never comes back.
 */
export interface EmailRoute {
  id: string;
  label: string;
  /** A short status on the right ("Connected"). */
  state?: string;
  /** The Server address field's (i): what the address means on this route. */
  urlInfo?: string;
  /** The address this route usually takes, shown as the placeholder and filled on pick. */
  url?: string;
}

/** The settings as saved, without the key. */
export interface EmailCurrent {
  route: string;
  url: string;
  /** The key's last 4 characters (`…9fT2`). */
  keyHint: string;
  from: string;
  fromName: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

/** One line of a check or test: reached the server, key accepted, sender allowed, sent. */
export interface EmailCheckStep {
  id: 'reach' | 'key' | 'sender' | 'send';
  /** null: could not tell (a server that does not list its senders). */
  ok: boolean | null;
  text: string;
  ms: number | null;
}

export interface EmailCheck {
  /** Every step that could be told passed. */
  ok: boolean;
  kind: 'check' | 'test';
  steps: EmailCheckStep[];
  at: number;
  by?: string;
}

export interface EmailSettingsView {
  routes: EmailRoute[];
  current: EmailCurrent | null;
  lastTest: EmailCheck | null;
  /** Where Send test goes: the signed-in admin. */
  me: string;
}

/** What the form sends: a key left empty keeps the saved one. */
export interface EmailDraft {
  route: string;
  url: string;
  apiKey?: string;
  from: string;
  fromName: string;
}
