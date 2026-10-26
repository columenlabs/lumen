// Email · Resend-compatible API: the settings section where an admin sets how the app sends email.
// Four steps: how the server is reached, its address and sealed key, who mail is sent from, then
// Check connection (nothing sent) or Send test. Save waits until one of them passes.
import type { EmailCheck, EmailDraft, EmailSettingsView } from '@columenlabs/lumen-ui-types/people';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CableIcon,
  CheckIcon,
  CircleHelpIcon,
  GlobeIcon,
  MailIcon,
  PlugZapIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { type FormIssue, SaveButton } from '../form-issues';
import { InfoLabel } from '../info-tip';
import { errorText } from '../integrations';
import { LumenChoice } from '../lumen-choice';
import { lumenToast } from '../lumen-toast';
import { SettingsActions, SettingsFooter } from '../settings';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Spinner } from '../ui/spinner';
import type { PeopleAdapter } from './client';
import { when } from './shared';

const blank = (v: EmailSettingsView): EmailDraft => {
  const route = v.current?.route ?? v.routes[0]?.id ?? '';
  return {
    route,
    url: v.current?.url ?? v.routes.find((r) => r.id === route)?.url ?? '',
    apiKey: '',
    from: v.current?.from ?? '',
    fromName: v.current?.fromName ?? '',
  };
};

const same = (a: EmailDraft, b: EmailDraft) =>
  a.route === b.route &&
  a.url === b.url &&
  (a.apiKey ?? '') === (b.apiKey ?? '') &&
  a.from === b.from &&
  a.fromName === b.fromName;

/** The Email section's body. In LumenSettings its badge sits in the header and Save in the footer;
 *  `inline` draws both in the body instead. */
export function LumenEmailSettings({
  adapter,
  inline = false,
}: {
  adapter: PeopleAdapter;
  inline?: boolean;
}) {
  const api = adapter.email;
  const q = useQuery({
    queryKey: ['lumen-people', adapter.key, 'email'],
    queryFn: () => api?.view() ?? Promise.reject(new Error('Email settings are not set up here.')),
  });
  if (!q.data)
    return (
      <p className="text-muted-foreground text-sm">{q.isError ? errorText(q.error) : 'Loading…'}</p>
    );
  return <EmailForm adapter={adapter} view={q.data} inline={inline} />;
}

function EmailForm({
  adapter,
  view,
  inline,
}: {
  adapter: PeopleAdapter;
  view: EmailSettingsView;
  inline: boolean;
}) {
  const api = adapter.email;
  const qc = useQueryClient();
  const ids = useId();
  const [draft, setDraft] = useState(() => blank(view));
  const [replacing, setReplacing] = useState(!view.current);
  const [result, setResult] = useState<{ for: EmailDraft; check: EmailCheck } | null>(null);
  const [busy, setBusy] = useState<'check' | 'test' | 'save' | null>(null);
  const [testTo, setTestTo] = useState(view.me);
  // Each route keeps what was typed for it, so switching back and forth loses nothing.
  const [perRoute, setPerRoute] = useState<
    Record<string, { url: string; apiKey: string; replacing: boolean }>
  >({});
  // Start over only when the saved settings change, never on a refetch of the same ones.
  const savedKey = `${view.current?.updatedAt ?? ''}|${view.current?.route ?? ''}|${view.current?.url ?? ''}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the saved settings change
  useEffect(() => {
    setDraft(blank(view));
    setReplacing(!view.current);
    setPerRoute({});
  }, [savedKey]);
  if (!api) return null;

  const route = view.routes.find((r) => r.id === draft.route);
  const changed = !view.current || !same(draft, { ...blank(view), apiKey: '' });
  const passed = !!result?.check.ok && same(result.for, draft);
  const set = (patch: Partial<EmailDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const run = async (kind: 'check' | 'test') => {
    setBusy(kind);
    try {
      const check = await (kind === 'check'
        ? api.check(draft)
        : api.test({ ...draft, testTo: testTo.trim() }));
      setResult({ for: draft, check });
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      const next = await api.save(draft);
      qc.setQueryData(['lumen-people', adapter.key, 'email'], next);
      await qc.invalidateQueries({ queryKey: ['lumen-people', adapter.key] });
      setReplacing(false);
      setResult(null);
      lumenToast.success('Email saved. Invites now go out by email.');
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const issues: FormIssue[] = [];
  if (!draft.url.trim())
    issues.push({ where: 'Server address', message: 'Enter the address', target: `${ids}-url` });
  if (replacing && !draft.apiKey?.trim())
    issues.push({ where: 'API key', message: 'Enter the key', target: `${ids}-key` });
  if (!draft.from.trim())
    issues.push({
      where: 'Address',
      message: 'Enter who mail is sent from',
      target: `${ids}-from`,
    });
  const ready = issues.length === 0;
  if (ready && changed && !passed)
    issues.push({ where: 'Test it', message: 'Check the connection or send a test first' });

  const badge = passed ? (
    <Badge variant="secondary">Ready to save</Badge>
  ) : view.current ? (
    view.lastTest && !view.lastTest.ok ? (
      <Badge variant="destructive">Last test failed</Badge>
    ) : (
      <Badge variant="secondary" className="text-gain">
        Working
      </Badge>
    )
  ) : (
    <Badge variant="outline">Not set up</Badge>
  );
  const footer = (
    <div className="flex w-full items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
        {passed
          ? 'Passed'
          : view.current
            ? `Saved by ${view.current.updatedBy ?? '—'} ${when(view.current.updatedAt)}`
            : 'Test to save'}
      </span>
      {changed && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(blank(view));
            setReplacing(!view.current);
            setPerRoute({});
            setResult(null);
          }}
        >
          Revert
        </Button>
      )}
      <SaveButton issues={issues} busy={busy === 'save'} disabled={!changed} onSave={save} />
    </div>
  );

  return (
    <div className="flex flex-col">
      {inline ? (
        <div className="flex justify-end pb-2">{badge}</div>
      ) : (
        <SettingsActions>{badge}</SettingsActions>
      )}
      <Step n={1} title="Reach the server through">
        <LumenChoice
          label="Reach the server through"
          value={draft.route}
          options={view.routes.map((r) => ({
            value: r.id,
            icon: r.id === 'public' ? GlobeIcon : CableIcon,
            title: (
              <span className="flex w-full items-center gap-2">
                {r.label}
                {r.state && (
                  <span className="ml-auto font-normal text-gain text-xs">{r.state}</span>
                )}
              </span>
            ),
          }))}
          onValueChange={(id) => {
            if (id === draft.route) return;
            setPerRoute((m) => ({
              ...m,
              [draft.route]: { url: draft.url, apiKey: draft.apiKey ?? '', replacing },
            }));
            const kept = perRoute[id];
            const next = view.routes.find((r) => r.id === id);
            const onSaved = !!view.current && view.current.route === id;
            const url = kept?.url ?? (onSaved ? view.current?.url : undefined) ?? next?.url ?? '';
            // The saved key carries to every route (the same server is often reached either way).
            setReplacing(kept?.replacing ?? !view.current);
            set({ route: id, url, apiKey: kept?.apiKey ?? '' });
          }}
        />
      </Step>
      <Step n={2} title="Email server">
        <Labelled
          id={`${ids}-url`}
          label={<InfoLabel info={route?.urlInfo}>Server address</InfoLabel>}
        >
          <Input
            id={`${ids}-url`}
            className="font-code text-xs"
            value={draft.url}
            placeholder={route?.url ?? 'https://api.resend.com'}
            onChange={(e) => set({ url: e.target.value })}
          />
        </Labelled>
        <Labelled id={`${ids}-key`} label="API key">
          {replacing ? (
            <div className="flex gap-2">
              <Input
                id={`${ids}-key`}
                type="password"
                autoComplete="off"
                className="font-code text-xs"
                value={draft.apiKey ?? ''}
                onChange={(e) => set({ apiKey: e.target.value })}
              />
              {view.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReplacing(false);
                    set({ apiKey: '' });
                  }}
                >
                  Keep
                </Button>
              )}
            </div>
          ) : (
            <div className="flex h-9 items-center gap-3 rounded-md border px-3 text-sm">
              <span className="font-code text-muted-foreground text-xs">
                {view.current?.keyHint}
              </span>
              <span className="ml-auto text-gain text-xs">sealed</span>
              <Button size="xs" variant="link" onClick={() => setReplacing(true)}>
                Replace
              </Button>
            </div>
          )}
        </Labelled>
      </Step>
      <Step n={3} title="Sent from">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Labelled id={`${ids}-name`} label="Name" className="sm:flex-1">
            <Input
              id={`${ids}-name`}
              value={draft.fromName}
              onChange={(e) => set({ fromName: e.target.value })}
            />
          </Labelled>
          <Labelled id={`${ids}-from`} label="Address" className="sm:flex-[1.4]">
            <Input
              id={`${ids}-from`}
              type="email"
              value={draft.from}
              placeholder="hello@example.com"
              onChange={(e) => set({ from: e.target.value })}
            />
          </Labelled>
        </div>
      </Step>
      <Step n={4} title="Test it">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || !!busy}
            onClick={() => run('check')}
          >
            {busy === 'check' ? <Spinner /> : <PlugZapIcon />} Check connection
          </Button>
        </div>
        <Labelled id={`${ids}-test-to`} label="Send a test email to">
          <div className="flex gap-2">
            <Input
              id={`${ids}-test-to`}
              type="email"
              className="text-sm"
              value={testTo}
              placeholder={view.me}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!ready || !!busy || !testTo.trim()}
              onClick={() => run('test')}
            >
              {busy === 'test' ? <Spinner /> : <MailIcon />} Send test
            </Button>
          </div>
        </Labelled>
        {result && same(result.for, draft) && <Steps check={result.check} />}
        {!result && view.lastTest && (
          <p className="text-muted-foreground text-xs">
            Last {view.lastTest.kind === 'test' ? 'test' : 'check'} {when(view.lastTest.at)}:{' '}
            {view.lastTest.ok ? 'passed' : 'failed'}.
          </p>
        )}
      </Step>
      {inline ? (
        <div className="border-t pt-3">{footer}</div>
      ) : (
        <SettingsFooter>{footer}</SettingsFooter>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-4 border-t py-5 first-of-type:border-t-0" aria-label={title}>
      <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-xs">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h3 className="font-medium text-sm">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function Labelled({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </label>
      {children}
    </div>
  );
}

function Steps({ check }: { check: EmailCheck }) {
  return (
    <ul className="flex flex-col gap-2 rounded-lg border bg-muted/50 px-3.5 py-3 text-sm">
      {check.steps.map((s) => (
        <li key={s.id} className="flex items-center gap-2.5">
          {s.ok === true ? (
            <CheckIcon className="size-4 shrink-0 text-gain" />
          ) : s.ok === false ? (
            <XIcon className="size-4 shrink-0 text-loss" />
          ) : (
            <CircleHelpIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">{s.text}</span>
          {s.ms !== null && <span className="num text-muted-foreground text-xs">{s.ms} ms</span>}
        </li>
      ))}
    </ul>
  );
}
