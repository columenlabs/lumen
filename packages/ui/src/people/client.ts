// What the People screens call: an adapter an app fills, or `peopleClient(url)` over the routes of
// `@columenlabs/lumen-people` (`peopleRoutes`). A part left out hides its screen or button.
import type {
  AuditEvent,
  AuditQuery,
  BulkOp,
  BulkResult,
  EmailCheck,
  EmailDraft,
  EmailSettingsView,
  Grant,
  InviteInput,
  InviteLink,
  InviteResult,
  PeopleView,
  Person,
  RemovePlan,
  Role,
  SyncStatus,
} from '@columenlabs/lumen-ui-types/people';
import { apiJson } from '../api-fetch';

/** What a change did to the sign-in provider's allow list, when the app keeps one in step. */
export interface WithSync {
  access?: SyncStatus | null;
}

export interface PeopleAdapter {
  /** Names the cache its reads keep (two adapters on one page need two keys). */
  key: string;
  view(): Promise<PeopleView>;
  invite(input: InviteInput): Promise<{ results: InviteResult[] } & WithSync>;
  update(
    id: string,
    change: { name?: string; role?: Role; status?: 'active' | 'disabled' },
  ): Promise<{ person: Person } & WithSync>;
  setAccess(id: string, grants: Grant[]): Promise<{ person: Person } & WithSync>;
  resend(id: string): Promise<{ result: InviteResult } & WithSync>;
  revoke(id: string): Promise<WithSync>;
  removePlan(id: string): Promise<RemovePlan>;
  remove(id: string): Promise<WithSync>;
  /** One change over many people; without it the bulk bar runs them one by one. */
  bulk?(ids: string[], op: BulkOp): Promise<BulkResult & WithSync>;
  /** The audit log; without it the Audit page and a person's Recent activity hide. */
  audit?(q?: AuditQuery): Promise<{ events: AuditEvent[] }>;
  /** Rewrites the sign-in provider's allow list now. */
  sync?(): Promise<SyncStatus>;
  /** The resources of a construct scope (a scope with a `parent`), to grant one. */
  resources?(scope: string): Promise<{ id: string; name: string }[]>;
  /** Email through a Resend-style API (the Email settings section); left out, it hides. */
  email?: {
    view(): Promise<EmailSettingsView>;
    check(draft: EmailDraft): Promise<EmailCheck>;
    test(draft: EmailDraft): Promise<EmailCheck>;
    save(draft: EmailDraft): Promise<EmailSettingsView>;
    clear(): Promise<unknown>;
  };
  /** The invitee's side: what a link is for, and accepting it. */
  invitation?(token: string): Promise<InviteLink>;
  accept?(token: string): Promise<Person>;
}

/** The adapter over `peopleRoutes` mounted at `base` (`/api/people`). */
export function peopleClient(base: string): PeopleAdapter {
  const root = base.replace(/\/+$/, '');
  const at = (path: string) => `${root}${path}`;
  const id = (p: string) => encodeURIComponent(p);
  const send = <T>(method: string, path: string, body: unknown = {}) =>
    apiJson<T>(at(path), { method, body: JSON.stringify(body) }, 'people');
  const get = <T>(path: string) => apiJson<T>(at(path), {}, 'people');
  return {
    key: root,
    view: () => get('/'),
    invite: (input) => send('POST', '/invites', input),
    update: (p, change) => send('PATCH', `/${id(p)}`, change),
    setAccess: (p, grants) => send('PUT', `/${id(p)}/access`, { grants }),
    resend: (p) => send('POST', `/${id(p)}/resend`),
    revoke: (p) => send('POST', `/${id(p)}/revoke`),
    removePlan: (p) => get(`/${id(p)}/remove-plan`),
    remove: (p) => send('DELETE', `/${id(p)}`),
    bulk: (ids, op) => send('POST', '/bulk', { ids, op }),
    audit: (q = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
      const qs = params.toString();
      return get(`/audit${qs ? `?${qs}` : ''}`);
    },
    sync: () => send('POST', '/sync'),
    email: {
      view: () => get('/email'),
      check: (draft) => send('POST', '/email/check', draft),
      test: (draft) => send('POST', '/email/test', draft),
      save: (draft) => send('PUT', '/email', draft),
      clear: () => send('DELETE', '/email'),
    },
    invitation: (token) => get(`/invite/${id(token)}`),
    accept: (token) => send('POST', `/invite/${id(token)}/accept`),
  };
}
