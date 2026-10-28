/**
 * Moving an app's rows in from the Durable Object that held them before, a page at a time, so no
 * step holds either store for long. The old store answers `exportRows` pages (by rowid, from a
 * bookmark); the module's wake writes each page with `importRows` and keeps the bookmark, and when
 * every table is across `rowStats` on both sides says the move is whole. Keep the old store from
 * writing while it moves (stop its alarm and its writes), or rows it changes behind the bookmark
 * are missed: `rowStats` then tells, and that table goes again.
 */
import { fromJson, toJson } from './json';
import type { DumpTable, SqlLike } from './object';

/** One page of a table: its columns, rows and their rowids, and the bookmark to ask for next (null: done). */
export interface RowsPage extends DumpTable {
  ids: number[];
  next: number | null;
}

/** A table's row count and highest rowid, to check a move is whole. */
export type RowStats = Record<string, { n: number; max: number }>;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Rows of `table` after rowid `after`, in rowid order: at most `limit` rows and about `maxBytes`
 * (at least one row a page, so a big blob still moves). Bytes come as `{b64}`, as in a dump.
 */
export function exportRows(
  sql: SqlLike,
  table: string,
  after: number,
  opts: { limit?: number; maxBytes?: number } = {},
): RowsPage {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const maxBytes = opts.maxBytes ?? 4_000_000;
  const cols = sql
    .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`)
    .toArray()
    .map((r) => r.name);
  if (!cols.length) return { cols, rows: [], ids: [], next: null };
  const found = sql
    .exec<Record<string, unknown>>(
      `SELECT rowid AS _rowid_, * FROM ${quote(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      after,
      limit,
    )
    .toArray();
  const rows: unknown[][] = [];
  const ids: number[] = [];
  let bytes = 0;
  let last = after;
  for (const r of found) {
    if (rows.length && bytes > maxBytes) break;
    const row = cols.map((c) => toJson(r[c]));
    bytes += JSON.stringify(row).length;
    rows.push(row);
    last = Number(r._rowid_);
    ids.push(last);
  }
  const more = rows.length === found.length ? found.length === limit : true;
  return { cols, rows, ids, next: more ? last : null };
}

/**
 * Writes a page into `table`, naming only the columns the table has (the rest keep their
 * defaults) and keeping each row's rowid, so the two stores' `rowStats` match and a page sent
 * twice changes nothing. Run it inside the module's transaction.
 */
export function importRows(
  sql: SqlLike,
  table: string,
  page: DumpTable & { ids?: number[] },
): number {
  const have = new Set(
    sql
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`)
      .toArray()
      .map((r) => r.name),
  );
  const pick = page.cols.map((c, i) => [c, i] as const).filter(([c]) => have.has(c));
  if (!pick.length) return 0;
  const ids = page.ids?.length === page.rows.length ? page.ids : null;
  const names = [...(ids ? ['rowid'] : []), ...pick.map(([c]) => quote(c))];
  const insert = `INSERT OR REPLACE INTO ${quote(table)} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`;
  page.rows.forEach((row, k) =>
    sql.exec(insert, ...(ids ? [ids[k]] : []), ...pick.map(([, i]) => fromJson(row[i]))),
  );
  return page.rows.length;
}

/** Row counts and highest rowids of `tables` (a missing table counts as empty). */
export function rowStats(sql: SqlLike, tables: string[]): RowStats {
  const out: RowStats = {};
  for (const t of tables) {
    try {
      const r = sql
        .exec<{ n: number; max: number | null }>(
          `SELECT COUNT(*) AS n, MAX(rowid) AS max FROM ${quote(t)}`,
        )
        .toArray()[0];
      out[t] = { n: Number(r?.n ?? 0), max: Number(r?.max ?? 0) };
    } catch {
      out[t] = { n: 0, max: 0 };
    }
  }
  return out;
}
