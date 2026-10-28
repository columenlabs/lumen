/** A SQLite value as JSON carries it: bytes become `{b64}` (no Buffer, so it runs anywhere). */
export function toJson(v: unknown): unknown {
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes =
      v instanceof ArrayBuffer
        ? new Uint8Array(v)
        : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(s) };
  }
  return v;
}

export function fromJson(v: unknown): unknown {
  if (v && typeof v === 'object' && 'b64' in v) {
    const s = atob(String((v as { b64: unknown }).b64));
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes.buffer;
  }
  return v;
}
