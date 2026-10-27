// Invite people: many emails at once, a role, access per scope, how long the link works and a note.
// Each result says whether the email went; when it did not, the link is there to copy.
import {
  type Grant,
  type InviteResult,
  type PeopleView,
  type Role,
  emailsIn,
  inviteGrants,
  levelsOf,
} from '@columenlabs/lumen-ui-types/people';
import { CheckIcon, CopyIcon, MailIcon, TriangleAlertIcon, UserPlusIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { DrawerSection } from '../drawer-section';
import { type FormIssue, SaveButton } from '../form-issues';
import { InfoLabel } from '../info-tip';
import { LumenDrawer } from '../lumen-drawer';
import { LumenSelector } from '../lumen-selector';
import { lumenToast } from '../lumen-toast';
import { NoteLine } from '../note-line';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { PeopleAdapter } from './client';
import { topScopes, usePeopleAction, when, withGrant } from './shared';

const DAYS = [1, 3, 7, 14, 30];
const MAX = 50;

export function InviteDrawer({
  adapter,
  view,
  open,
  onClose,
  onSetUpMail,
}: {
  adapter: PeopleAdapter;
  view: PeopleView;
  open: boolean;
  onClose: () => void;
  /** Opens the app's email settings; shown when no email is set up. */
  onSetUpMail?: () => void;
}) {
  const act = usePeopleAction(adapter);
  const ids = useId();
  const [text, setText] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [grants, setGrants] = useState<Grant[]>(() => inviteGrants(view.scopes));
  const [days, setDays] = useState(view.inviteDays);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);

  const emails = useMemo(() => emailsIn(text), [text]);
  const known = new Map(view.people.map((p) => [p.id, p]));
  const fresh = emails.filter((e) => {
    const p = known.get(e);
    return !p || p.status === 'invited' || p.status === 'expired';
  });
  const issues: FormIssue[] = [];
  if (!emails.length)
    issues.push({ where: 'Emails', message: 'Add an email address', target: `${ids}-emails` });
  else if (!fresh.length)
    issues.push({
      where: 'Emails',
      message: 'Everyone here is already a member',
      target: `${ids}-emails`,
    });
  if (emails.length > MAX)
    issues.push({ where: 'Emails', message: `At most ${MAX} at once`, target: `${ids}-emails` });

  const reset = () => {
    setText('');
    setRole('member');
    setGrants(inviteGrants(view.scopes));
    setDays(view.inviteDays);
    setNote('');
    setResults(null);
  };
  const close = () => {
    onClose();
    reset();
  };
  const send = async () => {
    setBusy(true);
    const r = await act(
      () =>
        adapter.invite({
          emails,
          role,
          grants: role === 'admin' ? [] : grants,
          days,
          note: note.trim() || undefined,
        }),
      emails.length === 1 ? `Invited ${emails[0]}` : `Invited ${fresh.length} people`,
    );
    setBusy(false);
    if (r) setResults(r.results);
  };

  return (
    <LumenDrawer
      open={open}
      onClose={close}
      title="Invite people"
      footerStart={
        view.mail.configured
          ? view.mail.from
            ? `From ${view.mail.from}`
            : 'By email'
          : 'Links only'
      }
      footer={
        results ? (
          <>
            <Button size="sm" variant="outline" onClick={reset}>
              <UserPlusIcon /> Invite more
            </Button>
            <Button size="sm" onClick={close}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <SaveButton
              issues={issues}
              busy={busy}
              icon={view.mail.configured ? MailIcon : UserPlusIcon}
              label={
                view.mail.configured
                  ? `Send ${fresh.length > 1 ? `${fresh.length} invites` : 'invite'}`
                  : `Make ${fresh.length > 1 ? `${fresh.length} links` : 'link'}`
              }
              onSave={send}
            />
          </>
        )
      }
    >
      {results ? (
        <Results results={results} />
      ) : (
        <>
          {!view.mail.configured && (
            <NoteLine
              icon={TriangleAlertIcon}
              title="Email is not set up."
              note="Each invite gives you a link to send yourself."
              action={
                onSetUpMail && (
                  <Button size="sm" variant="outline" onClick={onSetUpMail}>
                    Set up email
                  </Button>
                )
              }
            />
          )}
          <DrawerSection title="Who" count={emails.length || null} defaultOpen>
            <div className="flex flex-col gap-2">
              <label htmlFor={`${ids}-emails`} className="font-medium text-sm">
                Emails
              </label>
              <Textarea
                id={`${ids}-emails`}
                rows={3}
                value={text}
                placeholder="jo@example.com, ravi@example.org"
                onChange={(e) => setText(e.target.value)}
              />
              {emails.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {emails.map((e) => {
                    const p = known.get(e);
                    const member = p && p.status !== 'invited' && p.status !== 'expired';
                    return (
                      <Badge
                        key={e}
                        variant={member ? 'outline' : 'secondary'}
                        className={member ? 'text-muted-foreground line-through' : undefined}
                        title={
                          member
                            ? 'Already a member: skipped'
                            : p
                              ? 'Invited before: sends a new link'
                              : undefined
                        }
                      >
                        {e}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </DrawerSection>
          <DrawerSection title="Access" defaultOpen>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center justify-between gap-3">
                <InfoLabel info="Admins hold the top level everywhere and manage People.">
                  Role
                </InfoLabel>
                <LumenSelector<Role>
                  trigger="chip"
                  size="sm"
                  label="Role"
                  value={role}
                  options={[
                    { value: 'member', label: 'Member' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                  onChange={setRole}
                />
              </li>
              {role === 'member' &&
                topScopes(view.scopes).map((s) => {
                  const levels = levelsOf(s);
                  const value =
                    grants.find((g) => g.scope === s.id && !g.resource)?.level ?? levels[0]?.id;
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      {s.name}
                      <LumenSelector
                        trigger="chip"
                        size="sm"
                        label={s.name}
                        value={value}
                        options={levels.map((l) => ({
                          value: l.id,
                          label: l.label,
                          description: l.description,
                        }))}
                        onChange={(l) => setGrants((g) => withGrant(g, s, l))}
                      />
                    </li>
                  );
                })}
            </ul>
          </DrawerSection>
          <DrawerSection title="Link and note" defaultOpen>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <InfoLabel info="Past this the link stops working and they are refused at sign-in until you resend.">
                  Link works for
                </InfoLabel>
                <LumenSelector
                  trigger="chip"
                  size="sm"
                  label="Link works for"
                  value={String(days)}
                  options={[...new Set([...DAYS, view.inviteDays])]
                    .sort((a, b) => a - b)
                    .map((d) => ({
                      value: String(d),
                      label: d === 1 ? '1 day' : `${d} days`,
                      detail: `until ${when(Date.now() + d * 86_400_000)}`,
                    }))}
                  onChange={(d) => setDays(Number(d))}
                />
              </div>
              {view.mail.configured && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${ids}-note`} className="font-medium">
                    A note in the email
                  </label>
                  <Textarea
                    id={`${ids}-note`}
                    rows={2}
                    maxLength={500}
                    value={note}
                    placeholder="Optional"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              )}
            </div>
          </DrawerSection>
        </>
      )}
    </LumenDrawer>
  );
}

/** One line per email: sent, link only (with Copy link), or skipped and why. */
function Results({ results }: { results: InviteResult[] }) {
  return (
    <ul className="flex flex-col gap-3 py-3 text-sm">
      {results.map((r) => (
        <li key={r.email} className="flex flex-col gap-1.5">
          <span className="flex items-start gap-2">
            {r.ok && r.mail?.ok ? (
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-gain" />
            ) : (
              <TriangleAlertIcon
                className={`mt-0.5 size-4 shrink-0 ${r.ok ? 'text-warning' : 'text-muted-foreground'}`}
              />
            )}
            <span className="min-w-0">
              <span className="font-medium">{r.email}</span>{' '}
              <span className="text-muted-foreground">
                {!r.ok
                  ? `skipped: ${r.detail}`
                  : r.mail?.ok
                    ? `was emailed. The link works until ${when(r.person?.expiresAt)}.`
                    : `is invited, but the email did not go${r.mail?.detail ? ` (${r.mail.detail})` : ''}.`}
              </span>
            </span>
          </span>
          {r.ok && r.link && !r.mail?.ok && <CopyLink link={r.link} />}
        </li>
      ))}
    </ul>
  );
}

export function CopyLink({ link }: { link: string }) {
  return (
    <span className="ml-6 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{link}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          navigator.clipboard.writeText(link).then(
            () => lumenToast.success('Link copied. It is single use and tied to this email.'),
            () => lumenToast.error('Could not copy: select the link and copy it.'),
          )
        }
      >
        <CopyIcon /> Copy link
      </Button>
    </span>
  );
}
