/**
 * The envelope vault: one master key derives an owner key and a wrap key; each person gets a random
 * data key, stored wrapped by the app wherever it keeps keys (a table, a durable object).
 *
 *   master key (32 bytes, base64)
 *     ├─ HKDF "owner" → HMAC key: an email → `u_<40 hex>`, so the store never holds an email
 *     └─ HKDF "wrap"  → AES-GCM key: wraps each person's data key (AAD `vaults:<owner>`)
 *   data key (random, 32 bytes)
 *     ├─ AES-256-GCM: seals each value; the AAD names the table and row, so a blob can't be moved
 *     └─ HKDF "index" → HMAC key: lookup keys (`index`), the first 32 hex of the HMAC
 *
 * Sealed text is `v1.` + base64(iv ‖ ciphertext ‖ tag). HKDF salt is empty. These constants are the
 * stored format: changing any of them makes every stored blob unreadable, so they never change.
 *
 * Without a master key the vault stores values readable (`plain.` + JSON, owners as given, lookup
 * keys the JSON of the value), and only when the app opts in with `allowPlain`; otherwise every use
 * fails. Unwrapped keys stay in isolate memory, so a seal or open after the first costs no store read.
 */
import { fromBase64, toBase64, toHex } from './base64';
import { type UnlockSink, emitUnlock } from './unlock';

const te = new TextEncoder();
const td = new TextDecoder();

export const SEALED_PREFIX = 'v1.';
export const PLAIN_PREFIX = 'plain.';
/** A stored owner id; no email, service token or local name looks like one. */
export const OWNER_ID = /^u_[0-9a-f]{40}$/;

/** Where the app keeps each owner's wrapped data key (`v1.` text). */
export interface WrappedKeyStore {
  get(owner: string): Promise<string | null>;
  /** Stores the key unless one is already there; the vault reads back whichever won. */
  putIfAbsent(owner: string, wrapped: string): Promise<void>;
}

export interface EnvelopeVaultOptions {
  /** Base64 of 32 random bytes; null when the app runs without encryption. */
  kek: string | null;
  store: WrappedKeyStore;
  /** Store values readable when `kek` is null. Without it a missing key fails closed. */
  allowPlain?: boolean;
  /** Called on each unwrap, new key or failure. */
  onUnlock?: UnlockSink;
}

async function hkdf(
  raw: Uint8Array<ArrayBuffer>,
  info: string,
  usage: 'aes' | 'hmac',
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) },
    base,
    usage === 'aes' ? { name: 'AES-GCM', length: 256 } : { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage === 'aes' ? ['encrypt', 'decrypt'] : ['sign'],
  );
}

/** AES-GCM seal with the AAD: `v1.` + base64(iv ‖ ciphertext ‖ tag). */
export async function sealText(
  key: CryptoKey,
  aad: string,
  plain: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: te.encode(aad) },
      key,
      plain,
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return SEALED_PREFIX + toBase64(out);
}

export async function openText(
  key: CryptoKey,
  aad: string,
  sealed: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!sealed.startsWith(SEALED_PREFIX)) throw new Error('vault: unknown blob version');
  const bytes = fromBase64(sealed.slice(SEALED_PREFIX.length));
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: te.encode(aad) },
      key,
      bytes.subarray(12),
    ),
  );
}

/** One owner's open vault: seals and opens their values. */
export class OwnerVault {
  constructor(
    /** The owner as stored: `u_` + HMAC of the email, or as given when encryption is off. */
    readonly owner: string,
    /** Both null when encryption is off. */
    private readonly dataKey: CryptoKey | null,
    private readonly indexKey: CryptoKey | null,
  ) {}

  /** JSON value → sealed text; `aad` names the table and row. */
  async seal(aad: string, value: unknown): Promise<string> {
    if (!this.dataKey) return PLAIN_PREFIX + JSON.stringify(value);
    return sealText(this.dataKey, aad, te.encode(JSON.stringify(value)));
  }

  async open<T>(aad: string, sealed: string): Promise<T> {
    if (!this.dataKey) {
      if (!sealed.startsWith(PLAIN_PREFIX))
        throw new Error('vault: value is sealed but no master key is set');
      return JSON.parse(sealed.slice(PLAIN_PREFIX.length)) as T;
    }
    return JSON.parse(td.decode(await openText(this.dataKey, aad, sealed))) as T;
  }

  /** A lookup key for a value: equal values match, nothing else shows. */
  async index(value: string): Promise<string> {
    if (!this.indexKey) return JSON.stringify(value);
    return toHex(await crypto.subtle.sign('HMAC', this.indexKey, te.encode(value))).slice(0, 32);
  }
}

/** Opens each owner's vault, making their data key on first use. One per isolate. */
export class EnvelopeVault {
  private master?: Promise<{ owner: CryptoKey; wrap: CryptoKey }>;
  private readonly opened = new Map<string, Promise<OwnerVault>>();

  constructor(private readonly opts: EnvelopeVaultOptions) {}

  /** True when values are sealed; false only in the readable mode the app opted into. */
  get encrypted(): boolean {
    return this.opts.kek !== null;
  }

  private plainAllowed() {
    if (this.opts.kek === null && !this.opts.allowPlain)
      throw new Error('vault: no master key set');
    return this.opts.kek === null;
  }

  private keys() {
    this.master ??= (async () => {
      const raw = fromBase64(this.opts.kek ?? '');
      if (raw.length !== 32) throw new Error('vault: the master key must be 32 bytes, base64');
      const keys = {
        owner: await hkdf(raw, 'owner', 'hmac'),
        wrap: await hkdf(raw, 'wrap', 'aes'),
      };
      raw.fill(0);
      return keys;
    })();
    this.master.catch(() => {
      this.master = undefined;
    });
    return this.master;
  }

  /** The stored owner id for an email or name; a stored `u_…` id is itself. */
  async ownerId(owner: string): Promise<string> {
    if (this.plainAllowed() || OWNER_ID.test(owner)) return owner;
    const { owner: key } = await this.keys();
    return `u_${toHex(await crypto.subtle.sign('HMAC', key, te.encode(owner))).slice(0, 40)}`;
  }

  /** The owner's vault, by email or stored id; the first call per isolate reads or makes the key. */
  for(owner: string): Promise<OwnerVault> {
    let v = this.opened.get(owner);
    if (!v) {
      v = this.load(owner);
      this.opened.set(owner, v);
      v.catch(() => this.opened.delete(owner));
    }
    return v;
  }

  private async load(given: string): Promise<OwnerVault> {
    if (this.plainAllowed()) return new OwnerVault(given, null, null);
    const t0 = performance.now();
    let owner = given;
    let event: 'unwrap' | 'create' = 'unwrap';
    try {
      const { wrap } = await this.keys();
      owner = await this.ownerId(given);
      const aad = `vaults:${owner}`;
      let wrapped = await this.opts.store.get(owner);
      if (!wrapped) {
        event = 'create';
        const fresh = crypto.getRandomValues(new Uint8Array(32));
        await this.opts.store.putIfAbsent(owner, await sealText(wrap, aad, fresh));
        fresh.fill(0);
        // Two first calls at once: both read back the one key that won.
        wrapped = await this.opts.store.get(owner);
        if (!wrapped) throw new Error('vault: data key not stored');
      }
      const raw = await openText(wrap, aad, wrapped);
      const dataKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]);
      const indexKey = await hkdf(raw, 'index', 'hmac');
      raw.fill(0);
      emitUnlock(this.opts.onUnlock, { owner, event, ms: performance.now() - t0 });
      return new OwnerVault(owner, dataKey, indexKey);
    } catch (err) {
      emitUnlock(this.opts.onUnlock, {
        owner,
        event: 'fail',
        ms: performance.now() - t0,
        error: errorKind(err),
      });
      throw err;
    }
  }
}

function errorKind(err: unknown): string {
  const m = String((err as Error)?.message ?? err);
  if (/master key/.test(m)) return 'bad_key';
  if (/not stored/.test(m)) return 'store';
  if ((err as Error)?.name === 'OperationError') return 'open';
  return 'error';
}
