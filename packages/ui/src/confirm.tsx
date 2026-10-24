// Every delete asks first: one shadcn AlertDialog every app uses for any
// delete, remove, cancel or other step to confirm (LumenConfirm, : no raw
// AlertDialog in an app). Wrap the trigger button, or control `open` when it starts from a menu item.
// When `onConfirm` returns a promise the dialog waits for it: the action shows `busyAction` and
// nothing closes it until the server answers; a failure stays in the dialog, a success closes it
// or shows `done`.
import { type MouseEvent, type ReactNode, useId, useState } from 'react';
import { ErrorLine } from './integrations';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { Field, FieldLabel } from './ui/field';
import { Input } from './ui/input';

export interface LumenConfirmProps {
  /** The question, e.g. `Delete view Options?`. */
  title: ReactNode;
  description?: ReactNode;
  /** The confirm button's label. */
  action?: ReactNode;
  /** The button that backs out (Keep, Keep running). */
  cancel?: string;
  /** Return a promise to keep the dialog open, busy, until it settles. */
  onConfirm: () => unknown;
  /** The button that opens the dialog; leave it out and control `open` instead. */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False for a confirm that destroys nothing (a new version): its action is not red. */
  destructive?: boolean;
  /** A word the person must type before the action unlocks, for a step that loses a lot (`DELETE`). */
  typeToConfirm?: string;
  /** The action's label while the promise runs. */
  busyAction?: ReactNode;
  /** Turns a failed promise's error into what the dialog says (a string, or the error itself). */
  problem?: (error: unknown) => unknown;
  /** What the dialog says after the promise succeeds; leave it out to close instead. */
  done?: { title: ReactNode; description?: ReactNode; action?: ReactNode };
  /** Runs when the person dismisses the `done` state. */
  onDone?: () => void;
  /** `default` is wider, for a longer description. */
  size?: 'sm' | 'default';
}

export function LumenConfirm({
  title,
  description = 'This cannot be undone.',
  action = 'Delete',
  cancel = 'Cancel',
  onConfirm,
  children,
  open,
  onOpenChange,
  destructive = true,
  typeToConfirm,
  busyAction = 'Working…',
  problem = (e) => e,
  done,
  onDone,
  size = 'sm',
}: LumenConfirmProps) {
  const id = useId();
  const [inner, setInner] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [finished, setFinished] = useState(false);
  const locked = typeToConfirm !== undefined && typed !== typeToConfirm;
  const change = (o: boolean) => {
    if (busy) return;
    if (!o && finished) onDone?.();
    if (!o) {
      setTyped('');
      setError(null);
      setFinished(false);
    }
    setInner(o);
    onOpenChange?.(o);
  };
  const confirm = async (e: MouseEvent) => {
    e.preventDefault();
    const run = onConfirm();
    if (!(run instanceof Promise)) return change(false);
    setBusy(true);
    setError(null);
    try {
      await run;
      setBusy(false);
      if (done) setFinished(true);
      else {
        setTyped('');
        setInner(false);
        onOpenChange?.(false);
      }
    } catch (err) {
      setBusy(false);
      setError(problem(err));
    }
  };
  return (
    <AlertDialog open={open ?? inner} onOpenChange={change}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent size={size}>
        {finished && done ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{done.title}</AlertDialogTitle>
              {done.description && (
                <AlertDialogDescription>{done.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter className="group-data-[size=sm]/alert-dialog-content:grid-cols-1">
              <AlertDialogAction>{done.action ?? 'Done'}</AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            {typeToConfirm !== undefined && (
              <Field>
                <FieldLabel htmlFor={id}>
                  <span>
                    Type <code className="rounded bg-muted px-1.5 font-code">{typeToConfirm}</code>{' '}
                    to confirm
                  </span>
                </FieldLabel>
                <Input
                  id={id}
                  autoComplete="off"
                  autoCapitalize={
                    typeToConfirm === typeToConfirm.toUpperCase() ? 'characters' : 'none'
                  }
                  spellCheck={false}
                  className="font-code"
                  disabled={busy}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </Field>
            )}
            <ErrorLine error={error} />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>{cancel}</AlertDialogCancel>
              <AlertDialogAction
                variant={destructive ? 'destructive-confirm' : 'default'}
                disabled={locked || busy}
                aria-busy={busy}
                onClick={confirm}
              >
                {busy ? busyAction : action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
