/**
 * The regional vault: one master key per region (32 raw bytes, base64) wraps each person's AES-GCM
 * data key with AES-KW; the wrapped key lives beside the person's data. A sealed value is bytes: the
 * 12-byte IV, then ciphertext and tag, with no AAD. These are the stored format and never change.
 */
import { fromBase64 } from './base64';
import { type UnlockSink, emitUnlock } from './unlock';

/** Each region's master key, read once per isolate; a failed read is tried again next call. */
export class MasterKeys<R extends string> {
  private readonly keys: Partial<Record<R, Promise<CryptoKey>>> = {};

  /** `read` gives a region's base64 secret, or null when it is not set. */
  constructor(private readonly read: (region: R) => Promise<string> | null) {}

  /** The region's master key, or null when its secret is not set. */
  get(region: R): Promise<CryptoKey> | null {
    const secret = this.read(region);
    if (!secret) return null;
    if (!this.keys[region]) {
      const key = secret.then((b64) =>
        crypto.subtle.importKey('raw', fromBase64(b64), 'AES-KW', false, ['wrapKey', 'unwrapKey']),
      );
      key.catch(() => delete this.keys[region]);
      this.keys[region] = key;
    }
    return this.keys[region] as Promise<CryptoKey>;
  }
}

/** A new data key, wrapped by the master key, ready to store. */
export async function newWrappedKey(master: CryptoKey): Promise<ArrayBuffer> {
  const key = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])) as CryptoKey;
  return crypto.subtle.wrapKey('raw', key, master, 'AES-KW');
}

/** The data key from its stored, wrapped form. Not extractable once unwrapped. */
export function unwrapKey(master: CryptoKey, wrapped: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey('raw', wrapped, master, 'AES-KW', 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Text → iv ‖ ciphertext ‖ tag. */
export async function seal(key: CryptoKey, text: string): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  const out = new Uint8Array(12 + data.byteLength);
  out.set(iv);
  out.set(new Uint8Array(data), 12);
  return out.buffer;
}

export async function unseal(key: CryptoKey, sealed: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(sealed);
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    key,
    bytes.slice(12),
  );
  return new TextDecoder().decode(data);
}

/** Where one person's wrapped key is kept (base64 text), read and written synchronously in place. */
export interface WrappedKeySlot {
  get(): string | null;
  /** Stores the key unless one is already there. */
  putIfAbsent(wrapped: string): void;
}

/**
 * One person's data key: unwrapped from the slot, or made and stored on first use (two calls at once
 * keep the first key stored). Fails when the master key is missing.
 */
export async function dataKey(opts: {
  master: Promise<CryptoKey> | null;
  slot: WrappedKeySlot;
  /** The owner id the unlock event names. */
  owner: string;
  onUnlock?: UnlockSink;
}): Promise<CryptoKey> {
  const t0 = performance.now();
  let event: 'unwrap' | 'create' = 'unwrap';
  try {
    if (!opts.master) throw new Error('vault: no master key set');
    const m = await opts.master;
    let stored = opts.slot.get();
    if (!stored) {
      event = 'create';
      const wrapped = new Uint8Array(await newWrappedKey(m));
      let s = '';
      for (const b of wrapped) s += String.fromCharCode(b);
      opts.slot.putIfAbsent(btoa(s));
      stored = opts.slot.get();
      if (!stored) throw new Error('vault: data key not stored');
    }
    const key = await unwrapKey(m, fromBase64(stored).buffer);
    emitUnlock(opts.onUnlock, { owner: opts.owner, event, ms: performance.now() - t0 });
    return key;
  } catch (err) {
    const m = String((err as Error)?.message ?? err);
    emitUnlock(opts.onUnlock, {
      owner: opts.owner,
      event: 'fail',
      ms: performance.now() - t0,
      error: /master key/.test(m) ? 'no_key' : /not stored/.test(m) ? 'store' : 'open',
    });
    throw err;
  }
}
