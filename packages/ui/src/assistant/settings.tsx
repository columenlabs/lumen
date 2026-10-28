// The assistant's Settings sections, for any app on `@columenlabs/lumen-ai/assistant`: the assistant
// itself (tier, hand off, advice), then Model providers (a person's own key for each provider and
// its monthly cap), Models (each tier's model and effort, each task's starting tier), Tools (each group
// Off, Read or Read + draft), Web (fetch, ScrapeQL's token) and Spend (this month). Keys and tokens
// are tested before they are kept and never shown again, only their last characters. The app's
// shared keys and the allowance on them are the admin's section (`assistantAdminSections`).
import type {
  AllowanceRequest,
  AssistantAccess,
  AssistantEffort,
  AssistantOwnWay,
  AssistantProviderRow,
  AssistantSettingsPatch,
  AssistantStatus,
  HandOffPolicy,
  KeyState,
} from '@columenlabs/lumen-ui-types/assistant';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CoinsIcon,
  GlobeIcon,
  InboxIcon,
  KeyRoundIcon,
  LayersIcon,
  Link2Icon,
  LogInIcon,
  ReceiptIcon,
  SendIcon,
  SparklesIcon,
  WrenchIcon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import {
  ConnectionLogo,
  type ConnectionTest,
  type ConnectionWay,
  LumenConnection,
} from '../connection';
import { LumenExpandList, LumenExpandRow } from '../expand-list';
import { type FormIssue, SaveButton } from '../form-issues';
import { InfoLabel } from '../info-tip';
import { errorText } from '../integrations';
import { LumenSelector } from '../lumen-selector';
import { lumenToast } from '../lumen-toast';
import type { SettingsSectionDef } from '../settings';
import { ShareMeter } from '../share-meter';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import type { AssistantAdapter } from './client';
import { allowanceAmount, assistantStatusKey, usd, useAssistantStatus } from './lumen-assistant';

const EFFORTS: { value: AssistantEffort; label: string }[] = [
  { value: 'default', label: 'Model default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const HAND_OFF: { value: HandOffPolicy; label: string }[] = [
  { value: 'next', label: 'Next tier up' },
  { value: 'any', label: 'Any higher tier' },
  { value: 'ask', label: 'Only when I ask' },
];

const ACCESS: { value: AssistantAccess; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'read', label: 'Read' },
  { value: 'draft', label: 'Read + draft' },
  { value: 'write', label: 'Read + write' },
];

/** Runs a change and keeps the status it returns, or says why it failed. */
function useApply(client: AssistantAdapter) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const apply = async (what: string, run: () => Promise<AssistantStatus>, done?: string) => {
    setBusy(what);
    try {
      qc.setQueryData(assistantStatusKey(client), await run());
      if (done) lumenToast.success(done);
      return true;
    } catch (e) {
      lumenToast.error(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const refresh = () => qc.invalidateQueries({ queryKey: assistantStatusKey(client) });
  return { apply, busy, refresh };
}

/** The section's body once the status loads. */
function WithStatus({
  client,
  children,
}: {
  client: AssistantAdapter;
  children: (s: AssistantStatus) => ReactNode;
}) {
  const q = useAssistantStatus(client);
  if (!q.data)
    return (
      <p className="text-muted-foreground text-sm">{q.isError ? errorText(q.error) : 'Loading…'}</p>
    );
  return <>{children(q.data)}</>;
}

/** One setting: its label (with an (i) when `info` says more) and its control. */
function Row({ label, info, children }: { label: string; info?: ReactNode; children: ReactNode }) {
  return (
    <div
      data-slot="setting-row"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-3 last:border-b-0"
    >
      <Label className="min-w-0 flex-1">
        <InfoLabel info={info}>{label}</InfoLabel>
      </Label>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- the assistant

function General({ client }: { client: AssistantAdapter }) {
  const { apply } = useApply(client);
  const set = (patch: AssistantSettingsPatch) => apply('settings', () => client.settings(patch));
  return (
    <WithStatus client={client}>
      {(s) => {
        const above = s.tiers.slice(s.tiers.findIndex((t) => t.id === s.tier) + 1);
        return (
          <div className="flex flex-col">
            <Row label="Tier">
              <LumenSelector
                label="Tier"
                size="sm"
                className="w-44"
                value={s.tier}
                options={s.tiers.map((t) => ({
                  value: t.id,
                  label: t.label,
                  detail: t.model_label,
                }))}
                onChange={(tier) => void set({ tier })}
              />
            </Row>
            {s.tiers.length > 1 && (
              <Row
                label="Hand off the work"
                info="On its own, a higher tier takes one task in its own section of the chat and sends back a memo. It costs more."
              >
                <LumenSelector
                  label="Hand off the work"
                  size="sm"
                  className="w-44"
                  value={s.hand_off}
                  options={HAND_OFF}
                  onChange={(hand_off) => void set({ hand_off })}
                />
              </Row>
            )}
            {s.tiers.length > 1 && (
              <Row
                label="Ask for advice"
                info="A bigger tier reads the chat and sends a plan before hard questions. It runs no tools, at most twice an answer."
              >
                <LumenSelector
                  label="Ask for advice"
                  size="sm"
                  className="w-44"
                  value={s.advice}
                  options={[
                    { value: 'off', label: 'Off' },
                    ...(above.length ? above : s.tiers).map((t) => ({
                      value: t.id,
                      label: t.label,
                    })),
                  ]}
                  onChange={(advice) => void set({ advice })}
                />
              </Row>
            )}
          </div>
        );
      }}
    </WithStatus>
  );
}

// ---------------------------------------------------------------- model providers

/** A dollar cap a month, saved on Enter or leaving the field. */
function CapInput({
  label,
  value,
  onSave,
}: { label: string; value: number; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(Math.round(n * 100) / 100);
    else setText(String(value));
  };
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-muted-foreground">$</span>
      <Input
        aria-label={label}
        inputMode="decimal"
        className="h-8 w-20 text-right tabular-nums"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="text-muted-foreground">/ month</span>
    </div>
  );
}

/** A key's last test as a connection way shows it; a plan that failed asks for a new sign-in. */
const wayTest = (k: KeyState | undefined, plan = false): ConnectionTest | null =>
  k?.test
    ? {
        at: k.test.at,
        ok: k.test.ok,
        detail: k.test.detail,
        error: k.test.ok ? null : k.test.detail,
        expired: plan && !k.test.ok,
      }
    : null;

/** A provider's mark: its initial on a tile. */
const mark = (label: string) => <ConnectionLogo text={label.charAt(0)} />;

/** One provider, collapsed to a row: the person's own key and, where it has one, their plan sign-in. */
function OwnProviderKey({ client, p }: { client: AssistantAdapter; p: AssistantProviderRow }) {
  const { apply, refresh } = useApply(client);
  const ways: ConnectionWay[] = [];
  if (p.signin === 'chatgpt')
    ways.push({
      id: 'plan',
      label: 'ChatGPT plan',
      icon: LogInIcon,
      info: 'Run OpenAI models on your own ChatGPT plan instead of an API key.',
      set: !!p.plan?.set,
      ident: p.plan?.hint,
      test: wayTest(p.plan, true),
      signin: { start: () => client.startSignin(p.id), provider: 'ChatGPT' },
      onFinish: (url) => apply(`signin:${p.id}`, () => client.finishSignin(p.id, url), 'Signed in'),
      onTest: () => client.testOwnKey(p.id, 'plan').finally(refresh),
      onRemove: () => apply(`plan:${p.id}`, () => client.signOut(p.id), 'Signed out'),
      removeTitle: 'Sign out of your ChatGPT plan?',
      removeText: 'Your API key, if you set one, runs from then on.',
      removeLabel: 'Sign out',
    });
  ways.push({
    id: 'key',
    label: 'API key',
    icon: KeyRoundIcon,
    info: `Your own ${p.label} key, billed by ${p.label}.`,
    set: p.own.set,
    ident: p.own.hint,
    test: wayTest(p.own),
    fields: [{ id: 'key', label: `${p.label} API key`, secret: true, prefix: p.prefix }],
    getUrl: p.keys_url,
    onSave: (v) => apply(`own:${p.id}`, () => client.ownKey(p.id, v.key ?? ''), 'Key saved'),
    onTest: () => client.testOwnKey(p.id, 'key').finally(refresh),
    onRemove: () => apply(`own:${p.id}`, () => client.ownKey(p.id, null), 'Key removed'),
    removeTitle: `Remove your ${p.label} key?`,
  });
  return (
    <LumenConnection
      id={p.id}
      name={p.label}
      logo={mark(p.label)}
      ways={ways}
      use={p.use}
      onUse={(use) =>
        apply(`use:${p.id}`, () => client.settings({ own_use: { [p.id]: use as AssistantOwnWay } }))
      }
    />
  );
}

/** A person's own keys, one row a provider, and what they may spend on them. */
function Providers({ client }: { client: AssistantAdapter }) {
  const { apply } = useApply(client);
  return (
    <WithStatus client={client}>
      {(s) => (
        <div className="flex flex-col">
          <LumenExpandList>
            {s.providers.map((p) => (
              <OwnProviderKey key={p.id} client={client} p={p} />
            ))}
          </LumenExpandList>
          {s.providers.some((p) => p.own.set || p.plan?.set) && (
            <Row label="Your keys may spend" info="On your keys, every provider together.">
              <CapInput
                label="Your monthly cap"
                value={s.caps.own}
                onSave={(n) => void apply('own', () => client.ownCap(n))}
              />
            </Row>
          )}
        </div>
      )}
    </WithStatus>
  );
}

/** One provider's shared key, which an admin sets for everyone. */
function SharedProviderKey({ client, p }: { client: AssistantAdapter; p: AssistantProviderRow }) {
  const { apply, refresh } = useApply(client);
  const env = !p.app.set && !!p.app.from_env;
  return (
    <LumenConnection
      id={p.id}
      name={p.label}
      logo={mark(p.label)}
      ways={[
        {
          id: 'key',
          label: 'Shared key',
          icon: KeyRoundIcon,
          info: "Everyone's answers run on it, within the allowance below.",
          set: p.app.set || env,
          ident: env ? 'From the server' : p.app.hint,
          test: wayTest(p.app),
          fields: [{ id: 'key', label: `${p.label} API key`, secret: true, prefix: p.prefix }],
          getUrl: p.keys_url,
          onSave: (v) => apply(`app:${p.id}`, () => client.appKey(p.id, v.key ?? ''), 'Key saved'),
          onTest: () => client.testAppKey(p.id).finally(refresh),
          ...(p.app.set
            ? {
                onRemove: () =>
                  apply(`app:${p.id}`, () => client.appKey(p.id, null), 'Key removed'),
                removeTitle: `Remove the shared ${p.label} key?`,
                removeText: 'Answers on it stop until a key is set again.',
              }
            : {}),
        },
      ]}
    />
  );
}

/** Admins only: the app's shared keys and what each person may spend on them. */
function SharedKeys({ client }: { client: AssistantAdapter }) {
  const { apply } = useApply(client);
  return (
    <WithStatus client={client}>
      {(s) =>
        s.admin ? (
          <div className="flex flex-col">
            <LumenExpandList>
              {s.providers.map((p) => (
                <SharedProviderKey key={p.id} client={client} p={p} />
              ))}
            </LumenExpandList>
            {/* A one-off allowance has no monthly cap: starter and grants set it. */}
            {s.allowance?.period !== 'once' && (
              <Row
                label="Each person may spend"
                info="A month on the shared keys, every provider together. Past it, a person's own key pays."
              >
                <CapInput
                  label="Allowance per person"
                  value={s.caps.app}
                  onSave={(n) => void apply('cap', () => client.appCap(n))}
                />
              </Row>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Only an admin can change these.</p>
        )
      }
    </WithStatus>
  );
}

// ---------------------------------------------------------------- models

function Models({ client }: { client: AssistantAdapter }) {
  const { apply } = useApply(client);
  const set = (patch: AssistantSettingsPatch) =>
    void apply('settings', () => client.settings(patch));
  return (
    <WithStatus client={client}>
      {(s) => {
        const models = s.models.map((m) => ({ value: m.id, label: m.label, group: m.group }));
        const tiers = s.tiers.map((t) => ({ value: t.id, label: t.label }));
        return (
          <div className="flex flex-col">
            {s.tiers.map((t) => {
              const p = s.providers.find((x) => x.id === t.provider);
              const keyless = p && !p.app.set && !p.app.from_env && !p.own.set && !p.plan?.set;
              return (
                <Row key={t.id} label={t.label} info={t.about}>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {keyless && <Badge variant="outline">No {p.label} key</Badge>}
                    <LumenSelector
                      label={`${t.label} model`}
                      size="sm"
                      className="w-36 sm:w-44"
                      value={t.model}
                      options={models}
                      onChange={(model) => set({ tiers: { [t.id]: { model } } })}
                    />
                    <LumenSelector
                      label={`${t.label} effort`}
                      size="sm"
                      className="w-24 sm:w-32"
                      value={t.effort}
                      options={EFFORTS}
                      onChange={(effort) => set({ tiers: { [t.id]: { effort } } })}
                    />
                  </div>
                </Row>
              );
            })}
            {s.tasks.length > 1 &&
              s.tasks.map((task) => (
                <Row key={task.id} label={`${task.label} starts on`}>
                  <LumenSelector
                    label={`${task.label} starts on`}
                    size="sm"
                    className="w-44"
                    value={task.tier}
                    options={tiers}
                    onChange={(tier) => set({ tasks: { [task.id]: tier } })}
                  />
                </Row>
              ))}
          </div>
        );
      }}
    </WithStatus>
  );
}

// ---------------------------------------------------------------- tools

function Tools({ client }: { client: AssistantAdapter }) {
  const { apply } = useApply(client);
  return (
    <WithStatus client={client}>
      {(s) =>
        s.groups.length ? (
          <div className="flex flex-col">
            {s.groups.map((g) => (
              <Row key={g.id} label={g.label} info={g.about}>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={g.access}
                  aria-label={g.label}
                  onValueChange={(v) =>
                    v &&
                    void apply('access', () =>
                      client.settings({ access: { [g.id]: v as AssistantAccess } }),
                    )
                  }
                >
                  {ACCESS.filter(
                    (a) => (a.value !== 'draft' || g.drafts) && (a.value !== 'write' || g.writes),
                  ).map((a) => (
                    <ToggleGroupItem key={a.value} value={a.value}>
                      {a.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Row>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            This app gives the assistant no tools yet.
          </p>
        )
      }
    </WithStatus>
  );
}

// ---------------------------------------------------------------- web

function ScrapeqlBlock({ client, s }: { client: AssistantAdapter; s: AssistantStatus }) {
  const { apply, refresh } = useApply(client);
  const state = s.web.scrapeql;
  if (!state) return null;
  // Reached over the app's service binding: nothing to paste, only a test.
  if (state.bound)
    return (
      <LumenExpandList>
        <LumenConnection
          id="scrapeql"
          name="ScrapeQL"
          logo={<ConnectionLogo icon={GlobeIcon} />}
          meta="Linked to this app, no token needed"
          ways={[
            {
              id: 'link',
              label: 'App link',
              icon: Link2Icon,
              info: 'This app reaches ScrapeQL over a Cloudflare service binding, so no token is stored.',
              set: true,
              test: wayTest(state),
              note: 'Set by the app',
              readOnly: true,
              ...(s.admin ? { onTest: () => client.testScrapeql().finally(refresh) } : {}),
            },
          ]}
        />
      </LumenExpandList>
    );
  return (
    <LumenExpandList>
      <LumenConnection
        id="scrapeql"
        name="ScrapeQL"
        logo={<ConnectionLogo icon={GlobeIcon} />}
        meta={state.set ? undefined : 'Search and pages that need a real browser'}
        ways={[
          {
            id: 'token',
            label: 'Service token',
            icon: KeyRoundIcon,
            info: 'A Cloudflare Access service token that ScrapeQL lets in.',
            set: state.set,
            ident: state.hint,
            test: wayTest(state),
            readOnly: !s.admin,
            fields: [
              { id: 'client_id', label: 'Client ID' },
              { id: 'client_secret', label: 'Client Secret', secret: true },
            ],
            onSave: (v) =>
              apply(
                'scrapeql',
                () =>
                  client.scrapeql({
                    client_id: v.client_id ?? '',
                    client_secret: v.client_secret ?? '',
                  }),
                'Token saved',
              ),
            ...(s.admin ? { onTest: () => client.testScrapeql().finally(refresh) } : {}),
            onRemove: () => apply('scrapeql', () => client.scrapeql(null), 'Token removed'),
            removeTitle: 'Remove the ScrapeQL token?',
            removeText: 'Search and browser pages stop until a token is set again.',
          },
        ]}
      />
    </LumenExpandList>
  );
}

function Web({ client }: { client: AssistantAdapter }) {
  const { apply } = useApply(client);
  return (
    <WithStatus client={client}>
      {(s) => (
        <div className="flex flex-col">
          <Row
            label="Read the web"
            info="A plain fetch of public pages and APIs from the server, never the app's own pages."
          >
            <Switch
              aria-label="Read the web"
              checked={s.web.fetch}
              onCheckedChange={(fetch) =>
                void apply('web', () => client.settings({ web: { fetch } }))
              }
            />
          </Row>
          <ScrapeqlBlock client={client} s={s} />
        </div>
      )}
    </WithStatus>
  );
}

// ---------------------------------------------------------------- spend

function Spend({ client }: { client: AssistantAdapter }) {
  return (
    <WithStatus client={client}>
      {(s) => {
        const sp = s.spend;
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-2xl tabular-nums">{usd(sp.usd)}</span>
              <span className="text-muted-foreground text-sm">
                {sp.month}
                {sp.cap != null &&
                  sp.payer &&
                  ` · ${usd(sp.cap)} cap on ${sp.payer === 'app' ? 'the app key' : 'your key'}`}
              </span>
            </div>
            {sp.rows.length ? (
              <div className="flex flex-col text-sm">
                {sp.rows.map((r) => (
                  <div
                    key={`${r.label}:${r.payer}`}
                    className="flex items-center gap-2 border-b py-2 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {r.payer === 'app' ? 'Shared key' : 'Your key'}
                    </span>
                    <span className="w-16 text-right text-muted-foreground text-xs tabular-nums">
                      {r.calls} calls
                    </span>
                    <span className="w-16 text-right tabular-nums">{usd(r.usd)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nothing spent this month.</p>
            )}
          </div>
        );
      }}
    </WithStatus>
  );
}

// ---------------------------------------------------------------- allowance

const day = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function RequestBadge({ r }: { r: AllowanceRequest }) {
  if (r.status === 'open') return <Badge variant="outline">Waiting</Badge>;
  if (r.status === 'granted') return <Badge variant="secondary">Granted</Badge>;
  return <Badge variant="outline">Declined</Badge>;
}

/** A person's allowance on the shared keys, their newest request and Request more. */
function Allowance({ client }: { client: AssistantAdapter }) {
  const { apply, busy } = useApply(client);
  const [amount, setAmount] = useState<string>('');
  const [why, setWhy] = useState('');
  const whyId = useId();
  return (
    <WithStatus client={client}>
      {(s) => {
        const a = s.allowance;
        const requestMore = client.requestMore;
        if (!a || !requestMore)
          return <p className="text-muted-foreground text-sm">This app sets no allowance.</p>;
        const n = (x: number) => allowanceAmount(a.unit, x);
        const r = a.request;
        const pick = amount || String(a.amounts[0] ?? '');
        const issues: FormIssue[] = [
          ...(pick ? [] : [{ where: 'Amount', message: 'Pick how much to ask for' }]),
          ...(why.trim()
            ? []
            : [{ where: 'What for', message: 'Say what it is for', target: whyId }]),
        ];
        const ask = () =>
          void apply('request', () => requestMore(Number(pick), why.trim()), 'Request sent').then(
            (ok) => ok && setWhy(''),
          );
        return (
          <div className="flex flex-col">
            <div className="flex flex-col gap-2 border-b pb-3">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-2xl tabular-nums">{n(a.left)}</span>
                <span className="text-muted-foreground text-sm">
                  left of {n(a.total)}
                  {a.period === 'month' ? ' this month' : ''}
                </span>
              </div>
              <ShareMeter value={a.total > 0 ? a.used / a.total : 1} wide />
            </div>
            {r && (
              <Row label={`Asked for ${n(r.amount)} · ${day(r.at)}`} info={r.why || undefined}>
                <div className="flex items-center gap-2 text-sm">
                  {r.status === 'granted' && r.granted !== undefined && (
                    <span className="tabular-nums">+{n(r.granted)}</span>
                  )}
                  <RequestBadge r={r} />
                </div>
              </Row>
            )}
            {r?.status === 'open' ? (
              <p className="pt-3 text-muted-foreground text-sm">
                You can ask again once this one is decided.
              </p>
            ) : (
              <div className="flex flex-col gap-2 pt-3">
                <Input
                  id={whyId}
                  aria-label="What for"
                  placeholder="What it is for"
                  className="h-8 w-full"
                  maxLength={500}
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <LumenSelector
                    label="Amount"
                    size="sm"
                    className="w-40"
                    value={pick}
                    options={a.amounts.map((x) => ({ value: String(x), label: n(x) }))}
                    onChange={(v) => setAmount(v)}
                  />
                  <SaveButton
                    issues={issues}
                    label="Request more"
                    icon={SendIcon}
                    busy={busy === 'request'}
                    onSave={ask}
                  />
                </div>
              </div>
            )}
          </div>
        );
      }}
    </WithStatus>
  );
}

/** One request, opened in place to grant (any amount) or decline. */
function RequestRow({
  client,
  r,
  n,
  onDone,
}: {
  client: AssistantAdapter;
  r: AllowanceRequest;
  n: (x: number) => string;
  onDone: () => void;
}) {
  const [text, setText] = useState(String(r.amount));
  const [busy, setBusy] = useState<string | null>(null);
  const amountId = useId();
  const value = Number(text);
  const decide = async (action: 'grant' | 'decline') => {
    if (!client.decideRequest) return;
    setBusy(action);
    try {
      await client.decideRequest(r.id, action, action === 'grant' ? value : undefined);
      lumenToast.success(action === 'grant' ? `Granted ${n(value)}` : 'Declined');
      onDone();
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const issues: FormIssue[] =
    Number.isFinite(value) && value > 0
      ? []
      : [{ where: 'Grant', message: 'Grant more than 0', target: amountId }];
  return (
    <LumenExpandRow
      id={r.id}
      name={r.who}
      meta={`${n(r.amount)} · ${day(r.at)}`}
      badge={<RequestBadge r={r} />}
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="whitespace-pre-wrap">{r.why || 'No reason given.'}</p>
        {r.status === 'open' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={amountId}
              aria-label="Grant"
              inputMode="decimal"
              className="h-8 w-24 text-right tabular-nums"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <SaveButton
              issues={issues}
              label="Grant"
              busy={busy === 'grant'}
              onSave={() => void decide('grant')}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => void decide('decline')}
            >
              Decline
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">
            {r.status === 'granted' ? `Granted ${n(r.granted ?? r.amount)}` : 'Declined'}
            {r.decided_by ? ` by ${r.decided_by}` : ''}
            {r.decided_at ? ` · ${day(r.decided_at)}` : ''}
          </p>
        )}
      </div>
    </LumenExpandRow>
  );
}

/** Approvers: every request for more allowance, open ones first. */
function AllowanceRequests({ client }: { client: AssistantAdapter }) {
  const qc = useQueryClient();
  const key = [...assistantStatusKey(client), 'allowance-requests'];
  const q = useQuery({
    queryKey: key,
    queryFn: () => client.allowanceRequests?.() ?? Promise.resolve([]),
    enabled: !!client.allowanceRequests,
  });
  return (
    <WithStatus client={client}>
      {(s) => {
        const a = s.allowance;
        if (!a || !client.allowanceRequests)
          return <p className="text-muted-foreground text-sm">This app sets no allowance.</p>;
        if (!a.approver)
          return <p className="text-muted-foreground text-sm">Only an approver can see these.</p>;
        if (!q.data)
          return (
            <p className="text-muted-foreground text-sm">
              {q.isError ? errorText(q.error) : 'Loading…'}
            </p>
          );
        if (!q.data.length)
          return <p className="text-muted-foreground text-sm">No requests yet.</p>;
        const rows = [...q.data].sort(
          (x, y) => Number(y.status === 'open') - Number(x.status === 'open') || y.at - x.at,
        );
        const done = () => {
          void qc.invalidateQueries({ queryKey: assistantStatusKey(client) });
        };
        return (
          <LumenExpandList>
            {rows.map((r) => (
              <RequestRow
                key={r.id}
                client={client}
                r={r}
                n={(x) => allowanceAmount(a.unit, x)}
                onDone={done}
              />
            ))}
          </LumenExpandList>
        );
      }}
    </WithStatus>
  );
}

/**
 * The admin's section: the app's shared keys and each person's monthly allowance on them. Put it
 * where the app keeps its admin settings, shown only to admins.
 */
export function assistantAdminSections({
  client,
  allowance = false,
}: {
  client: AssistantAdapter;
  /** Add Allowance requests (the app set `allowance` on the server). */
  allowance?: boolean;
}): SettingsSectionDef[] {
  return [
    {
      id: 'assistant-shared-keys',
      title: 'Shared model keys',
      icon: KeyRoundIcon,
      description: "Keys everyone's answers run on, and the allowance",
      content: <SharedKeys client={client} />,
    },
    ...(allowance
      ? [
          {
            id: 'assistant-allowance-requests',
            title: 'Allowance requests',
            icon: InboxIcon,
            description: 'Grant or decline asks for more allowance',
            content: <AllowanceRequests client={client} />,
          },
        ]
      : []),
  ];
}

/**
 * The assistant's Settings sections: the assistant, then Model providers, Models, Tools, Web and
 * Spend under it. Pass them to LumenShell's `shared` (or an app's own `settings`).
 */
export function assistantSettingsSections({
  client,
  name,
  web = true,
  allowance = false,
}: {
  client: AssistantAdapter;
  /** The assistant's name, the parent section's title. */
  name: string;
  /** Show the Web section (the app set up `web` on the server). */
  web?: boolean;
  /** Show Allowance: what is left on the shared keys, and Request more (`allowance` on the server). */
  allowance?: boolean;
}): SettingsSectionDef[] {
  return [
    {
      id: 'assistant',
      title: name,
      icon: SparklesIcon,
      description: 'Which tier answers, and when it asks a bigger one',
      content: <General client={client} />,
    },
    {
      id: 'assistant-providers',
      title: 'Model providers',
      icon: KeyRoundIcon,
      sub: true,
      description: 'Your own key for each provider',
      content: <Providers client={client} />,
    },
    {
      id: 'assistant-models',
      title: 'Models',
      icon: LayersIcon,
      sub: true,
      description: "Each tier's model and effort",
      content: <Models client={client} />,
    },
    {
      id: 'assistant-tools',
      title: 'Tools',
      icon: WrenchIcon,
      sub: true,
      description: 'What the assistant may read and draft',
      content: <Tools client={client} />,
    },
    ...(web
      ? [
          {
            id: 'assistant-web',
            title: 'Web',
            icon: GlobeIcon,
            sub: true,
            description: 'Reading public pages and search',
            content: <Web client={client} />,
          },
        ]
      : []),
    {
      id: 'assistant-spend',
      title: 'Spend',
      icon: ReceiptIcon,
      sub: true,
      description: 'What answers cost this month',
      content: <Spend client={client} />,
    },
    ...(allowance
      ? [
          {
            id: 'assistant-allowance',
            title: 'Allowance',
            icon: CoinsIcon,
            sub: true,
            description: 'What is left on the shared keys, and Request more',
            content: <Allowance client={client} />,
          },
        ]
      : []),
  ];
}
