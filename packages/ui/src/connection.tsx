// One connection, one look on every app: an AI provider, an email relay, a Google account, a
// connector. Built on the settings slots (docs/parts/settings.md): a LumenExpandRow whose header has
// one status pill; inside, each way to connect is a row (a pasted key or token, a sign-in that ends on
// an address the person pastes back, or the app's own form) with Replace or Sign in again inside its
// value. Several ways add a Use row, so a person who has both an API key and a plan sign-in picks which
// one runs, and each way's row ends in its own status, Test and Remove; one way puts its last test,
// Test and Remove in the action bar. `lines` and `children` are the app's own rows below the ways.
import { ExternalLinkIcon, LogInIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { type ComponentType, type ReactNode, useId, useState } from 'react';
import { LumenConfirm } from './confirm';
import { LumenExpandRow } from './expand-list';
import { type FormIssue, SaveButton } from './form-issues';
import { IconButton } from './icon-button';
import { ErrorLine, errorText } from './integrations';
import { cn } from './lib/utils';
import { lumenToast } from './lumen-toast';
import {
  SettingActions,
  SettingField,
  type SettingHealth,
  SettingStatus,
  SettingValue,
} from './setting-parts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

/** A way's last test. `at` is an ISO time or epoch ms; `expired` asks for a new key or sign-in. */
export interface ConnectionTest {
  at: string | number;
  ok: boolean;
  /** What it read when it worked (`3 models`, the account). */
  detail?: string | null;
  /** Why it failed, in the person's words. */
  error?: string | null;
  expired?: boolean;
}

/** One value a way is set up with: a key, a client id, a secret. */
export interface ConnectionField {
  id: string;
  label: string;
  /** Typed as a password and never shown again. */
  secret?: boolean;
  /** What it starts with (`sk-`); anything else is an issue before Save. */
  prefix?: string;
  placeholder?: string;
  info?: ReactNode;
}

/** A sign-in that opens in a new tab and ends on an address the person pastes back. */
export interface ConnectionSignin {
  /** Starts it on the server: the address to open and, when it varies, the one it ends on. */
  start: () => Promise<{ url: string; redirect?: string }>;
  /** Where it ends when `start` does not say (`http://localhost:8765/`). */
  redirect?: string;
  /** Whose sign-in, for the button: `Sign in with ChatGPT`. */
  provider?: string;
}

/** One way to connect. */
export interface ConnectionWay {
  id: string;
  /** `API key`, `ChatGPT plan`, `Service token`. */
  label: string;
  icon?: ComponentType<{ className?: string }>;
  info?: ReactNode;
  /** Set up now. */
  set: boolean;
  /** Who or what it is once set: an email, a key's last characters. */
  ident?: ReactNode;
  test?: ConnectionTest | null;
  /** A short line in place of the actions (`From the server`, `Only an admin can change it`). */
  note?: ReactNode;
  /** Pasted values: the built-in form, saved by `onSave`. */
  fields?: ConnectionField[];
  /** Where a key is made, beside the empty fields. */
  getUrl?: string;
  signin?: ConnectionSignin;
  /** Tests and keeps the values; false (the app said why) or a throw keeps the form open. */
  onSave?: (values: Record<string, string>) => Promise<unknown>;
  /** Finishes a sign-in from the pasted address; false or a throw keeps it open. */
  onFinish?: (pasted: string) => Promise<unknown>;
  /** One cheap call that says whether it still works; the app refreshes its data after. */
  onTest?: () => Promise<unknown>;
  /** Removes it (asks first). */
  onRemove?: () => Promise<unknown>;
  /** The confirm's question and action: `Sign out of ChatGPT?`, `Sign out`. */
  removeTitle?: string;
  removeText?: ReactNode;
  removeLabel?: string;
  /** The button that sets it up: `Add api key`, `Sign in with …` by default. */
  addLabel?: string;
  /** The app's own editor in place of `fields` and `signin`; `close` once saved or cancelled. */
  form?: (close: () => void) => ReactNode;
  /** Shown but not changed here (a person who is not an admin). */
  readOnly?: boolean;
}

/** A label and value under the ways: `Server`, `Sent from`. */
export interface ConnectionLine {
  label: string;
  value: ReactNode;
  info?: ReactNode;
  mono?: boolean;
}

export interface LumenConnectionProps {
  /** Its id inside a LumenExpandList. */
  id?: string;
  name: ReactNode;
  /** The collapsed row's line; by default the way in use and who it is. */
  meta?: ReactNode;
  /** A logo or icon before the name. */
  logo?: ReactNode;
  ways: ConnectionWay[];
  /** The way in use when several are set up; by default the first set up. */
  use?: string;
  /** Picks the way in use; with it and two ways or more the ways show radios. */
  onUse?: (way: string) => unknown;
  lines?: ConnectionLine[];
  defaultOpen?: boolean;
  children?: ReactNode;
}

export type ConnectionStatus = 'connected' | 'untested' | 'expired' | 'failed' | 'off';

/** Where a way stands: the row's pill. */
export function connectionStatus(way: ConnectionWay | undefined): ConnectionStatus {
  if (!way?.set) return 'off';
  if (!way.test) return 'untested';
  if (way.test.ok) return 'connected';
  return way.test.expired ? 'expired' : 'failed';
}

/** The way in use: the picked one when it is set up, else the first set up. */
export function activeWay(ways: ConnectionWay[], use?: string) {
  return ways.find((w) => w.id === use && w.set) ?? ways.find((w) => w.set);
}

/** The row's pill for a status: Works, Failed, Not tested or Off; hover says to sign in again. */
export function ConnectionBadge({
  status,
  signin,
  title,
}: { status: ConnectionStatus; signin?: boolean; title?: string }) {
  const health: SettingHealth =
    status === 'connected'
      ? 'works'
      : status === 'untested'
        ? 'untested'
        : status === 'off'
          ? 'off'
          : 'failed';
  return (
    <SettingStatus
      health={health}
      title={
        title ?? (status === 'expired' ? (signin ? 'Sign in again' : 'Key expired') : undefined)
      }
    />
  );
}

/** A connection's mark: an icon or a letter on a tile. */
export function ConnectionLogo({
  icon: Icon,
  text,
}: {
  icon?: ComponentType<{ className?: string }>;
  text?: string;
}) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted font-semibold text-muted-foreground text-sm"
    >
      {Icon ? <Icon className="size-4" /> : text}
    </span>
  );
}

/** `Service token` → `service token`; `API key` stays. */
const lower = (label: string) =>
  /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;

const toIso = (at: string | number) =>
  new Date(typeof at === 'number' ? at : Date.parse(at)).toISOString();

/** A way's last test as the action bar reads it. */
const lastTest = (t: ConnectionTest | null | undefined) =>
  t
    ? {
        at: toIso(t.at),
        ok: t.ok,
        detail: t.detail,
        error: t.ok ? t.error : (t.error ?? (t.expired ? 'Expired' : null)),
      }
    : null;

/** The confirm that removes a way. */
const removeOf = (way: ConnectionWay) =>
  !way.readOnly && !way.note && way.onRemove
    ? {
        label: way.removeLabel ?? `Remove ${way.label}`,
        title: way.removeTitle ?? `Remove ${lower(way.label)}?`,
        description: way.removeText ?? 'You can add it again any time.',
        action: way.removeLabel ?? 'Remove',
        run: () => way.onRemove?.(),
      }
    : undefined;

/**
 * One connection on the settings slots: the header carries its name, the way in use and one
 * status pill; each way is a row (its label beside its value, Replace or Sign in again inside);
 * with one way the action bar holds its last test, Test and Remove, with several each row ends in
 * its own. `lines` are rows of their own; `children` the app's settings below them.
 */
export function LumenConnection({
  id,
  name,
  meta,
  logo,
  ways,
  use,
  onUse,
  lines,
  defaultOpen,
  children,
}: LumenConnectionProps) {
  const active = activeWay(ways, use);
  const status = connectionStatus(active);
  const pick = ways.length > 1 && !!onUse;
  const solo = ways.length === 1 ? ways[0] : null;
  const [picking, setPicking] = useState(false);
  const choose = async (way: string) => {
    if (!onUse || way === active?.id) return;
    setPicking(true);
    try {
      await onUse(way);
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setPicking(false);
    }
  };
  const line =
    meta ??
    (active ? (
      <>
        {ways.length > 1 && active.label}
        {ways.length > 1 && active.ident ? ' · ' : ''}
        {active.ident}
      </>
    ) : (
      'Not set up'
    ));
  const t = active?.test;
  return (
    <LumenExpandRow
      id={id}
      name={name}
      meta={line}
      icon={logo}
      defaultOpen={defaultOpen}
      status={
        <ConnectionBadge
          status={status}
          signin={!!active?.signin}
          title={t ? (t.ok ? (t.detail ?? undefined) : (t.error ?? undefined)) : undefined}
        />
      }
      actions={
        solo?.set && !solo.note && (solo.onTest || removeOf(solo)) ? (
          <SettingActions test={lastTest(solo.test)} onTest={solo.onTest} remove={removeOf(solo)} />
        ) : undefined
      }
    >
      {pick && (
        <SettingField label="Use">
          <RadioGroup
            value={active?.id ?? ''}
            onValueChange={(v) => void choose(v)}
            disabled={picking}
            aria-label={`Which way ${typeof name === 'string' ? name : ''} connects`}
            className="flex flex-wrap gap-x-4 gap-y-1"
          >
            {ways.map((w) => (
              <WayChoice key={w.id} way={w} />
            ))}
          </RadioGroup>
        </SettingField>
      )}
      {ways.map((w) => (
        <WayField key={w.id} way={w} solo={!!solo} />
      ))}
      {lines?.map((l) => (
        <SettingField key={l.label} label={l.label} info={l.info}>
          <span
            className={cn('min-w-0 truncate text-sm', l.mono && 'font-code text-xs')}
            title={typeof l.value === 'string' ? l.value : undefined}
          >
            {l.value}
          </span>
        </SettingField>
      ))}
      {children}
    </LumenExpandRow>
  );
}

/** One way in the Use picker. */
function WayChoice({ way }: { way: ConnectionWay }) {
  const rid = useId();
  return (
    <span className="flex min-h-8 items-center gap-2">
      <RadioGroupItem id={rid} value={way.id} disabled={!way.set} aria-label={`Use ${way.label}`} />
      <Label htmlFor={rid} className={cn('font-normal', !way.set && 'text-muted-foreground')}>
        {way.label}
      </Label>
    </span>
  );
}

/** One way as a row: its label, then its value with Replace inside, or Add; its form when open. */
function WayField({ way, solo }: { way: ConnectionWay; solo: boolean }) {
  const [editing, setEditing] = useState(false);
  const close = () => setEditing(false);
  const editable = !way.readOnly && !way.note;
  const hasForm = !!(way.form || way.fields?.length || way.signin);
  if (editing)
    return way.form ? (
      <div className="py-2">{way.form(close)}</div>
    ) : way.signin ? (
      <SigninForm way={way} close={close} />
    ) : (
      <FieldsForm way={way} close={close} />
    );
  const Icon = way.signin ? LogInIcon : PlusIcon;
  const addLabel =
    way.addLabel ??
    (way.signin
      ? way.signin.provider
        ? `Sign in with ${way.signin.provider}`
        : 'Sign in'
      : `Add ${lower(way.label)}`);
  const control = way.note ? (
    <span className="min-w-0 truncate text-muted-foreground text-sm">{way.note}</span>
  ) : way.set ? (
    (typeof way.ident === 'string' || way.ident == null) && editable && hasForm ? (
      <SettingValue
        value={way.ident ?? 'Set'}
        label={way.label}
        mono
        onReplace={() => setEditing(true)}
        replaceLabel={way.signin ? 'Sign in again' : 'Replace'}
        replaceIcon={way.signin ? LogInIcon : undefined}
      />
    ) : (
      <span
        className={cn(
          'min-w-0 truncate text-sm',
          typeof way.ident === 'string' && 'font-code text-xs',
        )}
        title={typeof way.ident === 'string' ? way.ident : undefined}
      >
        {way.ident ?? 'Set'}
      </span>
    )
  ) : editable && hasForm ? (
    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
      <Icon />
      {addLabel}
    </Button>
  ) : (
    <span className="text-muted-foreground text-sm">Not set up</span>
  );
  return (
    <SettingField
      label={way.label}
      info={way.info}
      stack={!solo}
      end={!solo && way.set && !way.note ? <WayEnd way={way} /> : undefined}
    >
      {control}
    </SettingField>
  );
}

/** With several ways, each set-up way's row ends in its status, Test and Remove. */
function WayEnd({ way }: { way: ConnectionWay }) {
  const [testing, setTesting] = useState(false);
  const remove = removeOf(way);
  const t = way.test;
  const test = async () => {
    if (!way.onTest) return;
    setTesting(true);
    try {
      await way.onTest();
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setTesting(false);
    }
  };
  return (
    <span className="flex items-center gap-1">
      <ConnectionBadge
        status={connectionStatus(way)}
        signin={!!way.signin}
        title={t ? (t.ok ? (t.detail ?? undefined) : (t.error ?? undefined)) : undefined}
      />
      {way.onTest && (
        <IconButton
          icon={RefreshCwIcon}
          label={testing ? 'Testing…' : `Test ${way.label}`}
          busy={testing}
          disabled={testing}
          onClick={() => void test()}
        />
      )}
      {remove && (
        <LumenConfirm
          title={remove.title}
          description={remove.description}
          action={remove.action}
          onConfirm={remove.run}
          problem={errorText}
        >
          <IconButton icon={Trash2Icon} label={remove.label} className="text-loss" />
        </LumenConfirm>
      )}
    </span>
  );
}

/** Runs a save; false or a throw keeps the form open (a throw says why). */
async function keep(run: () => Promise<unknown>, setError: (e: unknown) => void) {
  setError(null);
  try {
    return (await run()) !== false;
  } catch (e) {
    setError(e);
    return false;
  }
}

/** A form's footer: a link on the left, then Cancel and its Save. */
function FormFooter({ left, children }: { left?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-1 flex min-h-10 min-w-0 items-center gap-2 border-t pt-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{left}</span>
      {children}
    </div>
  );
}

/** The way's fields, a row each, checked before Test and save. */
function FieldsForm({ way, close }: { way: ConnectionWay; close: () => void }) {
  const ids = useId();
  const fields = way.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const val = (f: ConnectionField) => (values[f.id] ?? '').trim();
  const issues: FormIssue[] = [];
  for (const f of fields) {
    const v = val(f);
    if (v && f.prefix && !v.startsWith(f.prefix))
      issues.push({
        where: f.label,
        message: `It starts with ${f.prefix}`,
        target: `${ids}-${f.id}`,
      });
  }
  const empty = fields.some((f) => !val(f));
  const save = async () => {
    if (!way.onSave) return;
    setBusy(true);
    const trimmed = Object.fromEntries(fields.map((f) => [f.id, val(f)]));
    if (await keep(() => Promise.resolve(way.onSave?.(trimmed)), setError)) close();
    setBusy(false);
  };
  return (
    <div className="flex flex-col">
      {fields.map((f) => (
        <SettingField
          key={f.id}
          label={fields.length > 1 ? f.label : way.label}
          info={fields.length > 1 ? f.info : (f.info ?? way.info)}
          htmlFor={`${ids}-${f.id}`}
        >
          <Input
            id={`${ids}-${f.id}`}
            type={f.secret ? 'password' : 'text'}
            autoComplete="off"
            placeholder={f.placeholder ?? (f.prefix ? `${f.prefix}…` : f.label)}
            className="h-8 font-code text-xs"
            value={values[f.id] ?? ''}
            onChange={(e) => setValues((s) => ({ ...s, [f.id]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && !empty && !issues.length && void save()}
          />
        </SettingField>
      ))}
      <ErrorLine error={error} />
      <FormFooter
        left={
          way.getUrl && (
            <a className="underline" href={way.getUrl} target="_blank" rel="noreferrer">
              Get {/^[AEIOU]/i.test(way.label) ? 'an' : 'a'} {lower(way.label)} ↗
            </a>
          )
        }
      >
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <SaveButton
          issues={issues}
          busy={busy}
          disabled={empty}
          label="Test and save"
          onSave={() => void save()}
        />
      </FormFooter>
    </div>
  );
}

/** Open the sign-in in a new tab, then paste back the address it ended on. */
function SigninForm({ way, close }: { way: ConnectionWay; close: () => void }) {
  const id = useId();
  const signin = way.signin as ConnectionSignin;
  const [redirect, setRedirect] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const open = async () => {
    // Open the tab inside the click, or the browser blocks it; point it once the address is known.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setError(null);
    try {
      const r = await signin.start();
      if (tab) tab.location.href = r.url;
      else window.open(r.url, '_blank', 'noopener');
      setRedirect(r.redirect ?? signin.redirect ?? '');
    } catch (e) {
      tab?.close();
      setError(e);
    }
  };
  const origin = (() => {
    try {
      return redirect ? new URL(redirect).origin : '';
    } catch {
      return redirect ?? '';
    }
  })();
  const issues: FormIssue[] = [];
  const p = pasted.trim();
  if (p && origin && !p.startsWith(origin))
    issues.push({ where: 'Address', message: `It starts with ${redirect}`, target: id });
  const finish = async () => {
    if (!way.onFinish) return;
    setBusy(true);
    if (await keep(() => Promise.resolve(way.onFinish?.(p)), setError)) close();
    setBusy(false);
  };
  return (
    <div className="flex flex-col">
      <SettingField label={way.label} info={way.info}>
        <Button
          size="sm"
          variant={redirect === null ? 'default' : 'outline'}
          onClick={() => void open()}
        >
          <ExternalLinkIcon />
          {redirect === null ? 'Open sign-in' : 'Open again'}
        </Button>
      </SettingField>
      <SettingField
        label="Address"
        htmlFor={id}
        stack
        info={`The sign-in ends on ${redirect || signin.redirect || 'an address'} that does not load. That is expected: copy the whole address from that tab's address bar and paste it here.`}
      >
        <Input
          id={id}
          autoComplete="off"
          disabled={redirect === null}
          placeholder={`${redirect || signin.redirect || 'http://localhost'}…`}
          className="h-8 font-code text-xs"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
      </SettingField>
      <ErrorLine error={error} />
      <FormFooter>
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <SaveButton
          issues={issues}
          busy={busy}
          disabled={!p}
          label="Finish"
          onSave={() => void finish()}
        />
      </FormFooter>
    </div>
  );
}
