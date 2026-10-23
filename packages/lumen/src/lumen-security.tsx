// Two-step sign-in, the same on every app: the second step after a password (LumenSecondStep), the
// sign-in methods in Settings ▸ General ▸ Security (LumenSignInMethods), and the backup codes shown
// once (LumenBackupCodes). They draw the screens and call the app back; the app talks to its own
// sign-in service and decides which methods it allows. A callback answers with a problem to show,
// or nothing when it worked.
import {
  Check,
  Copy,
  Download,
  Fingerprint,
  Lock,
  Mail,
  Plus,
  Smartphone,
  Ticket,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, type ReactNode, useState } from 'react';
import {
  LumenAuthHeading,
  LumenAuthNote,
  LumenAuthProblem,
  LumenCodeField,
  LumenPasswordField,
  LumenStepBar,
} from './lumen-auth';
import { SettingRow } from './settings';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { FieldSeparator } from './ui/field';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';

/** What a callback answers: a problem to show the person (a string), or anything else when it worked. */
export type LumenResult = Promise<unknown>;

/** The problem a callback answered, if any; a throw counts as one. */
const problemOf = (work: () => LumenResult) =>
  work().then(
    (r) => (typeof r === 'string' && r ? r : null),
    () => 'That didn’t work. Try again.',
  );

/** The ways to pass the second step that take a typed code. */
export type LumenCodeMethod = 'email' | 'app' | 'backup';

const link = 'text-primary underline-offset-4 hover:underline';

export interface LumenSecondStepProps {
  /** The ways this person can pass the second step. */
  methods: { passkey?: boolean; app?: boolean; email?: boolean; backup?: boolean };
  /** The method shown first; the app sends the first emailed code itself. */
  initial: LumenCodeMethod;
  /** Where emailed codes go, as the app wants it shown (masked or whole). */
  emailTo?: string;
  onPasskey?: () => LumenResult;
  /** Sends a new emailed code. */
  onSendEmail?: () => LumenResult;
  onVerify: (method: LumenCodeMethod, code: string) => LumenResult;
  /** Back to the first step; no link without it. */
  onBack?: () => void;
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
  onSendEmail,
  onVerify,
  onBack,
}: LumenSecondStepProps) {
  const [method, setMethod] = useState<LumenCodeMethod>(initial);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => LumenResult) => {
    setError(null);
    setBusy(true);
    const problem = await problemOf(work);
    setBusy(false);
    if (problem) setError(problem);
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
        : 'Enter one of the backup codes you saved. Each works once.';

  return (
    <>
      <LumenAuthHeading title="Confirm it’s you" sub={sub} />
      <div className="flex flex-col gap-4">
        {methods.passkey && onPasskey && (
          <>
            <Button size="lg" className="h-10" disabled={busy} onClick={() => run(onPasskey)}>
              <Fingerprint /> {busy ? 'Waiting for your passkey…' : 'Use my passkey'}
            </Button>
            <FieldSeparator>or enter the code</FieldSeparator>
          </>
        )}
        <LumenAuthNote>{note}</LumenAuthNote>
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
          <Button size="lg" variant="outline" type="submit" className="h-10" disabled={busy}>
            Verify
          </Button>
        </form>
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
}

export interface LumenSignInMethodsProps {
  /** The password row; its Change opens the app's own flow. */
  password?: { onChange: () => void };
  passkeys?: {
    list: LumenPasskey[];
    /** Adds one under the name the person typed; the device asks for their face, finger or PIN. */
    onAdd: (name: string) => LumenResult;
    onRemove: (id: string) => LumenResult;
  };
  /** The authenticator app (TOTP). Turning it on asks for the password first. */
  app?: {
    on: boolean;
    /** Checks the password and starts setup: the app's otpauth:// link and fresh backup codes. */
    onStart: (password: string) => Promise<{ uri: string; backupCodes: string[] } | string>;
    /** Confirms setup with the first code the app shows. */
    onConfirm: (code: string) => LumenResult;
    /** Turns it off after the password; no Turn off without it. */
    onTurnOff?: (password: string) => LumenResult;
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
}

type Flow = 'passkey' | 'app' | 'app-confirm' | 'app-off' | 'backup' | 'codes' | null;

const when = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

/** A row's icon, in the same square as the sign-in screen's points. */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
      {children}
    </span>
  );
}

/**
 * Settings ▸ General ▸ Security: the password, then the second-step methods (passkeys, an
 * authenticator app, emailed codes, backup codes). Adding or changing one opens its steps in place.
 */
export function LumenSignInMethods({
  password,
  passkeys,
  app,
  email,
  backup,
}: LumenSignInMethodsProps) {
  const [flow, setFlow] = useState<Flow>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (f: Flow) => {
    setFlow(f);
    setError(null);
    setSecret('');
    setCode('');
    setName('');
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
    <Button type="button" variant="ghost" onClick={() => open(null)} disabled={busy}>
      Cancel
    </Button>
  );

  if (flow === 'passkey' && passkeys) {
    return (
      <form
        className="flex max-w-md flex-col gap-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => passkeys.onAdd(name.trim()),
            () => open(null),
          );
        }}
      >
        <h4 className="font-semibold">Add a passkey</h4>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lumen-passkey-name">Name it</Label>
          <Input
            id="lumen-passkey-name"
            placeholder="MacBook, iPhone, YubiKey"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            So you can tell your passkeys apart later.
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          Your device asks for your face, fingerprint or PIN. That never leaves the device.
        </p>
        <LumenAuthProblem>{error}</LumenAuthProblem>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            <Fingerprint /> {busy ? 'Waiting for your device…' : 'Add passkey'}
          </Button>
          {cancel}
        </div>
      </form>
    );
  }

  // The steps that ask for the password first: turning the app on or off, and new backup codes.
  if (
    (flow === 'app' && app) ||
    (flow === 'app-off' && app?.onTurnOff) ||
    (flow === 'backup' && backup)
  ) {
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
      <form className="flex max-w-md flex-col gap-4 py-2" onSubmit={submit}>
        {flow === 'app' && <LumenStepBar at={1} of={3} />}
        <h4 className="font-semibold">{title}</h4>
        <p className="text-muted-foreground text-sm">First, confirm it’s you with your password.</p>
        <LumenPasswordField value={secret} onChange={setSecret} autoComplete="current-password" />
        <LumenAuthProblem>{error}</LumenAuthProblem>
        <div className="flex gap-2">
          <Button
            type="submit"
            variant={flow === 'app-off' ? 'destructive' : 'default'}
            disabled={busy || !secret}
          >
            {flow === 'app-off' ? 'Turn off' : 'Continue'}
          </Button>
          {cancel}
        </div>
      </form>
    );
  }

  if (flow === 'app-confirm' && app && setup) {
    const key = new URL(setup.uri).searchParams.get('secret') ?? '';
    return (
      <form
        className="flex max-w-md flex-col gap-4 py-2"
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
        <h4 className="font-semibold">Scan this code</h4>
        <p className="text-muted-foreground text-sm">
          Open 1Password, Google Authenticator or any authenticator app, then scan it.
        </p>
        <QRCodeSVG
          value={setup.uri}
          size={160}
          marginSize={2}
          className="self-center rounded-md bg-white"
        />
        <div className="flex flex-col items-center gap-1 text-sm">
          <span className="text-muted-foreground">Can’t scan it? Enter this key:</span>
          <button
            type="button"
            className="flex items-center gap-2 break-all font-code"
            onClick={() => navigator.clipboard?.writeText(key)}
          >
            {key.match(/.{1,4}/g)?.join(' ')} <Copy className="size-3.5 shrink-0" />
          </button>
        </div>
        <LumenCodeField
          value={code}
          onChange={setCode}
          error={error}
          hint="Enter the 6 digits it shows."
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Turn on
          </Button>
          {cancel}
        </div>
      </form>
    );
  }

  if (flow === 'codes') {
    return (
      <div className="flex max-w-md flex-col gap-2 py-2">
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
    );
  }

  const list = passkeys?.list ?? [];
  return (
    <div className="flex flex-col">
      <LumenAuthProblem>{error}</LumenAuthProblem>
      {password && (
        <SettingRow label="Password" description="The first step, every time.">
          <Button size="sm" variant="outline" onClick={password.onChange}>
            <Lock /> Change
          </Button>
        </SettingRow>
      )}
      <p className="pt-4 pb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
        Second step · one of these, every time
      </p>
      {passkeys && (
        <>
          <SettingRow
            label="Passkeys"
            description={
              list.length
                ? `${list.length} added. The fastest second step, and it can’t be phished.`
                : 'None yet. The fastest second step, and it can’t be phished.'
            }
          >
            <Button size="sm" onClick={() => open('passkey')}>
              <Plus /> Add a passkey
            </Button>
          </SettingRow>
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b py-2 pl-4 text-sm">
              <Fingerprint className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{p.name || 'Passkey'}</span>
                {p.createdAt && (
                  <span className="text-muted-foreground text-xs">Added {when(p.createdAt)}</span>
                )}
              </div>
              {removing === p.id ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => passkeys.onRemove(p.id),
                        () => setRemoving(null),
                      )
                    }
                  >
                    Remove
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setRemoving(p.id)}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
        </>
      )}
      {app && (
        <SettingRow
          label="Authenticator app"
          description={
            app.on
              ? 'On. A 6-digit code from your app.'
              : 'A 6-digit code from 1Password, Google Authenticator or similar.'
          }
        >
          <div className="flex items-center gap-2">
            {app.on && (
              <Badge variant="secondary">
                <Check /> On
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => open('app')}>
              <Smartphone /> {app.on ? 'Replace' : 'Set up'}
            </Button>
            {app.on && app.onTurnOff && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => open('app-off')}
              >
                Turn off
              </Button>
            )}
          </div>
        </SettingRow>
      )}
      {email && (
        <SettingRow
          label="Emailed code"
          description={email.locked && email.on ? email.locked : `A 6-digit code to ${email.to}.`}
          htmlFor="lumen-email-code"
        >
          {email.onToggle ? (
            <Switch
              id="lumen-email-code"
              checked={email.on}
              disabled={busy || (email.on && Boolean(email.locked))}
              onCheckedChange={(v) => run(() => email.onToggle?.(v) ?? Promise.resolve())}
            />
          ) : (
            <Mail className="size-4 text-muted-foreground" />
          )}
        </SettingRow>
      )}
      {backup && (
        <SettingRow
          label="Backup codes"
          description={
            backup.left === null
              ? 'Each works once, for when your devices are lost.'
              : `${backup.left} left. Each works once, for when your devices are lost.`
          }
        >
          <Button size="sm" variant="outline" onClick={() => open('backup')}>
            <Ticket /> Make new codes
          </Button>
        </SettingRow>
      )}
    </div>
  );
}
