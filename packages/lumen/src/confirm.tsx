// Every delete asks first: one shadcn AlertDialog every app uses for any
// delete, remove, cancel or other step to confirm (LumenConfirm, : no raw
// AlertDialog in an app). Wrap the trigger button, or control `open` when it starts from a menu item.
import { type ReactNode, useId, useState } from 'react';
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
  onConfirm: () => void;
  /** The button that opens the dialog; leave it out and control `open` instead. */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False for a confirm that destroys nothing (a new version): its action is not red. */
  destructive?: boolean;
  /** A word the person must type before the action unlocks, for a step that loses a lot (`DELETE`). */
  typeToConfirm?: string;
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
}: LumenConfirmProps) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const locked = typeToConfirm !== undefined && typed !== typeToConfirm;
  const change = (o: boolean) => {
    if (!o) setTyped('');
    onOpenChange?.(o);
  };
  return (
    <AlertDialog open={open} onOpenChange={change}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {typeToConfirm !== undefined && (
          <Field>
            <FieldLabel htmlFor={id}>
              <span>
                Type <code className="rounded bg-muted px-1.5 font-code">{typeToConfirm}</code> to
                confirm
              </span>
            </FieldLabel>
            <Input
              id={id}
              autoComplete="off"
              className="font-code"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive-confirm' : 'default'}
            disabled={locked}
            onClick={onConfirm}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
