// Every delete asks first: one shadcn AlertDialog every app uses for any
// delete, remove, cancel or other step to confirm (LumenConfirm, : no raw
// AlertDialog in an app). Wrap the trigger button, or control `open` when it starts from a menu item.
import type { ReactNode } from 'react';
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
}: LumenConfirmProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive-confirm' : 'default'}
            onClick={onConfirm}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
