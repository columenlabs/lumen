// A passkey ceremony (sign in with a passkey, or add one) waits on the person's device, and a device
// or passkey manager may never answer: a cancelled prompt can leave the browser's promise pending.
// usePasskeyWait holds that wait for one button only, ends it at once on Cancel, on a new attempt or
// after a time limit, tells the app to abort the browser prompt, and drops any late answer. The
// helpers below read every shape a cancelled, timed-out or refused ceremony comes back in.
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the kit waits on a device before it gives up (WebAuthn's own timeouts are often longer). */
export const PASSKEY_WAIT_MS = 120_000;
/** The line for a passkey prompt the person closed or the browser refused; shown as a quiet note. */
export const PASSKEY_CANCELLED_TEXT = 'Passkey cancelled. Try again or use another way.';
/** The line for a device that never answered within the time limit. */
export const PASSKEY_TIMEOUT_TEXT = 'Your device didn’t answer. Try again or use another way.';

/** Codes a cancelled or refused ceremony comes back with (Better Auth's, SimpleWebAuthn's). */
const CANCEL_CODES = new Set([
  'AUTH_CANCELLED',
  'REGISTRATION_CANCELLED',
  'AUTHENTICATION_CANCELLED',
  'ERROR_CEREMONY_ABORTED',
]);
/** Error names the browser gives a closed, refused or aborted prompt. */
const CANCEL_NAMES = new Set(['NotAllowedError', 'AbortError']);
/** The words browsers use for the same (Chrome, Safari, Firefox and the passkey managers). */
const CANCEL_WORDS =
  /timed out or was not allowed|not allowed|cancell?ed|aborted|operation was aborted|user (denied|dismissed)/i;

type Shape = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  cause?: unknown;
  error?: unknown;
};

/**
 * Whether an error (or an answer `{ error }`, or a message) says the passkey prompt was closed,
 * refused or timed out by the browser. Browsers report all three the same way on purpose, so the
 * kit treats them as one: a cancel, never a fault.
 */
export function passkeyCancelled(e: unknown, depth = 0): boolean {
  if (!e || depth > 3) return false;
  if (typeof e === 'string') return CANCEL_WORDS.test(e);
  if (typeof e !== 'object') return false;
  const s = e as Shape;
  if (typeof s.code === 'string' && CANCEL_CODES.has(s.code)) return true;
  if (typeof s.name === 'string' && CANCEL_NAMES.has(s.name)) return true;
  if (typeof s.message === 'string' && CANCEL_WORDS.test(s.message)) return true;
  return passkeyCancelled(s.cause, depth + 1) || passkeyCancelled(s.error, depth + 1);
}

/** How a passkey wait ended. */
export type LumenPasskeyWait<T> =
  /** The work answered; `value` may still carry an `{ error }` (see `passkeyProblem`). */
  | { ended: 'done'; value: T }
  /** The work threw. */
  | { ended: 'failed'; error: unknown }
  /** The person cancelled from the page (or the part closed). */
  | { ended: 'cancelled' }
  /** No answer within the time limit. */
  | { ended: 'timeout' }
  /** A newer attempt took over; nothing to show. */
  | { ended: 'superseded' };

/**
 * The problem in a passkey call's answer, if any: `cancelled` for a closed or refused prompt (shown
 * as a quiet note), else `text` in plain words. An answer is a message string, a Better Auth style
 * `{ error: { code, message } }`, or anything else when it worked.
 */
export function passkeyProblem(answer: unknown): { cancelled: boolean; text: string } | null {
  const err =
    typeof answer === 'string'
      ? answer || null
      : answer && typeof answer === 'object' && 'error' in answer
        ? (answer as { error?: unknown }).error || null
        : null;
  if (!err) return null;
  if (passkeyCancelled(err)) return { cancelled: true, text: PASSKEY_CANCELLED_TEXT };
  if (typeof err === 'string') return { cancelled: false, text: err };
  const m = (err as { message?: unknown }).message;
  return {
    cancelled: false,
    text: typeof m === 'string' && m ? m : 'That didn’t work. Try again.',
  };
}

export interface LumenPasskeyWaitOptions {
  /** Aborts the browser's prompt (for example SimpleWebAuthn's `WebAuthnAbortService.cancelCeremony`). */
  onCancel?: () => void;
  /** The time limit; `PASSKEY_WAIT_MS` when absent. */
  timeoutMs?: number;
}

/**
 * One passkey ceremony at a time, never a wait with no end. `run(work)` waits on the device and
 * resolves when it answers, when `cancel()` is called, when another `run` starts, or after the time
 * limit; a late answer is dropped. Cancel, the time limit and unmounting call `onCancel` so the
 * browser closes its prompt. `waiting` is for the passkey button only: other ways in stay usable,
 * and starting one should call `cancel()` first.
 */
export function usePasskeyWait({
  onCancel,
  timeoutMs = PASSKEY_WAIT_MS,
}: LumenPasskeyWaitOptions = {}) {
  const [waiting, setWaiting] = useState(false);
  const end = useRef<((how: 'cancelled' | 'timeout' | 'superseded') => void) | null>(null);
  const abort = useRef(onCancel);
  abort.current = onCancel;
  const limit = useRef(timeoutMs);
  limit.current = timeoutMs;

  const cancel = useCallback(() => {
    if (!end.current) return;
    end.current('cancelled');
    abort.current?.();
  }, []);

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<LumenPasskeyWait<T>> => {
    end.current?.('superseded');
    let finish!: (how: 'cancelled' | 'timeout' | 'superseded') => void;
    const stopped = new Promise<LumenPasskeyWait<T>>((resolve) => {
      finish = (how) => resolve({ ended: how });
    });
    end.current = finish;
    setWaiting(true);
    const timer = setTimeout(() => {
      if (end.current !== finish) return;
      finish('timeout');
      abort.current?.();
    }, limit.current);
    const answer = Promise.resolve()
      .then(work)
      .then(
        (value): LumenPasskeyWait<T> => ({ ended: 'done', value }),
        (error): LumenPasskeyWait<T> => ({ ended: 'failed', error }),
      );
    const out = await Promise.race([answer, stopped]);
    clearTimeout(timer);
    if (end.current === finish) {
      end.current = null;
      setWaiting(false);
    }
    return out;
  }, []);

  // Leaving the page or closing the part ends the wait and closes the browser's prompt.
  useEffect(() => () => cancel(), [cancel]);

  return { waiting, run, cancel };
}
