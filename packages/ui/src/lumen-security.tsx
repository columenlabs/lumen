// Two-step sign-in, the same on every app: the second step after a password (LumenSecondStep), the
// sign-in methods in Settings ▸ General ▸ Security (LumenSignInMethods), and the backup codes shown
// once (LumenBackupCodes). They draw the screens and call the app back; the app talks to its own
// sign-in service and decides which methods it allows. A callback answers with a problem to show,
// or nothing when it worked.
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Mail,
  Power,
  RefreshCw,
  Smartphone,
  Ticket,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { LumenConfirm } from './confirm';
import { LumenExpandList, LumenExpandRow } from './expand-list';
import { IconButton } from './icon-button';
import {
  LumenAuthHeading,
  LumenAuthNote,
  LumenAuthProblem,
  LumenCodeField,
  LumenPasswordField,
  LumenStepBar,
} from './lumen-auth';
import {
  type LumenPasskeyWait,
  PASSKEY_TIMEOUT_TEXT,
  passkeyCancelled,
  passkeyProblem,
  usePasskeyWait,
} from './lumen-passkey';
import { SettingActions, SettingField } from './setting-parts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { FieldSeparator } from './ui/field';
import { Input } from './ui/input';
import { Label } from './ui/label';

/** What a callback answers: a problem to show the person (a string), or anything else when it worked. */
export type LumenResult = Promise<unknown>;

/** The problem a callback answered, if any; a throw counts as one. */
const problemOf = (work: () => LumenResult) =>
  work().then(
    (r) => (typeof r === 'string' && r ? r : null),
    () => 'That didn’t work. Try again.',
  );

/** What a passkey wait ended with, for the screen: a quiet note, a problem, or nothing (it worked). */
function waitOutcome(r: LumenPasskeyWait<unknown>): { note?: string; error?: string } | null {
  if (r.ended === 'superseded' || r.ended === 'cancelled') return {};
  if (r.ended === 'timeout') return { error: PASSKEY_TIMEOUT_TEXT };
  if (r.ended === 'failed') {
    return passkeyCancelled(r.error)
      ? { note: passkeyProblem({ error: r.error })?.text }
      : { error: 'That didn’t work. Try again.' };
  }
  const p = passkeyProblem(r.value);
  if (!p) return null;
  return p.cancelled ? { note: p.text } : { error: p.text };
}

/** The ways to pass the second step that take a typed code. */
export type LumenCodeMethod = 'email' | 'app' | 'backup';

const link = 'text-primary underline-offset-4 hover:underline';

export interface LumenSecondStepProps {
  /** The ways this person can pass the second step. */
  methods: { passkey?: boolean; app?: boolean; email?: boolean; backup?: boolean };
  /**
   * The code method shown first (the app sends the first emailed code itself). Left out, it is
   * the app, then email, then backup, whichever the person has; with none, only the passkey shows.
   */
  initial?: LumenCodeMethod;
  /** Where emailed codes go, as the app wants it shown (masked or whole). */
  emailTo?: string;
  onPasskey?: () => LumenResult;
  /** Aborts the browser's passkey prompt (SimpleWebAuthn's `WebAuthnAbortService.cancelCeremony`). */
  onCancelPasskey?: () => void;
  /** Sends a new emailed code. */
  onSendEmail?: () => LumenResult;
  onVerify: (method: LumenCodeMethod, code: string) => LumenResult;
  /** Back to the first step; no link without it. */
  onBack?: () => void;
  /** A "Trust this device" box under the code: when ticked, this browser skips the second step
   *  for the days the sign-in service keeps the trust. The app passes its choice on with `onVerify`. */
  trust?: { checked: boolean; onCheckedChange: (on: boolean) => void; days?: number };
}

/**
 * The second step of a sign-in: the passkey first when the person has one, else a 6-digit code
 * from their authenticator app or email, or a backup code. Goes inside LumenAuthStage.
 */
export function LumenSecondStep({
  methods,
  initial,
  emailTo,
  onPasskey,
  onCancelPasskey,
  onSendEmail,
  onVerify,
  onBack,
  trust,
}: LumenSecondStepProps) {
  const passkey = usePasskeyWait({ onCancel: onCancelPasskey });
  const [passkeyNote, setPasskeyNote] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [method, setMethod] = useState<LumenCodeMethod | null>(
    initial ?? (['app', 'email', 'backup'] as const).find((m) => methods[m]) ?? null,
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => LumenResult) => {
    passkey.cancel();
    setPasskeyNote(null);
    setPasskeyError(null);
    setError(null);
    setBusy(true);
    const problem = await problemOf(work);
    setBusy(false);
    if (problem) setError(problem);
  };
  const startPasskey = async () => {
    if (!onPasskey) return;
    setPasskeyError(null);
    setPasskeyNote(null);
    const out = waitOutcome(await passkey.run(onPasskey));
    if (out?.note) setPasskeyNote(out.note);
    if (out?.error) setPasskeyError(out.error);
  };
  const switchTo = async (m: LumenCodeMethod) => {
    setMethod(m);
    setCode('');
    setError(null);
    setNote(null);
    if (m === 'email' && onSendEmail) {
      await run(onSendEmail);
      setNote(emailTo ? `We emailed a code to ${emailTo}.` : 'We emailed you a code.');
    }
  };
  const verify = (e: FormEvent) => {
    e.preventDefault();
    if (!method) return;
    if (method !== 'backup' && code.length !== 6) return setError('Enter all 6 digits.');
    return run(() => onVerify(method, code.trim()));
  };
  const others: { m: LumenCodeMethod; label: string }[] = [
    { m: 'app' as const, label: 'Use my authenticator app instead' },
    { m: 'email' as const, label: 'Email me a code instead' },
    { m: 'backup' as const, label: 'Use a backup code' },
  ].filter((o) => o.m !== method && methods[o.m]);
  const sub =
    method === 'email'
      ? emailTo
        ? `We emailed a code to ${emailTo}.`
        : 'We emailed you a code.'
      : method === 'app'
        ? 'Enter the code from your authenticator app.'
        : method === 'backup'
          ? 'Enter one of the backup codes you saved. Each works once.'
          : 'Use your passkey to finish signing in.';

  return (
    <>
      <LumenAuthHeading title="Confirm it’s you" sub={sub} />
      <div className="flex flex-col gap-4">
        {methods.passkey && onPasskey && (
          <>
            <Button
              size="lg"
              className="h-10"
              disabled={busy || passkey.waiting}
              onClick={startPasskey}
            >
              <Fingerprint /> {passkey.waiting ? 'Waiting for your passkey…' : 'Use my passkey'}
            </Button>
            {passkey.waiting && (
              <button
                type="button"
                className={`${link} self-center text-sm`}
                onClick={passkey.cancel}
              >
                Cancel
              </button>
            )}
            <LumenAuthProblem>{passkeyError}</LumenAuthProblem>
            {method && <FieldSeparator>or enter the code</FieldSeparator>}
          </>
        )}
        <LumenAuthNote icon={<Undo2 />}>{passkeyNote}</LumenAuthNote>
        <LumenAuthNote>{note}</LumenAuthNote>
        {method && (
          <form className="flex flex-col gap-4" onSubmit={verify}>
            {method === 'backup' ? (
              <>
                <Input
                  aria-label="Backup code"
                  autoComplete="one-time-code"
                  className="h-12 text-center font-code text-lg"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <LumenAuthProblem>{error}</LumenAuthProblem>
              </>
            ) : (
              <LumenCodeField
                value={code}
                onChange={setCode}
                error={error}
                hint={
                  method === 'email'
                    ? 'It expires in 5 minutes.'
                    : 'The code changes every 30 seconds.'
                }
                onResend={
                  method === 'email' && onSendEmail
                    ? async () => {
                        await run(onSendEmail);
                        setNote(emailTo ? `New code sent to ${emailTo}.` : 'New code sent.');
                      }
                    : undefined
                }
              />
            )}
            {trust && (
              <Label className="flex min-h-10 items-center justify-center gap-2 font-normal">
                <Checkbox
                  checked={trust.checked}
                  onCheckedChange={(v) => trust.onCheckedChange(v === true)}
                />
                Trust this device{trust.days ? ` for ${trust.days} days` : ''}
              </Label>
            )}
            <Button size="lg" variant="outline" type="submit" className="h-10" disabled={busy}>
              Verify
            </Button>
          </form>
        )}
        <div className="flex flex-col items-center gap-2 text-sm">
          {others.map((o) => (
            <button key={o.m} type="button" className={link} onClick={() => switchTo(o.m)}>
              {o.label}
            </button>
          ))}
          {onBack && (
            <button type="button" className={link} onClick={onBack}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Backup codes, shown once: copy, download, and a box to tick before Done. */
export function LumenBackupCodes({
  codes,
  onDone,
  fileName = 'backup-codes.txt',
  doneLabel = 'Done',
}: {
  codes: string[];
  onDone: () => void;
  fileName?: string;
  doneLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        If you lose your devices, each code signs you in once. They are shown only now.
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-muted p-3 font-code text-sm">
        {codes.map((c) => (
          <span key={c} className="text-center">
            {c}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => navigator.clipboard?.writeText(text)}
        >
          <Copy /> Copy
        </Button>
        <Button variant="outline" className="flex-1" onClick={download}>
          <Download /> Download
        </Button>
      </div>
      <Label className="flex items-center gap-2">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} /> I saved them
        somewhere safe
      </Label>
      <Button disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

/** A passkey the person has added. */
export interface LumenPasskey {
  id: string;
  name?: string | null;
  createdAt?: Date | string | null;
  /** When it last signed in: shown instead of when it was added, so one that stopped working stands out. */
  lastUsed?: Date | string | null;
}

export interface LumenSignInMethodsProps {
  /** The password row; its Change opens the app's own flow. */
  password?: { onChange: () => void };
  passkeys?: {
    list: LumenPasskey[];
    /**
     * Adds one under the name the person typed; the device asks for their face, finger or PIN. It
     * may answer a message, or the sign-in service's `{ error }` as is: a closed prompt reads as a
     * quiet note, never the browser's words.
     */
    onAdd: (name: string) => LumenResult;
    /** Aborts the browser's passkey prompt (SimpleWebAuthn's `WebAuthnAbortService.cancelCeremony`). */
    onCancel?: () => void;
    onRemove: (id: string) => LumenResult;
  };
  /** The authenticator app (TOTP). Turning it on asks for the password first (not when `passwordless`). */
  app?: {
    on: boolean;
    /** Checks the password and starts setup: the app's otpauth:// link and fresh backup codes. */
    onStart: (password: string) => Promise<{ uri: string; backupCodes: string[] } | string>;
    /** Confirms setup with the first code the app shows. */
    onConfirm: (code: string) => LumenResult;
    /** Turns it off after the password; no Turn off without it. */
    onTurnOff?: (password: string) => LumenResult;
    /** Whether Set up again shows while it is on (over the old one); true when absent. */
    replaceable?: boolean;
  };
  /** A code emailed at each sign-in. */
  email?: {
    /** Where the codes go, as the app wants it shown. */
    to: string;
    on: boolean;
    /** No switch without it: emailed codes stay on. */
    onToggle?: (on: boolean) => LumenResult;
    /** Why the switch is locked (it is the only second step left); unlocked when absent. */
    locked?: string;
  };
  backup?: {
    /** Codes left, or null when unknown. */
    left: number | null;
    /** Checks the password and makes 10 new codes; the old ones stop working. */
    onRenew: (password: string) => Promise<string[] | string>;
  };
  /**
   * The app has no passwords (passkeys, Google, emailed codes): setting up or turning off the
   * authenticator app and making new backup codes skip the password step (a confirm guards turning
   * off and new codes), and the callbacks get an empty password.
   */
  passwordless?: boolean;
}

type Flow = 'passkey' | 'app' | 'app-confirm' | 'app-off' | 'backup' | 'codes' | null;
type Row = 'passkeys' | 'app' | 'email' | 'backup';

const when = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

/** A row's icon. */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
      {children}
    </span>
  );
}

/** A small uppercase label over a list. */
function ListLabel({ children }: { children: ReactNode }) {
  return (
    <p className="pt-4 pb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wide first:pt-0">
      {children}
    </p>
  );
}

/**
 * Settings ▸ General ▸ Security: the password, then the ways to sign in (passkeys, an
 * authenticator app, emailed codes, backup codes), each a row that opens in place, one at a time.
 * Adding or changing one runs its steps inside its own row; the other rows stay.
 */
export function LumenSignInMethods({
  password,
  passkeys,
  app,
  email,
  backup,
  passwordless = false,
}: LumenSignInMethodsProps) {
  const [row, setRow] = useState<Row | null>(null);
  const [flow, setFlow] = useState<Flow>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkey = usePasskeyWait({ onCancel: passkeys?.onCancel });

  const open = (f: Flow) => {
    passkey.cancel();
    setFlow(f);
    setError(null);
    setNote(null);
    setSecret('');
    setCode('');
    setName('');
  };
  /** Opens a row (closing the others) and ends any steps running in another. */
  const openRow = (r: Row | null, f: Flow = null) => {
    if (r !== row) {
      setSetup(null);
      setCodes([]);
    }
    setRow(r);
    open(f);
  };
  const run = async (work: () => LumenResult, next?: () => void) => {
    setError(null);
    setBusy(true);
    const problem = await problemOf(work);
    setBusy(false);
    if (problem) return setError(problem);
    next?.();
  };
  const cancel = (
    <IconButton icon={X} label="Cancel" type="button" onClick={() => open(null)} disabled={busy} />
  );

  const startApp = () => {
    if (!app) return;
    if (!passwordless) return openRow('app', 'app');
    openRow('app');
    void run(async () => {
      const res = await app.onStart('');
      if (typeof res === 'string') return res;
      setSetup(res);
      open('app-confirm');
    });
  };
  const [askOff, setAskOff] = useState(false);
  // Backup codes fold into the authenticator app's row; a row of their own only without one.
  const backupRow: Row = app ? 'app' : 'backup';
  const turnOffApp = () => run(() => app?.onTurnOff?.('') ?? Promise.resolve());
  const renewCodes = () =>
    run(async () => {
      const res = await backup?.onRenew('');
      if (typeof res === 'string') return res;
      setCodes(res ?? []);
      setRow(backupRow);
      setFlow('codes');
    });

  // The steps that ask for the password first: turning the app on or off, and new backup codes.
  const passwordStep =
    (flow === 'app' && app) ||
    (flow === 'app-off' && app?.onTurnOff) ||
    (flow === 'backup' && backup)
      ? (() => {
          const title =
            flow === 'app'
              ? 'Set up an authenticator app'
              : flow === 'app-off'
                ? 'Turn off the authenticator app'
                : 'Make new backup codes';
          const submit = (e: FormEvent) => {
            e.preventDefault();
            if (flow === 'app' && app) {
              return run(async () => {
                const res = await app.onStart(secret);
                if (typeof res === 'string') return res;
                setSetup(res);
                open('app-confirm');
              });
            }
            if (flow === 'app-off' && app?.onTurnOff)
              return run(
                () => app.onTurnOff?.(secret) ?? Promise.resolve(),
                () => open(null),
              );
            if (flow === 'backup' && backup) {
              return run(async () => {
                const res = await backup.onRenew(secret);
                if (typeof res === 'string') return res;
                setCodes(res);
                open('codes');
              });
            }
          };
          return (
            <form className="flex max-w-md flex-col gap-3 py-1" onSubmit={submit}>
              {flow === 'app' && <LumenStepBar at={1} of={3} />}
              <h4 className="font-semibold">{title}</h4>
              <LumenPasswordField
                value={secret}
                onChange={setSecret}
                autoComplete="current-password"
              />
              <LumenAuthProblem>{error}</LumenAuthProblem>
              <div className="flex gap-1">
                <IconButton
                  icon={flow === 'app-off' ? Power : Check}
                  label={flow === 'app-off' ? 'Turn off' : 'Continue'}
                  type="submit"
                  variant={flow === 'app-off' ? 'destructive' : 'default'}
                  size="icon"
                  disabled={busy || !secret}
                />
                {cancel}
              </div>
            </form>
          );
        })()
      : null;

  const appConfirm =
    flow === 'app-confirm' && app && setup
      ? (() => {
          const key = new URL(setup.uri).searchParams.get('secret') ?? '';
          return (
            <form
              className="flex max-w-md flex-col gap-3 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length !== 6) return setError('Enter all 6 digits.');
                return run(
                  () => app.onConfirm(code),
                  () => {
                    setCodes(setup.backupCodes);
                    open('codes');
                  },
                );
              }}
            >
              <LumenStepBar at={2} of={3} />
              <h4 className="font-semibold">Scan with your authenticator app</h4>
              <div className="flex flex-wrap items-start gap-4">
                <QRCodeSVG
                  value={setup.uri}
                  size={148}
                  marginSize={2}
                  className="shrink-0 rounded-md bg-white max-sm:hidden"
                  aria-label="QR code to scan"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Button asChild className="sm:hidden">
                    <a href={setup.uri}>
                      <ExternalLink /> Open in authenticator app
                    </a>
                  </Button>
                  <button
                    type="button"
                    className="flex min-h-9 items-center gap-2 self-stretch rounded-md border px-2.5 py-1.5 text-left font-code text-sm"
                    aria-label="Copy setup key"
                    title="Copy setup key"
                    onClick={() => navigator.clipboard?.writeText(key)}
                  >
                    <span className="break-all">{key.match(/.{1,4}/g)?.join(' ')}</span>
                    <Copy className="size-3.5 shrink-0" />
                  </button>
                  <LumenCodeField
                    value={code}
                    onChange={setCode}
                    error={error}
                    hint="Enter the 6 digits it shows."
                  />
                  <div className="flex gap-1">
                    <IconButton
                      icon={Check}
                      label="Turn on"
                      type="submit"
                      variant="default"
                      size="icon"
                      disabled={busy}
                    />
                    {cancel}
                  </div>
                </div>
              </div>
            </form>
          );
        })()
      : null;

  const codesStep =
    flow === 'codes' ? (
      <div className="flex max-w-md flex-col gap-2 py-1">
        {setup && <LumenStepBar at={3} of={3} />}
        <h4 className="font-semibold">Save your backup codes</h4>
        <LumenBackupCodes
          codes={codes}
          onDone={() => {
            setSetup(null);
            setCodes([]);
            open(null);
          }}
        />
      </div>
    ) : null;

  const list = passkeys?.list ?? [];
  const appFlow =
    flow === 'app' || flow === 'app-off' || flow === 'app-confirm' || (flow === 'codes' && setup);
  const backupFlow = flow === 'backup' || (flow === 'codes' && !setup);
  const rowProps = (r: Row) => ({
    id: r,
    open: row === r,
    onOpenChange: (o: boolean) => openRow(o ? r : null),
  });

  return (
    <div className="flex min-w-0 flex-col">
      {password && (
        <SettingField label="Password">
          <IconButton
            icon={Lock}
            label="Change password"
            variant="outline"
            onClick={password.onChange}
          />
        </SettingField>
      )}
      <ListLabel>{password ? 'Second step' : 'Sign-in'}</ListLabel>
      <LumenConfirm
        open={askOff}
        onOpenChange={setAskOff}
        title="Turn off the authenticator app?"
        description="Sign-in stops asking for its code. Your backup codes stop working."
        action="Turn off"
        onConfirm={turnOffApp}
      />
      <LumenExpandList className="rounded-lg border px-2">
        {passkeys && (
          <LumenExpandRow
            {...rowProps('passkeys')}
            icon={
              <RowIcon>
                <KeyRound />
              </RowIcon>
            }
            name="Passkeys"
            meta={
              list.length > 1
                ? `${list.length} passkeys`
                : list.length === 1
                  ? list[0]?.name || 'Passkey'
                  : 'None yet'
            }
            health={list.length ? 'on' : null}
          >
            <div className="flex min-w-0 flex-col pl-7">
              {list.map((p) => (
                <div key={p.id} className="flex min-h-10 min-w-0 items-center gap-3">
                  <span className="min-w-0 flex-1 truncate" title={p.name || 'Passkey'}>
                    {p.name || 'Passkey'}
                  </span>
                  {(p.lastUsed || p.createdAt) && (
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground text-sm">
                      {p.lastUsed ? `Last used ${when(p.lastUsed)}` : `Added ${when(p.createdAt)}`}
                    </span>
                  )}
                  <LumenConfirm
                    title={`Remove ${p.name || 'this passkey'}?`}
                    description="You can’t sign in with it after this."
                    action="Remove"
                    onConfirm={() => passkeys.onRemove(p.id)}
                  >
                    <IconButton
                      icon={Trash2}
                      label={`Remove ${p.name || 'passkey'}`}
                      className="text-muted-foreground hover:bg-loss/10 hover:text-loss"
                    />
                  </LumenConfirm>
                </div>
              ))}
              {flow !== 'passkey' && (
                <div className="flex justify-end pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => open('passkey')}>
                    <KeyRound /> Add passkey
                  </Button>
                </div>
              )}
              {flow === 'passkey' && (
                <form
                  className="flex min-w-0 flex-col gap-2 pt-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError(null);
                    setNote(null);
                    const r = await passkey.run(() => passkeys.onAdd(name.trim()));
                    const out = waitOutcome(r);
                    if (!out) return open(null);
                    if (out.note) setNote(out.note);
                    if (out.error) setError(out.error);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <Input
                      autoFocus
                      aria-label="Passkey name"
                      className="min-w-0 flex-1"
                      placeholder="MacBook, iPhone, YubiKey"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <IconButton
                      icon={Fingerprint}
                      busy={passkey.waiting}
                      label={passkey.waiting ? 'Waiting for your device…' : 'Add passkey'}
                      type="submit"
                      variant="default"
                      size="icon"
                      disabled={passkey.waiting}
                    />
                    <IconButton icon={X} label="Cancel" type="button" onClick={() => open(null)} />
                  </div>
                  <LumenAuthNote icon={<Undo2 />}>{note}</LumenAuthNote>
                  <LumenAuthProblem>{error}</LumenAuthProblem>
                </form>
              )}
            </div>
          </LumenExpandRow>
        )}
        {app && (
          <LumenExpandRow
            {...rowProps('app')}
            icon={
              <RowIcon>
                <Smartphone />
              </RowIcon>
            }
            name="Authenticator app"
            meta={
              appFlow
                ? 'Setting up'
                : app.on && backup && backup.left !== null
                  ? `${backup.left} backup codes left`
                  : undefined
            }
            health={app.on ? 'on' : null}
            toggle={{
              checked: app.on || Boolean(appFlow),
              label: 'Authenticator app',
              disabled: busy || (app.on && !app.onTurnOff),
              onCheckedChange: (v) => {
                if (v) return startApp();
                if (!app.on) {
                  setSetup(null);
                  return open(null);
                }
                if (passwordless) return setAskOff(true);
                openRow('app', 'app-off');
              },
            }}
          >
            {passwordStep && row === 'app' ? (
              passwordStep
            ) : appConfirm ? (
              appConfirm
            ) : codesStep && (setup || backupFlow) ? (
              codesStep
            ) : (
              <>
                <SettingField label="Codes from">
                  <span
                    className="min-w-0 truncate text-sm"
                    title="1Password, Google Authenticator or any app"
                  >
                    1Password, Google Authenticator or any app
                  </span>
                </SettingField>
                {app.on && backup && (
                  <SettingField
                    label="Backup codes"
                    info="Each works once, for when your phone is lost."
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="num truncate text-sm">
                        {backup.left === null ? 'Saved' : `${backup.left} left`}
                      </span>
                      {passwordless ? (
                        <LumenConfirm
                          title="Make new backup codes?"
                          description="Your old codes stop working."
                          action="Make new codes"
                          destructive={false}
                          onConfirm={renewCodes}
                        >
                          <IconButton
                            icon={RefreshCw}
                            label="Make new backup codes"
                            disabled={busy}
                          />
                        </LumenConfirm>
                      ) : (
                        <IconButton
                          icon={RefreshCw}
                          label="Make new backup codes"
                          onClick={() => openRow(backupRow, 'backup')}
                        />
                      )}
                    </span>
                  </SettingField>
                )}
                <LumenAuthProblem>{row === 'app' ? error : null}</LumenAuthProblem>
                {app.on && app.replaceable !== false && (
                  <SettingActions>
                    {
                      <IconButton
                        icon={RefreshCw}
                        label="Set up again"
                        variant="outline"
                        onClick={startApp}
                      />
                    }
                  </SettingActions>
                )}
              </>
            )}
          </LumenExpandRow>
        )}
        {email && (
          <LumenExpandRow
            {...rowProps('email')}
            icon={
              <RowIcon>
                <Mail />
              </RowIcon>
            }
            name="Email code"
            meta={email.to}
            health={email.on ? 'on' : null}
            toggle={
              email.onToggle
                ? {
                    checked: email.on,
                    label: 'Email code',
                    disabled: busy || (email.on && Boolean(email.locked)),
                    onCheckedChange: (v) =>
                      void run(() => email.onToggle?.(v) ?? Promise.resolve()),
                  }
                : undefined
            }
          >
            <SettingField
              label="Sent to"
              info={email.locked && email.on ? email.locked : undefined}
            >
              <span className="min-w-0 truncate text-sm" title={email.to}>
                {email.to}
              </span>
            </SettingField>
          </LumenExpandRow>
        )}
        {backup && !app && (
          <LumenExpandRow
            {...rowProps('backup')}
            icon={
              <RowIcon>
                <Ticket />
              </RowIcon>
            }
            name="Backup codes"
            meta={backup.left === null ? undefined : `${backup.left} left`}
            health="on"
            actions={
              codesStep && backupFlow ? undefined : (
                <SettingActions>
                  {passwordless ? (
                    <LumenConfirm
                      title="Make new backup codes?"
                      description="Your old codes stop working."
                      action="Make new codes"
                      destructive={false}
                      onConfirm={renewCodes}
                    >
                      <IconButton
                        icon={RefreshCw}
                        label="Make new backup codes"
                        variant="outline"
                        disabled={busy}
                      />
                    </LumenConfirm>
                  ) : (
                    <IconButton
                      icon={RefreshCw}
                      label="Make new backup codes"
                      variant="outline"
                      onClick={() => openRow(backupRow, 'backup')}
                    />
                  )}
                </SettingActions>
              )
            }
          >
            {passwordStep && row === 'backup' ? (
              passwordStep
            ) : codesStep && backupFlow ? (
              codesStep
            ) : (
              <>
                <SettingField label="Each code">
                  <span className="text-sm">Works once, for when your phone is lost</span>
                </SettingField>
                <LumenAuthProblem>{row === 'backup' ? error : null}</LumenAuthProblem>
              </>
            )}
          </LumenExpandRow>
        )}
      </LumenExpandList>
    </div>
  );
}

/** One place a person is signed in. */
export interface LumenSession {
  id: string;
  /** What it is, as people say it: "Safari on iPhone". */
  name: string;
  lastUsed?: Date | string | null;
  /** This browser. */
  current?: boolean;
}

/**
 * Settings ▸ Security ▸ Devices: where the person is signed in. Folded at first under "Signed in on
 * N"; open, this device first, then one line per kind of device (the same name shows once, ×N), each
 * with Sign out. The header signs out everywhere else.
 */
export function LumenSessions({
  list,
  onSignOut,
  onSignOutHere,
  onSignOutOthers,
}: {
  list: LumenSession[];
  /** Signs out these sessions (one line can stand for several). */
  onSignOut: (ids: string[]) => LumenResult;
  /** Signs out this browser. */
  onSignOutHere?: () => unknown;
  /** Signs out every session but this one; no header button without it. */
  onSignOutOthers?: () => LumenResult;
}) {
  const here = list.find((s) => s.current);
  const groups = new Map<string, LumenSession[]>();
  for (const s of list) {
    if (s.current) continue;
    groups.set(s.name, [...(groups.get(s.name) ?? []), s]);
  }
  const lines = [...groups.entries()]
    .map(([name, items]) => ({
      name,
      items,
      last: Math.max(...items.map((i) => (i.lastUsed ? +new Date(i.lastUsed) : 0))),
    }))
    .sort((a, b) => b.last - a.last);
  const others = list.length - (here ? 1 : 0);
  const signOut = (
    <IconButton
      icon={LogOut}
      label="Sign out everywhere else"
      disabled={!others || !onSignOutOthers}
    />
  );
  const kinds = new Set(list.map((i) => i.name)).size;
  return (
    <div className="flex min-w-0 flex-col">
      <ListLabel>Devices</ListLabel>
      <LumenExpandList className="rounded-lg border px-2">
        <LumenExpandRow
          id="devices"
          icon={
            <RowIcon>
              <Laptop />
            </RowIcon>
          }
          name={`Signed in on ${Math.max(list.length, 1)}`}
          meta={kinds > 1 ? `${kinds} kinds of device` : undefined}
          end={
            onSignOutOthers && others ? (
              <LumenConfirm
                title={`Sign out ${others} other ${others === 1 ? 'device' : 'devices'}?`}
                description="They need to sign in again."
                action="Sign out"
                onConfirm={onSignOutOthers}
              >
                {signOut}
              </LumenConfirm>
            ) : undefined
          }
        >
          <div className="flex min-w-0 flex-col">
            {here && (
              <div className="flex min-h-10 min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1 truncate" title={here.name}>
                  {here.name}
                </span>
                <Badge variant="secondary" className="shrink-0">
                  This device
                </Badge>
                {onSignOutHere && (
                  <IconButton icon={LogOut} label="Sign out" onClick={() => onSignOutHere()} />
                )}
              </div>
            )}
            {lines.map((l) => (
              <div
                key={l.name}
                className="flex min-h-10 min-w-0 items-center gap-3 border-t border-border/60 first:border-t-0"
              >
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="min-w-0 truncate" title={l.name}>
                    {l.name}
                  </span>
                  {l.items.length > 1 && (
                    <span className="shrink-0 text-muted-foreground text-xs">
                      ×{l.items.length}
                    </span>
                  )}
                </span>
                {l.last > 0 && (
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground text-sm">
                    {when(new Date(l.last))}
                  </span>
                )}
                <IconButton
                  icon={LogOut}
                  label={
                    l.items.length > 1 ? `Sign out these ${l.items.length}` : 'Sign out this device'
                  }
                  onClick={() => void problemOf(() => onSignOut(l.items.map((i) => i.id)))}
                />
              </div>
            ))}
          </div>
        </LumenExpandRow>
      </LumenExpandList>
    </div>
  );
}
