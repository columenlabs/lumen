// The assistant's Settings sections, for any app on `@columenlabs/lumen-ai/assistant`: the assistant
// itself (tier, hand off, advice), then Model providers (each provider's app key and a person's own
// key, the monthly caps, who pays), Models (each tier's model and effort, each task's starting tier), Tools (each group
// Off, Read or Read + draft), Web (fetch, ScrapeQL's token) and Spend (this month). Keys and tokens
// are tested before they are kept and never shown again, only their last characters.
import type {
  AssistantAccess,
  AssistantEffort,
  AssistantPayer,
  AssistantProviderRow,
  AssistantSettingsPatch,
  AssistantStatus,
  HandOffPolicy,
  KeyState,
} from '@columenlabs/lumen-ui-types/assistant';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  ExternalLinkIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayersIcon,
  ReceiptIcon,
  SparklesIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { LumenExpandList, LumenExpandRow } from '../expand-list';
import { type FormIssue, SaveButton } from '../form-issues';
import { IconButton } from '../icon-button';
import { InfoLabel } from '../info-tip';
import { KeyTestLine, TestBadge, errorText } from '../integrations';
import { LumenSelector } from '../lumen-selector';
import { lumenToast } from '../lumen-toast';
import type { SettingsSectionDef } from '../settings';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import type { AssistantAdapter } from './client';
import { assistantStatusKey, usd, useAssistantStatus } from './lumen-assistant';

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

const testOf = (k: KeyState) =>
  k.test
    ? {
        at: new Date(k.test.at).toISOString(),
        ok: k.test.ok,
        detail: k.test.detail,
        error: k.test.ok ? null : k.test.detail,
      }
    : null;

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

/** Paste a key, Save tests it first; then its hint, Test and Remove. */
function KeyBlock({
  label,
  prefix,
  provider,
  state,
  canEdit,
  onSave,
  onRemove,
  onTest,
  keysUrl,
}: {
  label: string;
  prefix: string;
  provider: string;
  /** Where a key is made: a link that opens in a new tab beside the empty field. */
  keysUrl?: string;
  state: KeyState & { from_env?: boolean };
  canEdit: boolean;
  onSave: (key: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onTest: () => Promise<unknown>;
}) {
  const id = useId();
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = canEdit && (!state.set || replacing);
  const issues: FormIssue[] = [];
  if (editing && key.trim() && !key.trim().startsWith(prefix))
    issues.push({ where: label, message: `An ${provider} key starts with ${prefix}`, target: id });
  const save = async () => {
    setBusy(true);
    if (await onSave(key.trim())) {
      setKey('');
      setReplacing(false);
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 border-b py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-medium text-sm">{label}</span>
        {state.set ? (
          state.hint ? (
            <span className="font-code text-muted-foreground text-xs">{state.hint}</span>
          ) : (
            <Badge variant="secondary">Set</Badge>
          )
        ) : state.from_env ? (
          <Badge variant="secondary">From the server</Badge>
        ) : (
          <Badge variant="outline">Not set</Badge>
        )}
        {state.set && state.test && <TestBadge test={state.test} />}
      </div>
      {editing ? (
        <div className="flex gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            placeholder={`${prefix}…`}
            className="font-code text-xs"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {keysUrl && (
            <IconButton
              icon={ExternalLinkIcon}
              label={`Get an ${provider} key`}
              href={keysUrl}
              variant="outline"
            />
          )}
          {replacing && (
            <IconButton
              icon={Trash2Icon}
              label="Keep the saved key"
              onClick={() => setReplacing(false)}
            />
          )}
          <SaveButton
            issues={issues}
            busy={busy}
            disabled={!key.trim()}
            label="Test and save"
            onSave={save}
          />
        </div>
      ) : (
        state.set &&
        canEdit && (
          <>
            <KeyTestLine test={testOf(state)} run={onTest} />
            <div className="flex justify-end gap-2">
              <IconButton
                icon={Trash2Icon}
                label={`Remove ${label.toLowerCase()}`}
                variant="outline"
                onClick={() => void onRemove()}
              />
              <SaveButton
                issues={[]}
                icon={KeyRoundIcon}
                label="Replace"
                onSave={() => setReplacing(true)}
              />
            </div>
          </>
        )
      )}
    </div>
  );
}

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

/** A person's ChatGPT plan sign-in: opens in a new tab, finished by pasting back where it ended. */
function ChatgptSignin({ client, p }: { client: AssistantAdapter; p: AssistantProviderRow }) {
  const { apply, refresh } = useApply(client);
  const id = useId();
  const [started, setStarted] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const signedIn = p.own.via === 'chatgpt';
  const start = async () => {
    // Open the tab inside the click, or the browser blocks it; point it once the address is known.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url, redirect } = await client.startSignin(p.id);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
      setStarted(redirect);
    } catch (e) {
      tab?.close();
      lumenToast.error(errorText(e));
    }
  };
  const finish = async () => {
    setBusy(true);
    if (
      await apply(`signin:${p.id}`, () => client.finishSignin(p.id, pasted.trim()), 'Signed in')
    ) {
      setPasted('');
      setStarted(null);
    }
    setBusy(false);
  };
  const issues: FormIssue[] = [];
  if (pasted.trim() && started && !pasted.trim().startsWith(started.split('/auth')[0] ?? ''))
    issues.push({ where: 'Address', message: `It starts with ${started}`, target: id });
  if (signedIn)
    return (
      <div className="flex flex-col gap-3 border-b py-3 last:border-b-0">
        <div className="flex items-center gap-2">
          <span className="flex-1 font-medium text-sm">Your ChatGPT plan</span>
          <span className="text-muted-foreground text-xs">{p.own.hint}</span>
          {p.own.test && <TestBadge test={p.own.test} />}
        </div>
        <KeyTestLine test={testOf(p.own)} run={() => client.testOwnKey(p.id).finally(refresh)} />
        <div className="flex justify-end gap-2">
          <IconButton
            icon={Trash2Icon}
            label="Sign out of ChatGPT"
            variant="outline"
            onClick={() => void apply(`own:${p.id}`, () => client.ownKey(p.id, null), 'Signed out')}
          />
          <SaveButton issues={[]} icon={KeyRoundIcon} label="Sign in again" onSave={start} />
        </div>
        {started && (
          <SigninPaste
            id={id}
            redirect={started}
            pasted={pasted}
            setPasted={setPasted}
            issues={issues}
            busy={busy}
            finish={finish}
          />
        )}
      </div>
    );
  return (
    <div className="flex flex-col gap-3 border-b py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <InfoLabel
          className="flex-1 font-medium text-sm"
          info="Run OpenAI models on your own ChatGPT plan instead of an API key."
        >
          Your ChatGPT plan
        </InfoLabel>
        <Badge variant="outline">Not signed in</Badge>
      </div>
      <div className="flex justify-end">
        <SaveButton
          issues={[]}
          icon={ExternalLinkIcon}
          label={started ? 'Open the sign-in again' : 'Sign in with ChatGPT'}
          onSave={start}
        />
      </div>
      {started && (
        <SigninPaste
          id={id}
          redirect={started}
          pasted={pasted}
          setPasted={setPasted}
          issues={issues}
          busy={busy}
          finish={finish}
        />
      )}
    </div>
  );
}

/** Where the sign-in tab ends, and the box its address is pasted into. */
function SigninPaste({
  id,
  redirect,
  pasted,
  setPasted,
  issues,
  busy,
  finish,
}: {
  id: string;
  redirect: string;
  pasted: string;
  setPasted: (s: string) => void;
  issues: FormIssue[];
  busy: boolean;
  finish: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        <InfoLabel
          info={`The sign-in ends on ${redirect}, a page that does not load. That is expected: copy the whole address from that tab's address bar.`}
        >
          Paste the address the sign-in ended on
        </InfoLabel>
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          autoComplete="off"
          placeholder={`${redirect}?code=…`}
          className="font-code text-xs"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <SaveButton
          issues={issues}
          busy={busy}
          disabled={!pasted.trim()}
          label="Finish"
          onSave={finish}
        />
      </div>
    </div>
  );
}

/** One provider, collapsed to a row: where to make a key (a new tab), the app's key and the person's. */
function ProviderKeys({
  client,
  p,
  admin,
}: { client: AssistantAdapter; p: AssistantProviderRow; admin: boolean }) {
  const { apply, refresh } = useApply(client);
  const appOn = p.app.set || !!p.app.from_env;
  const plan = p.own.via === 'chatgpt';
  const meta = [
    appOn ? 'App key set' : 'No app key',
    plan ? 'your ChatGPT plan' : p.own.set ? 'your own key' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const failed = [p.app, p.own].some((k) => k.set && k.test && !k.test.ok);
  const badge = failed ? (
    <TestBadge test={{ ok: false }} />
  ) : appOn || p.own.set ? (
    <Badge variant="outline" className="text-gain">
      <CheckIcon />
      Ready
    </Badge>
  ) : (
    <Badge variant="outline">Not set</Badge>
  );
  const ownKey = (
    <KeyBlock
      label={p.signin && !p.own.set ? 'Or your own API key' : 'Your own key'}
      prefix={p.prefix}
      provider={p.label}
      state={p.own}
      canEdit
      keysUrl={p.keys_url}
      onSave={(k) => apply(`own:${p.id}`, () => client.ownKey(p.id, k), 'Key saved')}
      onRemove={() => apply(`own:${p.id}`, () => client.ownKey(p.id, null), 'Key removed')}
      onTest={() => client.testOwnKey(p.id).finally(refresh)}
    />
  );
  return (
    <LumenExpandRow id={p.id} name={p.label} meta={meta} badge={badge}>
      <div className="flex flex-col">
        <KeyBlock
          label="App key"
          prefix={p.prefix}
          provider={p.label}
          state={p.app}
          canEdit={admin}
          keysUrl={p.keys_url}
          onSave={(k) => apply(`app:${p.id}`, () => client.appKey(p.id, k), 'Key saved')}
          onRemove={() => apply(`app:${p.id}`, () => client.appKey(p.id, null), 'Key removed')}
          onTest={() => client.testAppKey(p.id).finally(refresh)}
        />
        {p.signin === 'chatgpt' && (!p.own.set || plan) && <ChatgptSignin client={client} p={p} />}
        {!plan && ownKey}
      </div>
    </LumenExpandRow>
  );
}

function Providers({ client }: { client: AssistantAdapter }) {
  const { apply } = useApply(client);
  return (
    <WithStatus client={client}>
      {(s) => {
        const ownSet = s.providers.some((p) => p.own.set);
        return (
          <div className="flex flex-col">
            <LumenExpandList>
              {s.providers.map((p) => (
                <ProviderKeys key={p.id} client={client} p={p} admin={s.admin} />
              ))}
            </LumenExpandList>
            {s.admin && (
              <Row label="Each person may spend" info="On the app's keys, every provider together.">
                <CapInput
                  label="Cap per person"
                  value={s.caps.app}
                  onSave={(n) => void apply('cap', () => client.appCap(n))}
                />
              </Row>
            )}
            {ownSet && (
              <Row label="Your keys may spend" info="On your own keys, every provider together.">
                <CapInput
                  label="Your monthly cap"
                  value={s.caps.own}
                  onSave={(n) => void apply('own', () => client.ownCap(n))}
                />
              </Row>
            )}
            <Row
              label="Pay with first"
              info="When it reaches its cap this month, or has no key for the tier's provider, the other pays."
            >
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={s.pay}
                aria-label="Pay with"
                onValueChange={(v) =>
                  v && void apply('pay', () => client.settings({ pay: v as AssistantPayer }))
                }
              >
                <ToggleGroupItem value="app">App keys</ToggleGroupItem>
                <ToggleGroupItem value="own" disabled={!ownSet}>
                  Your keys
                </ToggleGroupItem>
              </ToggleGroup>
            </Row>
          </div>
        );
      }}
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
              const keyless = p && !p.app.set && !p.app.from_env && !p.own.set;
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
                  {ACCESS.filter((a) => a.value !== 'draft' || g.drafts).map((a) => (
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
  const ids = useId();
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = s.web.scrapeql;
  if (!state) return null;
  const editing = s.admin && (!state.set || replacing);
  const issues: FormIssue[] = [];
  if (editing && id && !secret)
    issues.push({
      where: 'Client Secret',
      message: 'Paste the secret too',
      target: `${ids}-secret`,
    });
  const save = async () => {
    setBusy(true);
    if (
      await apply(
        'scrapeql',
        () => client.scrapeql({ client_id: id.trim(), client_secret: secret.trim() }),
        'Token saved',
      )
    ) {
      setId('');
      setSecret('');
      setReplacing(false);
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 border-b py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-medium text-sm">
          <InfoLabel info="Search and pages that need a real browser. Paste a Cloudflare Access service token that ScrapeQL lets in.">
            ScrapeQL
          </InfoLabel>
        </span>
        {state.set ? (
          state.hint ? (
            <span className="font-code text-muted-foreground text-xs">{state.hint}</span>
          ) : (
            <Badge variant="secondary">Set</Badge>
          )
        ) : (
          <Badge variant="outline">Not set</Badge>
        )}
        {state.set && state.test && <TestBadge test={state.test} />}
      </div>
      {editing ? (
        <div className="grid grid-cols-1 gap-2">
          <Input
            id={`${ids}-id`}
            aria-label="Client ID"
            placeholder="Client ID"
            autoComplete="off"
            className="font-code text-xs"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <Input
            id={`${ids}-secret`}
            aria-label="Client Secret"
            placeholder="Client Secret"
            type="password"
            autoComplete="off"
            className="font-code text-xs"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            {replacing && (
              <IconButton
                icon={Trash2Icon}
                label="Keep the saved token"
                onClick={() => setReplacing(false)}
              />
            )}
            <SaveButton
              issues={issues}
              busy={busy}
              disabled={!id.trim() || !secret.trim()}
              label="Test and save"
              onSave={save}
            />
          </div>
        </div>
      ) : (
        state.set &&
        s.admin && (
          <>
            <KeyTestLine test={testOf(state)} run={() => client.testScrapeql().finally(refresh)} />
            <div className="flex justify-end gap-2">
              <IconButton
                icon={Trash2Icon}
                label="Remove the token"
                variant="outline"
                onClick={() => void apply('scrapeql', () => client.scrapeql(null), 'Token removed')}
              />
              <SaveButton
                issues={[]}
                icon={KeyRoundIcon}
                label="Replace"
                onSave={() => setReplacing(true)}
              />
            </div>
          </>
        )
      )}
    </div>
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
                      {r.payer === 'app' ? 'App key' : 'Your key'}
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

/**
 * The assistant's Settings sections: the assistant, then Model providers, Models, Tools, Web and
 * Spend under it. Pass them to LumenShell's `shared` (or an app's own `settings`).
 */
export function assistantSettingsSections({
  client,
  name,
  web = true,
}: {
  client: AssistantAdapter;
  /** The assistant's name, the parent section's title. */
  name: string;
  /** Show the Web section (the app set up `web` on the server). */
  web?: boolean;
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
      description: 'Keys for each provider, and who pays',
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
  ];
}
