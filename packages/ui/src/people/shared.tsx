// What the People screens share: times in words, a person's status, the level picker and how a
// change reports back.
import {
  type Grant,
  type PeopleView,
  type Person,
  type PersonStatus,
  type Scope,
  checkAdminFloor,
  levelLabel,
  levelOf,
  levelsOf,
} from '@columenlabs/lumen-ui-types/people';
import { type CustomViewConfig, customViewConfigSchema } from '@columenlabs/lumen-ui-types/views';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useState } from 'react';
import { errorText } from '../integrations';
import { LumenSelector } from '../lumen-selector';
import { lumenToast } from '../lumen-toast';
import type { Crumb } from '../page';
import { getPrefs } from '../prefs';
import type { ViewChipTone } from '../view-model';
import type { PeopleAdapter, WithSync } from './client';

export const STATUS_LABEL: Record<PersonStatus, string> = {
  active: 'Active',
  invited: 'Invited',
  expired: 'Expired',
  disabled: 'Disabled',
};

export const statusTone = (p: Pick<Person, 'status'>): ViewChipTone | undefined =>
  p.status === 'active'
    ? 'gain'
    : p.status === 'invited'
      ? 'info'
      : p.status === 'expired'
        ? 'amber'
        : 'muted';

const DAY = 86_400_000;
/** Non-breaking spaces, so `today 7:18 PM PT` and `in 7 d` never split across lines in any text. */
const glue = (s: string) => s.replace(/ /g, '\u00a0');

/**
 * `today 9:12 AM PT`, `yesterday 6:42 PM PT`, `Oct 24`, `Oct 24, 2025`; a dash for never. Days and
 * times are the person's time zone (Settings ▸ Preferences), not the device's.
 */
export function when(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const { timeZone } = getPrefs();
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', { timeZone });
  const year = (t: number) =>
    new Date(t).toLocaleDateString('en-US', { timeZone, year: 'numeric' });
  const time = new Date(ts).toLocaleTimeString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'shortGeneric',
  });
  if (day(ts) === day(now)) return glue(`today ${time}`);
  if (day(ts) === day(now - DAY)) return glue(`yesterday ${time}`);
  return glue(
    new Date(ts).toLocaleDateString('en-US', {
      timeZone,
      day: 'numeric',
      month: 'short',
      ...(year(ts) === year(now) ? {} : { year: 'numeric' }),
    }),
  );
}

/** `in 5 d`, `in 3 h`, `2 d ago`: how far a time is from now. */
export function fromNow(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const ms = ts - now;
  const abs = Math.abs(ms);
  const n =
    abs >= DAY
      ? `${Math.round(abs / DAY)} d`
      : abs >= 3_600_000
        ? `${Math.round(abs / 3_600_000)} h`
        : `${Math.max(1, Math.round(abs / 60_000))} min`;
  return glue(ms >= 0 ? `in ${n}` : `${n} ago`);
}

/** The top scopes (apps), in order; constructs inside one have a `parent`. */
export const topScopes = (scopes: readonly Scope[]) => scopes.filter((s) => !s.parent);

/** Grants with one scope's (and resource's) level set; the lowest level drops the grant. */
export function withGrant(
  grants: readonly Grant[],
  scope: Scope,
  level: string,
  resource?: string,
) {
  const rest = grants.filter(
    (g) => !(g.scope === scope.id && (g.resource ?? '') === (resource ?? '')),
  );
  return level === levelsOf(scope)[0]?.id
    ? rest
    : [...rest, { scope: scope.id, level, ...(resource ? { resource } : {}) }];
}

/** Why a person's role or status cannot change (the last or built-in admin), or null. */
export const adminGuard = (people: readonly Person[], p: Person, fixed: readonly string[]) =>
  checkAdminFloor(people, { id: p.id, role: 'member' }, fixed);

/** Runs a change, says how it went, and reloads the People data. A sign-in sync that failed is
 *  said too: the change stands, but the provider still has the old list. */
export function usePeopleAction(adapter: PeopleAdapter) {
  const qc = useQueryClient();
  return useCallback(
    async <R extends WithSync | undefined>(
      run: () => Promise<R>,
      done: string,
      undo?: () => Promise<unknown>,
    ): Promise<R | null> => {
      try {
        const r = await run();
        const sync = r?.access && !r.access.ok ? ` Sign-in sync: ${r.access.detail}` : '';
        if (sync) lumenToast.warning(`${done}.${sync}`);
        else if (undo)
          lumenToast.undo(done, () => {
            void undo()
              .then(() => qc.invalidateQueries({ queryKey: ['lumen-people', adapter.key] }))
              .catch((e) => lumenToast.error(errorText(e)));
          });
        else lumenToast.success(done);
        return r;
      } catch (e) {
        lumenToast.error(errorText(e));
        return null;
      } finally {
        await qc.invalidateQueries({ queryKey: ['lumen-people', adapter.key] });
      }
    },
    [adapter, qc],
  );
}

/** One person's level on one scope (or one resource of it): a chip that changes it at once. Admins
 *  and people without access show what they hold, fixed, with why on hover. */
export function LevelPicker({
  person,
  scope,
  scopes,
  resource,
  onPick,
  disabled,
}: {
  person: Person;
  scope: Scope;
  scopes: readonly Scope[];
  resource?: string;
  onPick: (level: string) => void;
  disabled?: boolean;
}) {
  const fixed =
    person.role === 'admin'
      ? 'Admins hold the top level everywhere'
      : person.status === 'disabled'
        ? 'Disabled: no access'
        : person.status === 'expired'
          ? 'Invite expired: resend it first'
          : null;
  const own = person.grants.some(
    (g) => g.scope === scope.id && (g.resource ?? '') === (resource ?? ''),
  );
  const parent = scope.parent ? scopes.find((s) => s.id === scope.parent) : undefined;
  const value = levelOf(person, scope, scopes, resource);
  return (
    <span
      title={fixed ?? undefined}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <LumenSelector
        trigger="chip"
        size="sm"
        label={`${scope.name} for ${person.name || person.email}`}
        disabled={disabled || !!fixed}
        value={value}
        options={levelsOf(scope).map((l) => ({
          value: l.id,
          label: !own && parent && l.id === value ? `${l.label} (from ${parent.name})` : l.label,
          description: l.description,
        }))}
        onChange={(level) => level !== value && onPick(level)}
      />
    </span>
  );
}

export const levelText = (scope: Scope, p: Person, scopes: readonly Scope[], resource?: string) =>
  levelLabel(scope, levelOf(p, scope, scopes, resource));

/** A page's default view, parsed so every setting has its default. */
export const peopleView = (name: string, config: Record<string, unknown>) =>
  ({ ...customViewConfigSchema.parse(config), name }) as CustomViewConfig;

/** A view config the person changes for the visit, with Reset back to the code's. */
export function useVisitView(view: CustomViewConfig) {
  const [config, setConfig] = useState(view);
  return { config, onConfigChange: setConfig, onReset: () => setConfig(view) };
}

export const scopeKey = (s: Scope) => `scope_${s.id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;

export function usePeopleQuery(adapter: PeopleAdapter) {
  return useQuery({ queryKey: ['lumen-people', adapter.key], queryFn: () => adapter.view() });
}

/** What every section's page shares: the data, its crumbs, the tabs and the Invite button. */
export interface PeopleFrame {
  adapter: PeopleAdapter;
  view: PeopleView;
  crumbs: Crumb[];
  tabs: ReactNode;
  mailNote: ReactNode;
  invite: ReactNode;
}
