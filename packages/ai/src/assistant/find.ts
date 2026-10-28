/**
 * Find tools: one call turns a question into one query that runs where the rows live (D1 or a
 * Durable Object's SQLite), so the assistant never lists or opens records one by one to filter them.
 *
 * An app declares its table's fields once (`defineFind`). The kit gives the tool (`findTool`: a flat
 * input of tag filters, words to include or leave out, which fields to look in and which to return),
 * the query (`runFind`: bound parameters only, never model-written SQL) and the SQL that sets up the
 * word index (`findSql`: an FTS5 table kept in step with the table by triggers, whoever writes).
 *
 *   const recipesFind = defineFind({ name: 'recipes', label: 'recipe', table: 'recipes', key: 'id',
 *     where: 'is_deleted = 0', fields: { title: { kind: 'text' }, category: { kind: 'tag' } } });
 *   const tool = await findTool(recipesFind, d1Sql(env.RECIPES_DB));
 *
 * Words are matched by the FTS5 index (stems: "egg" finds "eggs"). Until that index exists, words
 * fall back to a plain text match, so a build that lands before its index still answers.
 *
 * Meaning (opt in, `meaning` on the definition plus a `FindMeaning` given to `findTool`): `like`
 * asks a vector index for the rows nearest a loose ask ("something light for a hot day") and the
 * same SQL trims them, so filters and words still hold. `meaning.ts` gives the Vectorize index and
 * the budgeted background step that keeps it in step.
 */
import type { FindMeaning } from './meaning';
import type { SqlRunner } from './store';
import { type PlainTool, ToolError, withDeadline } from './tools';

/** text: searchable words. tag: an exact value to filter on (listed to the model). number, date: ranges. */
export type FindKind = 'text' | 'tag' | 'number' | 'date';

export interface FindField {
  kind: FindKind;
  /** The table's column, when it is named differently. */
  column?: string;
  /**
   * Not a column but the app's own SQL over the row, its columns as `t.<column>`
   * (`json_array_length(t.steps)`): a number, date or tag worked out per row. Never text.
   */
  sql?: string;
  /** Returned unless the call names its fields. False keeps it searchable but out of the default. */
  show?: boolean;
  /** The column holds JSON (a list of ingredients): returned parsed. */
  json?: boolean;
  /** A few words for the model. */
  about?: string;
}

export interface FindDef {
  /** The tool is `<name>_find`. */
  name: string;
  /** What one row is, for the model: "recipe". */
  label: string;
  /** One line on what the rows are. */
  about?: string;
  table: string;
  /** The table's integer primary key (the FTS rowid). */
  key: string;
  /** Always applied: rows the person never sees (deleted ones). The app's own SQL, never the model's. */
  where?: string;
  fields: Record<string, FindField>;
  /** The FTS5 table: `<table>_fts` by default. */
  fts?: string;
  /** The order with no words to rank by: `category, title`. Column names. */
  order?: string;
  /** Rows a call returns by default (25) and at most (200). */
  limit?: number;
  max?: number;
  /** The field that names a row (the first text field by default): rows that share one are flagged. */
  title?: string;
  /**
   * Search by meaning: which fields make up what a row means (embedded in the background) and
   * the column that changes on every write, so the index step picks up only what changed.
   */
  meaning?: { fields: string[]; changed: string };
}

/** What the model sends: flat, so every provider takes the schema. Tag fields are their own keys. */
export interface FindQuery {
  like?: string;
  any?: string[];
  all?: string[];
  none?: string[];
  in?: string[];
  ids?: number[];
  fields?: string[];
  sort?: string;
  desc?: boolean;
  limit?: number;
  [tagOrRange: string]: unknown;
}

export interface FindResult {
  /**
   * Rows that match, all of them, before `limit`. Say this number when asked how many. Left out
   * of a search by meaning, whose rows are the nearest few, not every row that fits.
   */
  count?: number;
  /** Set on a search by meaning: the rows are the nearest in meaning, nearest first, to pick from. */
  nearest?: true;
  /** Rows in this answer (at most `limit`). */
  returned: number;
  rows: Record<string, unknown>[];
  /** Different rows that share a name: each is its own row, so say both. */
  same_name?: { name: string; ids: unknown[] }[];
  /** Set when a part of the query could not run as asked (no word index yet, meaning down). */
  note?: string;
}

const RESERVED = new Set([
  'like',
  'any',
  'all',
  'none',
  'in',
  'ids',
  'fields',
  'sort',
  'desc',
  'limit',
]);
const FIND_MS = 3_000;
const TAG_VALUES = 60;
const WORDS = 20;
/** Rows nearest in meaning that `like` asks the index for, before the SQL trims them. */
const NEAR_MIN = 20;
const NEAR_MAX = 50;

/** Checks a definition once, where the app declares it. */
export function defineFind(def: FindDef): FindDef {
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
  for (const n of [def.name, def.table, def.key, def.fts ?? 'x'])
    if (!ident.test(n)) throw new Error(`find ${def.name}: "${n}" is not a plain name`);
  for (const [n, f] of Object.entries(def.fields)) {
    if (!ident.test(n) || !ident.test(f.column ?? n))
      throw new Error(`find ${def.name}: field "${n}" is not a plain name`);
    if (RESERVED.has(n)) throw new Error(`find ${def.name}: field "${n}" is a reserved word`);
    if (f.sql && f.kind === 'text')
      throw new Error(`find ${def.name}: field "${n}" is text, which needs a column, not sql`);
  }
  if (!Object.values(def.fields).some((f) => f.kind === 'text'))
    throw new Error(`find ${def.name}: give at least one text field`);
  if (def.title && def.fields[def.title]?.kind !== 'text')
    throw new Error(`find ${def.name}: title "${def.title}" is not a text field`);
  if (def.meaning) {
    if (!ident.test(def.meaning.changed))
      throw new Error(
        `find ${def.name}: meaning.changed "${def.meaning.changed}" is not a plain name`,
      );
    const bad = def.meaning.fields.filter((f) => !def.fields[f]);
    if (bad.length || !def.meaning.fields.length)
      throw new Error(
        `find ${def.name}: meaning.fields ${bad.join(', ') || '(none)'} are not fields`,
      );
  }
  return def;
}

const col = (def: FindDef, f: string) => def.fields[f]?.column ?? f;
/** A field as SQL over the row aliased `t`: its column, or its own expression. */
export const findRef = (def: FindDef, f: string) => def.fields[f]?.sql ?? `t.${col(def, f)}`;
const ftsName = (def: FindDef) => def.fts ?? `${def.table}_fts`;
const textFields = (def: FindDef) =>
  Object.entries(def.fields)
    .filter(([, f]) => f.kind === 'text')
    .map(([n]) => n);

/**
 * The SQL that sets up the word index: an external-content FTS5 table over the text columns, the
 * triggers that keep it in step on every insert, update and delete, and (`fill`) the one statement
 * that indexes the rows already there. Each `create` statement is safe to run again. Run `fill` once,
 * in a migration or a budgeted background step, never on a request.
 */
export function findSql(def: FindDef): { create: string[]; fill: string; drop: string[] } {
  const fts = ftsName(def);
  const cols = textFields(def).map((f) => col(def, f));
  const list = cols.join(', ');
  const nu = cols.map((c) => `new.${c}`).join(', ');
  const ol = cols.map((c) => `old.${c}`).join(', ');
  return {
    create: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${fts} USING fts5(${list}, content='${def.table}', content_rowid='${def.key}', tokenize='porter unicode61')`,
      `CREATE TRIGGER IF NOT EXISTS ${fts}_ai AFTER INSERT ON ${def.table} BEGIN INSERT INTO ${fts}(rowid, ${list}) VALUES (new.${def.key}, ${nu}); END`,
      `CREATE TRIGGER IF NOT EXISTS ${fts}_ad AFTER DELETE ON ${def.table} BEGIN INSERT INTO ${fts}(${fts}, rowid, ${list}) VALUES ('delete', old.${def.key}, ${ol}); END`,
      `CREATE TRIGGER IF NOT EXISTS ${fts}_au AFTER UPDATE ON ${def.table} BEGIN INSERT INTO ${fts}(${fts}, rowid, ${list}) VALUES ('delete', old.${def.key}, ${ol}); INSERT INTO ${fts}(rowid, ${list}) VALUES (new.${def.key}, ${nu}); END`,
    ],
    fill: `INSERT INTO ${fts}(${fts}) VALUES ('rebuild')`,
    drop: [
      `DROP TRIGGER IF EXISTS ${fts}_ai`,
      `DROP TRIGGER IF EXISTS ${fts}_ad`,
      `DROP TRIGGER IF EXISTS ${fts}_au`,
      `DROP TABLE IF EXISTS ${fts}`,
    ],
  };
}

/** Words as the model sent them (a list, or one string as a list of one): trimmed, deduped, at most `WORDS`. */
function words(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const out = new Set<string>();
  for (const w of list) {
    if (typeof w !== 'string') continue;
    const t = w.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (t) out.add(t);
  }
  return [...out].slice(0, WORDS);
}

/** One FTS5 term: a quoted phrase, so the model's words are never read as FTS syntax. */
const phrase = (w: string) => `"${w.replace(/"/g, '""')}"`;

function strings(v: unknown): string[] {
  const a = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  return a.filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x));
}

/** The query, checked: what is not a field of this table is an error the model can fix. */
function checked(def: FindDef, q: FindQuery) {
  const names = Object.keys(def.fields);
  const unknown = (list: string[], what: string) => {
    const bad = list.filter((f) => !def.fields[f]);
    if (bad.length)
      throw new ToolError(`${what}: no field ${bad.join(', ')}. Fields: ${names.join(', ')}.`);
  };
  const inFields = strings(q.in);
  unknown(inFields, 'in');
  const notText = inFields.filter((f) => def.fields[f]?.kind !== 'text');
  if (notText.length) throw new ToolError(`in: ${notText.join(', ')} are not text fields.`);
  const fields = strings(q.fields);
  unknown(fields, 'fields');
  if (q.sort !== undefined) unknown(strings(q.sort), 'sort');
  for (const k of Object.keys(q)) {
    if (RESERVED.has(k)) continue;
    const base = k.replace(/_(min|max|from|to)$/, '');
    if (!def.fields[base] || def.fields[base]?.kind === 'text')
      throw new ToolError(`${k}: not a filter. Filters: ${filterKeys(def).join(', ')}.`);
  }
  const max = def.max ?? 200;
  const limit = Math.max(1, Math.min(max, Math.trunc(Number(q.limit ?? def.limit ?? 25)) || 25));
  return {
    like: typeof q.like === 'string' ? q.like.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
    any: words(q.any),
    all: words(q.all),
    none: words(q.none),
    in: inFields.length ? inFields : textFields(def),
    ids: (Array.isArray(q.ids) ? q.ids : []).map(Number).filter(Number.isInteger).slice(0, max),
    fields: fields.length ? fields : names.filter((n) => def.fields[n]?.show !== false),
    sort: typeof q.sort === 'string' ? q.sort : undefined,
    desc: q.desc === true,
    limit,
  };
}

function filterKeys(def: FindDef): string[] {
  return Object.entries(def.fields).flatMap(([n, f]) =>
    f.kind === 'tag'
      ? [n]
      : f.kind === 'number'
        ? [`${n}_min`, `${n}_max`]
        : f.kind === 'date'
          ? [`${n}_from`, `${n}_to`]
          : [],
  );
}

/**
 * One find as SQL and its bound values. `fts` false matches words with LIKE (no index yet). `near`
 * is the rows nearest in meaning, nearest first: only they can match, in that order.
 */
function compile(def: FindDef, q: FindQuery, fts: boolean, near?: number[]) {
  const c = checked(def, q);
  const t = 't';
  const where: string[] = [];
  const args: unknown[] = [];
  if (def.where) where.push(`(${def.where})`);
  for (const [n, f] of Object.entries(def.fields)) {
    const column = findRef(def, n);
    if (f.kind === 'tag') {
      const vals = strings(q[n]).slice(0, 50);
      if (vals.length) {
        where.push(`${column} COLLATE NOCASE IN (${vals.map(() => '?').join(', ')})`);
        args.push(...vals);
      }
    } else if (f.kind === 'number' || f.kind === 'date') {
      const [lo, hi] = f.kind === 'number' ? ['_min', '_max'] : ['_from', '_to'];
      for (const [suffix, op] of [
        [lo, '>='],
        [hi, '<='],
      ] as const) {
        const v = q[`${n}${suffix}`];
        if (v === undefined || v === null || v === '') continue;
        where.push(`${column} ${op} ?`);
        args.push(f.kind === 'number' ? Number(v) : String(v));
      }
    }
  }
  if (c.ids.length) {
    where.push(`${t}.${def.key} IN (${c.ids.map(() => '?').join(', ')})`);
    args.push(...c.ids);
  }
  let nearOrder = '';
  if (near?.length) {
    where.push(`${t}.${def.key} IN (${near.map(() => '?').join(', ')})`);
    args.push(...near);
    // Literal integers, not bound: the ORDER BY comes after the WHERE's bound values.
    nearOrder = `CASE ${t}.${def.key} ${near.map((id, i) => `WHEN ${Math.trunc(id)} THEN ${i}`).join(' ')} END`;
  }
  const fname = ftsName(def);
  const cols = c.in.map((f) => col(def, f));
  const scope = `{${cols.join(' ')}} : `;
  const positive = [
    ...(c.any.length ? [`(${c.any.map(phrase).join(' OR ')})`] : []),
    ...c.all.map(phrase),
  ];
  let join = '';
  let rank = '';
  if (fts) {
    if (positive.length) {
      join = ` JOIN ${fname} ON ${fname}.rowid = ${t}.${def.key}`;
      where.push(`${fname} MATCH ?`);
      args.push(`${scope}(${positive.join(' AND ')})`);
      rank = `${fname}.rank`;
    }
    if (c.none.length) {
      where.push(`${t}.${def.key} NOT IN (SELECT rowid FROM ${fname} WHERE ${fname} MATCH ?)`);
      args.push(`${scope}(${c.none.map(phrase).join(' OR ')})`);
    }
  } else {
    const like = (w: string) => {
      args.push(...cols.map(() => `%${w}%`));
      return `(${cols.map((x) => `${t}.${x} LIKE ?`).join(' OR ')})`;
    };
    if (c.any.length) where.push(`(${c.any.map(like).join(' OR ')})`);
    for (const w of c.all) where.push(like(w));
    for (const w of c.none) where.push(`NOT ${like(w)}`);
  }
  const order = c.sort
    ? `${findRef(def, c.sort)} ${c.desc ? 'DESC' : 'ASC'}`
    : nearOrder ||
      rank ||
      (def.order
        ? def.order
            .split(',')
            .map((o) => `${t}.${o.trim()}`)
            .join(', ')
        : `${t}.${def.key}`);
  const select = [...new Set([def.key, ...c.fields])]
    .map((f) => (f === def.key ? `${t}.${def.key} AS ${def.key}` : `${findRef(def, f)} AS ${f}`))
    .join(', ');
  const sql = `SELECT ${select}, COUNT(*) OVER () AS _count FROM ${def.table} ${t}${join}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ${c.limit}`;
  return {
    sql,
    args,
    fields: c.fields,
    like: c.like,
    limit: c.limit,
    words: c.any.length + c.all.length + c.none.length > 0,
  };
}

const missingIndex = (e: unknown) =>
  e instanceof Error && /no such table|no such module|fts5/i.test(e.message);

/**
 * Runs one find: one query, the rows' asked fields (JSON parsed) and how many match in all. With
 * `like` and a `meaning`, the index's nearest rows come first and the same SQL trims them.
 */
export async function runFind(
  def: FindDef,
  sql: SqlRunner,
  q: FindQuery,
  meaning?: FindMeaning,
): Promise<FindResult> {
  let built = compile(def, q, true);
  const notes: string[] = [];
  let near: number[] | undefined;
  if (built.like) {
    if (!meaning || !def.meaning)
      throw new ToolError('like: this find has no search by meaning; use words instead.');
    const k = Math.min(NEAR_MAX, Math.max(NEAR_MIN, built.limit * 2));
    try {
      near = await withDeadline(`${def.name} meaning`, FIND_MS, meaning.near(built.like, k));
    } catch {
      near = undefined;
    }
    if (near?.length) built = compile(def, q, true, near);
    else notes.push('Search by meaning is not available now: like was left out, the rest applied.');
  }
  let rows: Record<string, unknown>[];
  try {
    rows = await withDeadline(`${def.name} find`, FIND_MS, sql.all(built.sql, ...built.args));
  } catch (e) {
    if (!built.words || !missingIndex(e)) throw e;
    built = compile(def, q, false, near);
    notes.push('Words were matched as plain text: the word index is not set up yet.');
    rows = await withDeadline(`${def.name} find`, FIND_MS, sql.all(built.sql, ...built.args));
  }
  const count = Number(rows[0]?._count ?? 0);
  const out = rows.map((r) => {
    const row: Record<string, unknown> = { [def.key]: r[def.key] };
    for (const f of built.fields) {
      const v = r[f];
      if (def.fields[f]?.json && typeof v === 'string') {
        try {
          row[f] = JSON.parse(v);
        } catch {
          row[f] = v;
        }
      } else row[f] = v;
    }
    return row;
  });
  const same = sameNames(def, out, built.fields);
  const byMeaning = !!near?.length;
  if (byMeaning)
    notes.push(
      'These are the nearest in meaning, nearest first, not every row that fits: pick from them and do not say how many match.',
    );
  return {
    ...(byMeaning ? { nearest: true as const } : { count }),
    returned: out.length,
    rows: out,
    ...(same.length ? { same_name: same } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

/** Rows in the answer that share a name, so the model counts and lists each of them. */
function sameNames(def: FindDef, rows: Record<string, unknown>[], fields: string[]) {
  const title = def.title ?? textFields(def)[0];
  if (!title || !fields.includes(title)) return [];
  const by = new Map<string, { name: string; ids: unknown[] }>();
  for (const r of rows) {
    const name = String(r[title] ?? '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const g = by.get(k) ?? { name, ids: [] };
    g.ids.push(r[def.key]);
    by.set(k, g);
  }
  return [...by.values()].filter((g) => g.ids.length > 1);
}

/** The values a tag field holds, to list in the tool's description. */
async function tagValues(def: FindDef, sql: SqlRunner, field: string): Promise<string[]> {
  const c = findRef(def, field);
  const rows = await sql.all(
    `SELECT DISTINCT ${c} AS v FROM ${def.table} t${def.where ? ` WHERE ${def.where}` : ''} ORDER BY v LIMIT ${TAG_VALUES + 1}`,
  );
  return rows.map((r) => String(r.v ?? '')).filter(Boolean);
}

/** The tool's flat JSON Schema, from the fields. */
function schemaOf(
  def: FindDef,
  tags: Record<string, string[]>,
  meaning: boolean,
): Record<string, unknown> {
  const names = Object.keys(def.fields);
  const text = textFields(def);
  const list = (description: string, items: Record<string, unknown> = { type: 'string' }) => ({
    type: 'array',
    items,
    description,
  });
  const props: Record<string, unknown> = {
    ...(meaning
      ? {
          like: {
            type: 'string',
            description: `A loose ask in plain words ("something light for a hot day", "good for a party"): the ${def.label}s nearest in meaning come first, and every other condition still applies. Use it for a mood, an occasion or a kind of thing, not for one exact word.`,
          },
        }
      : {}),
    any: list('Rows with at least one of these words or phrases.'),
    all: list('Rows with every one of these words or phrases.'),
    none: list('Leave out rows with any of these words or phrases (an ingredient to avoid).'),
    in: list('Which fields the words must be in; all text fields when left out.', {
      type: 'string',
      enum: text,
    }),
    ids: list(`Only these ${def.label}s, by ${def.key}.`, { type: 'integer' }),
    fields: list(
      `What to return for each ${def.label}; ${names.filter((n) => def.fields[n]?.show !== false).join(', ')} when left out. Ask only for what the answer needs.`,
      { type: 'string', enum: names },
    ),
    sort: {
      type: 'string',
      enum: names,
      description:
        'Order by this field; by best word match, else the default order, when left out.',
    },
    desc: { type: 'boolean', description: 'Highest first.' },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: def.max ?? 200,
      description: `Rows to return (${def.limit ?? 25} by default). The result says how many match in all.`,
    },
  };
  for (const [n, f] of Object.entries(def.fields)) {
    if (f.kind === 'tag') {
      const vals = tags[n] ?? [];
      props[n] = list(
        `Only these ${n} values${vals.length && vals.length <= TAG_VALUES ? `: ${vals.join(', ')}` : ''}.`,
        vals.length && vals.length <= TAG_VALUES
          ? { type: 'string', enum: vals }
          : { type: 'string' },
      );
    } else if (f.kind === 'number') {
      props[`${n}_min`] = { type: 'number', description: `${n} at least this.` };
      props[`${n}_max`] = { type: 'number', description: `${n} at most this.` };
    } else if (f.kind === 'date') {
      props[`${n}_from`] = { type: 'string', description: `${n} on or after this (YYYY-MM-DD).` };
      props[`${n}_to`] = { type: 'string', description: `${n} on or before this (YYYY-MM-DD).` };
    }
  }
  return { type: 'object', properties: props, additionalProperties: false };
}

/**
 * The find tool for one table, opened for one answer: its tag values are read once (one small query)
 * so the model picks real ones. A read; `find` marks it so the assistant puts a whole question in it.
 */
export async function findTool(
  def: FindDef,
  sql: SqlRunner,
  opts: { meaning?: FindMeaning } = {},
): Promise<PlainTool> {
  const meaning = def.meaning ? opts.meaning : undefined;
  const tags: Record<string, string[]> = {};
  await Promise.all(
    Object.entries(def.fields)
      .filter(([, f]) => f.kind === 'tag')
      .map(async ([n]) => {
        tags[n] = await withDeadline(`${def.name} values`, FIND_MS, tagValues(def, sql, n)).catch(
          () => [],
        );
      }),
  );
  const fields = Object.entries(def.fields)
    .map(([n, f]) => `${n} (${f.kind}${f.about ? `: ${f.about}` : ''})`)
    .join(', ');
  return {
    name: `${def.name}_find`,
    description: `Finds ${def.label}s in one query${def.about ? ` (${def.about})` : ''}: put every condition of the question in one call (filters, words to include or leave out, which fields to look in${meaning ? ', and like for a loose ask' : ''}) and ask only for the fields the answer needs. Fields: ${fields}. Returns the matching ${def.label}s, how many match in all (count; a like search returns the nearest instead, marked nearest, with no count) and any that share a name (same_name).`,
    inputSchema: schemaOf(def, tags, Boolean(meaning)),
    read: true,
    find: true,
    run: (args) => runFind(def, sql, (args ?? {}) as FindQuery, meaning),
  };
}
