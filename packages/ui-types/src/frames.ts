// Frames: named rows
// and the one script that made them, kept apart from any page. A frame is linked (extra columns a
// card attaches by its key) or a snapshot of its own; Lumen's views draw both. The product's assistant
// makes them and its workspaces (`./workspaces`) show them in tabs.
import { z } from 'zod';
import { type JoinKey, joinKeys } from './domains';
import { type CustomViewConfig, type ViewFormat, customViewConfigSchema } from './views';

/** A frame's name, as the assistant and the person read it ("Earnings week"). One frame per name. */
export const frameName = z.string().trim().min(1).max(60);
/** Most rows and columns a frame keeps (the warehouse's own cap). */
export const FRAME_ROWS = 10_000;
export const FRAME_COLUMNS = 50;
/** Most hand edits a frame keeps (the latest per cell); past it the oldest go. */
export const FRAME_EDITS = 500;

/** The formats a frame column can carry; the assistant may set one, else number or text. */
export const FRAME_FORMATS = [
  'number',
  'rounded',
  'compact',
  'integer',
  'price',
  'price_rounded',
  'price_signed',
  'percent',
  'weight',
  'signed',
  'text',
  'amount',
  'amount_signed',
  'quantity',
] as const;
export type FrameFormat = (typeof FRAME_FORMATS)[number];

/**
 * The person's own money and sizes: `amount` (dollars), `amount_signed` (a
 * dollar gain) and `quantity` (shares or contracts held) show as price, price_signed and number,
 * and Hide amounts masks them.
 */
const FRAME_AMOUNTS: Partial<Record<FrameFormat, ViewFormat>> = {
  amount: 'price',
  amount_signed: 'price_signed',
  quantity: 'number',
};
export function frameFormat(f: FrameFormat): { format: ViewFormat; amount: boolean } {
  const shown = FRAME_AMOUNTS[f];
  return shown ? { format: shown, amount: true } : { format: f as ViewFormat, amount: false };
}

export interface FrameColumn {
  /** The field key: lowercase letters, digits and _ (formulas name it). */
  key: string;
  /** The name as the assistant wrote it. */
  label: string;
  type: 'number' | 'text' | 'date';
  format: ViewFormat;
  /** A holding amount the assistant marked (`frameFormat`): Hide amounts masks it. */
  amount?: boolean;
}

/**
 * How a frame refreshes: `live` runs its script again when its tab opens (app data only), `asof`
 * replays on a tap (it read the web), `static` cannot replay (the assistant wrote its rows itself).
 */
export type FrameMode = 'live' | 'asof' | 'static';

/**
 * What a frame is for (design step 2b): `linked`, rows keyed by a symbol or
 * account column, are extra columns for one card of the app's own data, attached by that key;
 * `snapshot` is a point-in-time table of its own (a scrape, a SQL result). The assistant says which by
 * giving a key (`frame.put` with `{key: "symbol"}`, `key` on call and sql).
 */
export type FrameKind = 'linked' | 'snapshot';

/**
 * Where a frame came from (Edits in place): `assistant` made it with a script;
 * `yours` is a column the person typed (Your data on a card's + Add column), a linked frame of
 * one key column and their own columns that the assistant never writes over.
 */
export type FrameOrigin = 'assistant' | 'yours';

/**
 * What makes a frame (one script, never stacked steps): one call, one SQL query
 * or one script that puts it. The assistant changes a frame by rewriting its script whole; a refresh runs it
 * once, in one sandbox. The person reads and edits it in the card's Script editor.
 */
export type FrameScript =
  | { kind: 'call'; fn: string; args: Record<string, unknown> }
  | { kind: 'sql'; query: string }
  | { kind: 'script'; code: string };

/** Longest code or SQL a frame's script may carry. */
export const FRAME_SCRIPT_CHARS = 20_000;
/** A frame's script as the person saves it from the Script editor. */
export const frameScriptSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('call'),
    fn: z
      .string()
      .trim()
      .regex(/^[a-z]+\.[a-z0-9_]+$/, 'a function such as trade.holdings_list'),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({ kind: z.literal('sql'), query: z.string().trim().min(1).max(FRAME_SCRIPT_CHARS) }),
  z.object({ kind: z.literal('script'), code: z.string().trim().min(1).max(FRAME_SCRIPT_CHARS) }),
]);

/** A frame cell's value. */
export type FrameCell = string | number | null;

/**
 * One hand edit on a frame: a value the person typed into a cell. A linked
 * frame's edit names the row by its `key` value (a ticker, an account), a snapshot's by `row`
 * index. A refresh runs the script, then puts the edits back; the latest per cell wins.
 */
export interface FrameEdit {
  column: string;
  key?: string;
  row?: number;
  value: FrameCell;
  at: string;
}

export interface FrameMeta {
  id: string;
  name: string;
  columns: FrameColumn[];
  rows: number;
  mode: FrameMode;
  kind: FrameKind;
  /** A linked frame's key: the join its rows carry. */
  key?: JoinKey;
  /** When its rows were last made or changed: the frame's as-of time. */
  at: string;
  /** The chat that made it. */
  chat?: string;
  /** The last refresh failed: why (the rows stay the last good ones). */
  error?: string;
  /** Who made it; absent means the assistant. */
  origin?: FrameOrigin;
  /** How many cells the person edited by hand (the edits themselves ride with the rows). */
  edited?: number;
}

/** A frame's rows, one array per row in the order of `columns`, and the person's hand edits. */
export interface FrameData {
  meta: FrameMeta;
  rows: FrameCell[][];
  edits?: FrameEdit[];
}

/** A Your data column as the person adds it: a name and whether it holds numbers or text. */
export const yourColumnSchema = z.object({
  label: z.string().trim().min(1).max(40),
  type: z.enum(['number', 'text']),
});
export type YourColumn = z.infer<typeof yourColumnSchema>;

/** A cell edit as the app sends it: the row by key or index, the column and the new value. */
export const frameEditSchema = z.object({
  column: z.string().min(1).max(40),
  key: z.string().min(1).max(80).optional(),
  row: z.number().int().min(0).optional(),
  value: z.union([z.string().max(2000), z.number(), z.null()]),
});
export type FrameEditInput = z.infer<typeof frameEditSchema>;

/** A field key from a column name: `Day %` → `day_pct`. */
export function columnKey(name: string, taken: Set<string>): string {
  const base =
    name
      .trim()
      .replace(/%/g, ' pct ')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .replace(/^(\d)/, 'c_$1')
      .slice(0, 36) || 'col';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  taken.add(key);
  return key;
}

/** The columns that make a frame's rows carry a symbol key (the registry's Symbol join). */
export const SYMBOL_COLUMNS = ['symbol', 'ticker', 'underlying'] as const;

/** The columns that make a frame's rows carry an account key (the registry's Account join). */
export const ACCOUNT_COLUMNS = ['account', 'account_id'] as const;
const KEY_COLUMNS: Record<JoinKey, readonly string[]> = {
  symbol: SYMBOL_COLUMNS,
  account: ACCOUNT_COLUMNS,
  // A frame never links by contract: its options rows join by their underlying.
  contract: [],
};

/** The frame's column for a join key, if it has one: a text column named like that key. */
export const frameKeyAt = (meta: Pick<FrameMeta, 'columns'>, key: JoinKey) =>
  meta.columns.findIndex((c) => c.type === 'text' && KEY_COLUMNS[key].includes(c.key));

/**
 * Columns a frame with a symbol column must not carry where the app has a live feed (a price in a frame freezes): the card's Symbol join fills live Price and Day % by
 * itself. Keys as `columnKey` makes them; a dated price goes in under its own name (`close_q3`).
 */
export const LIVE_QUOTE_COLUMNS: Record<string, 'price' | 'change_pct'> = {
  price: 'price',
  last: 'price',
  last_price: 'price',
  current_price: 'price',
  live_price: 'price',
  quote: 'price',
  change_pct: 'change_pct',
  day_pct: 'change_pct',
  day_change_pct: 'change_pct',
  pct_change: 'change_pct',
  change_pct_1d: 'change_pct',
  day_change: 'change_pct',
};

/** The live quote columns a frame carries that its Symbol join already gives. */
export function liveQuoteColumns(columns: FrameColumn[]): FrameColumn[] {
  if (frameKeyAt({ columns }, 'symbol') < 0) return [];
  return columns.filter((c) => c.type === 'number' && LIVE_QUOTE_COLUMNS[c.key]);
}

/** The frame's symbol column, if it has one: a text column named like a ticker column. */
export const frameSymbolAt = (meta: Pick<FrameMeta, 'columns'>) => frameKeyAt(meta, 'symbol');

/** The key column a Your data frame starts with, for a join key. */
export const yourKeyColumn = (key: JoinKey): FrameColumn => ({
  key,
  label: key === 'symbol' ? 'Symbol' : 'Account',
  type: 'text',
  format: 'text',
});

/**
 * The join key a frame's rows are merged on, from the column the assistant named: `symbol` for a ticker
 * column, `account` for an account column, else null (a plain merge key, not a join).
 */
export function frameJoinKey(columns: FrameColumn[], mergeKey: string | undefined): JoinKey | null {
  if (!mergeKey) return null;
  const col = columns.find((c) => c.label === mergeKey || c.key === mergeKey);
  if (!col || col.type !== 'text') return null;
  return (
    (Object.keys(KEY_COLUMNS) as JoinKey[]).find((k) => KEY_COLUMNS[k].includes(col.key)) ?? null
  );
}

/** A linked frame as a card's catalog knows it: its key and the columns it adds. */
export interface LinkedFrame {
  id: string;
  name: string;
  key: JoinKey;
  /** The frame's columns but its key column. */
  columns: FrameColumn[];
  at: string;
}

/**
 * A linked frame as Edit widget's + Data lists it: the person's own recipes a
 * card can attach, with where one already enriches a card (a linked frame joins one card only).
 */
export interface FrameChoice extends Omit<LinkedFrame, 'key'> {
  /** None: a snapshot, which a card links by field pairs (`frame:<id>` connection). */
  key?: JoinKey;
  origin: FrameOrigin;
  /** The card it enriches now ("tab Watch in workspace Ideas", "a saved view"); none when free. */
  used?: string;
}

/** A frame as a linked one, or null when it is a snapshot. */
export function linkedFrame(meta: FrameMeta): LinkedFrame | null {
  if (meta.kind !== 'linked' || !meta.key) return null;
  const at = frameKeyAt(meta, meta.key);
  if (at < 0) return null;
  return {
    id: meta.id,
    name: meta.name,
    key: meta.key,
    columns: meta.columns.filter((_, i) => i !== at),
    at: meta.at,
  };
}

/**
 * A frame tab's starting layout: every column, sorted as the rows came, no Total row. A frame with
 * a symbol column also starts with the Symbol join's live Price and Day % (the app's feed fills
 * them; where there is none the header says so), and may name any other Symbol field.
 */
export function frameConfig(meta: FrameMeta, start?: Partial<CustomViewConfig>): CustomViewConfig {
  const own = meta.columns.map((c) => c.key);
  const joins = frameSymbolAt(meta) >= 0 ? joinKeys(['symbol'], own) : [];
  const keys = new Set([...own, ...joins]);
  const base = customViewConfigSchema.parse({
    shape: 'table',
    columns: [...own, ...joins.filter((k) => k === 'price' || k === 'change_pct')],
    // Empty offers every field the frame's catalog marks groupable or filterable: listing them
    // would break on a frame wider than the 20 fields a view may name.
    group: { fields: [], default: null },
    filters: { fields: [], default: [] },
    width: 'scroll',
    // A frame's rows are whatever the assistant found; adding them all up rarely means anything.
    total: false,
  });
  const merged = customViewConfigSchema.safeParse({ ...base, ...(start ?? {}) });
  const config = merged.success ? merged.data : base;
  // Columns the assistant named that the frame lacks are dropped, not refused: rows change over time.
  return {
    ...config,
    name: meta.name,
    columns: config.columns.filter((k) => keys.has(k) || config.formulas.some((f) => f.key === k)),
  };
}
