// A person's ChatGPT plan sign-in, for any app that runs OpenAI models on it in place of an API key
// (`@columenlabs/lumen-ai/assistant`'s `startChatgpt` / `finishChatgpt` on the server). The sign-in
// opens in a new tab and ends on a 127.0.0.1 address that does not load; the person pastes that
// address back and the app's server finishes it. The app passes its own calls, so any routes work.
import type { KeyState } from '@columenlabs/lumen-ui-types/assistant';
import { ExternalLinkIcon, KeyRoundIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';
import { type FormIssue, SaveButton } from './form-issues';
import { IconButton } from './icon-button';
import { InfoLabel } from './info-tip';
import { KeyTestLine, TestBadge, errorText } from './integrations';
import { lumenToast } from './lumen-toast';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';

export interface LumenChatgptSigninProps {
  /** The person's key state: signed in when `via` is `chatgpt`, `hint` the account's email. */
  state: KeyState;
  /** Starts a sign-in on the server: the address to open and the one it ends on. */
  start: () => Promise<{ url: string; redirect: string }>;
  /** Finishes it from the pasted address; true once kept (the app says why when it is not). */
  finish: (url: string) => Promise<boolean>;
  /** Signs out (drops the sealed tokens). */
  signOut: () => Promise<unknown>;
  /** One free call that says whether the sign-in still works; the app refreshes its data after. */
  test: () => Promise<unknown>;
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

/** Sign in with ChatGPT: opens in a new tab, finished by pasting back where it ended. */
export function LumenChatgptSignin({
  state,
  start,
  finish,
  signOut,
  test,
}: LumenChatgptSigninProps) {
  const id = useId();
  const [started, setStarted] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const signedIn = state.via === 'chatgpt';
  const open = async () => {
    // Open the tab inside the click, or the browser blocks it; point it once the address is known.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url, redirect } = await start();
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
      setStarted(redirect);
    } catch (e) {
      tab?.close();
      lumenToast.error(errorText(e));
    }
  };
  const done = async () => {
    setBusy(true);
    if (await finish(pasted.trim())) {
      setPasted('');
      setStarted(null);
    }
    setBusy(false);
  };
  const issues: FormIssue[] = [];
  if (pasted.trim() && started && !pasted.trim().startsWith(started.split('/auth')[0] ?? ''))
    issues.push({ where: 'Address', message: `It starts with ${started}`, target: id });
  const paste = started && (
    <SigninPaste
      id={id}
      redirect={started}
      pasted={pasted}
      setPasted={setPasted}
      issues={issues}
      busy={busy}
      finish={done}
    />
  );
  if (signedIn)
    return (
      <div className="flex flex-col gap-3 border-b py-3 last:border-b-0">
        <div className="flex items-center gap-2">
          <span className="flex-1 font-medium text-sm">Your ChatGPT plan</span>
          <span className="text-muted-foreground text-xs">{state.hint}</span>
          {state.test && <TestBadge test={state.test} />}
        </div>
        <KeyTestLine test={testOf(state)} run={test} />
        <div className="flex justify-end gap-2">
          <IconButton
            icon={Trash2Icon}
            label="Sign out of ChatGPT"
            variant="outline"
            onClick={() => void signOut()}
          />
          <SaveButton issues={[]} icon={KeyRoundIcon} label="Sign in again" onSave={open} />
        </div>
        {paste}
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
          onSave={open}
        />
      </div>
      {paste}
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
