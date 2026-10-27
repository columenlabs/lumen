/**
 * The unlock hook: one event each time a person's data key is unwrapped, made or fails to open, so
 * an app can log who opened which vault, when and why (an Analytics Engine dataset, say). Events hold
 * the owner id and timings only, never a key or a value. The app adds its own context (the part of
 * the app, the caller, what triggered it) when it maps the event to its sink.
 */
export interface UnlockEvent {
  /** The stored owner id (never an email). */
  owner: string;
  /** unwrap: a stored key opened; create: a new key made and stored; fail: neither worked. */
  event: 'unwrap' | 'create' | 'fail';
  /** Wall time of the unlock, ms. */
  ms: number;
  /** A short error kind when it failed (`no_key`, `bad_key`, `store`), never the message. */
  error?: string;
}

export type UnlockSink = (e: UnlockEvent) => void;

/** Calls the sink without ever letting it throw into the unlock. */
export function emitUnlock(sink: UnlockSink | undefined, e: UnlockEvent) {
  if (!sink) return;
  try {
    sink(e);
  } catch (err) {
    console.error('vault onUnlock', err);
  }
}
