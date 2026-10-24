// Views: one table, group and pivot engine every app reuses over its own
// data (an explorer over warehouse market data, a portfolio over a database).
// An app produces rows of columns; these schemas say how a view shows them, and `views/shape.ts`
// in the Worker rolls them up.
import { z } from 'zod';
import { DOMAIN_KEYS, JOINS, type JoinKey, joinFields, joinKeys } from './domains';
import { MARKET_KEY_RE, marketWindows } from './market';
import {
  type FormulaNames,
  checkViewFormula,
  formulaLoops,
  frameSpace,
  renameFormula,
} from './view-formula';

export {
  checkViewFormula,
  compileViewFormula,
  type FormulaNames,
  formulaLoops,
  formulaReads,
  frameSpace,
  renameFormula,
  viewFormulaFunctions,
  type ViewFormulaScope,
  viewFormulaIsText,
  whyBlank,
} from './view-formula';
export {
  FORMULA_FUNCTIONS,
  type FormulaFunction,
  formulaFunctionsText,
} from './formula-functions';

const viewKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'key: lowercase letters, digits and _');
const MAX_VALUES = 40;

/** How a view shows its rows; the sidebar icon follows it. */
export const viewShapes = ['table', 'group', 'pivot'] as const;
export type ViewShape = (typeof viewShapes)[number];
/** Calendar buckets a group or pivot can use besides a column's own values. */
export const viewPeriods = ['week', 'month', 'quarter', 'year', 'weekday'] as const;
export const viewAggs = [
  'last',
  'first',
  'mean',
  'sum',
  'min',
  'max',
  'count',
  'distinct',
] as const;
export type ViewAgg = (typeof viewAggs)[number];
/**
 * Roll-ups that count rows rather than read their values (`distinct` counts
 * the different values), so they take any field, text included, and show as a whole number.
 */
export const isCountAgg = (a: ViewAgg) => a === 'count' || a === 'distinct';
/** A column's group and Total rows: a roll-up, or `none` for blank. */
export const viewTotalAggs = [...viewAggs, 'none'] as const;
export type ViewTotalAgg = (typeof viewTotalAggs)[number];
/** A period, or the key of a column whose values make the buckets. */
const viewBucket = z.union([z.enum(viewPeriods), viewKey]);
const MAX_FIELDS = 20;
export const viewGroupSchema = z
  .object({
    /** The grouping the view opens on. */
    by: viewBucket.default('month'),
    /** The groupings a reader can switch between; empty = only `by`. */
    fields: z.array(viewBucket).max(MAX_FIELDS).default([]),
    /** Each entry is one rolled-up column; empty = `last` of every shown column. */
    values: z
      .array(z.object({ key: viewKey, agg: z.enum(viewAggs).default('last') }))
      .max(MAX_VALUES)
      .default([]),
  })
  .refine((g) => !g.fields.length || g.fields.includes(g.by), 'by is not one of fields');
export const viewPivotSchema = z.object({
  rows: viewBucket.default('year'),
  columns: viewBucket.default('month'),
  /** Null = the first shown column. */
  value: viewKey.nullable().default(null),
  agg: z.enum(viewAggs).default('mean'),
});
/** A number condition on a number field: `value` is a number, or `a..b` for between. */
export const viewTokenOps = ['gt', 'lt', 'eq', 'between'] as const;
export type ViewTokenOp = (typeof viewTokenOps)[number];
const NUM = '-?\\d+(?:\\.\\d+)?';
const numberToken = (t: { value: string; op?: ViewTokenOp }) =>
  !t.op || new RegExp(t.op === 'between' ? `^${NUM}\\.\\.${NUM}$` : `^${NUM}$`).test(t.value);
/**
 * A filter token, `key:value` (symbol:QQQ); `not: true` excludes the value. On one key a row must
 * have one of its included values (if any) and none of its excluded ones; tokens on different keys
 * must all match. Text matches without case, a number by its value. With `op`, a number field
 * keeps the rows above (`gt`), below (`lt`), at (`eq`) or `between` the value (`a..b`, inclusive).
 */
export const viewTokenSchema = z
  .object({
    key: viewKey,
    value: z.string().trim().min(1).max(40),
    not: z.boolean().optional(),
    op: z.enum(viewTokenOps).optional(),
  })
  .refine(numberToken, 'a number condition needs a number, or a..b for between');
export type ViewToken = z.infer<typeof viewTokenSchema>;
/**
 * The token key for free text: `contains:fed` keeps the rows whose text holds
 * "fed" (any case), `not` drops them. It needs no filterable field: it reads the row's own text.
 */
export const CONTAINS_KEY = 'contains';
/** Whether `n` meets a number token's condition; `eq` matches to the cent. */
export function meetsNumber(op: ViewTokenOp | undefined, value: string, n: number | null) {
  if (n === null || !Number.isFinite(n)) return false;
  const [a = Number.NaN, b = Number.NaN] = value.split('..').map(Number);
  if (op === 'gt') return n > a;
  if (op === 'lt') return n < a;
  if (op === 'between') return n >= Math.min(a, b) && n <= Math.max(a, b);
  return Math.abs(n - a) < 0.005;
}
export const viewFilterSchema = z
  .object({
    /** The columns a reader can filter on. */
    fields: z.array(viewKey).max(MAX_FIELDS).default([]),
    /** The tokens the view opens with; a read may send others. */
    default: z.array(viewTokenSchema).max(MAX_FIELDS).default([]),
  })
  .refine(
    (f) => f.default.every((t) => t.key === CONTAINS_KEY || f.fields.includes(t.key)),
    'a default token is not on a filterable field',
  );

/** A cell: a number, text (a symbol, an account), a `span(a, b)` pair, or null for no data. */
export type ViewValue = number | string | null | [number | null, number | null];
/**
 * `weight` is an unsigned percent (a share of a whole); `percent` is a signed change. `price_signed`
 * is dollars with a sign and gain/loss colour, for gains; `price` is plain dollars.
 * `number` and `price` show cents, `rounded` and `price_rounded` the same with no decimals, and
 * `integer` no decimals and no thousands commas, for years and ids; `compact` reads large numbers
 * short (1.2K, 10B).
 */
export type ViewFormat =
  | 'number'
  | 'rounded'
  | 'compact'
  | 'price'
  | 'price_rounded'
  | 'price_signed'
  | 'percent'
  | 'weight'
  | 'signed'
  | 'integer'
  | 'text';
/** Formats that read as dollars. */
export const isDollarFormat = (f: ViewFormat) =>
  f === 'price' || f === 'price_rounded' || f === 'price_signed';

/** Rows rolled up by a bucket; `days` counts the rows in each. */
export interface ViewGrouped {
  shape: 'group';
  by: string;
  values: { key: string; agg: ViewAgg; label: string; format: ViewFormat }[];
  rows: { bucket: string; days: number; values: ViewValue[] }[];
}
/** One value rolled up into a rows × columns grid; `cells[r][c]` is null where no row falls. */
export interface ViewPivoted {
  shape: 'pivot';
  rows_by: string;
  columns_by: string;
  value: { key: string; agg: ViewAgg; label: string; format: ViewFormat };
  rows: string[];
  columns: string[];
  cells: (number | null)[][];
}

const cell = (v: ViewValue) =>
  Array.isArray(v) ? v.map((x) => x ?? '').join(';') : v === null ? '' : String(v);

/** A group or pivot as CSV: a group as `bucket,days,<key>_<agg>...`, a pivot as its grid. */
export function viewShapedCsv(shaped: ViewGrouped | ViewPivoted): string {
  const lines =
    shaped.shape === 'group'
      ? [
          [shaped.by, 'days', ...shaped.values.map((v) => `${v.key}_${v.agg}`)],
          ...shaped.rows.map((r) => [r.bucket, String(r.days), ...r.values.map(cell)]),
        ]
      : [
          [`${shaped.rows_by}\\${shaped.columns_by}`, ...shaped.columns],
          ...shaped.rows.map((r, i) => [r, ...(shaped.cells[i] ?? []).map(cell)]),
        ];
  return lines.map((r) => r.join(',')).join('\n');
}

/**
 * Custom views: a saved LumenView view over one data domain, for any
 * app. One store (D1 `custom_views`) keeps them all: owner, app, domain, name and this config.
 * Field keys are the domain's own (`symbol`, `account`), so any short key is allowed.
 */
const fieldKey = z.string().trim().min(1).max(40);
/** The quick-pick icons for a view (lucide names; the shell maps them). */
export const viewIconNames = [
  'table',
  'list-tree',
  'grid',
  'wallet',
  'receipt',
  'briefcase',
  'landmark',
  'piggy-bank',
  'banknote',
  'coins',
  'chart-line',
  'chart-bar',
  'chart-pie',
  'trending-up',
  'trending-down',
  'target',
  'shield',
  'star',
  'zap',
  'flame',
  'calendar',
  'clock',
  'layers',
  'tag',
] as const;
export type ViewIconName = (typeof viewIconNames)[number];
/**
 * A view's sidebar icon: any lucide icon name in kebab case (`viewIconNames`
 * are the quick picks; an unknown name shows the shape's icon), or one emoji.
 */
export const viewIconSchema = z.union([
  z.string().regex(/^[a-z][a-z0-9-]{0,48}$/),
  z.emoji().max(16),
]);
export type ViewIcon = z.infer<typeof viewIconSchema>;
/** The number formats: how a number field or formula shows. */
export const viewNumberFormats = [
  'number',
  'rounded',
  'integer',
  'compact',
  'signed',
  'price',
  'price_rounded',
  'price_signed',
  'weight',
  'percent',
] as const;
/** Formats a formula column can take: a number format, or text for one that gives words. */
export const viewFormulaFormats = [...viewNumberFormats, 'text'] as const;
/**
 * A formula column: `expr` over the domain's field keys and the view's
 * earlier formulas, with group_sum("key") and total_sum("key"); `agg` rolls it up on group and
 * Total rows (null: the same expression over each input's own roll-up, so unrealized / cost_basis
 * gives each group's own gain %; `none`: those rows show nothing). Its key can be listed in `columns` like any field.
 */
export const viewFormulaSchema = z.object({
  key: viewKey,
  label: z.string().trim().min(1).max(40),
  expr: z.string().trim().min(1).max(400),
  format: z.enum(viewFormulaFormats).default('number'),
  agg: z.enum(viewTotalAggs).nullable().default(null),
});
export type ViewFormula = z.infer<typeof viewFormulaSchema>;
/**
 * Filter links: a
 * card can carry a link colour (a square before its title). A filter chip that carries its card's
 * colour narrows every card of that colour; one without narrows its own card only.
 */
export const viewLinkColors = ['teal', 'amber', 'pink', 'lime', 'blue'] as const;
export type ViewLinkColor = (typeof viewLinkColors)[number];
const tokenLink = z.enum(viewLinkColors).optional();
const cardToken = z
  .object({
    key: fieldKey,
    value: z.string().trim().min(1).max(40),
    not: z.boolean().optional(),
    op: z.enum(viewTokenOps).optional(),
    /** Linked: narrows every card of this colour too (a widget's filter on a page with no table). */
    link: tokenLink,
  })
  .refine(numberToken, 'a number condition needs a number, or a..b for between');
/** Secondary lines a Summary card shows under its main number, at most. */
export const MAX_TILE_LINES = 4;
/**
 * A line under a Summary card's main number: `value` is another roll-up of a
 * field over the card's rows (narrowed by its own `filter`), with an optional `suffix` ("18
 * contracts"); `pct` is the main number as a percent of a roll-up of `field` over all the Summary's rows
 * ("4.5% of Value"); `text` is plain text.
 */
export const viewTileLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('value'),
    field: viewKey,
    agg: z.enum(viewAggs).default('sum'),
    filter: z.array(cardToken).max(MAX_FIELDS).default([]),
    suffix: z.string().trim().max(30).default(''),
  }),
  z.object({ kind: z.literal('pct'), field: viewKey, agg: z.enum(viewAggs).default('sum') }),
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(60) }),
]);
export type ViewTileLine = z.infer<typeof viewTileLineSchema>;
/**
 * A Summary card (one main number and secondary lines since): `{key}`
 * alone is one of the domain's own cards (Value, Day P&L), drawn by the app; with `label`, `field`
 * and `agg` it is a card of the view's own: its main number is one field or formula column rolled
 * up over the rows the Summary shows, narrowed by its own `filter`; `sign` colours it green or red
 * by sign; `lines` are its secondary lines.
 */
const ownTileSchema = z.object({
  key: viewKey,
  label: z.string().trim().min(1).max(40),
  field: viewKey,
  agg: z.enum(viewAggs).default('sum'),
  filter: z.array(cardToken).max(MAX_FIELDS).default([]),
  sign: z.boolean().default(false),
  /** Text after the main number ("21 places"), as a value line's `suffix`. */
  suffix: z.string().trim().max(30).default(''),
  lines: z.array(viewTileLineSchema).max(MAX_TILE_LINES).default([]),
});
export const viewTileSchema = z.union([ownTileSchema, z.object({ key: fieldKey }).strict()]);
export type ViewTile = z.infer<typeof viewTileSchema>;
/** A tile the view works out itself (it names a field), not one of the domain's. */
export type ViewOwnTile = z.infer<typeof ownTileSchema>;
export const isOwnTile = (t: ViewTile): t is ViewOwnTile => 'field' in t;
/** The domain's own tiles by key, as a view's `tiles` lists them. */
export const domainTiles = (...keys: string[]): ViewTile[] => keys.map((key) => ({ key }));
/**
 * Where a chip field shows: `column` in its own column, `inline` on the view's
 * first column (holdings: next to the Symbol), so tags read with the row's name.
 */
/** Page sizes a view's table offers. */
export const viewPageSizes = [25, 50, 100, 250] as const;
export type ViewPageSize = (typeof viewPageSizes)[number];
/** A view's pagination: on by default, 25 rows a page. */
export const viewPaginationSchema = z
  .object({
    on: z.boolean().default(true),
    size: z.literal(viewPageSizes).default(25),
  })
  .prefault({});
export type ViewPagination = z.infer<typeof viewPaginationSchema>;
/** How a view's table meets the width there is. */
export const viewTableWidths = ['fit', 'scroll'] as const;
export type ViewTableWidth = (typeof viewTableWidths)[number];
export const viewChipPlacements = ['column', 'inline'] as const;
export type ViewChipPlacement = (typeof viewChipPlacements)[number];
/** A text field shown as chips; it shows only while its key is in `columns`. */
export const viewChipSchema = z.object({
  key: fieldKey,
  placement: z.enum(viewChipPlacements).default('column'),
});
export type ViewChip = z.infer<typeof viewChipSchema>;
/**
 * Cards (as blocks; renamed):
 * a page (LumenLayout) is a grid of cards (react-grid-layout), each placed at
 * `x`, `y` and sized `w` columns of 6 by `h` rows of 8px, with its own place on a phone.
 *
 * Every card is a widget of one kind with a style (Widget anatomy): Table (the view's table, or Top
 * N), Metric (a number, a row of numbers, a progress bar or ring, a spark, a tracker), Allocation
 * (a bar, a donut, a bar list) and Chart (a price chart, Growth of $1, Market and the trends). A
 * page may hold several tables: the first without its own `table` layout
 * draws the view's columns, sort and grouping, every other one its own. Widgets read the rows the
 * view shows after its filters, narrowed by their own `filter`, and are worked out in the browser;
 * Market and Price read their own market data. `page` is a card a page draws itself.
 */
export const viewCardKinds = ['table', 'metric', 'allocation', 'chart'] as const;
export type ViewCardKind = (typeof viewCardKinds)[number];
export const VIEW_CARD_KIND_NAMES: Record<ViewCardKind, string> = {
  table: 'Table',
  metric: 'Metric',
  allocation: 'Allocation',
  chart: 'Chart',
};
/** A trend's drawings as a chart (every Tremor visualization, on our charts). */
export const chartTrendStyles = ['line', 'area', 'stacked', 'bars', 'combo'] as const;
/** A trend's drawings as a metric: a small line with its last value, or one block per bucket. */
export const metricTrendStyles = ['spark', 'tracker'] as const;
export const trendStyles = [...chartTrendStyles, ...metricTrendStyles] as const;
export type TrendStyle = (typeof trendStyles)[number];
/** How a trend buckets its rows' dates. */
export const trendBuckets = ['day', 'week', 'month', 'year'] as const;
export type TrendBucket = (typeof trendBuckets)[number];
/** A number's drawing: the number, or that number against a target as a bar or a ring. */
export const cardStyles = ['number', 'progress_bar', 'progress_circle'] as const;
export type CardStyle = (typeof cardStyles)[number];
/**
 * What a number against its target means, which colours its bar or ring:
 * `health` is better high (green at `warn` and over, orange down to `bad`, red below), `usage`
 * better low (green under `warn`, orange from it, red from `bad`). Left out: the one chart colour.
 */
export const meterKinds = ['health', 'usage'] as const;
export type MeterKind = (typeof meterKinds)[number];
/** Each meter's default bands, in % of the target. */
export const METER_BANDS: Record<MeterKind, { warn: number; bad: number }> = {
  health: { warn: 100, bad: 90 },
  usage: { warn: 75, bad: 90 },
};
/** The theme tone a share of the target (%) reads as, or null with no meter. */
export function meterTone(
  meter: MeterKind | undefined,
  share: number | null,
  bands?: { warn: number; bad: number },
): 'success' | 'warning' | 'destructive' | null {
  if (!meter || share === null) return null;
  const { warn, bad } = bands ?? METER_BANDS[meter];
  if (meter === 'health')
    return share >= warn ? 'success' : share >= bad ? 'warning' : 'destructive';
  return share < warn ? 'success' : share < bad ? 'warning' : 'destructive';
}
/** Each kind's styles, the first its default. */
export const viewCardStyles = {
  table: ['table', 'top_n'],
  metric: [...cardStyles, 'row', ...metricTrendStyles],
  allocation: ['bar', 'donut', 'bar_list'],
  chart: ['price', 'growth', 'market', ...chartTrendStyles],
} as const satisfies Record<ViewCardKind, readonly string[]>;
/** The grid: 6 columns on a desktop, 2 on a phone, rows of 8px. */
export const GRID_COLS = 6;
export const GRID_PHONE_COLS = 2;
export const GRID_ROW_PX = 8;
/** One block of height: a 1×1 card (one main number and its lines) is a column by this. */
export const GRID_BLOCK_ROWS = 14;
/** A card's place on the phone's 2-column grid, kept when the layout is edited there. */
export const viewCardPlaceSchema = z.object({
  x: z
    .int()
    .min(0)
    .max(GRID_PHONE_COLS - 1),
  y: z.int().min(0).max(100_000),
  w: z.int().min(1).max(GRID_PHONE_COLS),
  h: z.int().min(2).max(500).optional(),
});
export type ViewCardPlace = z.infer<typeof viewCardPlaceSchema>;
const MAX_CARDS = 12;
const uniqueKeys = (keys: string[]) => [...new Set(keys)];
/**
 * A widget's controls (widget anatomy): each shows or hides one part of its
 * frame. Missing keys take the kind's default (`CONTROL_DEFAULTS`); a key a kind lacks is ignored.
 */
export const widgetControls = [
  'ask',
  'refresh',
  'filter',
  'group',
  'columns',
  'pager',
  'download',
  'window',
  'legend',
  'footer',
  'header',
] as const;
export type WidgetControl = (typeof widgetControls)[number];
export const WIDGET_CONTROL_NAMES: Record<WidgetControl, string> = {
  ask: 'Ask assistant',
  refresh: 'Refresh',
  filter: 'Filter box',
  group: 'Group',
  columns: 'Columns',
  pager: 'Pager',
  download: 'Download',
  window: 'Window',
  legend: 'Legend',
  footer: 'Footer',
  header: 'Header',
};
/** Each kind's controls and whether each starts on; a control a kind has not is left out. */
export const CONTROL_DEFAULTS: Record<ViewCardKind, Partial<Record<WidgetControl, boolean>>> = {
  table: {
    ask: true,
    refresh: true,
    filter: true,
    group: true,
    columns: true,
    pager: true,
    download: true,
    footer: true,
    header: true,
  },
  metric: { ask: true, refresh: true, filter: false, footer: false, header: false },
  allocation: {
    ask: true,
    refresh: true,
    filter: false,
    group: false,
    download: false,
    legend: true,
    footer: false,
    header: true,
  },
  chart: {
    ask: true,
    refresh: true,
    filter: false,
    download: false,
    window: true,
    legend: true,
    footer: false,
    header: true,
  },
};
/** Slices an allocation bar shows on its own before the rest fold into Other. */
export const ALLOCATION_MAX = 10;
/**
 * One connection: the domain `to` and the pairs that match a row to its rows, each a key the
 * rows carry (`symbol`, `account`) or a field of each side. Left out of a card move, `on` is
 * inferred from the keys both domains carry.
 */
export const viewConnectionSchema = z
  .object({
    // A catalog domain any reader returns, or a recipe `frame:<id>` (`linkIssues`, checked where
    // views are written).
    to: z
      .string()
      .regex(/^(?:frame:[A-Za-z0-9_-]+|[a-z][a-z0-9_]*)$/)
      .max(80),
    // No pairs: added but Not linked yet, unless both sides carry a key.
    on: z.array(z.object({ from: fieldKey, to: fieldKey }).strict()).max(3),
  })
  .strict();
export type ViewConnection = z.infer<typeof viewConnectionSchema>;
/** A widget's own main data: a catalog domain id (`zeus_credits`) or a recipe (`frame:<id>`). */
export const viewSourceSchema = viewConnectionSchema.shape.to;
const cardBase = {
  id: viewKey,
  /** Null or left out: the style's own title (the catalog's name for a pre-built widget). */
  title: z.string().trim().min(1).max(40).nullable().default(null),
  /** Columns it spans of 6 (a third is 2, half 3, full 6). */
  w: z.int().min(1).max(GRID_COLS).default(GRID_COLS),
  /** Rows of 8px it is tall; left out, as tall as what it shows. */
  h: z.int().min(2).max(500).optional(),
  /** Its column and row on the desktop grid; left out, it follows the card before it. */
  x: z
    .int()
    .min(0)
    .max(GRID_COLS - 1)
    .optional(),
  y: z.int().min(0).max(100_000).optional(),
  /** Its place on a phone, once the layout was arranged there; left out, the desktop's order. */
  phone: viewCardPlaceSchema.optional(),
  /** Tokens that narrow the view's rows for this widget only, e.g. kind:Option. */
  filter: z.array(cardToken).max(MAX_FIELDS).default([]),
  /**
   * Its own main data, which gives its rows: a catalog domain id or a recipe (`frame:<id>`). Left
   * out, the page's rows. A widget with a source follows the page's chips only by a key both carry.
   */
  source: viewSourceSchema.optional(),
  /** What it links to its own source (with `source` only; a page-data widget shares the view's). */
  connections: z.array(viewConnectionSchema).max(4).optional(),
  /** Its link colour: it shares its chips and tapped row with every card of that colour and
   *  follows theirs. Left out: none. */
  link: z.enum(viewLinkColors).optional(),
  /** Its controls shown or hidden (Edit widget ▸ Controls); missing keys take the kind's default. */
  controls: z.partialRecord(z.enum(widgetControls), z.boolean()).optional(),
};
/**
 * A table's own layout (several tables on a layout): the parts of a view
 * config that shape one table. Left out on a table card, it draws the view's own.
 */
export const viewTableLayoutSchema = z.object({
  shape: z.enum(viewShapes).default('table'),
  columns: z.array(fieldKey).max(60).default([]).transform(uniqueKeys),
  hidden: z.array(fieldKey).max(60).optional(),
  chips: z.array(viewChipSchema).max(MAX_FIELDS).default([]),
  formats: z.record(fieldKey, z.enum(viewNumberFormats)).optional(),
  aggs: z.record(fieldKey, z.enum(viewTotalAggs)).optional(),
  group: z
    .object({
      fields: z.array(fieldKey).max(MAX_FIELDS).default([]),
      default: fieldKey.nullable().default(null),
    })
    .prefault({}),
  subgroup: fieldKey.nullable().optional(),
  pivot: z
    .object({ rows: fieldKey, columns: fieldKey, value: fieldKey, agg: z.enum(viewAggs) })
    .nullable()
    .default(null),
  sort: z
    .object({ key: fieldKey, desc: z.boolean().default(false) })
    .nullable()
    .default(null),
  pagination: viewPaginationSchema,
  width: z.enum(viewTableWidths).optional(),
});
export type ViewTableLayout = z.infer<typeof viewTableLayoutSchema>;
/** A trend's settings: up to 4 number fields over a date field, rolled up per bucket. */
const trendFields = {
  w: cardBase.w.unwrap().default(3),
  date: fieldKey,
  values: z.array(fieldKey).min(1).max(4),
  bucket: z.enum(trendBuckets).default('day'),
  agg: z.enum(['sum', 'mean', 'last', 'count']).default('sum'),
};
const tableCard = z.discriminatedUnion('style', [
  /** A table of the rows (LumenView): the view's own layout, or its own `table`. */
  z.object({
    ...cardBase,
    kind: z.literal('table'),
    style: z.literal('table'),
    table: viewTableLayoutSchema.optional(),
  }),
  /** The first `n` rows by `sort`, with a few columns: largest positions, biggest gains. */
  z.object({
    ...cardBase,
    kind: z.literal('table'),
    style: z.literal('top_n'),
    sort: fieldKey,
    desc: z.boolean().default(true),
    n: z.int().min(1).max(50).default(5),
    columns: z.array(fieldKey).min(1).max(8),
  }),
]);
const metricCard = z.discriminatedUnion('style', [
  /**
   * One number (LumenCard): one main number and up to 4 lines, a column wide by
   * default, over the view's rows narrowed by its own `filter`; or that number against `target`
   * as a progress bar or ring.
   */
  z.object({
    ...cardBase,
    kind: z.literal('metric'),
    style: z.enum(cardStyles),
    w: cardBase.w.unwrap().default(1),
    tile: viewTileSchema,
    /** What the number is measured against (a progress style's 100%). */
    target: z.number().positive().max(1e15).optional(),
    /** What the share of `target` means: colours the bar or ring by `meterTone`. */
    meter: z.enum(meterKinds).optional(),
    /** The meter's own bands in % of `target`; left out, `METER_BANDS`. */
    bands: z
      .object({ warn: z.number().min(0).max(100), bad: z.number().min(0).max(100) })
      .optional(),
  }),
  /**
   * A row of numbers (a Summary): its own `tiles` when set, else the view's
   * `tiles` (the page's first). A page can hold several, each with its own rows filter.
   */
  z.object({
    ...cardBase,
    kind: z.literal('metric'),
    style: z.literal('row'),
    tiles: z.array(viewTileSchema).max(24).optional(),
    /** The field whose highest row the app's tiles show (Best variant), when it ranks. */
    rank: fieldKey.optional(),
    /**
     * Counts the domain's cash rows, set in Edit widget where the domain has
     * them. Left out: cash counts when the row covers every row, not when it is narrowed.
     */
    cash: z.boolean().optional(),
  }),
  /** A trend as a metric: a spark (a small line and its last value) or a tracker (one block per
   *  bucket, green up and red down). */
  z.object({
    ...cardBase,
    kind: z.literal('metric'),
    style: z.enum(metricTrendStyles),
    ...trendFields,
  }),
]);
const allocationCard = z.discriminatedUnion('style', [
  /** One stacked bar: the share of `value` (a number) for each value of `by` (a text field). The
   *  largest `max` show on their own; the rest fold into Other. */
  z.object({
    ...cardBase,
    kind: z.literal('allocation'),
    style: z.literal('bar'),
    by: fieldKey,
    value: fieldKey,
    max: z.int().min(2).max(50).default(ALLOCATION_MAX),
  }),
  /** The same share as a donut; past `max` slices the rest fold into Other. */
  z.object({
    ...cardBase,
    kind: z.literal('allocation'),
    style: z.literal('donut'),
    by: fieldKey,
    value: fieldKey,
    max: z.int().min(2).max(12).default(6),
  }),
  /** `value` summed by `by`, one horizontal bar each; `signed` draws gains green and losses red.
   *  `stack` (unsigned only) splits each bar by a text field, its 5 largest coloured, the rest Other. */
  z.object({
    ...cardBase,
    kind: z.literal('allocation'),
    style: z.literal('bar_list'),
    by: fieldKey,
    value: fieldKey,
    signed: z.boolean().default(false),
    stack: fieldKey.optional(),
    desc: z.boolean().default(true),
    n: z.int().min(1).max(30).default(10),
  }),
]);
const chartCard = z.discriminatedUnion('style', [
  /**
   * One symbol's price chart (LumenChart): the chart dialog's chart in a card,
   * over `window` (1D live where the app has a feed), as a line or candles. Not narrowed by rows.
   */
  z.object({
    ...cardBase,
    kind: z.literal('chart'),
    style: z.literal('price'),
    symbol: z.string().regex(MARKET_KEY_RE),
    window: z.enum(marketWindows).default('6M'),
    type: z.enum(['line', 'candles']).default('line'),
  }),
  /**
   * Growth of $1: one line per shown row that has a curve, from the domain's
   * own `growth` (an app's variants), with its benchmarks and markers. Offered only where the
   * domain has one.
   */
  z.object({
    ...cardBase,
    kind: z.literal('chart'),
    style: z.literal('growth'),
    scale: z.enum(['log', 'linear']).default('log'),
  }),
  /**
   * Today's 1m bars of market symbols, live while the session trades (an app in the suite; the
   * widget hides where the app has no market feed). `layout` `lines`: one % chart from the prior
   * close; `tiles`: one small chart each with a sparkline; `today`: one row each, up or down today
   *. Each draws the trades since the close while the session is shut. Not
   * narrowed by the view's rows.
   */
  z.object({
    ...cardBase,
    kind: z.literal('chart'),
    style: z.literal('market'),
    symbols: z.array(z.string().regex(MARKET_KEY_RE)).min(1).max(12),
    layout: z.enum(['lines', 'tiles', 'today']).default('tiles'),
  }),
  /**
   * A trend (every Tremor chart): up to 4 number fields (`values`) over a date
   * field (`date`) of the rows, rolled up per `bucket` by `agg`, drawn as a line, area, stacked
   * area, bars over time or combo (the first as bars, the rest as lines).
   */
  z.object({
    ...cardBase,
    kind: z.literal('chart'),
    style: z.enum(chartTrendStyles),
    ...trendFields,
  }),
]);
const cardUnion = z.discriminatedUnion('kind', [
  tableCard,
  metricCard,
  allocationCard,
  chartCard,
  /**
   * A card the page draws itself (a playbook's Allocations and Trades): the
   * layout keeps only its place and width; its id names the page's card. A page adds the cards it
   * has but the layout lacks, and skips the ones it no longer draws.
   */
  z.object({
    ...cardBase,
    kind: z.literal('page'),
    /** The dollars its money starts from at the window's start (a playbook's Trades); left out, $10,000. */
    amount: z.number().positive().max(1e12).optional(),
  }),
]);
/** A kind's style when a card leaves it out: its first (a chart always names its own). */
const DEFAULT_STYLE: Partial<Record<string, string>> = {
  table: 'table',
  metric: 'number',
  allocation: 'bar',
};
/** Layouts saved before the grid kept `width` (third, half, two thirds, full): read as columns. */
const LEGACY_WIDTH: Record<string, number> = { third: 2, half: 3, two_thirds: 4, full: 6 };
export const viewCardSchema = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  let card = v as Record<string, unknown>;
  if ('width' in card) {
    const { width, ...rest } = card;
    card = 'w' in rest ? rest : { ...rest, w: LEGACY_WIDTH[String(width)] ?? GRID_COLS };
  }
  const style = DEFAULT_STYLE[String(card.kind)];
  return card.style === undefined && style ? { ...card, style } : card;
}, cardUnion);
export type ViewCard = z.infer<typeof viewCardSchema>;
/** A card that is a widget, not a page's own card. */
export type ViewWidget = Exclude<ViewCard, { kind: 'page' }>;
/** Any card's style, a page's own card none. */
export type ViewCardStyle = ViewWidget['style'];
/** A table card that draws the rows (not Top N). */
export type ViewTableCard = Extract<ViewCard, { kind: 'table'; style: 'table' }>;
/** A row of numbers (a Summary). */
export type ViewRowCard = Extract<ViewCard, { kind: 'metric'; style: 'row' }>;
/** Whether a card is a table of the rows. */
export const isTableCard = (c: { kind: string; style?: string }): c is ViewTableCard =>
  c.kind === 'table' && c.style === 'table';
/** Whether a card is a row of numbers (a Summary). */
export const isRowCard = (c: { kind: string; style?: string }): c is ViewRowCard =>
  c.kind === 'metric' && c.style === 'row';
/**
 * The Widget picker's styles, grouped by kind. Together they cover every
 * Tremor visualization (Area, Bar, Combo, Bar List, Category Bar, Donut, Line, Progress Bar,
 * Progress Circle, Spark, Tracker), drawn on Lumen components. `id` is `<kind>:<style>`; `about`
 * is what `custom_view_widget_list` tells an agent.
 */
export const WIDGET_STYLES: {
  id: string;
  kind: ViewCardKind;
  style: string;
  name: string;
  note: string;
  about: string;
}[] = [
  {
    id: 'table:table',
    kind: 'table',
    style: 'table',
    name: 'Table',
    note: 'The rows, with columns, grouping and sort',
    about:
      "A table of the rows: the view's own columns, grouping and sort (Edit widget changes them), or its own `table` layout (shape, columns, chips, formats, aggs, group, subgroup, pivot, sort, pagination, width) when a page holds more than one.",
  },
  {
    id: 'table:top_n',
    kind: 'table',
    style: 'top_n',
    name: 'Top N',
    note: 'The first rows by a field',
    about: 'A small table: the first n rows sorted by sort (desc), showing columns.',
  },
  {
    id: 'metric:number',
    kind: 'metric',
    style: 'number',
    name: 'Number',
    note: 'One number and up to 4 lines',
    about:
      "One number (tile): a main number, a field or formula rolled up over the view's rows narrowed by its own filter, and up to 4 lines; a column wide by default.",
  },
  {
    id: 'metric:row',
    kind: 'metric',
    style: 'row',
    name: 'Row of numbers',
    note: 'Several numbers side by side',
    about:
      "Numbers of one main value and secondary lines over the view's rows, side by side: its own `tiles`, else the view's.",
  },
  {
    id: 'metric:progress_bar',
    kind: 'metric',
    style: 'progress_bar',
    name: 'Progress bar',
    note: 'A number against a target',
    about: 'A number (tile) against target (its 100%), drawn as a bar.',
  },
  {
    id: 'metric:progress_circle',
    kind: 'metric',
    style: 'progress_circle',
    name: 'Progress circle',
    note: 'A number against a target, as a ring',
    about: 'A number (tile) against target (its 100%), drawn as a ring.',
  },
  {
    id: 'metric:spark',
    kind: 'metric',
    style: 'spark',
    name: 'Number + spark',
    note: 'The latest value and its small line',
    about:
      'Number fields (values) over a date field (date), rolled up (agg) per bucket: the latest value with a small line.',
  },
  {
    id: 'metric:tracker',
    kind: 'metric',
    style: 'tracker',
    name: 'Tracker',
    note: 'One block per day, green up and red down',
    about:
      'A number field (values) over a date field (date): one block per bucket, green up and red down.',
  },
  {
    id: 'allocation:bar',
    kind: 'allocation',
    style: 'bar',
    name: 'Category bar',
    note: 'Shares of a total in one bar',
    about:
      'One stacked bar: the share of a number field (value) by a text field (by); the largest max (2-50, default 10) show on their own, the rest fold into Other.',
  },
  {
    id: 'allocation:donut',
    kind: 'allocation',
    style: 'donut',
    name: 'Donut',
    note: 'Shares of a total as a ring',
    about: 'The share of value by by, as a donut; max slices (2-12, default 6), rest Other.',
  },
  {
    id: 'allocation:bar_list',
    kind: 'allocation',
    style: 'bar_list',
    name: 'Bar list',
    note: 'A number by group, gains green and losses red',
    about:
      'value summed by by, one bar each, largest first (desc false: smallest); n bars; signed draws gains green and losses red; stack (a text field, unsigned only) splits each bar by it, its 5 largest coloured, the rest Other.',
  },
  {
    id: 'chart:line',
    kind: 'chart',
    style: 'line',
    name: 'Line',
    note: 'Numbers over a date',
    about:
      'Up to 4 number fields (values) over a date field (date) of the rows, rolled up (agg sum, mean, last or count) per bucket (day, week, month, year), as lines.',
  },
  {
    id: 'chart:area',
    kind: 'chart',
    style: 'area',
    name: 'Area',
    note: 'Numbers over a date, filled',
    about: 'As line, filled.',
  },
  {
    id: 'chart:stacked',
    kind: 'chart',
    style: 'stacked',
    name: 'Stacked area',
    note: 'Parts adding up over a date',
    about: 'As line, as stacked areas.',
  },
  {
    id: 'chart:bars',
    kind: 'chart',
    style: 'bars',
    name: 'Bars over time',
    note: 'One bar per day, week or month',
    about: 'As line, one bar per bucket.',
  },
  {
    id: 'chart:combo',
    kind: 'chart',
    style: 'combo',
    name: 'Combo',
    note: 'Bars for the first number, lines for the rest',
    about: 'As line: the first value as bars, the rest as lines.',
  },
  {
    id: 'chart:price',
    kind: 'chart',
    style: 'price',
    name: 'Price chart',
    note: "One symbol's chart over a window",
    about:
      'One symbol (a ticker, an index like SPX, or a breadth or macro key) as a line or candles (type) over window 1D, 5D, 1M, 6M (default), YTD, 1Y, 5Y or Max. The card is the full chart: windows, zoom, indicators and Compare start from these.',
  },
  {
    id: 'chart:growth',
    kind: 'chart',
    style: 'growth',
    name: 'Growth of $1',
    note: 'One line per row over the window',
    about:
      "Growth of $1, one line per shown row that has a curve (a variant's tape), with the domain's benchmarks and markers (an OOS line); scale log (default) or linear. Only on domains that draw curves.",
  },
  {
    id: 'chart:market',
    kind: 'chart',
    style: 'market',
    name: 'Market',
    note: 'Live 1m bars of indexes and indicators',
    about:
      "Today's 1m bars of symbols (SPX, NDX, DJI, RUT, VIX, 10Y, DXY, GOLD, WTI, HYG, BTC or any ticker), live in market hours, then pre-market, after hours and overnight (an index through its ETF); layout lines (one % chart), tiles (a small chart each) or today (a row each, up or down today). Click opens the chart.",
  },
];
/** A widget's style id in `WIDGET_STYLES`. */
export const widgetStyleId = (card: { kind: string; style?: string }) =>
  `${card.kind}:${card.style ?? DEFAULT_STYLE[card.kind] ?? ''}`;
/** A widget's style in `WIDGET_STYLES`, if it is one. */
export const widgetStyleOf = (card: { kind: string; style?: string }) =>
  WIDGET_STYLES.find((w) => w.id === widgetStyleId(card));
/** Whether a card shows one of its controls: its own choice, else its kind's default. */
export function controlOn(
  card: { kind: string; style?: string; controls?: Partial<Record<WidgetControl, boolean>> },
  control: WidgetControl,
): boolean {
  const kind = (viewCardKinds as readonly string[]).includes(card.kind)
    ? (card.kind as ViewCardKind)
    : null;
  const fallback = kind ? CONTROL_DEFAULTS[kind][control] : undefined;
  if (fallback === undefined) return kind === null;
  return card.controls?.[control] ?? fallback;
}
/** A page's cards, in order, ids unique. */
export const viewCardsSchema = z
  .array(viewCardSchema)
  .max(MAX_CARDS)
  .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, 'a card id is used twice');
/** The cards a view without `cards` shows: its row of numbers, then its table. */
export const defaultViewCards: ViewCard[] = [
  { id: 'tiles', kind: 'metric', style: 'row', title: null, w: 6, filter: [] },
  { id: 'view', kind: 'table', style: 'table', title: null, w: 6, filter: [] },
];
export const cardsOf = (c: { cards?: ViewCard[] }) => c.cards ?? defaultViewCards;
/** The table that draws the view's own layout: the first table card without its own `table`. */
export const mainTableOf = (cards: ViewCard[]) =>
  cards.find((c): c is ViewTableCard => isTableCard(c) && !c.table && !c.source);
/** A row card's numbers: its own, else the view's. */
export const tilesOfCard = (c: { tiles?: ViewTile[] }, card: ViewRowCard): ViewTile[] =>
  card.tiles ?? c.tiles ?? [];
/** Every number on the page: the view's, each row's own and each single number. */
export const allTilesOf = (c: { tiles?: ViewTile[]; cards?: ViewCard[] }): ViewTile[] => [
  ...(c.tiles ?? []),
  ...cardsOf(c).flatMap((x) =>
    isRowCard(x) && x.tiles ? x.tiles : x.kind === 'metric' && 'tile' in x ? [x.tile] : [],
  ),
];
/** The field keys a Summary card reads: its main field, filters and lines (a domain card: its key). */
export const tileFieldKeys = (t: ViewTile): string[] =>
  isOwnTile(t)
    ? [
        t.field,
        ...t.filter.map((x) => x.key),
        ...t.lines.flatMap((l) =>
          l.kind === 'value'
            ? [l.field, ...l.filter.map((x) => x.key)]
            : l.kind === 'pct'
              ? [l.field]
              : [],
        ),
      ]
    : [t.key];
/**
 * A card saved before kinds folded into four ("Fold now"): its kind and style
 * now. Only stored configs (custom views, workspace tabs) pass through it, once, on read; nothing
 * else accepts an old kind.
 */
function foldCard(card: unknown): unknown {
  if (!card || typeof card !== 'object') return card;
  const c = card as Record<string, unknown>;
  const to = (kind: string, style: string, extra: Record<string, unknown> = {}) => ({
    ...c,
    ...extra,
    kind,
    style,
  });
  switch (c.kind) {
    case 'view':
      return to('table', 'table');
    case 'top_n':
      return to('table', 'top_n');
    case 'card':
      return to('metric', typeof c.style === 'string' ? c.style : 'number');
    case 'tiles':
      return to('metric', 'row');
    case 'allocation':
      return c.style === undefined ? to('allocation', 'bar') : c;
    case 'donut':
      return to('allocation', 'donut');
    case 'bars':
      return to('allocation', 'bar_list');
    case 'market': {
      const { style, ...rest } = c;
      return { ...rest, kind: 'chart', style: 'market', ...(style ? { layout: style } : {}) };
    }
    case 'chart':
      return c.style === undefined ? to('chart', 'price') : c;
    case 'growth':
      return to('chart', 'growth');
    case 'trend': {
      const style = typeof c.style === 'string' ? c.style : 'line';
      return to(style === 'spark' || style === 'tracker' ? 'metric' : 'chart', style);
    }
    default:
      return c;
  }
}
/** A pre-built widget as written, before `viewCardSchema` fills its defaults. */
export type ViewWidgetDraft = z.input<typeof cardUnion>;
/** One pre-built widget of a domain: its name, a line on what it shows, and its config. */
export interface ViewWidgetPreset {
  name: string;
  note: string;
  widget: ViewWidget;
}
/**
 * Pre-built widgets per domain: named, ready configs of a kind. Adding one
 * copies its config into the view under the preset's id, so it can then be edited like any other.
 * Empty until the app registers its own (`registerDomains`).
 */
export const viewWidgetCatalog: Record<string, ViewWidgetPreset[]> = {};
/** Presets from `[name, note, draft]` triples, each draft filled in by the card schema. */
export const widgetPresets = (items: [string, string, ViewWidgetDraft][]): ViewWidgetPreset[] =>
  items.map(([name, note, b]) => ({
    name,
    note,
    widget: viewCardSchema.parse({ title: name, ...b }) as ViewWidget,
  }));

/** A connected field's key on the card: `holdings_quantity`; `holdings_count` counts the rows. */
export const connectedKey = (to: string, field: string) => `${linkSpace(to)}_${field}`;
/** A link's name in field keys: the domain id, or `r` and the end of a recipe's frame id. */
export const linkSpace = (to: string) =>
  to.startsWith('frame:') ? `r${to.slice(-8).replace(/[^A-Za-z0-9]/g, '')}` : to;
export const CONNECTED_COUNT = 'count';
/** The key pairs two domains share, inferred from the keys their rows carry (symbol first). */
export function inferConnection(
  fromKeys: readonly string[],
  toKeys: readonly string[],
): ViewConnection['on'] | null {
  const k = fromKeys.find((x) => toKeys.includes(x));
  return k ? [{ from: k, to: k }] : null;
}
/** The column keys a view's connections add, from each connected domain's catalog. */
export function connectionColumns(
  connections: ViewConnection[] | undefined,
  /** What a config or patch names: a link with no fixed field list (a recipe, or a domain the
   *  view catalog does not list) takes any `<link>_<field>` named in it, since its fields are its
   *  rows'. */
  seen?: unknown,
): string[] {
  const text = seen === undefined ? '' : JSON.stringify(seen);
  return (connections ?? []).flatMap((c) => {
    const fixed = customViewFields[c.to]?.columns;
    const space = linkSpace(c.to);
    const named = fixed
      ? []
      : [...text.matchAll(new RegExp(`\\b${space}_[A-Za-z0-9_]+`, 'g'))].map((m) => m[0]);
    return [
      connectedKey(c.to, CONNECTED_COUNT),
      ...(fixed ?? []).map((k) => connectedKey(c.to, k)),
      ...named,
    ];
  });
}

export const customViewConfigSchema = z.object({
  shape: z.enum(viewShapes).default('table'),
  /** The view's own formula columns, in order. */
  formulas: z.array(viewFormulaSchema).max(MAX_FIELDS).default([]),
  /** Shown field keys, in order, each once; empty means every field. A key twice would draw two
   *  columns under one React key, and a re-render can then drop a cell and shift the row. */
  columns: z.array(fieldKey).max(60).default([]).transform(uniqueKeys),
  /**
   * Fields listed in the editor's Columns but not shown, kept for their Filter and Group ticks
   * (a column only for grouping or filtering).
   */
  hidden: z.array(fieldKey).max(60).optional(),
  /** Text fields shown as chips (a kind, an account, a label), each in its own column or inline. */
  chips: z.array(viewChipSchema).max(MAX_FIELDS).default([]),
  /**
   * A number column's format picked in Edit view, over the field's own: any
   * view's column reads as currency, a signed % in gain/loss colour, and so on.
   */
  formats: z.record(fieldKey, z.enum(viewNumberFormats)).optional(),
  /**
   * A number column's group and Total rows picked in Edit view: a roll-up
   * over the field's own, or `none` for blank. A formula keeps its own `agg`. Left out: the field's.
   */
  aggs: z.record(fieldKey, z.enum(viewTotalAggs)).optional(),
  /** The sidebar icon, a lucide name or an emoji; null = the shape's icon. */
  icon: viewIconSchema.nullable().default(null),
  /** The summary tiles, in order: the domain's (`{key}`) and the view's own. */
  tiles: z.array(viewTileSchema).max(24).default([]),
  /** The groupable fields the switcher offers (empty: every groupable field), and the default. */
  group: z
    .object({
      fields: z.array(fieldKey).max(MAX_FIELDS).default([]),
      default: fieldKey.nullable().default(null),
    })
    .prefault({}),
  /** What each row opens under it: one of the domain's sub-groups by key,
   *  null for none (no chevrons); left out, the domain's first. */
  subgroup: fieldKey.nullable().optional(),
  /** Filterable fields (empty: every filterable field) and the tokens applied on open. */
  filters: z
    .object({
      fields: z.array(fieldKey).max(MAX_FIELDS).default([]),
      default: z
        .array(
          z
            .object({
              key: fieldKey,
              value: z.string().trim().min(1).max(40),
              not: z.boolean().optional(),
              op: z.enum(viewTokenOps).optional(),
              /** Linked: the chip also narrows every card of the view card's colour. */
              link: tokenLink,
            })
            .refine(numberToken, 'a number condition needs a number, or a..b for between'),
        )
        .max(MAX_FIELDS)
        .default([]),
    })
    .prefault({}),
  pivot: z
    .object({ rows: fieldKey, columns: fieldKey, value: fieldKey, agg: z.enum(viewAggs) })
    .nullable()
    .default(null),
  /** The column the table opens sorted by (mock 2b); null keeps the rows' order. */
  sort: z
    .object({ key: fieldKey, desc: z.boolean().default(false) })
    .nullable()
    .default(null),
  /** Flat tables page their rows; grouped tables and pivots show every row. */
  pagination: viewPaginationSchema,
  /**
   * How a wide table fits: `fit` wraps text columns so the table fits the
   * width there is (Feed), `scroll` keeps each row on one line and scrolls sideways (Holdings).
   * Views saved without it scroll.
   */
  width: z.enum(viewTableWidths).optional(),
  /**
   * Linked assistant frames attached to this view, by id (views-domains design
   * step 2b): each is extra columns joined to the rows by its key (symbol, account) on every
   * render, so they survive reloads, filters and layout edits. A frame enriches one view only.
   */
  frames: z
    .array(z.string().regex(/^fr_[a-f0-9]{16}$/))
    .max(10)
    .optional(),
  /**
   * Connections: other
   * domains' rows attached to this view's rows on key pairs (earnings ▸ holdings by symbol). Each
   * connected domain's fields join the catalog as `<to>_<field>` (and `<to>_count`, the rows that
   * match), rolled up over the matching rows, so they can be columns, filters and formula inputs.
   */
  connections: z.array(viewConnectionSchema).max(4).optional(),
  /**
   * The table's Total row: false leaves it out where adding every row means
   * nothing, as in Holdings history, whose rows repeat the same holdings day after day. Group rows
   * still roll up. Left out: shown.
   */
  total: z.boolean().optional(),
  /** The page's cards in order; left out: the tiles, then the view. */
  cards: viewCardsSchema.optional(),
});
/** A saved view as LumenView reads it: its name plus the config. */
export type CustomViewConfig = { name: string } & Omit<
  z.infer<typeof customViewConfigSchema>,
  'pagination'
> & {
    /** Views saved before pagination carry none and read the defaults. */
    pagination?: ViewPagination;
  };
/** The parts of a view config that shape one table (a second table on the page starts from these). */
export function tableLayoutOf(c: CustomViewConfig): ViewTableLayout {
  return viewTableLayoutSchema.parse({
    shape: c.shape,
    columns: c.columns,
    hidden: c.hidden,
    chips: c.chips,
    formats: c.formats,
    aggs: c.aggs,
    group: c.group,
    subgroup: c.subgroup,
    pivot: c.pivot,
    sort: c.sort,
    pagination: c.pagination,
    width: c.width,
  });
}
/**
 * The config one table card draws (several tables on a layout): the view's,
 * with the card's own `table` layout over it, its own chips starting empty, and the card as the
 * page's one table, so the view editor edits it like the main one.
 */
export function tableConfigOf(c: CustomViewConfig, card: ViewTableCard): CustomViewConfig {
  if (!card.table) return c;
  const { table, ...rest } = card;
  return {
    ...c,
    ...table,
    name: card.title ?? c.name,
    filters: { ...c.filters, default: [] },
    cards: [rest],
  };
}

/**
 * The config a widget with its own `source` draws: its own table layout and links over a fresh
 * config, nothing of the page's (formulas, links, recipes) carried in.
 */
export function sourceConfigOf(card: ViewWidget, name: string): CustomViewConfig {
  const base: CustomViewConfig = {
    ...customViewConfigSchema.parse({ connections: card.connections ?? [] }),
    name: card.title ?? name,
  };
  return isTableCard(card)
    ? tableConfigOf(base, { ...card, table: card.table ?? tableLayoutOf(base) })
    : base;
}

/** A custom view's domain: lowercase, like `holdings` or `explorer`. */
export const customViewDomainSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, 'domain: lowercase letters, digits and _');
/** The app a saved view belongs to, as the app names it (`trade`). */
export type CustomViewDesk = string;
/** One stored custom view; `owner` null means everyone on the app shares it. */
export interface CustomView<C = z.infer<typeof customViewConfigSchema>> {
  id: string;
  /** An app view: a built-in page defined in code. Each person may change it (their own copy,
   *  `customized`) and reset it to this default; nobody can delete it. */
  app?: boolean;
  /** An app view the reader has changed: their own copy is what they see until Reset to default. */
  customized?: boolean;
  desk: CustomViewDesk;
  domain: string;
  owner: string | null;
  name: string;
  config: C;
  created_at: string;
  updated_at: string;
}

/** A pre-built widget of `domain` by its id, as the catalog has it. */
export function preset(domain: string, id: string): ViewWidget {
  const w = viewWidgetCatalog[domain]?.find((x) => x.widget.id === id)?.widget;
  if (!w) throw new Error(`no pre-built widget ${domain}/${id}`);
  return w;
}

/** A domain's field keys, for agents writing views and for the view editor's lists. */
export interface DomainFieldSet {
  columns: string[];
  group: string[];
  filter: string[];
  tiles?: string[];
  /** What a row can open under it ("Each row opens", the view's `subgroup`), first the default. */
  subgroups?: { key: string; about: string }[];
}

/** The domains' own fields (the rest of their `customViewFields.columns` are join fields). */
export const DOMAIN_OWN: Record<string, string[]> = {};

/**
 * Each domain's field keys: its own fields as the app's page defines them, then the join fields its
 * keys give it from the registry (`DOMAIN_KEYS`, `JOINS` in ./domains). Empty until registered.
 */
export const customViewFields: Record<string, DomainFieldSet> = {};

/** The join fields `domain`'s keys bring, less its own: every key, the groupable, the filterable. */
export const joinedKeys = (domain: string, own: string[]) =>
  joinKeys(DOMAIN_KEYS[domain] ?? [], own);
export const joinedGroups = (domain: string, own: string[]) =>
  joinFields(DOMAIN_KEYS[domain] ?? [], own)
    .filter((f) => f.category)
    .map((f) => f.key);
export const joinedFilters = (domain: string, own: string[]) =>
  joinFields(DOMAIN_KEYS[domain] ?? [], own)
    .filter((f) => f.category || f.format !== 'text')
    .map((f) => f.key);

/** A frame a card reads, for formula names: its name and column keys. */
export interface NamedFrame {
  name: string;
  columns: string[];
}

/**
 * Every name a card's formulas can read, to the row's field key: its own
 * fields as `<domain>.<key>` (a frame card's as `frame.<frame>.<key>`), the join fields its keys
 * bring as `<join>.<key>` (`symbol.price`), each linked domain's as `<domain>.<field>`
 * (`tax_lots.count`), each attached frame's as `frame.<frame>.<column>`, and its formulas bare.
 */
export function formulaNamesOf(p: {
  domain: string;
  /** The own field keys; left out, the registry's. */
  own?: string[];
  /** The keys the rows carry; left out, the registry's. */
  keys?: readonly JoinKey[];
  /** A frame card's frame name (its domain is `frame`). */
  frame?: string;
  frames?: NamedFrame[];
  connections?: ViewConnection[];
  formulas?: string[];
}): FormulaNames {
  const names: FormulaNames = new Map();
  const own = p.own ?? DOMAIN_OWN[p.domain] ?? customViewFields[p.domain]?.columns ?? [];
  const space = p.domain === 'frame' ? frameSpace(p.frame ?? 'frame') : p.domain;
  for (const k of own) names.set(`${space}.${k}`, k);
  const taken = new Set(own);
  for (const j of p.keys ?? DOMAIN_KEYS[p.domain] ?? [])
    for (const f of JOINS[j].fields)
      if (!taken.has(f.key)) {
        taken.add(f.key);
        names.set(`${j}.${f.key}`, f.key);
      }
  for (const c of p.connections ?? [])
    for (const k of [CONNECTED_COUNT, ...(customViewFields[c.to]?.columns ?? [])])
      names.set(`${c.to}.${k}`, connectedKey(c.to, k));
  for (const f of p.frames ?? [])
    for (const k of f.columns) names.set(`${frameSpace(f.name)}.${k}`, k);
  for (const k of p.formulas ?? []) names.set(k, k);
  return names;
}

/**
 * The formula issues of a card ("formulas.0: ..."): a key a field has or used twice, a name it
 * does not have (`names` null: any), a formula in a loop.
 */
export function formulaListIssues(
  formulas: { key: string; expr: string }[],
  names: FormulaNames | null,
  fieldKeys: string[] | null,
): string[] {
  const loops = formulaLoops(formulas);
  const known = names && [...names.keys()];
  return formulas.flatMap((f, i) => {
    if (fieldKeys?.includes(f.key)) return [`formulas.${i}: key ${f.key} is a field`];
    if (formulas.slice(0, i).some((x) => x.key === f.key))
      return [`formulas.${i}: key ${f.key} is used twice`];
    const issue = checkViewFormula(f.expr, known);
    if (issue) return [`formulas.${i}: ${issue}`];
    return loops.has(f.key) ? [`formulas.${i}: ${f.key} loops back to itself`] : [];
  });
}

/**
 * What is wrong with a view's formulas and tiles on `domain` ("formulas.0: ...", "tiles.0: ...");
 * empty when nothing.
 */
export function customViewIssues(
  domain: string,
  config: {
    formulas: { key: string; expr: string }[];
    tiles?: ViewTile[];
    cards?: ViewCard[];
    connections?: ViewConnection[];
  },
  /** The view's attached linked frames: formulas may read their columns. */
  frames: NamedFrame[] = [],
): string[] {
  const own = customViewFields[domain];
  const extra = frames.flatMap((f) => f.columns);
  const fields = own
    ? [...own.columns, ...extra, ...connectionColumns(config.connections, config)]
    : null;
  const { formulas } = config;
  const issues = formulaListIssues(
    formulas,
    own
      ? formulaNamesOf({
          domain,
          frames,
          connections: config.connections,
          formulas: formulas.map((f) => f.key),
        })
      : null,
    fields,
  );
  const columns = fields && [...fields, ...formulas.map((f) => f.key)];
  const tileListIssues = (tiles: ViewTile[], at: string) =>
    tiles.flatMap((t, i) => {
      if (tiles.slice(0, i).some((x) => x.key === t.key))
        return [`${at}.${i}: key ${t.key} is used twice`];
      if (!isOwnTile(t))
        return own?.tiles && !own.tiles.includes(t.key)
          ? [`${at}.${i}: ${t.key} is not a tile of ${domain}`]
          : [];
      if (own?.tiles?.includes(t.key)) return [`${at}.${i}: key ${t.key} is a tile of ${domain}`];
      const unknown = columns ? tileFieldKeys(t).filter((k) => !columns.includes(k)) : [];
      return unknown.length ? [`${at}.${i}: unknown field ${unknown[0]}`] : [];
    });
  return [
    ...issues,
    ...tileListIssues(config.tiles ?? [], 'tiles'),
    ...(config.cards ?? []).flatMap((c, i) =>
      isRowCard(c) && c.tiles ? tileListIssues(c.tiles, `cards.${i}.tiles`) : [],
    ),
    ...(config.cards ?? []).flatMap((c, i) => {
      // A widget with its own data is checked against that data's fields, not the page's; a
      // recipe or a domain the view catalog does not list has its rows' fields, known on read.
      const cols = c.source
        ? customViewFields[c.source]?.columns && [
            ...(customViewFields[c.source]?.columns ?? []),
            ...connectionColumns(c.connections, c),
            ...formulas.map((f) => f.key),
          ]
        : columns;
      return cols ? cardIssues([c], cols).map((x) => x.replace(/^cards\.0:/, `cards.${i}:`)) : [];
    }),
  ];
}

/**
 * What is wrong with a view's grouping on `domain`, for agents (custom_view_write): a group field
 * the domain cannot group by, or a sub-group its rows do not have, used to save and quietly show
 * nothing. Empty when nothing.
 */
export function customViewGroupIssues(
  domain: string,
  config: {
    formulas: { key: string }[];
    group: { fields: string[]; default: string | null };
    subgroup?: string | null;
  },
): string[] {
  const own = customViewFields[domain];
  if (!own) return [];
  const { formulas } = config;
  // Grouping by a field the domain cannot group by, or a sub-group it does not have, used to save
  // and quietly show nothing.
  const groupable = [...own.group, ...formulas.map((f) => f.key)];
  const groupIssues = [
    ...(config.group?.fields ?? [])
      .filter((k) => !groupable.includes(k))
      .map(
        (k) => `group.fields: ${domain} cannot group by ${k}; it groups by ${own.group.join(', ')}`,
      ),
    ...(config.group?.default && !groupable.includes(config.group.default)
      ? [`group.default: ${domain} cannot group by ${config.group.default}`]
      : []),
  ];
  const subgroups = own?.subgroups?.map((s) => s.key) ?? [];
  const subgroupIssues =
    config.subgroup && !subgroups.includes(config.subgroup)
      ? [
          subgroups.length
            ? `subgroup: ${domain} rows open ${subgroups.join(', ')}, not ${config.subgroup}`
            : `subgroup: ${domain} rows open nothing; leave subgroup out`,
        ]
      : [];
  return [...groupIssues, ...subgroupIssues];
}

/** Widget fields that are not the domain's fields or the view's formulas ("cards.2: unknown field x"). */
export function cardIssues(cards: ViewCard[], columns: string[]): string[] {
  return cards.flatMap((c, i) => {
    const keys = [
      ...c.filter.map((t) => t.key),
      ...('by' in c ? [c.by, c.value] : []),
      ...(c.kind === 'table' && c.style === 'top_n' ? [c.sort, ...c.columns] : []),
      ...(c.kind === 'table' && c.style === 'table' && c.table
        ? [...c.table.columns, ...(c.table.sort ? [c.table.sort.key] : [])]
        : []),
      ...('date' in c ? [c.date, ...c.values] : []),
    ];
    return [...new Set(keys.filter((k) => !columns.includes(k)))].map(
      (k) => `cards.${i}: unknown field ${k}`,
    );
  });
}

/**
 * A stored view's config in today's shape: views saved
 * before carried `blocks` (the table block, later the `view` card) and the domain's tile keys in
 * `widgets` ahead of their own `tiles`, and cards saved before kinds folded into four carried the old kinds (`foldCard`). Returns the config as is when it is already
 * current. The store rewrites each old row the first time it reads it.
 */
/**
 * Field keys a domain renamed, `{domain: {old: new}}`: saved configs are rewritten once on read
 * (`upgradeViewConfig`). An app registers its own.
 */
export const FIELDS_MOVED: Record<string, Record<string, string>> = {};
/** Text a rename never touches: names and ids, not field keys. */
const NOT_KEYS = new Set(['id', 'name', 'label', 'title', 'icon']);

/** `value` with each field key in `moved` renamed: exact strings, and words in formula `expr`s. */
function renameKeys(value: unknown, moved: Record<string, string>, under = ''): unknown {
  if (typeof value === 'string')
    return under === 'expr'
      ? renameFormula(value, (w) => {
          // A name's field part (`holdings.delta`) moves as a bare key does.
          const at = w.lastIndexOf('.');
          const k = w.slice(at + 1);
          return moved[k] ? w.slice(0, at + 1) + moved[k] : w;
        })
      : NOT_KEYS.has(under)
        ? value
        : (moved[value] ?? value);
  if (Array.isArray(value)) return value.map((v) => renameKeys(v, moved, under));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [moved[k] ?? k, renameKeys(v, moved, k)]),
    );
  return value;
}

/** What a config's formulas are named against when moved to names: frames, or a frame card's own. */
export interface NamingContext {
  /** Every frame the person has; a config's bare frame column is named by the one that has it. */
  frames?: NamedFrame[];
  /** A frame card's frame, with its own column keys and the keys its rows carry. */
  frame?: NamedFrame & { keys: JoinKey[] };
}

const FUNCTION_WORDS = new Set(['true', 'false', 'null', 'in']);

/** Whether a config has a formula reading a bare word that is none of its formulas (before names). */
export function hasBareNames(config: unknown): boolean {
  const formulas = (config as { formulas?: unknown })?.formulas;
  if (!Array.isArray(formulas)) return false;
  const keys = new Set(formulas.map((f) => (f as { key?: string }).key));
  return formulas.some((f) => {
    let bare = false;
    renameFormula(String((f as { expr?: unknown }).expr ?? ''), (t) => {
      if (!t.includes('.') && !keys.has(t) && !FUNCTION_WORDS.has(t)) bare = true;
      return t;
    });
    return bare;
  });
}

/**
 * A config's formulas moved to names: each bare field key a formula reads
 * becomes its name (`price` is `holdings.price`, a frame column `frame.<frame>.<column>`); a word
 * nothing has stays, and the check offers its fix.
 */
function nameFormulas<C>(config: C, domain: string | undefined, ctx: NamingContext): C {
  const c = config as {
    formulas?: { key: string; expr: string }[];
    connections?: ViewConnection[];
  };
  if (!domain || !Array.isArray(c.formulas) || !hasBareNames(config)) return config;
  if (domain === 'frame' && !ctx.frame) return config;
  const keys = new Set(c.formulas.map((f) => f.key));
  const names = formulaNamesOf({
    domain,
    ...(ctx.frame ? { own: ctx.frame.columns, keys: ctx.frame.keys, frame: ctx.frame.name } : {}),
    connections: c.connections,
    frames: ctx.frames,
  });
  const byKey = new Map<string, string>();
  for (const [n, k] of names) if (!byKey.has(k)) byKey.set(k, n);
  // A domain the registry does not list has only its own fields.
  const space = domain !== 'frame' && !customViewFields[domain] ? domain : null;
  const formulas = c.formulas.map((f) => ({
    ...f,
    expr: renameFormula(f.expr, (t) =>
      t.includes('.') || keys.has(t) || FUNCTION_WORDS.has(t)
        ? t
        : (byKey.get(t) ?? (space ? `${space}.${t}` : t)),
    ),
  }));
  return formulas.some((f, i) => f.expr !== c.formulas?.[i]?.expr)
    ? { ...config, formulas }
    : config;
}

export function upgradeViewConfig<C>(config: C, domain?: string, ctx: NamingContext = {}): C {
  if (!config || typeof config !== 'object') return config;
  const moved = domain ? FIELDS_MOVED[domain] : undefined;
  if (moved) {
    const renamed = renameKeys(config, moved) as C;
    if (JSON.stringify(renamed) !== JSON.stringify(config))
      return upgradeViewConfig(renamed, domain, ctx);
  }
  return foldConfig(nameFormulas(config, domain, ctx));
}

/** Blocks, widgets and old card kinds in today's shape. */
function foldConfig<C>(config: C): C {
  const old = config as Record<string, unknown>;
  const { blocks, widgets, ...rest } = old;
  const next: Record<string, unknown> = { ...rest };
  if (Array.isArray(widgets))
    next.tiles = [
      ...widgets.map((key) => ({ key })),
      ...(Array.isArray(rest.tiles) ? rest.tiles : []),
    ];
  // Blocks (before 2026-10-13) were cards whose table was kind `table` with id `table`.
  const cards = Array.isArray(blocks)
    ? blocks.map((b) =>
        b && typeof b === 'object' && (b as { kind?: unknown }).kind === 'table'
          ? {
              ...b,
              kind: 'view',
              ...((b as { id?: unknown }).id === 'table' ? { id: 'view' } : {}),
            }
          : b,
      )
    : rest.cards;
  if (Array.isArray(cards)) next.cards = cards.map(foldCard);
  const changed =
    'blocks' in old ||
    'widgets' in old ||
    (Array.isArray(cards) && JSON.stringify(next.cards) !== JSON.stringify(rest.cards));
  return (changed ? next : config) as C;
}
