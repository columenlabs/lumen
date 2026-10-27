// Field helpers the meters share; not exported from the package.

export const cap = (s: string | undefined, n = 96) => {
  const v = s ?? '';
  return v.length > n ? v.slice(0, n) : v;
};
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A code is a short lower-case word with `_`, `.` or `-`, so free text never passes as one. */
export const codeOf = (v: unknown, fallback = '') =>
  typeof v === 'string' && /^[A-Za-z0-9_.:/-]{1,64}$/.test(v) ? v : fallback;
