// The People block's other pages: Invites (pending and expired, Resend and Revoke), Permissions
// (each scope's levels and who holds what) and the Audit log.
import {
  type AuditEvent,
  type Person,
  levelLabel,
  levelOf,
  levelsOf,
} from '@columenlabs/lumen-ui-types/people';
import { useQuery } from '@tanstack/react-query';
import {
  AppWindowIcon,
  CircleDotIcon,
  ClockIcon,
  GitForkIcon,
  ListOrderedIcon,
  MailIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  TagIcon,
  TextIcon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { LumenLayout } from '../lumen-layout';
import { LumenSelector } from '../lumen-selector';
import { useLumenLoad } from '../lumen-source';
import { Tile, TileRow } from '../tile';
import { Button } from '../ui/button';
import type { ViewDomain } from '../view-model';
import { CopyLink } from './invite-drawer';
import {
  LevelPicker,
  type PeopleFrame,
  STATUS_LABEL,
  fromNow,
  peopleView,
  statusTone,
  topScopes,
  usePeopleAction,
  usePeopleQuery,
  useVisitView,
  when,
  withGrant,
} from './shared';

const INVITES_VIEW = peopleView('Invites', {
  columns: ['email', 'access', 'invited_by', 'sent', 'status', 'expires', 'actions'],
  chips: [{ key: 'status' }],
  filters: { fields: ['status', 'invited_by'], default: [] },
  group: { fields: ['status', 'invited_by'], default: null },
  pagination: { on: true, size: 50 },
  total: false,
  cards: [{ id: 'invites', kind: 'table', w: 6, title: null }],
});

export function InvitesSection({ frame }: { frame: PeopleFrame }) {
  const { adapter, view } = frame;
  const load = useLumenLoad(usePeopleQuery(adapter));
  const act = usePeopleAction(adapter);
  const layout = useVisitView(INVITES_VIEW);
  const [links, setLinks] = useState<Record<string, string>>({});
  const rows = view.people.filter((p) => p.status === 'invited' || p.status === 'expired');
  const expired = rows.filter((p) => p.status === 'expired');
  const next = rows
    .filter((p) => p.status === 'invited' && p.expiresAt)
    .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0))[0];
  const tops = topScopes(view.scopes);

  const resend = async (p: Person) => {
    const r = await act(() => adapter.resend(p.id), `New invite for ${p.email}`);
    const link = r?.result.link;
    if (link && !r?.result.mail?.ok) setLinks((l) => ({ ...l, [p.id]: link }));
  };

  const domain: ViewDomain<Person> = {
    id: 'invites',
    rowKey: (p) => p.id,
    text: (p) => [p.email, p.name],
    fields: [
      { key: 'email', label: 'Email', icon: MailIcon, value: (p) => p.email, format: 'text' },
      {
        key: 'access',
        label: 'Access',
        icon: AppWindowIcon,
        value: (p) =>
          p.role === 'admin'
            ? 'Admin'
            : tops
                .filter((s) => levelOf(p, s, view.scopes) !== levelsOf(s)[0]?.id)
                .map((s) => `${s.name} ${levelLabel(s, levelOf(p, s, view.scopes))}`)
                .join(', ') || 'None',
        format: 'text',
        maxWidth: '16rem',
      },
      {
        key: 'invited_by',
        label: 'Invited by',
        icon: UserRoundIcon,
        value: (p) => p.invitedBy ?? '—',
        format: 'text',
        filterable: true,
        groupable: true,
      },
      {
        key: 'sent',
        label: 'Sent',
        icon: ClockIcon,
        value: (p) => when(p.invitedAt),
        format: 'text',
      },
      {
        key: 'status',
        label: 'Status',
        icon: CircleDotIcon,
        value: (p) => STATUS_LABEL[p.status],
        tone: statusTone,
        format: 'text',
        filterable: true,
        groupable: true,
      },
      {
        key: 'expires',
        label: 'Expires',
        icon: ClockIcon,
        value: (p) =>
          p.status === 'expired' ? `expired ${when(p.expiresAt)}` : fromNow(p.expiresAt),
        format: 'text',
      },
      {
        key: 'actions',
        label: 'Actions',
        icon: RotateCwIcon,
        value: () => '',
        render: (p) => (
          <span
            className="flex gap-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Button size="xs" variant="outline" onClick={() => resend(p)}>
              <RotateCwIcon /> Resend
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => act(() => adapter.revoke(p.id), `Revoked the invite for ${p.email}`)}
            >
              <XIcon /> Revoke
            </Button>
          </span>
        ),
        format: 'text',
        maxWidth: false,
      },
    ],
  };

  const shownLinks = Object.entries(links).filter(([id]) => rows.some((p) => p.id === id));
  return (
    <LumenLayout<Person>
      crumbs={frame.crumbs}
      actions={
        <>
          {expired.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                for (const p of expired) await resend(p);
              }}
            >
              <RotateCwIcon /> Resend all expired
            </Button>
          )}
          {frame.invite}
        </>
      }
      intro={
        <div className="flex flex-col gap-3">
          {frame.tabs}
          <TileRow fill aria-label="Invites at a glance">
            <Tile
              label="Pending"
              value={rows.length - expired.length}
              caption={next ? `next expires ${fromNow(next.expiresAt)}` : 'none waiting'}
            />
            <Tile label="Expired" value={expired.length} caption="refused at sign-in" />
            <Tile label="Link life" value={`${view.inviteDays} d`} caption="Resend restarts it" />
          </TileRow>
          {frame.mailNote}
          {shownLinks.map(([id, link]) => (
            <div key={id} className="flex flex-col gap-1 text-sm">
              <span>
                The email to <span className="font-medium">{id}</span> did not go. Send the link
                another way:
              </span>
              <CopyLink link={link} />
            </div>
          ))}
        </div>
      }
      domain={domain}
      {...layout}
      rows={rows}
      load={load}
      state={
        rows.length ? undefined : (
          <p className="p-6 text-center text-muted-foreground text-sm">No invites waiting.</p>
        )
      }
      rowTitle={(p) => p.email}
    />
  );
}

/** One row per person (or per person and resource on a construct): their level and where it comes from. */
interface Holding {
  key: string;
  person: Person;
  resource?: string;
  from: string;
}

const PERMISSIONS_VIEW = peopleView('Permissions', {
  columns: ['name', 'resource', 'level', 'from'],
  chips: [{ key: 'from' }],
  filters: { fields: ['from', 'level'], default: [] },
  group: { fields: ['from', 'level'], default: null },
  pagination: { on: true, size: 50 },
  total: false,
  cards: [{ id: 'holdings', kind: 'table', w: 6, title: 'Who has what' }],
});

export function PermissionsSection({ frame }: { frame: PeopleFrame }) {
  const { adapter, view } = frame;
  const load = useLumenLoad(usePeopleQuery(adapter));
  const act = usePeopleAction(adapter);
  const layout = useVisitView(PERMISSIONS_VIEW);
  const [scopeId, setScopeId] = useState(view.scopes[0]?.id ?? '');
  const scope = view.scopes.find((s) => s.id === scopeId) ?? view.scopes[0];
  const parent = scope?.parent ? view.scopes.find((s) => s.id === scope.parent) : undefined;

  const rows = useMemo<Holding[]>(() => {
    if (!scope) return [];
    const low = levelsOf(scope)[0]?.id;
    const out: Holding[] = [];
    for (const p of view.people) {
      const from =
        p.status === 'disabled'
          ? 'Disabled'
          : p.status === 'expired'
            ? 'Invite expired'
            : p.role === 'admin'
              ? 'Admin role'
              : 'Own grant';
      if (scope.parent) {
        for (const g of p.grants.filter((g) => g.scope === scope.id && g.resource))
          out.push({ key: `${p.id}\u0001${g.resource}`, person: p, resource: g.resource, from });
        continue;
      }
      const has = p.grants.some((g) => g.scope === scope.id && !g.resource);
      const level = levelOf(p, scope, view.scopes);
      if (level === low && !has && p.role !== 'admin') continue;
      out.push({ key: p.id, person: p, from });
    }
    return out;
  }, [scope, view]);

  if (!scope) return <LumenLayout crumbs={frame.crumbs} intro={frame.tabs} cards={[]} />;

  const domain: ViewDomain<Holding> = {
    id: 'permissions',
    rowKey: (r) => r.key,
    text: (r) => [r.person.email, r.person.name],
    fields: [
      {
        key: 'name',
        label: 'Person',
        icon: UserRoundIcon,
        value: (r) => r.person.name || r.person.email,
        format: 'text',
      },
      {
        key: 'resource',
        label: scope.resourceLabel ?? 'Resource',
        icon: TagIcon,
        value: (r) => r.resource ?? '—',
        format: 'text',
      },
      {
        key: 'level',
        label: 'Level',
        icon: ShieldCheckIcon,
        value: (r) => levelLabel(scope, levelOf(r.person, scope, view.scopes, r.resource)),
        render: (r) => (
          <LevelPicker
            person={r.person}
            scope={scope}
            scopes={view.scopes}
            resource={r.resource}
            onPick={(l) => {
              const before = r.person.grants;
              void act(
                () => adapter.setAccess(r.person.id, withGrant(before, scope, l, r.resource)),
                `${scope.name}: ${levelLabel(scope, l)} for ${r.person.name || r.person.email}`,
                () => adapter.setAccess(r.person.id, before),
              );
            }}
          />
        ),
        format: 'text',
        filterable: true,
        groupable: true,
      },
      {
        key: 'from',
        label: 'Comes from',
        icon: GitForkIcon,
        value: (r) => r.from,
        tone: (r) =>
          r.from === 'Admin role' ? 'sky' : r.from === 'Own grant' ? undefined : 'muted',
        format: 'text',
        filterable: true,
        groupable: true,
      },
    ],
  };

  const levels = levelsOf(scope);
  return (
    <LumenLayout<Holding>
      crumbs={frame.crumbs}
      actions={
        <LumenSelector
          label="Scope"
          size="sm"
          value={scope.id}
          options={view.scopes.map((s) => ({
            value: s.id,
            label: s.name,
            group: s.parent ? 'Inside an app' : 'Apps',
            detail: s.parent ? view.scopes.find((x) => x.id === s.parent)?.name : undefined,
          }))}
          onChange={setScopeId}
        />
      }
      intro={frame.tabs}
      domain={domain}
      {...layout}
      rows={rows}
      load={load}
      state={
        rows.length ? undefined : (
          <p className="p-6 text-center text-muted-foreground text-sm">
            {scope.parent
              ? `No one holds a grant on a ${(scope.resourceLabel ?? 'resource').toLowerCase()} yet.`
              : 'No one has access yet.'}
          </p>
        )
      }
      rowTitle={(r) => r.person.name || r.person.email}
      lead={[
        {
          id: 'levels',
          w: 3,
          title: `Levels for ${scope.name}`,
          icon: ListOrderedIcon,
          link: false,
          children: (
            <ol className="flex flex-col gap-2 text-sm">
              {levels.map((l, i) => (
                <li key={l.id} className="flex gap-3">
                  <span className="num w-4 shrink-0 text-muted-foreground">{i + 1}</span>
                  <span className="w-20 shrink-0 font-medium">{l.label}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {l.description ?? ''}
                  </span>
                </li>
              ))}
              {parent && (
                <li className="pt-1 text-muted-foreground text-xs">
                  No grant of its own: the level on {parent.name}, by rank.
                </li>
              )}
            </ol>
          ),
        },
        {
          id: 'roles',
          w: 3,
          title: 'Roles',
          icon: ShieldCheckIcon,
          link: false,
          children: (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-medium">Admin</dt>
              <dd className="text-muted-foreground">
                The top level on every scope; manages People. One is always kept.
              </dd>
              <dt className="font-medium">Member</dt>
              <dd className="text-muted-foreground">
                Only the levels set per scope. The default for invites.
              </dd>
            </dl>
          ),
        },
      ]}
    />
  );
}

const AUDIT_VIEW = peopleView('Audit log', {
  columns: ['time', 'actor', 'kind', 'detail', 'target', 'via'],
  chips: [{ key: 'kind' }],
  filters: { fields: ['actor', 'kind', 'target', 'via', 'outcome'], default: [] },
  group: { fields: ['day', 'kind', 'actor'], default: 'day' },
  pagination: { on: true, size: 100 },
  total: false,
  cards: [{ id: 'audit', kind: 'table', w: 6, title: null }],
});

const WINDOWS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '365', label: 'Last year' },
];

export function AuditSection({ frame }: { frame: PeopleFrame }) {
  const { adapter } = frame;
  const [days, setDays] = useState('30');
  const since = useMemo(() => Date.now() - Number(days) * 86_400_000, [days]);
  const q = useQuery({
    queryKey: ['lumen-people', adapter.key, 'audit', 'log', days],
    queryFn: () => adapter.audit?.({ since, limit: 1000 }) ?? Promise.resolve({ events: [] }),
  });
  const load = useLumenLoad(q);
  const layout = useVisitView(AUDIT_VIEW);
  const domain: ViewDomain<AuditEvent> = {
    id: 'audit',
    rowKey: (e) => e.id,
    text: (e) => [e.actor, e.target, e.detail],
    fields: [
      {
        key: 'day',
        label: 'Day',
        icon: ClockIcon,
        value: (e) =>
          new Date(e.at).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
        format: 'text',
        groupable: true,
      },
      {
        key: 'time',
        label: 'When',
        icon: ClockIcon,
        value: (e) =>
          new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        format: 'text',
      },
      {
        key: 'actor',
        label: 'Who',
        icon: UserRoundIcon,
        value: (e) => e.actor,
        format: 'text',
        filterable: true,
        groupable: true,
      },
      {
        key: 'kind',
        label: 'Kind',
        icon: TagIcon,
        value: (e) => e.kind,
        format: 'text',
        filterable: true,
        groupable: true,
      },
      {
        key: 'detail',
        label: 'What changed',
        icon: TextIcon,
        value: (e) => (e.refused ? `${e.detail} refused: ${e.refused}` : e.detail),
        tint: (e) => (e.refused ? 'color-mix(in oklch, var(--loss) 8%, transparent)' : undefined),
        format: 'text',
        maxWidth: '28rem',
      },
      {
        key: 'target',
        label: 'Target',
        icon: UserRoundIcon,
        value: (e) => e.target,
        format: 'text',
        filterable: true,
      },
      {
        key: 'via',
        label: 'From',
        icon: AppWindowIcon,
        value: (e) => e.via,
        format: 'text',
        filterable: true,
        groupable: true,
      },
      {
        key: 'outcome',
        label: 'Outcome',
        icon: CircleDotIcon,
        value: (e) => (e.refused ? 'Refused' : 'Done'),
        format: 'text',
        filterable: true,
        groupable: true,
      },
    ],
  };
  return (
    <LumenLayout<AuditEvent>
      crumbs={frame.crumbs}
      actions={
        <LumenSelector label="Window" size="sm" value={days} options={WINDOWS} onChange={setDays} />
      }
      intro={frame.tabs}
      domain={domain}
      {...layout}
      rows={q.data?.events ?? []}
      load={load}
      rowTitle={(e) => e.detail}
    />
  );
}
