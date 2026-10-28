/**
 * Search by meaning for a find tool: a vector index of what each row means, asked for the rows
 * nearest a loose ask, which the find's own SQL then trims (filters, words, rows the person never
 * sees). Opt in per app: `meaning` on the definition, then
 *
 *   const meaning = vectorMeaning({ embed: workersEmbed(env.AI), index: env.NOTES_INDEX });
 *   await findTool(notesFind, d1Sql(env.DB), { meaning });
 *
 * The index is kept in step by `meaningStep`, a small budgeted background step (`waitUntil`, an
 * alarm or a queue) that embeds only the rows whose `changed` column moved past its bookmark, so
 * it never runs on the request path and resumes wherever it stopped, whoever wrote the rows.
 */
import { type FindDef, findRef } from './find';
import type { SqlRunner } from './store';
import { withDeadline } from './tools';

/** The rows nearest in meaning to a loose ask, by key, nearest first. */
export interface FindMeaning {
  near(text: string, k: number): Promise<number[]>;
}

/** Texts to vectors, in order. */
export type Embed = (texts: string[], as: 'query' | 'passage') => Promise<number[][]>;

/** What a vector index needs (Cloudflare Vectorize has it). */
export interface VectorIndex {
  query(
    vector: number[],
    options: { topK: number; namespace?: string },
  ): Promise<{ matches: { id: string; score: number }[] }>;
  upsert(vectors: { id: string; values: number[]; namespace?: string }[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** Workers AI's text embeddings (`AI.run`). */
export interface EmbedAi {
  run(model: string, input: { text: string[] }): Promise<unknown>;
}

export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
/** bge models are asymmetric: a query (not a passage) needs this, or scores bunch together. */
const BGE_QUERY = 'Represent this sentence for searching relevant passages: ';
/** Texts one embedding call takes. */
const EMBED_BATCH = 100;

/** Embeddings from Workers AI: bge-base-en-v1.5 (768 dimensions, cosine) unless `model` says. */
export function workersEmbed(ai: EmbedAi, model = EMBED_MODEL): Embed {
  const prefix = /\/bge-/.test(model) ? BGE_QUERY : '';
  return async (texts, as) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH).map((t) => (as === 'query' ? prefix + t : t));
      const res = (await ai.run(model, { text: batch })) as { data?: number[][] };
      if (!res.data || res.data.length !== batch.length) throw new Error('embedding failed');
      out.push(...res.data);
    }
    return out;
  };
}

/**
 * A vector id: the row's key, after the namespace when there is one, so ids stay unique across
 * people in one index (a Durable Object app gives each person a namespace).
 */
const vectorId = (key: number, namespace?: string) =>
  namespace ? `${namespace}:${key}` : `${key}`;
const keyOf = (id: string) => Number(id.slice(id.lastIndexOf(':') + 1));

/** Search by meaning over a vector index: one embedding, one query. */
export function vectorMeaning(o: {
  embed: Embed;
  index: VectorIndex;
  /** One per person when rows are a person's own. */
  namespace?: string;
}): FindMeaning {
  return {
    async near(text, k) {
      const [vector] = await o.embed([text], 'query');
      if (!vector) return [];
      const res = await o.index.query(vector, {
        topK: k,
        ...(o.namespace ? { namespace: o.namespace } : {}),
      });
      return res.matches.map((m) => keyOf(m.id)).filter(Number.isInteger);
    },
  };
}

/** Where the step stopped: the last row's `changed` value and key. */
export interface MeaningMark {
  at: string | number;
  key: number;
}

export interface MeaningStepOptions {
  def: FindDef;
  sql: SqlRunner;
  embed: Embed;
  index: VectorIndex;
  namespace?: string;
  /** The bookmark, kept by the app (a settings row, its object's storage). */
  mark: { get(): Promise<MeaningMark | null>; put(m: MeaningMark): Promise<void> };
  /** Rows one step reads at most (50). */
  rows?: number;
}

/** What a row means, as text: its meaning fields with their names, JSON lists flattened. */
export function meaningText(def: FindDef, row: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const f of def.meaning?.fields ?? []) {
    let v = row[f];
    if (def.fields[f]?.json && typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {}
    }
    const flat = (x: unknown): string =>
      Array.isArray(x)
        ? x.map(flat).filter(Boolean).join('; ')
        : x && typeof x === 'object'
          ? Object.values(x).map(flat).filter(Boolean).join(': ')
          : x === null || x === undefined
            ? ''
            : String(x);
    const text = flat(v).replace(/\s+/g, ' ').trim();
    if (text) parts.push(`${f}: ${text}`);
  }
  return parts.join('\n').slice(0, 2_000);
}

const STEP_MS = 20_000;

/**
 * One budgeted step of keeping the index in step: the next rows (at most `rows`) whose `changed`
 * column moved past the bookmark, embedded in one call and written in one upsert; rows the find
 * never shows (its `where`) leave the index. Safe to run twice at once (writes are idempotent).
 * `done` is false while rows are left: run it again (another `waitUntil`, the next alarm).
 * A row deleted outright keeps its vector, which the find's SQL never matches.
 */
export async function meaningStep(o: MeaningStepOptions): Promise<{
  indexed: number;
  removed: number;
  done: boolean;
}> {
  const { def } = o;
  if (!def.meaning) return { indexed: 0, removed: 0, done: true };
  const n = Math.max(1, Math.min(EMBED_BATCH, o.rows ?? 50));
  const changed = `t.${def.meaning.changed}`;
  const mark = await o.mark.get();
  const cols = [...new Set(def.meaning.fields)].map((f) => `${findRef(def, f)} AS ${f}`).join(', ');
  const live = def.where ? `CASE WHEN (${def.where}) THEN 1 ELSE 0 END` : '1';
  const rows = await withDeadline(
    `${def.name} meaning`,
    STEP_MS,
    o.sql.all(
      `SELECT t.${def.key} AS _key, ${changed} AS _at, ${live} AS _live, ${cols} FROM ${def.table} t${mark ? ` WHERE (${changed} > ? OR (${changed} = ? AND t.${def.key} > ?))` : ''} ORDER BY ${changed}, t.${def.key} LIMIT ${n}`,
      ...(mark ? [mark.at, mark.at, mark.key] : []),
    ),
  );
  if (!rows.length) return { indexed: 0, removed: 0, done: true };
  const keep = rows.filter((r) => Number(r._live) === 1);
  const gone = rows.filter((r) => Number(r._live) !== 1);
  if (keep.length) {
    const vectors = await withDeadline(
      `${def.name} embed`,
      STEP_MS,
      o.embed(
        keep.map((r) => meaningText(def, r)),
        'passage',
      ),
    );
    await o.index.upsert(
      keep.map((r, i) => ({
        id: vectorId(Number(r._key), o.namespace),
        values: vectors[i] ?? [],
        ...(o.namespace ? { namespace: o.namespace } : {}),
      })),
    );
  }
  if (gone.length)
    await o.index.deleteByIds(gone.map((r) => vectorId(Number(r._key), o.namespace)));
  const last = rows[rows.length - 1] as Record<string, unknown>;
  await o.mark.put({ at: last._at as string | number, key: Number(last._key) });
  return { indexed: keep.length, removed: gone.length, done: rows.length < n };
}
