// Rows that each use part of one shared cap (an account's allowance, split by label or resource)
// roll up as the pool's use over that cap: never a sum or a max of the rows' own shares. A group
// that spans several pools reads its fullest one, the cap it will hit first.

export interface Pool<T> {
  key: string;
  used: number;
  cap: number;
  /** `used / cap`; 0 when the pool has no cap (pay as you go). */
  share: number;
  rows: T[];
}

/**
 * The pools `rows` fall in and the fullest one's share. `cap` is read from each pool's first row
 * (every row of a pool shares it); a cap of 0 or less has no share. Use it in a field's
 * `rollRender`, so a group or Total row reads the share again from its rows.
 */
export function poolShare<T>(
  rows: T[],
  by: { pool: (row: T) => string; used: (row: T) => number; cap: (row: T) => number },
): { share: number; top: Pool<T> | null; pools: Pool<T>[] } {
  const m = new Map<string, Pool<T>>();
  for (const r of rows) {
    const key = by.pool(r);
    const p = m.get(key) ?? { key, used: 0, cap: by.cap(r), share: 0, rows: [] };
    p.used += by.used(r);
    p.rows.push(r);
    m.set(key, p);
  }
  const pools = [...m.values()];
  for (const p of pools) p.share = p.cap > 0 ? p.used / p.cap : 0;
  pools.sort((a, b) => b.share - a.share);
  const top = pools[0] ?? null;
  return { share: top?.share ?? 0, top, pools };
}
