import type {
  AuditEvent,
  EmailCheck,
  EmailSettingsView,
  PeopleView,
  Person,
  Scope,
} from '@columenlabs/lumen-ui-types/people';
import { LumenEmailSettings, LumenPeople, type PeopleAdapter } from '@columenlabs/lumen-ui/people';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SampleShell } from '../frame';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 26, 17);
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const SCOPES: Scope[] = [
  { id: 'docs', name: 'Docs', icon: 'file-text', description: 'Shared documents' },
  { id: 'reports', name: 'Reports', icon: 'chart-line', description: 'Dashboards and exports' },
  { id: 'billing', name: 'Billing', icon: 'credit-card', description: 'Invoices and plans' },
];

const person = (
  id: string,
  name: string,
  p: Partial<Person> & Pick<Person, 'role' | 'status' | 'grants'>,
): Person => ({
  id,
  email: `${id}@example.com`,
  name,
  invitedAt: NOW - 40 * DAY,
  invitedBy: 'ada@example.com',
  expiresAt: null,
  lastSeen: NOW - 2 * 3_600_000,
  ...p,
});

const PEOPLE: Person[] = [
  person('ada', 'Ada Park', { role: 'admin', status: 'active', grants: [], invitedBy: null }),
  person('sam', 'Sam Ortiz', {
    role: 'member',
    status: 'active',
    grants: [
      { scope: 'docs', level: 'edit' },
      { scope: 'reports', level: 'view' },
    ],
  }),
  person('lee', 'Lee Chen', {
    role: 'member',
    status: 'active',
    grants: [{ scope: 'reports', level: 'admin' }],
    lastSeen: NOW - 5 * DAY,
  }),
  person('kim', '', {
    role: 'member',
    status: 'invited',
    grants: [{ scope: 'docs', level: 'view' }],
    invitedAt: NOW - DAY,
    expiresAt: NOW + 6 * DAY,
    lastSeen: null,
  }),
  person('rio', '', {
    role: 'member',
    status: 'expired',
    grants: [{ scope: 'billing', level: 'view' }],
    invitedAt: NOW - 12 * DAY,
    expiresAt: NOW - 5 * DAY,
    lastSeen: null,
  }),
  person('max', 'Max Ito', {
    role: 'member',
    status: 'disabled',
    grants: [{ scope: 'docs', level: 'edit' }],
    lastSeen: NOW - 30 * DAY,
  }),
];

const AUDIT: AuditEvent[] = [
  {
    id: '1',
    at: NOW - 3_600_000,
    actor: 'ada@example.com',
    kind: 'access',
    op: 'set',
    target: 'sam@example.com',
    detail: 'Docs: View → Edit',
    via: 'app',
  },
  {
    id: '2',
    at: NOW - DAY,
    actor: 'ada@example.com',
    kind: 'invite',
    op: 'invite',
    target: 'kim@example.com',
    detail: 'Docs (View), link for 7 days',
    via: 'app',
  },
  {
    id: '3',
    at: NOW - DAY - 600_000,
    actor: 'lee@example.com',
    kind: 'people',
    op: 'role',
    target: 'ada@example.com',
    detail: 'Admin → Member',
    refused: 'The last admin stays an admin',
    via: 'app',
  },
];

const ROUTES: EmailSettingsView['routes'] = [
  {
    id: 'tunnel',
    label: 'Private tunnel',
    state: 'Connected',
    url: 'http://localhost:5000/api',
    urlInfo: 'As seen from the tunnel’s machine, so localhost is that machine itself.',
  },
  { id: 'public', label: 'Public internet', url: 'https://api.resend.com' },
];

function mockAdapter(opts: { mail: boolean }): PeopleAdapter {
  let people = PEOPLE.map((p) => ({ ...p }));
  let email: EmailSettingsView = {
    routes: ROUTES,
    current: opts.mail
      ? {
          route: 'tunnel',
          url: 'http://localhost:5000/api',
          keyHint: '…f3a9',
          from: 'hello@example.com',
          fromName: 'Example',
          updatedAt: NOW - 3 * DAY,
          updatedBy: 'ada@example.com',
        }
      : null,
    lastTest: null,
    me: 'ada@example.com',
  };
  const view = (): PeopleView => ({
    me: { id: 'ada', email: 'ada@example.com', admin: true },
    people,
    scopes: SCOPES,
    inviteDays: 7,
    mail: { configured: !!email.current, from: email.current?.from },
    sync: { configured: true, ok: true, detail: 'Allow list has 4 emails', at: NOW - 600_000 },
    fixedAdmins: ['ada@example.com'],
  });
  const patch = (id: string, change: Partial<Person>) => {
    people = people.map((p) => (p.id === id ? { ...p, ...change } : p));
    return people.find((p) => p.id === id) as Person;
  };
  const check = (kind: 'check' | 'test'): EmailCheck => ({
    ok: true,
    kind,
    at: Date.now(),
    steps:
      kind === 'check'
        ? [
            { id: 'reach', ok: true, text: 'Reached localhost:5000', ms: 42 },
            { id: 'key', ok: true, text: 'API key accepted', ms: null },
            {
              id: 'sender',
              ok: null,
              text: 'hello@example.com: this server does not list its senders, so Send test confirms it',
              ms: 18,
            },
          ]
        : [
            { id: 'reach', ok: true, text: 'Reached localhost:5000', ms: null },
            { id: 'key', ok: true, text: 'API key accepted', ms: null },
            { id: 'send', ok: true, text: 'Sent to ada@example.com · check the inbox', ms: 380 },
          ],
  });
  return {
    key: `story-people-${opts.mail}`,
    view: async () => view(),
    invite: async (input) => {
      await wait();
      const results = input.emails.map((e) => {
        const p = person(e.split('@')[0] ?? e, input.name ?? '', {
          email: e,
          role: input.role,
          status: 'invited',
          grants: input.grants,
          invitedAt: Date.now(),
          expiresAt: Date.now() + (input.days ?? 7) * DAY,
          lastSeen: null,
        });
        people = [...people, p];
        return {
          email: e,
          ok: true,
          detail: email.current ? `Emailed ${e}` : 'Send them the link',
          person: p,
          link: `https://app.example.com/invite/${p.id}-sample`,
          mail: email.current ? { ok: true, detail: `Emailed ${e}` } : undefined,
        };
      });
      return { results };
    },
    update: async (id, change) => ({ person: patch(id, change) }),
    setAccess: async (id, grants) => ({ person: patch(id, { grants }) }),
    resend: async (id) => {
      const p = patch(id, { status: 'invited', expiresAt: Date.now() + 7 * DAY });
      return {
        result: {
          email: p.email,
          ok: true,
          detail: 'Sent again',
          person: p,
          link: `https://app.example.com/invite/${id}-sample`,
        },
      };
    },
    revoke: async (id) => {
      people = people.filter((p) => p.id !== id);
      return {};
    },
    removePlan: async (id) => ({
      person: people.find((p) => p.id === id) as Person,
      steps: [
        { label: 'Their saved data', outcome: 'Deleted' },
        { label: 'Sign-in allow list', outcome: 'Removed' },
      ],
    }),
    remove: async (id) => {
      people = people.filter((p) => p.id !== id);
      return {};
    },
    audit: async () => ({ events: AUDIT }),
    email: {
      view: async () => email,
      check: async () => {
        await wait(600);
        return check('check');
      },
      test: async () => {
        await wait(900);
        return check('test');
      },
      save: async (d) => {
        email = {
          ...email,
          current: {
            route: d.route,
            url: d.url,
            keyHint: d.apiKey ? `…${d.apiKey.slice(-4)}` : (email.current?.keyHint ?? ''),
            from: d.from,
            fromName: d.fromName,
            updatedAt: Date.now(),
            updatedBy: 'ada@example.com',
          },
        };
        return email;
      },
      clear: async () => {
        email = { ...email, current: null };
        return {};
      },
    },
  };
}

/**
 * People and access for any app: who is in, what each can open, invites and the audit log. The
 * screens call a `PeopleAdapter`; `peopleClient('/api/people')` is one over the routes of
 * `@columenlabs/lumen-people`. These stories run on an in-memory adapter.
 */
const meta: Meta<typeof LumenPeople> = {
  title: 'Blocks/People',
  component: LumenPeople,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof LumenPeople>;

function Live({ mail }: { mail: boolean }) {
  const [adapter] = useState(() => mockAdapter({ mail }));
  return (
    <SampleShell>
      <LumenPeople adapter={adapter} />
    </SampleShell>
  );
}

export const People: Story = { render: () => <Live mail /> };

/** No email set up: invites give a link to send by hand, and the page says so. */
export const NoEmail: Story = { render: () => <Live mail={false} /> };

/** Email · Resend-compatible API: how the server is reached, its sealed key, the sender, then a check
 *  or test. Save waits until one passes. */
export const Email: StoryObj<typeof LumenEmailSettings> = {
  render: () => {
    const [adapter] = useState(() => mockAdapter({ mail: false }));
    return (
      <div className="mx-auto max-w-2xl p-4">
        <LumenEmailSettings adapter={adapter} inline />
      </div>
    );
  },
};
