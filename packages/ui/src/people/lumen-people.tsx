// LumenPeople: who may sign in, what each person may open, invites and the audit log, as one block
// an app drops in with an adapter (`peopleClient(url)` over `@columenlabs/lumen-people`'s routes).
import {
  type BulkOp,
  type Person,
  type Role,
  type Scope,
  levelLabel,
  levelOf,
  levelsOf,
} from '@columenlabs/lumen-ui-types/people';
import {
  AppWindowIcon,
  BanIcon,
  CircleDotIcon,
  ClockIcon,
  HistoryIcon,
  KeyRoundIcon,
  MailIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { LumenConfirm } from '../confirm';
import { LumenBoundary } from '../lumen-boundary';
import { LumenLayout } from '../lumen-layout';
import { LumenPageState } from '../lumen-page-state';
import { LumenSelector } from '../lumen-selector';
import { useLumenLoad } from '../lumen-source';
import { type LumenTab, LumenTabs } from '../lumen-tabs';
import { NoteLine } from '../note-line';
import type { Crumb } from '../page';
import { Tile, TileRow } from '../tile';
import { Button } from '../ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty';
import type { ViewDomain, ViewField } from '../view-model';
import type { PeopleAdapter } from './client';
import { InviteDrawer } from './invite-drawer';
import { PersonDrawer } from './person-drawer';
import { AuditSection, InvitesSection, PermissionsSection } from './sections';
import {
  LevelPicker,
  type PeopleFrame,
  STATUS_LABEL,
  fromNow,
  peopleView,
  scopeKey,
  statusTone,
  topScopes,
  usePeopleAction,
  usePeopleQuery,
  useVisitView,
  when,
  withGrant,
} from './shared';

export type PeopleSection = 'people' | 'invites' | 'permissions' | 'audit';

export interface LumenPeopleProps {
  adapter: PeopleAdapter;
  /** The crumbs before the section's own (`[{ label: 'Admin' }]`). */
  crumbs?: Crumb[];
  /** The open section; left out, the block keeps it and shows its own tabs. */
  section?: PeopleSection;
  onSection?: (section: PeopleSection) => void;
  /** Opens the app's email settings, offered while no email is set up. */
  onSetUpMail?: () => void;
  /** The app's own columns per person (their accounts, their storage). */
  fields?: ViewField<Person>[];
}

export function LumenPeople({
  adapter,
  crumbs = [],
  section: given,
  onSection,
  onSetUpMail,
  fields = [],
}: LumenPeopleProps) {
  const [own, setOwn] = useState<PeopleSection>('people');
  const section = given ?? own;
  const go = (s: PeopleSection) => (onSection ? onSection(s) : setOwn(s));
  const q = usePeopleQuery(adapter);
  const [inviting, setInviting] = useState(false);
  const titles: Record<PeopleSection, string> = {
    people: 'People',
    invites: 'Invites',
    permissions: 'Permissions',
    audit: 'Audit log',
  };
  if (!q.data)
    return (
      <LumenPageState
        crumbs={[...crumbs, { label: titles[section] }]}
        title={titles[section]}
        icon={UsersIcon}
        query={q}
      />
    );
  const view = q.data;
  const pending = view.people.filter((p) => p.status === 'invited' || p.status === 'expired');
  const tabs: LumenTab<PeopleSection>[] = [
    { value: 'people', label: 'People', icon: UsersIcon },
    {
      value: 'invites',
      label: 'Invites',
      icon: MailIcon,
      after: pending.length ? (
        <span className="num text-muted-foreground">{pending.length}</span>
      ) : undefined,
    },
    { value: 'permissions', label: 'Permissions', icon: KeyRoundIcon },
    { value: 'audit', label: 'Audit log', icon: HistoryIcon, hidden: !adapter.audit },
  ];
  const frame: PeopleFrame = {
    adapter,
    view,
    crumbs: [...crumbs, { label: titles[section] }],
    tabs: onSection ? null : <LumenTabs tabs={tabs} value={section} onChange={go} />,
    mailNote: view.mail.configured ? null : (
      <NoteLine
        icon={TriangleAlertIcon}
        title="Email is not set up."
        note="You can still invite: each invite gives you a link to send yourself."
        action={
          onSetUpMail && (
            <Button size="sm" variant="outline" onClick={onSetUpMail}>
              Set up email
            </Button>
          )
        }
      />
    ),
    invite: (
      <Button size="sm" onClick={() => setInviting(true)}>
        <UserPlusIcon /> Invite people
      </Button>
    ),
  };
  return (
    <>
      {section === 'people' && (
        <PeopleList frame={frame} fields={fields} onInvite={() => setInviting(true)} />
      )}
      {section === 'invites' && <InvitesSection frame={frame} />}
      {section === 'permissions' && <PermissionsSection frame={frame} />}
      {section === 'audit' && <AuditSection frame={frame} />}
      <LumenBoundary where="people-invite" what="panel">
        <InviteDrawer
          adapter={adapter}
          view={view}
          open={inviting}
          onClose={() => setInviting(false)}
          onSetUpMail={onSetUpMail}
        />
      </LumenBoundary>
    </>
  );
}

const LIST_VIEW = (scopes: readonly Scope[], extra: string[]) =>
  peopleView('People', {
    columns: [
      'name',
      'email',
      'role',
      'status',
      ...topScopes(scopes).map(scopeKey),
      ...extra,
      'last',
    ],
    chips: [{ key: 'status' }, { key: 'role' }],
    filters: { fields: ['role', 'status'], default: [] },
    group: { fields: ['role', 'status'], default: null },
    pagination: { on: true, size: 50 },
    total: false,
    cards: [{ id: 'people', kind: 'table', w: 6, title: null }],
  });

function PeopleList({
  frame,
  fields,
  onInvite,
}: {
  frame: PeopleFrame;
  fields: ViewField<Person>[];
  onInvite: () => void;
}) {
  const { adapter, view } = frame;
  const q = usePeopleQuery(adapter);
  const load = useLumenLoad(q);
  const act = usePeopleAction(adapter);
  const layout = useVisitView(
    useMemo(
      () =>
        LIST_VIEW(
          view.scopes,
          fields.map((f) => f.key),
        ),
      [view.scopes, fields],
    ),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const people = view.people;
  const open = people.find((p) => p.id === openId) ?? null;

  const setLevel = (p: Person, s: Scope, level: string) => {
    const before = p.grants;
    void act(
      () => adapter.setAccess(p.id, withGrant(before, s, level)),
      `${s.name}: ${levelLabel(s, level)} for ${p.name || p.email}`,
      () => adapter.setAccess(p.id, before),
    );
  };

  const domain: ViewDomain<Person> = {
    id: 'people',
    rowKey: (p) => p.id,
    text: (p) => [p.email, p.name],
    fields: [
      {
        key: 'name',
        label: 'Name',
        icon: UserRoundIcon,
        value: (p) => p.name || p.email,
        format: 'text',
      },
      {
        key: 'email',
        label: 'Email',
        icon: MailIcon,
        value: (p) => p.email,
        format: 'text',
        maxWidth: '16rem',
      },
      {
        key: 'role',
        label: 'Role',
        icon: ShieldCheckIcon,
        value: (p) => (p.role === 'admin' ? 'Admin' : 'Member'),
        tone: (p) => (p.role === 'admin' ? 'sky' : undefined),
        format: 'text',
        filterable: true,
        groupable: true,
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
      ...topScopes(view.scopes).map<ViewField<Person>>((s) => ({
        key: scopeKey(s),
        label: s.name,
        icon: AppWindowIcon,
        value: (p) => levelLabel(s, levelOf(p, s, view.scopes)),
        render: (p) => (
          <LevelPicker
            person={p}
            scope={s}
            scopes={view.scopes}
            onPick={(l) => setLevel(p, s, l)}
          />
        ),
        format: 'text',
        filterable: true,
        groupable: true,
      })),
      ...fields,
      {
        key: 'invited_by',
        label: 'Invited by',
        icon: UserPlusIcon,
        value: (p) => p.invitedBy ?? '—',
        format: 'text',
      },
      {
        key: 'expires',
        label: 'Invite expires',
        icon: ClockIcon,
        value: (p) => (p.status === 'invited' ? fromNow(p.expiresAt) : '—'),
        format: 'text',
      },
      {
        key: 'last',
        label: 'Last seen',
        icon: ClockIcon,
        value: (p) => when(p.lastSeen),
        format: 'text',
      },
    ],
  };

  const admins = people.filter((p) => p.role === 'admin' && p.status === 'active');
  const expired = people.filter((p) => p.status === 'expired').length;
  const invited = people.filter((p) => p.status === 'invited').length;
  const active = people.filter((p) => p.status === 'active').length;
  const disabled = people.filter((p) => p.status === 'disabled').length;
  const onlyMe = people.length <= 1;

  return (
    <>
      <LumenLayout<Person>
        crumbs={frame.crumbs}
        actions={frame.invite}
        intro={
          <div className="flex flex-col gap-3">
            {frame.tabs}
            <TileRow fill aria-label="People at a glance">
              <Tile
                label="People"
                value={people.length}
                caption={`${active} active${disabled ? ` · ${disabled} disabled` : ''}`}
              />
              <Tile label="Admins" value={admins.length} caption="at least 1 always kept" />
              <Tile
                label="Invites pending"
                value={invited}
                caption={expired ? `${expired} expired` : 'none expired'}
              />
              {view.sync ? (
                <Tile
                  label="Sign-in sync"
                  value={view.sync.ok ? 'Synced' : 'Out of step'}
                  caption={view.sync.at ? when(view.sync.at) : view.sync.detail}
                  valueClassName={view.sync.ok ? undefined : 'text-loss'}
                />
              ) : (
                <Tile
                  label="Email"
                  value={view.mail.configured ? 'Working' : 'Not set up'}
                  caption={view.mail.from ?? 'links only'}
                />
              )}
            </TileRow>
            {frame.mailNote}
            {picked.size > 0 && (
              <BulkBar frame={frame} ids={[...picked]} onClear={() => setPicked(new Set())} />
            )}
          </div>
        }
        domain={domain}
        {...layout}
        rows={people}
        load={load}
        state={onlyMe ? <FirstRun mail={view.mail.configured} onInvite={onInvite} /> : undefined}
        selection={{ keys: picked, onChange: setPicked }}
        rowTitle={(p) => p.name || p.email}
        onOpen={(p) => setOpenId(p.id)}
      />
      <LumenBoundary where="people-person" what="panel">
        <PersonDrawer adapter={adapter} view={view} person={open} onClose={() => setOpenId(null)} />
      </LumenBoundary>
    </>
  );
}

/** One change over the ticked people. Apply clears the selection; Undo puts the change back. */
function BulkBar({
  frame,
  ids,
  onClear,
}: { frame: PeopleFrame; ids: string[]; onClear: () => void }) {
  const { adapter, view } = frame;
  const act = usePeopleAction(adapter);
  const [removing, setRemoving] = useState(false);
  const chosen = view.people.filter((p) => ids.includes(p.id));
  const invites = chosen.filter((p) => p.status === 'invited' || p.status === 'expired');
  const n = chosen.length;
  const many = (k: number) => (k === 1 ? '1 person' : `${k} people`);

  /** A role, status, resend or remove over many: the adapter's bulk call, else one by one. */
  const each = async (op: BulkOp, list: Person[]) => {
    if (adapter.bulk) {
      const r = await adapter.bulk(
        list.map((p) => p.id),
        op,
      );
      if (r.failed.length) throw new Error(`${r.failed.length} not changed: ${r.failed[0]?.error}`);
      return r;
    }
    for (const p of list) {
      if (op.op === 'role') await adapter.update(p.id, { role: op.role });
      else if (op.op === 'status') await adapter.update(p.id, { status: op.status });
      else if (op.op === 'resend') await adapter.resend(p.id);
      else if (op.op === 'remove') await adapter.remove(p.id);
    }
    return {};
  };

  const levelOptions = topScopes(view.scopes).flatMap((s) =>
    levelsOf(s).map((l) => ({
      value: `${s.id}\u0001${l.id}`,
      label: l.label,
      group: s.name,
      description: l.description,
    })),
  );
  const setLevel = (pick: string) => {
    const [sid, level] = pick.split('\u0001');
    const s = view.scopes.find((x) => x.id === sid);
    if (!s || !level) return;
    const members = chosen.filter((p) => p.role !== 'admin');
    const before = new Map(members.map((p) => [p.id, p.grants]));
    onClear();
    void act(
      async () => {
        for (const p of members) await adapter.setAccess(p.id, withGrant(p.grants, s, level));
        return undefined;
      },
      `${s.name}: ${levelLabel(s, level)} for ${many(members.length)}`,
      async () => {
        for (const [id, g] of before) await adapter.setAccess(id, g);
      },
    );
  };
  const setRole = (role: Role) => {
    const list = chosen.filter((p) => p.role !== role);
    onClear();
    void act(
      () => each({ op: 'role', role }, list),
      `${many(list.length)} made ${role === 'admin' ? 'admin' : 'member'}`,
      () => each({ op: 'role', role: role === 'admin' ? 'member' : 'admin' }, list),
    );
  };
  const disable = () => {
    const list = chosen.filter((p) => p.status === 'active');
    onClear();
    void act(
      () => each({ op: 'status', status: 'disabled' }, list),
      `${many(list.length)} disabled`,
      () => each({ op: 'status', status: 'active' }, list),
    );
  };

  return (
    <div
      role="toolbar"
      aria-label="Change the ticked people"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm"
    >
      <span className="num font-medium">{n} selected</span>
      <LumenSelector
        trigger="chip"
        size="sm"
        label="Set level on…"
        placeholder="Set level on…"
        value={null}
        options={levelOptions}
        onChange={setLevel}
      />
      <Button size="sm" variant="outline" onClick={() => setRole('admin')}>
        <ShieldCheckIcon /> Make admin
      </Button>
      {invites.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onClear();
            void act(
              () => each({ op: 'resend' }, invites),
              `New invites sent to ${many(invites.length)}`,
            );
          }}
        >
          <MailIcon /> Resend invites
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={disable}>
        <BanIcon /> Disable
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive"
        onClick={() => setRemoving(true)}
      >
        <Trash2Icon /> Remove
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Clear the selection"
        className="ml-auto"
        onClick={onClear}
      >
        <XIcon />
      </Button>
      <LumenConfirm
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${many(n)}?`}
        description="Each part of the app deletes their data first, then they leave People. This cannot be undone."
        typeToConfirm="REMOVE"
        action="Remove for good"
        busyAction="Removing…"
        onConfirm={async () => {
          const r = await act(() => each({ op: 'remove' }, chosen), `Removed ${many(n)}`);
          if (!r) throw new Error('Some people were not removed.');
          setRemoving(false);
          onClear();
        }}
      />
    </div>
  );
}

/** Only the admin so far: what to do first. */
function FirstRun({ mail, onInvite }: { mail: boolean; onInvite: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon />
        </EmptyMedia>
        <EmptyTitle>It’s just you so far</EmptyTitle>
        <EmptyDescription>
          Invite people and pick what each one can open. You can change it any time.
          {mail ? '' : ' Without email set up, each invite gives you a link to send.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onInvite}>
          <UserPlusIcon /> Invite people
        </Button>
      </EmptyContent>
    </Empty>
  );
}
