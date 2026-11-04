/**
 * Rows as a frame: a tool's answer (a list, or an object with a list field) flattened to typed
 * columns, plus the person's hand edits put back after every run. Pure: no storage, no network.
 */
import {
  FRAME_COLUMNS,
  FRAME_EDITS,
  FRAME_ROWS,
  type FrameCell,
  type FrameColumn,
  type FrameEdit,
  columnKey,
} from '@columenlabs/lumen-ui-types/frames';

export type Row = Record<string, unknown>;

/** A frame the person can read back: why it was refused, in words. */
export class FrameError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

/** The rows of a value: a list's items, or its first list field, else the value as one row. */
export function asRows(v: unknown): Row[] {
  const list = Array.isArray(v)
    ? v
    : v && typeof v === 'object'
      ? (Object.values(v).find(Array.isArray) ?? [v])
      : v === undefined || v === null
        ? []
        : [{ value: v }];
  return (list as unknown[]).map((r) =>
    r && typeof r === 'object' && !Array.isArray(r) ? (r as Row) : { value: r },
  );
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** One cell: a list of short words becomes `a, b` (a tags column), anything else nested is JSON. */
function cell(v: unknown): { v: FrameCell; list: boolean } {
  if (v === null || v === undefined) return { v: null, list: false };
  if (typeof v === 'number') return { v: Number.isFinite(v) ? v : null, list: false };
  if (typeof v === 'string') return { v: v.slice(0, 2000), list: false };
  if (typeof v === 'boolean') return { v: v ? 'Yes' : 'No', list: false };
  if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
    return { v: (v as string[]).join(', ').slice(0, 500), list: true };
  return { v: JSON.stringify(v).slice(0, 500), list: false };
}

/** Distinct values a text column may hold and still read as tags (stage, source, kind). */
const TAG_DISTINCT = 12;
/** Longest value a tag column holds. */
const TAG_CHARS = 24;

/** Rows as a frame: columns by first sight, each typed from its values. */
export function toFrame(rows: Row[]): { columns: FrameColumn[]; data: FrameCell[][] } {
  if (rows.length > FRAME_ROWS)
    throw new FrameError(
      `${rows.length.toLocaleString('en-US')} rows: a tab keeps at most ${FRAME_ROWS.toLocaleString('en-US')}. Filter first.`,
    );
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  if (names.length > FRAME_COLUMNS)
    throw new FrameError(
      `${names.length} columns: a tab keeps at most ${FRAME_COLUMNS}. Ask for fewer fields.`,
    );
  const lists = new Set<number>();
  const data = rows.map((r) =>
    names.map((n, i) => {
      const c = cell(r[n]);
      if (c.list) lists.add(i);
      return c.v;
    }),
  );
  const taken = new Set<string>();
  const columns = names.map((label, i): FrameColumn => {
    const values = data.map((d) => d[i]).filter((v): v is string | number => v !== null);
    const type: FrameColumn['type'] =
      values.length && values.every((v) => typeof v === 'number')
        ? 'number'
        : values.length && values.every((v) => typeof v === 'string' && ISO_DAY.test(v))
          ? 'date'
          : 'text';
    // Short values from a small set (or lists of words) read as coloured chips, not text.
    const distinct = new Set(values);
    const tags =
      type === 'text' &&
      (lists.has(i) ||
        (values.length >= 4 &&
          distinct.size <= TAG_DISTINCT &&
          distinct.size < values.length &&
          values.every((v) => String(v).length <= TAG_CHARS)));
    return {
      key: columnKey(label, taken),
      label: label.slice(0, 40),
      type,
      format: type === 'number' ? 'number' : 'text',
      ...(tags ? { tags: true } : {}),
    };
  });
  return { columns, data };
}

/** A typed value for a column: numbers from numerals (a comma, %, $ or a true minus allowed). */
export function coerce(col: FrameColumn, value: FrameCell): FrameCell {
  if (value === null || value === '') return null;
  if (col.type !== 'number')
    return typeof value === 'number' ? String(value) : value.slice(0, 2000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value.replace(/[,$%\s]/g, '').replace('−', '-'));
  if (!Number.isFinite(n))
    throw new FrameError(`${col.label} holds numbers: "${value}" is not one.`);
  return n;
}

/** The latest edit per cell, newest last, at most FRAME_EDITS. */
export function dedupeEdits(edits: FrameEdit[]): FrameEdit[] {
  const seen = new Map<string, FrameEdit>();
  for (const e of edits) seen.set(`${e.column}\u0000${e.key ?? `#${e.row}`}`, e);
  return [...seen.values()].slice(-FRAME_EDITS);
}

/**
 * Puts the person's hand edits back onto new rows, by row index (a tab's rows come in the order
 * the recipe gives them). An edit whose column or row is gone is dropped.
 */
export function applyEdits(
  columns: FrameColumn[],
  data: FrameCell[][],
  edits: FrameEdit[],
): { data: FrameCell[][]; edits: FrameEdit[] } {
  if (!edits.length) return { data, edits };
  const rows = data.map((r) => [...r]);
  const kept: FrameEdit[] = [];
  for (const e of edits) {
    const col = columns.findIndex((c) => c.key === e.column);
    const row = e.row === undefined ? undefined : rows[e.row];
    if (col < 0 || !row) continue;
    row[col] = e.value;
    kept.push(e);
  }
  return { data: rows, edits: kept };
}

/** A frame's rows back as objects keyed by their column labels (what a CSV push appends to). */
export function asObjects(columns: FrameColumn[], data: FrameCell[][]): Row[] {
  return data.map((r) => Object.fromEntries(columns.map((c, i) => [c.label, r[i] ?? null])));
}

/** Most CSV text one call takes (bigger goes as `append` parts). */
export const CSV_BYTES = 1_000_000;

const NUMERAL = /^[-−]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * CSV text (RFC 4180: quoted fields, `""` for a quote, CRLF or LF) as rows keyed by the header.
 * A numeral becomes a number, but one with a leading zero (`02134`, a zip) stays text; `types`
 * says a column's type outright. Empty cells are blank.
 */
export function parseCsv(text: string, types: Record<string, 'number' | 'text'> = {}): Row[] {
  if (text.length > CSV_BYTES)
    throw new FrameError(
      `The CSV is ${Math.round(text.length / 1000)} KB: send at most ${CSV_BYTES / 1000} KB a call, the rest as append parts.`,
    );
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      rec.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rec.push(field);
      field = '';
      if (rec.length > 1 || rec[0] !== '') records.push(rec);
      rec = [];
    } else field += ch;
  }
  if (quoted) throw new FrameError('The CSV has a quote that never closes.');
  if (field !== '' || rec.length) {
    rec.push(field);
    records.push(rec);
  }
  const [header, ...body] = records;
  if (!header?.length) throw new FrameError('The CSV has no header row.');
  const names = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  return body.map((r) =>
    Object.fromEntries(
      names.map((n, i) => {
        const raw = (r[i] ?? '').trim();
        if (raw === '') return [n, null];
        const want = types[n];
        if (want === 'text') return [n, raw];
        const numeric = NUMERAL.test(raw) && !/^[-−]?0\d/.test(raw);
        if (want === 'number' || numeric) {
          const v = Number(raw.replace('−', '-').replace(/[,$%\s]/g, ''));
          if (Number.isFinite(v)) return [n, v];
          if (want === 'number') throw new FrameError(`${n} holds numbers: "${raw}" is not one.`);
        }
        return [n, raw];
      }),
    ),
  );
}
