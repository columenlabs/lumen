// LumenToast: the one toast every app shows, drawn by the shell's Toaster
// (bottom right). `lumenToast(message)`, `.success`, `.error`, `.warning`, `.info`, and `.undo` for a
// change the person can take back. Apps never import sonner themselves.
import type { ReactNode } from 'react';
import { type ExternalToast, toast } from 'sonner';

/** How long a toast with Undo stays up, so there is time to press it. */
const UNDO_MS = 6000;

export const lumenToast = Object.assign(
  (message: ReactNode, options?: ExternalToast) => toast(message, options),
  {
    success: toast.success,
    error: toast.error,
    warning: toast.warning,
    info: toast.info,
    dismiss: toast.dismiss,
    /** A change done, with Undo that puts it back. */
    undo: (message: ReactNode, onUndo: () => void, options?: ExternalToast) =>
      toast(message, {
        duration: UNDO_MS,
        ...options,
        action: { label: 'Undo', onClick: onUndo },
      }),
  },
);
