/**
 * Base64 without Node's Buffer, reading what Buffer reads: standard or URL-safe letters, with or
 * without padding, whitespace ignored. Output is always standard and padded, as Buffer writes it.
 */

/** Bytes → standard, padded base64. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Base64 (standard or URL-safe, padded or not) → bytes. Throws on a letter outside both alphabets. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(s)) throw new Error('base64: not base64');
  if (s.length % 4 === 1) throw new Error('base64: bad length');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes → lowercase hex. */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
