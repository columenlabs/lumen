// One person: their access per scope, role, sign-in, recent activity and the danger zone.
import {
  type PeopleView,
  type Person,
  type RemovePlan,
  type Role,
  levelLabel,
  levelOf,
  levelsOf,
} from '@columenlabs/lumen-ui-types/people';
import { useQuery } from '@tanstack/react-query';
import {
  AppWindowIcon,
  BanIcon,
  HistoryIcon,
  KeyRoundIcon,
  MailIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { LumenConfirm } from '../confirm';
import { DrawerSection } from '../drawer-section';
import { InfoLabel, InfoTip } from '../info-tip';
import { errorText } from '../integrations';
import { LumenDrawer } from '../lumen-drawer';
import { LumenSelector } from '../lumen-selector';
import { NoteLine } from '../note-line';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import type { PeopleAdapter } from './client';
import {
  LevelPicker,
  STATUS_LABEL,
  adminGuard,
  fromNow,
  topScopes,
  usePeopleAction,
  when,
  withGrant,
} from './shared';

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: 'member', label: 'Member', description: 'Only the levels set per scope' },
  { value: 'admin', label: 'Admin', description: 'Top level everywhere, and manages People' },
];

export function PersonDrawer({
  adapter,
  view,
  person,
  onClose,
}: {
  adapter: PeopleAdapter;
  view: PeopleView;
  person: Person | null;
  onClose: () => void;
}) {
  const act = usePeopleAction(adapter);
  const p = person;
  const guard = p ? adminGuard(view.people, p, view.fixedAdmins) : null;
  const pending = p?.status === 'invited' || p?.status === 'expired';
  const who = p ? p.name || p.email : '';

  const setLevel = (scopeId: string, level: string, resource?: string) => {
    if (!p) return;
    const scope = view.scopes.find((s) => s.id === scopeId);
    if (!scope) return;
    const before = p.grants;
    const next = withGrant(before, scope, level, resource);
    void act(
      () => adapter.setAccess(p.id, next),
      `${scope.name}: ${levelLabel(scope, level)} for ${who}`,
      () => adapter.setAccess(p.id, before),
    );
  };

  return (
    <LumenDrawer
      open={!!p}
      onClose={onClose}
      title={who}
      description={
        p ? `${p.email} · ${STATUS_LABEL[p.status]} · invited ${when(p.invitedAt)}` : undefined
      }
      footer={
        p && pending ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(() => adapter.revoke(p.id), `Revoked the invite for ${p.email}`).then(
                  (r) => r && onClose(),
                )
              }
            >
              <XIcon /> Revoke
            </Button>
            <Button
              size="sm"
              onClick={() => act(() => adapter.resend(p.id), `New invite sent to ${p.email}`)}
            >
              <MailIcon /> Resend invite
            </Button>
          </>
        ) : undefined
      }
    >
      {p && (
        <>
          <AccessSection adapter={adapter} view={view} person={p} onLevel={setLevel} />
          <DrawerSection icon={ShieldCheckIcon} title="Role" defaultOpen>
            <div className="flex items-center justify-between gap-3 py-1 text-sm">
              <InfoLabel info="Admins hold the top level on every scope and manage People. One active admin is always kept.">
                Role
              </InfoLabel>
              <LumenSelector<Role>
                trigger="chip"
                size="sm"
                label={`Role of ${who}`}
                disabled={!!guard && p.role === 'admin'}
                value={p.role}
                options={ROLES}
                onChange={(role) =>
                  role !== p.role &&
                  void act(
                    () => adapter.update(p.id, { role }),
                    `${who} is now ${role === 'admin' ? 'an admin' : 'a member'}`,
                    () => adapter.update(p.id, { role: p.role }),
                  )
                }
              />
            </div>
            {guard && p.role === 'admin' && <NoteLine icon={ShieldCheckIcon} title={guard} />}
          </DrawerSection>
          <DrawerSection icon={KeyRoundIcon} title="Sign-in" defaultOpen>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Last seen</dt>
              <dd>{when(p.lastSeen)}</dd>
              <dt className="text-muted-foreground">Invited by</dt>
              <dd className="truncate">{p.invitedBy ?? '—'}</dd>
              {pending && (
                <>
                  <dt className="text-muted-foreground">Invite</dt>
                  <dd>
                    {p.status === 'expired'
                      ? `expired ${when(p.expiresAt)}`
                      : `expires ${fromNow(p.expiresAt)}`}
                  </dd>
                </>
              )}
              {view.sync && (
                <>
                  <dt className="text-muted-foreground">Sign-in provider</dt>
                  <dd>
                    {view.sync.ok ? 'Synced' : 'Out of step'} · {when(view.sync.at)}
                  </dd>
                </>
              )}
            </dl>
          </DrawerSection>
          {adapter.audit && <ActivitySection adapter={adapter} person={p} />}
          <DangerSection adapter={adapter} person={p} guard={guard} onGone={onClose} />
        </>
      )}
    </LumenDrawer>
  );
}

/** Each app's level, then the person's grants on constructs inside it. */
function AccessSection({
  adapter,
  view,
  person: p,
  onLevel,
}: {
  adapter: PeopleAdapter;
  view: PeopleView;
  person: Person;
  onLevel: (scope: string, level: string, resource?: string) => void;
}) {
  const tops = topScopes(view.scopes);
  const low = (id: string) => levelsOf(view.scopes.find((s) => s.id === id))[0]?.id;
  const open = tops.filter((s) => levelOf(p, s, view.scopes) !== low(s.id)).length;
  return (
    <DrawerSection
      icon={AppWindowIcon}
      title="Access"
      hint={`${open} of ${tops.length}`}
      defaultOpen
    >
      <ul className="flex flex-col gap-2 text-sm">
        {tops.map((s) => {
          const kids = view.scopes.filter((c) => c.parent === s.id);
          return (
            <li key={s.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                {s.name}
                <LevelPicker
                  person={p}
                  scope={s}
                  scopes={view.scopes}
                  onPick={(l) => onLevel(s.id, l)}
                />
              </div>
              {kids.map((k) => (
                <ResourceGrants
                  key={k.id}
                  adapter={adapter}
                  view={view}
                  person={p}
                  scopeId={k.id}
                  onLevel={onLevel}
                />
              ))}
            </li>
          );
        })}
      </ul>
    </DrawerSection>
  );
}

/** The person's grants on one construct (Collections inside Recipes), and + Grant on another. */
function ResourceGrants({
  adapter,
  view,
  person: p,
  scopeId,
  onLevel,
}: {
  adapter: PeopleAdapter;
  view: PeopleView;
  person: Person;
  scopeId: string;
  onLevel: (scope: string, level: string, resource?: string) => void;
}) {
  const scope = view.scopes.find((s) => s.id === scopeId);
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['lumen-people', adapter.key, 'resources', scopeId],
    queryFn: () => adapter.resources?.(scopeId) ?? Promise.resolve([]),
    enabled: !!adapter.resources && adding,
  });
  if (!scope) return null;
  const held = p.grants.filter((g) => g.scope === scopeId && g.resource);
  const name = (id: string) => list.data?.find((r) => r.id === id)?.name ?? id;
  const noun = scope.resourceLabel ?? scope.name;
  return (
    <div className="ml-3 flex flex-col gap-1.5 border-l pl-3">
      {held.map((g) => (
        <div key={g.resource} className="flex items-center justify-between gap-3">
          <span className="truncate text-muted-foreground">{name(g.resource ?? '')}</span>
          <LevelPicker
            person={p}
            scope={scope}
            scopes={view.scopes}
            resource={g.resource}
            onPick={(l) => onLevel(scopeId, l, g.resource)}
          />
        </div>
      ))}
      {adapter.resources && p.role !== 'admin' && (
        <LumenSelector
          trigger="chip"
          size="sm"
          label={`Grant on a ${noun.toLowerCase()}`}
          placeholder={`+ Grant on a ${noun.toLowerCase()}`}
          value={null}
          open={adding}
          onOpenChange={setAdding}
          empty={list.isPending ? 'Loading…' : `No ${noun.toLowerCase()} to add`}
          options={(list.data ?? [])
            .filter((r) => !held.some((g) => g.resource === r.id))
            .map((r) => ({ value: r.id, label: r.name }))}
          onChange={(r) => onLevel(scopeId, levelsOf(scope)[1]?.id ?? 'view', r)}
        />
      )}
    </div>
  );
}

function ActivitySection({ adapter, person }: { adapter: PeopleAdapter; person: Person }) {
  const q = useQuery({
    queryKey: ['lumen-people', adapter.key, 'audit', person.id],
    queryFn: () => adapter.audit?.({ target: person.id, limit: 5 }) ?? Promise.resolve(null),
  });
  const events = q.data?.events ?? [];
  return (
    <DrawerSection icon={HistoryIcon} title="Recent activity" count={events.length || null}>
      {q.isError ? (
        <p className="text-destructive text-sm">{errorText(q.error)}</p>
      ) : events.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="num w-24 shrink-0 text-muted-foreground">{when(e.at)}</span>
              <span className="min-w-0 flex-1 truncate" title={e.detail}>
                {e.actor} · {e.detail}
              </span>
              {e.refused && <Badge variant="destructive">Refused</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{q.isPending ? 'Loading…' : 'Nothing yet.'}</p>
      )}
    </DrawerSection>
  );
}

/** Disable or Enable, and Remove with what each part of the app does with their data first. */
function DangerSection({
  adapter,
  person: p,
  guard,
  onGone,
}: {
  adapter: PeopleAdapter;
  person: Person;
  guard: string | null;
  onGone: () => void;
}) {
  const act = usePeopleAction(adapter);
  const [plan, setPlan] = useState<RemovePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const who = p.name || p.email;
  const locked = !!guard && p.role === 'admin';
  const openRemove = async () => {
    setPlan(null);
    setPlanError(null);
    setConfirming(true);
    try {
      setPlan(await adapter.removePlan(p.id));
    } catch (e) {
      setPlanError(errorText(e));
    }
  };
  return (
    <DrawerSection icon={TriangleAlertIcon} title="Danger zone">
      {locked ? (
        <NoteLine icon={ShieldCheckIcon} title={guard} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {p.status !== 'invited' && p.status !== 'expired' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const status = p.status === 'disabled' ? 'active' : 'disabled';
                void act(
                  () => adapter.update(p.id, { status }),
                  status === 'disabled' ? `${who} is disabled` : `${who} is enabled`,
                  () =>
                    adapter.update(p.id, {
                      status: p.status === 'disabled' ? 'disabled' : 'active',
                    }),
                );
              }}
            >
              <BanIcon /> {p.status === 'disabled' ? 'Enable' : 'Disable'}
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-destructive" onClick={openRemove}>
            <Trash2Icon /> Remove…
          </Button>
          <InfoTip label="About Disable and Remove">
            Disable keeps their data and blocks sign-in. Remove asks each part of the app to delete
            their data first, then takes them out of People.
          </InfoTip>
        </div>
      )}
      <LumenConfirm
        open={confirming}
        onOpenChange={setConfirming}
        size="default"
        title={`Remove ${who}?`}
        description={
          planError ? (
            planError
          ) : plan ? (
            <span className="flex flex-col gap-2">
              <span>This cannot be undone.</span>
              <span className="flex flex-col gap-1">
                {plan.steps.map((s) => (
                  <span key={s.label} className="flex justify-between gap-3">
                    <span>{s.label}</span>
                    <span className="text-muted-foreground">{s.outcome}</span>
                  </span>
                ))}
              </span>
            </span>
          ) : (
            'Checking what removing them does…'
          )
        }
        typeToConfirm={p.email}
        action="Remove for good"
        busyAction="Removing…"
        onConfirm={async () => {
          const r = await act(() => adapter.remove(p.id), `Removed ${who}`);
          if (!r) throw new Error('Nothing was removed.');
          setConfirming(false);
          onGone();
        }}
      />
    </DrawerSection>
  );
}
