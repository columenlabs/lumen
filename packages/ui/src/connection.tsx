// One connection, one look on every app: an AI provider, an email relay, a Google account, a
// connector. A row that expands in place (LumenExpandRow) with one status pill; inside, each way to
// connect (a pasted key or token, a sign-in that ends on an address the person pastes back, or the
// app's own form). Several ways show radios and an In use tag, so a person who has both an API key and
// a plan sign-in picks which one runs. A way that is set up shows who or what it is and its last test,
// then Test, Remove (asks first) and Replace or Sign in again, all on the right. `lines` and
// `children` hold the app's own settings below the ways (a server, a sender, folders).
import {
  AlertTriangleIcon,
  CheckIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LogInIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { type ComponentType, type ReactNode, useId, useState } from 'react';
import { LumenConfirm } from './confirm';
import { LumenExpandRow } from './expand-list';
import { type FormIssue, SaveButton } from './form-issues';
import { IconButton } from './icon-button';
import { InfoLabel } from './info-tip';
import { ErrorLine, errorText, useClock } from './integrations';
import { cn } from './lib/utils';
import { lumenToast } from './lumen-toast';
import { Badge } from './ui/badge';
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

/** The row's pill for a status. */
export function ConnectionBadge({
  status,
  signin,
}: { status: ConnectionStatus; signin?: boolean }) {
  switch (status) {
    case 'connected':
      return (
        <Badge variant="outline" className="text-gain">
          <CheckIcon />
          Connected
        </Badge>
      );
    case 'untested':
      return <Badge variant="outline">Not tested</Badge>;
    case 'expired':
      return (
        <Badge variant="outline" className="text-warning">
          <AlertTriangleIcon />
          {signin ? 'Sign in again' : 'Key expired'}
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="text-loss">
          <AlertTriangleIcon />
          Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-dashed text-muted-foreground">
          Not connected
        </Badge>
      );
  }
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

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`. */
function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** `Service token` → `service token`; `API key` stays. */
const lower = (label: string) =>
  /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;

const toMs = (at: string | number) => (typeof at === 'number' ? at : Date.parse(at));

/** One connection: a row with its status, the ways to connect inside. */
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
  const list = ways.map((w) => (
    <WayRow key={w.id} way={w} pick={pick} inUse={w.id === active?.id && ways.length > 1} />
  ));
  return (
    <LumenExpandRow
      id={id}
      name={name}
      meta={line}
      icon={logo}
      defaultOpen={defaultOpen}
      badge={<ConnectionBadge status={status} signin={!!active?.signin} />}
    >
      <div className="grid grid-cols-1 gap-2">
        {pick ? (
          <RadioGroup
            value={active?.id ?? ''}
            onValueChange={(v) => void choose(v)}
            disabled={picking}
            aria-label={`Which way ${typeof name === 'string' ? name : ''} connects`}
            className="gap-2"
          >
            {list}
          </RadioGroup>
        ) : (
          list
        )}
      </div>
      {lines?.length ? (
        <dl className="grid grid-cols-1 text-sm">
          {lines.map((l) => (
            <div key={l.label} className="flex items-center gap-3 border-b py-2 last:border-b-0">
              <dt className="shrink-0 text-muted-foreground">
                <InfoLabel info={l.info}>{l.label}</InfoLabel>
              </dt>
              <dd
                className={cn('min-w-0 flex-1 truncate text-right', l.mono && 'font-code text-xs')}
                title={typeof l.value === 'string' ? l.value : undefined}
              >
                {l.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </LumenExpandRow>
  );
}

/** One way: its name and state, its actions on the right, its form when open. */
function WayRow({ way, pick, inUse }: { way: ConnectionWay; pick: boolean; inUse: boolean }) {
  const radioId = useId();
  const clock = useClock();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const Icon = way.icon;
  const status = connectionStatus(way);
  const failing = status === 'failed' || status === 'expired';
  const editable = !way.readOnly && !way.note;
  const hasForm = !!(way.form || way.fields?.length || way.signin);
  const test = async () => {
    if (!way.onTest) return;
    setTesting(true);
    setError(null);
    try {
      await way.onTest();
    } catch (e) {
      setError(e);
    } finally {
      setTesting(false);
    }
  };
  const close = () => setEditing(false);
  const fixLabel = way.signin ? 'Sign in again' : 'Replace';
  const addLabel =
    way.addLabel ??
    (way.signin
      ? way.signin.provider
        ? `Sign in with ${way.signin.provider}`
        : 'Sign in'
      : `Add ${lower(way.label)}`);
  const t = way.test;
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-2 rounded-md border px-3 py-2.5',
        inUse && 'border-primary/60 bg-primary/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {pick && (
          <RadioGroupItem
            id={radioId}
            value={way.id}
            disabled={!way.set}
            aria-label={`Use ${way.label}`}
          />
        )}
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 basis-40">
          <span className="flex min-w-0 items-center gap-2">
            {pick ? (
              <Label htmlFor={radioId} className="whitespace-nowrap font-medium">
                <InfoLabel info={way.info}>{way.label}</InfoLabel>
              </Label>
            ) : (
              <InfoLabel className="whitespace-nowrap font-medium text-sm" info={way.info}>
                {way.label}
              </InfoLabel>
            )}
            {inUse && (
              <Badge variant="outline" className="h-5 shrink-0 border-primary/40 text-primary">
                In use
              </Badge>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
            {way.set ? (
              <>
                {way.ident && (
                  <span
                    className="truncate"
                    title={typeof way.ident === 'string' ? way.ident : undefined}
                  >
                    {way.ident}
                  </span>
                )}
                {way.ident && <span aria-hidden>·</span>}
                {t ? (
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1',
                      t.ok ? 'text-gain' : 'text-loss',
                    )}
                    title={`Tested ${clock(new Date(toMs(t.at)).toISOString())}${t.ok && t.detail ? ` · ${t.detail}` : ''}`}
                  >
                    {t.ok ? (
                      <CheckIcon className="size-3" />
                    ) : (
                      <AlertTriangleIcon className="size-3" />
                    )}
                    {t.ok ? 'Works' : t.expired ? 'Expired' : 'Failed'} {ago(toMs(t.at))}
                  </span>
                ) : (
                  <span className="shrink-0">Not tested</span>
                )}
              </>
            ) : (
              <span>Not set up</span>
            )}
          </span>
        </span>
        {way.note ? (
          <span className="ml-auto shrink-0 text-muted-foreground text-xs">{way.note}</span>
        ) : way.set ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {way.onTest && (
              <IconButton
                icon={RefreshCwIcon}
                label={testing ? 'Testing…' : `Test ${way.label}`}
                busy={testing}
                disabled={testing}
                onClick={() => void test()}
              />
            )}
            {editable && way.onRemove && (
              <LumenConfirm
                title={way.removeTitle ?? `Remove ${lower(way.label)}?`}
                description={way.removeText ?? 'You can add it again any time.'}
                action={way.removeLabel ?? 'Remove'}
                onConfirm={() => way.onRemove?.()}
                problem={errorText}
              >
                <IconButton icon={Trash2Icon} label={way.removeLabel ?? `Remove ${way.label}`} />
              </LumenConfirm>
            )}
            {editable && hasForm && !editing && (
              <Button
                size="sm"
                variant={failing ? 'default' : 'outline'}
                onClick={() => setEditing(true)}
              >
                {way.signin ? <LogInIcon /> : <KeyRoundIcon />}
                {fixLabel}
              </Button>
            )}
          </span>
        ) : (
          editable &&
          hasForm &&
          !editing && (
            <Button size="sm" className="ml-auto shrink-0" onClick={() => setEditing(true)}>
              {way.signin ? <LogInIcon /> : <PlusIcon />}
              {addLabel}
            </Button>
          )
        )}
      </div>
      {t && !t.ok && t.error && (
        <p role="alert" className="text-xs text-loss">
          {t.error}
        </p>
      )}
      <ErrorLine error={error} />
      {editing &&
        (way.form ? (
          way.form(close)
        ) : way.signin ? (
          <SigninForm way={way} close={close} />
        ) : (
          <FieldsForm way={way} close={close} />
        ))}
    </div>
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

/** The way's fields, checked before Test and save. */
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
    <div className="grid grid-cols-1 gap-2 border-t pt-2">
      {fields.map((f) => (
        <div key={f.id} className="grid grid-cols-1 gap-1">
          {fields.length > 1 && (
            <Label htmlFor={`${ids}-${f.id}`} className="text-xs">
              <InfoLabel info={f.info}>{f.label}</InfoLabel>
            </Label>
          )}
          <Input
            id={`${ids}-${f.id}`}
            aria-label={f.label}
            type={f.secret ? 'password' : 'text'}
            autoComplete="off"
            placeholder={f.placeholder ?? (f.prefix ? `${f.prefix}…` : f.label)}
            className="font-code text-xs"
            value={values[f.id] ?? ''}
            onChange={(e) => setValues((s) => ({ ...s, [f.id]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && !empty && !issues.length && void save()}
          />
        </div>
      ))}
      <ErrorLine error={error} />
      <div className="flex items-center justify-end gap-1">
        {way.getUrl && (
          <IconButton
            icon={ExternalLinkIcon}
            label={`Get ${/^[AEIOU]/i.test(way.label) ? 'an' : 'a'} ${lower(way.label)}`}
            href={way.getUrl}
          />
        )}
        <IconButton icon={XIcon} label="Cancel" onClick={close} />
        <SaveButton
          issues={issues}
          busy={busy}
          disabled={empty}
          label="Test and save"
          onSave={() => void save()}
        />
      </div>
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
    <ol className="grid grid-cols-1 gap-3 border-t pt-2 text-sm">
      <li className="flex items-center gap-2">
        <Step n={1} />
        <span className="flex-1">Sign in in a new tab</span>
        <Button
          size="sm"
          variant={redirect === null ? 'default' : 'outline'}
          onClick={() => void open()}
        >
          <ExternalLinkIcon />
          {redirect === null ? 'Open sign-in' : 'Open again'}
        </Button>
      </li>
      <li className="grid grid-cols-1 gap-2">
        <span className="flex items-center gap-2">
          <Step n={2} />
          <Label htmlFor={id} className={cn(redirect === null && 'text-muted-foreground')}>
            <InfoLabel
              info={`The sign-in ends on ${redirect || signin.redirect || 'an address'} that does not load. That is expected: copy the whole address from that tab's address bar.`}
            >
              Paste the address it ended on
            </InfoLabel>
          </Label>
        </span>
        <span className="flex gap-2 pl-7">
          <Input
            id={id}
            autoComplete="off"
            disabled={redirect === null}
            placeholder={`${redirect || signin.redirect || 'http://localhost'}…`}
            className="font-code text-xs"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
        </span>
      </li>
      <ErrorLine error={error} />
      <li className="flex items-center justify-end gap-1">
        <IconButton icon={XIcon} label="Cancel" onClick={close} />
        <SaveButton
          issues={issues}
          busy={busy}
          disabled={!p}
          label="Finish"
          onSave={() => void finish()}
        />
      </li>
    </ol>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-xs tabular-nums">
      {n}
    </span>
  );
}
