// The view model every LumenView and its Edit dialog share: a domain's fields, a view's
// formula columns and chips, and the values worked out over the shown rows.
import type { JoinKey } from '@columenlabs/lumen-ui-types/domains';
import {
  CONTAINS_KEY,
  type CustomViewConfig,
  type ViewAgg,
  type ViewChip,
  type ViewFormat,
  type ViewTotalAgg,
  whyBlank,
} from '@columenlabs/lumen-ui-types/views';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import type { ChartBand, ChartMarker, Series } from './growth-chart';
import { formulaFields } from './view-formulas';

export type ViewCellValue = number | string | null;

/** One field of a data domain: how to read it, show it, filter, group and roll it up. */
export interface ViewField<T> {
  key: string;
  label: string;
  icon: LucideIcon;
  value: (row: T) => ViewCellValue;
  /**
   * Its name in formulas when not `<domain>.<key>`: a join field's
   * `symbol.price`, a frame column's `frame.<frame>.<column>`, a linked domain's `tax_lots.count`.
   */
  name?: string;
  /**
   * Where the field comes from: one of the domain's `groups` (Holding, Symbol,
   * Account). The editor's tree and the table's column-group headers follow it; formulas are their
   * own group. Left out: the domain's first group.
   */
  group?: string;
  /** The sub-heading within its group in the editor's tree (Valuation, Analysts, Technicals). */
  topic?: string;
  /** Every value a row has for filtering, when it has several (a symbol in Holdings and Watchlist). */
  values?: (row: T) => string[];
  format: ViewFormat;
  /** How the value is made, shown under the field in the Edit dialog. */
  formula?: string;
  /** A holding amount (dollars or size) that Hide amounts masks. */
  amount?: boolean;
  /** Large numbers in short form, $283.1B or 6.1M (13F funds). */
  compact?: boolean;
  /** What an empty cell says (`N/A` where the source has no value for it); left out: a dash. */
  empty?: string;
  /** A short note beside the field in the Edit dialog, e.g. `per ticker`. */
  note?: string;
  /**
   * Makes the cell editable: a click picks a value in use or takes a new one,
   * saved through `save`; `note` says what an edit covers for that row. `options` lists every
   * value the field has, in use or not, so the picker offers them whatever the filter shows
   *; without it the picker offers the values in the shown rows.
   */
  edit?: {
    /** Saves one value (null clears it). A field with `many` leaves it out. */
    save?: (row: T, value: string | null) => Promise<unknown>;
    /**
     * Several values a row (labels): the cell shows each of `values` as a chip
     * and its picker ticks any number, typed names added, saved together when it closes.
     */
    many?: (row: T, values: string[]) => Promise<unknown>;
    note?: (row: T) => string;
    options?: () => { inUse: string[]; unused: string[] };
    /**
     * Typed in place (Edits in place): the cell is a number or text box, as in
     * a sheet (click or tap and type; Enter saves, Esc leaves, Tab moves right), not a picker.
     */
    input?: 'number' | 'text';
    /** The picker offers only `options`, with no typed new value (an app, an area). */
    fixed?: boolean;
    /** This row's cell was typed by hand: a small ✎ marks it. */
    edited?: (row: T) => boolean;
  };
  /** Offered as `field:value` tokens in the filter box. */
  filterable?: boolean;
  /** Offered in the Group switcher and as pivot rows or columns. */
  groupable?: boolean;
  /** Why a field is not groupable, shown on its greyed Group box in Edit view, e.g. `One per holding. Group by Underlying.` */
  groupNote?: string;
  /** How group, pivot and Total rows roll the field up; no roll-up when left out. */
  aggregate?: ViewAgg;
  /** A formula column with no `aggregate`: group and Total rows run `compute` over the rows' roll-ups of its inputs. */
  rollFormula?: boolean;
  /** Group and Total rows leave it blank (the view picked None for it). */
  noRollup?: boolean;
  /** A value the page works out from the row and the shown rows (a formula column). */
  compute?: (
    row: T,
    scope: {
      value: (key: string) => ViewCellValue;
      groupSum: (key: string) => number;
      totalSum: (key: string) => number;
    },
  ) => ViewCellValue;
  /**
   * A share the page works out, in %: the row's `of` field over its sum in the row's group
   * (`group`; every shown row when not grouped) or in every shown row (`total`). A group row shows
   * its group's share of the total. `value` is unused for it.
   */
  share?: { of: string; within: 'group' | 'total' };
  /** Draws the cell instead of its formatted value (a sparkline); sorting and filters still use
   *  `value` (strategy lab). */
  render?: (row: T) => ReactNode;
  /**
   * Draws a group or Total row's cell from its rows instead of the rolled-up number: an amount with
   * its unit, or a share worked out again as the rows' total over their allowance (never a sum of
   * percents). Only where the field rolls up (`aggregate`).
   */
  rollRender?: (rows: T[]) => ReactNode;
  /**
   * Ways the column can read, picked per column in Edit view ("Show as"), e.g. an amount or its % of
   * an allowance. The first is the field as defined; each other one's `field` replaces those parts
   * of it (value, format, render, aggregate...). The pick saves with the view (`shows`).
   */
  showAs?: { id: string; label: string; field?: Partial<Omit<ViewField<T>, 'key' | 'showAs'>> }[];
  /** The ticker a click on the cell charts in the app's chart dialog (an option charts its
   *  underlying); null leaves the row's cell plain. */
  chart?: (row: T) => string | null;
  /** The chip's colour when the field shows as a chip: `gain` green, `muted` grey (Open and
   *  Closed lots), `loss` red and `info` blue (a run's Failed and Running;
   *  `RUN_STATE_TONE`). Left out: the plain chip. */
  tone?: (row: T) => ViewChipTone | undefined;
  /**
   * A text value's colour (a category's, a label's): a dot before it in the
   * cell, its chip and the edit picker. A CSS colour; a theme token reads in light and dark.
   */
  color?: (value: string) => string | undefined;
  /** A text value's icon (a label's), drawn in its `color` on its chip and in the edit picker. */
  iconOf?: (value: string) => ComponentType<{ className?: string }> | undefined;
  /** The cell's background, a theme colour mix (a P/L heat grid). */
  tint?: (row: T) => string | undefined;
  /**
   * The column's widest cell, a CSS length (`14rem`): past it the cell ends in an ellipsis on one
   * line, the full text in its hover. The first column defaults to `--lead-col-max` (18rem);
   * `false` lets it grow.
   */
  maxWidth?: string | false;
  /** Left out on phones, where the table has no room for it (a returns table's longer windows). */
  hideOnPhone?: boolean;
  /**
   * How the value updates (live domains): `live` moves with the market while it
   * trades (a quote), `asof` is a daily or snapshot value (a close, a fact, the assistant frame's column).
   * `calc` is worked out from live values the domain has no field for (an account's value).
   * Left out it is fixed (a quantity, a cost), unless `from` names a live field.
   */
  updates?: 'live' | 'calc' | 'asof';
  /** The fields it is worked out from, so a value made from a live one marks as Live calc. */
  from?: string[];
}

export type ViewChipTone = 'gain' | 'loss' | 'info' | 'muted' | 'sky' | 'amber';

/** A chip's classes per tone, on the theme's tokens so light and dark both read. */
export const CHIP_TONE: Record<ViewChipTone, string> = {
  gain: 'border-transparent bg-gain/15 text-gain',
  loss: 'border-transparent bg-loss/15 text-loss',
  info: 'border-transparent bg-info/15 text-info',
  muted: 'border-transparent bg-muted text-muted-foreground',
  // Two neutral kinds side by side (backfill and incremental jobs), on the chart palette.
  sky: 'border-transparent bg-chart-6/15 text-chart-6',
  amber: 'border-transparent bg-chart-3/15 text-chart-3',
};

/** A run's state as a chip, the same on every app: done green, failed
 *  red, running blue, queued, waiting and canceled grey. */
export const RUN_STATE_TONE = {
  done: 'gain',
  failed: 'loss',
  running: 'info',
  queued: 'muted',
  waiting: 'muted',
  canceled: 'muted',
} as const satisfies Record<string, ViewChipTone>;

/** A group of fields by where they come from: their colour and, per topic, the source line. */
export interface ViewFieldGroup {
  id: string;
  label: string;
  /** A theme colour (`var(--chart-3)`) for the group's dot and column-group header. */
  color?: string;
  /** What the group's fields are looked up by, e.g. `by symbol · an option by its underlying`. */
  note?: string;
  /** Each topic's source, e.g. Feed, live (`JOIN_SOURCES`). */
  sources?: Record<string, ViewSource & { detail?: string }>;
}

/** Where a topic's fields come from; its colour marks the topic in the field tree. */
export interface ViewSource {
  name: string;
  /** A theme colour (`var(--chart-2)`), one per source across every app. */
  color: string;
}

/** The formulas group: a view's own formula columns. */
export const FORMULAS_GROUP = '_formulas';

/** A data domain: registered once, any app can open views on it. */
export interface ViewDomain<T> {
  id: string;
  fields: ViewField<T>[];
  /** Field groups in order; without them every field is one group. */
  groups?: ViewFieldGroup[];
  /** Why its rows can't group at all (a server pages them, so a group would cover one page):
   *  Edit view greys the Group and Pivot shapes and every Group box with it. */
  groupNote?: string;
  /** Why its rows can't pivot (a server pages them): Edit view greys the Pivot shape with it. */
  pivotNote?: string;
  /**
   * The keys its rows carry (views from data domains): a reader per key, null
   * for a row without one (cash). The shell's `useJoins` attaches the registry's join fields for
   * each key (symbol: Price, Valuation, Technicals, Change...; account: Brokerage, Trading, Cash)
   * on any card of any app, after the domain's own fields; an own field of the same key wins.
   */
  keys?: Partial<Record<JoinKey, (row: T) => string | string[] | null>>;
  /** A stable id per row (React keys, the details drawer). */
  rowKey: (row: T) => string;
  /** Free text the filter box matches besides field values (a name, an id). */
  text?: (row: T) => string[];
  /** False keeps views from adding their own formula columns (`config.formulas`); every other
   *  domain takes them (formulas everywhere, `takesFormulas`). */
  formulas?: false;
  /** The domain's own summary tiles a view can show, in the order offered;
   *  the app draws them (LumenLayout's `tile`). */
  tiles?: { key: string; label: string; icon: LucideIcon }[];
  /**
   * Row-tap filtering (the assistant drafts step 1): in a card with a link colour, a row
   * tap picks the row's value of this field as a temporary linked chip, so every card of that
   * colour narrows to it (tap a lot, see its swaps); a second tap lets go. Unlinked, a tap opens the
   * row as usual.
   */
  rowLink?: string;
  /** The details drawer: collapsible sections (the shell's DrawerSection), each with its icon.
   *  A section starts collapsed unless `open` says so; a function opens it only for rows it
   *  holds something for. `count` and `hint` fill the header's chip and note. */
  details?: {
    id: string;
    label: string;
    icon: LucideIcon;
    open?: boolean | ((row: T) => boolean);
    count?: (row: T) => number | null;
    hint?: (row: T) => string | null;
    render: (row: T) => ReactNode;
  }[];
  /** While grouped, rows of one group sharing `key` show as one line, made by `rows`. */
  merge?: { key: (row: T) => string; rows: (rows: T[]) => T };
  /** A folded row's own rows, shown as a table at the top of its details drawer, first column
   *  `by` (the field they differ on), then the view's columns. */
  parts?: {
    label: string;
    by: string;
    rows: (row: T) => T[];
    /** `rows` are the other rows only, not the row itself, so one is enough to open (a post's repeats). By default they include it and need two. */
    others?: boolean;
  };
  /**
   * A row with more to read opens it in a panel inside the table, right under the row, from the
   * chevron in its first cell (an outlook's write-up, an article's summary).
   * `render` returns null for rows with nothing more: they get no chevron. Takes the chevron over
   * from the sub-group.
   */
  panel?: { label: string; render: (row: T) => ReactNode | null };
  /**
   * What a row can open under it, one level: the view's "Each row opens"
   * picks one, or none; a view that says nothing opens the first. Either `rows`, a row's own
   * children (tax lots, accounts, variants), or `under`, where rows sharing that key fold into one
   * rolled-up line that opens them (holdings by underlying: Shares, then each option). `name`
   * labels each child in the first column.
   */
  subgroups?: ViewSubgroup<T>[];
  /**
   * Curves for the Growth of $1 widget: the shown rows' lines (rows with no
   * curve yet drop out) and anything drawn beside them (benchmarks), the bands (an OOS window, its
   * line draggable) and markers, the card's header tools and a note. Only domains with it offer
   * the widget.
   */
  growth?: {
    lines: (rows: T[]) => Series[];
    bands?: (rows: T[]) => ChartBand[];
    markers?: ChartMarker[];
    tools?: ReactNode;
    note?: string;
    /** The curves' own loading (the tapes), when they load apart from the rows. */
    loading?: boolean;
  };
  /**
   * The tiles card's own header from the shown rows: say whose numbers the
   * tiles show and how that row was picked, e.g. "Best variant: Daily close" / "highest CAGR", and
   * its own tools (a Rank by picker).
   */
  tilesHead?: (rows: T[]) => { title?: string; note?: string; tools?: ReactNode };
  /**
   * The domain's cash rows (an account's cash line), when it has them: each
   * Summary then offers Include cash in Edit widget (`summaryCash`).
   */
  cash?: (row: T) => boolean;
}

/** Whether a Summary counts the domain's cash rows: its own choice, else only when it covers
 *  every row (no filter of its own, no linked chips). */
export const summaryCash = (card: { cash?: boolean }, narrowed: boolean) => card.cash ?? !narrowed;

/** One choice of a domain's "Each row opens". */
export interface ViewSubgroup<T> {
  key: string;
  label: string;
  icon: LucideIcon;
  rows?: (row: T) => T[];
  under?: (row: T) => string;
  name?: (row: T) => string;
  /** `under` folds a key even when one row has it (a field's second level of grouping). */
  always?: boolean;
  /** Rows start open, their parts showing (a meter's labels); a click still closes one. */
  open?: boolean;
}

/**
 * What a row can open: the domain's own sub-groups, else every groupable field as a second level
 * of grouping (the assistant frame tab groups by class, then by unit). The field's
 * rows sharing a value fold into one rolled-up line that opens them.
 */
/** The picker's name: a domain's own sub-groups open rows, field ones group a second level. */
export function subgroupLabel<T>(domain: ViewDomain<T>): string {
  return domain.subgroups ? 'Each row opens' : 'Sub-group';
}

export function subgroupsOf<T>(domain: ViewDomain<T>): ViewSubgroup<T>[] {
  if (domain.subgroups) return domain.subgroups;
  return domain.fields
    .filter((f) => f.groupable)
    .map((f) => ({
      key: f.key,
      label: f.label,
      icon: f.icon,
      under: (row: T) => {
        const v = f.value(row);
        return v === null || v === '' ? '—' : String(v);
      },
      always: true,
    }));
}

/** The sub-group a view opens: its own pick, else the domain's first; null for none. */
export function subgroupOf<T>(
  domain: ViewDomain<T>,
  key: string | null | undefined,
): ViewSubgroup<T> | null {
  if (key === null) return null;
  // A view that says nothing opens the domain's first own sub-group; field ones only when picked.
  if (key === undefined) return domain.subgroups?.[0] ?? null;
  return subgroupsOf(domain).find((s) => s.key === key) ?? null;
}

/** Rolls values up; nulls are skipped and an empty set is null (count is 0). */
export function rollUp(values: ViewCellValue[], agg: ViewAgg): ViewCellValue {
  const have = values.filter((v) => v !== null);
  if (agg === 'count') return have.length;
  if (agg === 'distinct') return new Set(have.map(String)).size;
  if (!have.length) return null;
  if (agg === 'first') return have[0] ?? null;
  if (agg === 'last') return have[have.length - 1] ?? null;
  const xs = have.filter((v): v is number => typeof v === 'number');
  if (!xs.length) return null;
  if (agg === 'sum') return xs.reduce((a, b) => a + b, 0);
  if (agg === 'mean') return xs.reduce((a, b) => a + b, 0) / xs.length;
  if (agg === 'min') return Math.min(...xs);
  return Math.max(...xs);
}

/** A view's chip fields and where each shows; views saved before chips existed have none. */
export const chipsOf = (c: CustomViewConfig): ViewChip[] => c.chips ?? [];
/** Whether views over the domain may add formula columns: every domain but one that opts out. */
export const takesFormulas = (domain: { formulas?: false }) => domain.formulas !== false;

/** A view's formula columns; views saved before formulas existed have none. */
export const formulasOf = (c: CustomViewConfig) => c.formulas ?? [];
/** Fields listed under Columns but not shown, for their Filter and Group ticks; views saved before it have none. */
export const hiddenOf = (c: CustomViewConfig): string[] => c.hidden ?? [];
/** A view's own tiles; views saved before tiles existed have none. */
export const tilesOf = (c: CustomViewConfig) => c.tiles ?? [];
/**
 * The fields a view shows: the domain's plus its formula columns (where the domain takes formulas),
 * each number field in the format the view picked for it (`formats`).
 */
export function withViewFields<T>(domain: ViewDomain<T>, c: CustomViewConfig): ViewDomain<T> {
  const own = takesFormulas(domain) && formulasOf(c).length ? formulaFields<T>(formulasOf(c)) : [];
  const picked = c.formats ?? {};
  const aggs = c.aggs ?? {};
  const shows = c.shows ?? {};
  if (
    !own.length &&
    !Object.keys(picked).length &&
    !Object.keys(aggs).length &&
    !Object.keys(shows).length
  )
    return domain;
  const mine = new Set(own.map((f) => f.key));
  // A text formula groups like any text field: each row's value is the formula
  // over that row alone. One that reads group_sum or total_sum depends on the rows shown, so it
  // cannot pick its own group.
  const rowValue = (f: ViewField<T>) => (r: T) => computedOf(full, [r], null).value(f, r);
  const shown = (f: ViewField<T>): ViewField<T> => {
    const alt = f.showAs?.find((o) => o.id === shows[f.key]);
    return alt?.field ? { ...f, ...alt.field } : f;
  };
  const fields: ViewField<T>[] = [...domain.fields, ...own].map(shown).map((f) => {
    if (f.format === 'text') {
      if (!mine.has(f.key) || !f.formula) return f;
      if (/\b(group_sum|total_sum)\s*\(/.test(f.formula))
        return { ...f, groupNote: 'Reads group_sum or total_sum, so it changes with the group.' };
      const g: ViewField<T> = { ...f, groupable: true };
      g.value = rowValue(g);
      return g;
    }
    const format = picked[f.key];
    const agg = mine.has(f.key) ? undefined : aggs[f.key];
    const g = format ? { ...f, format } : f;
    if (!agg) return g;
    return agg === 'none'
      ? { ...g, noRollup: true }
      : { ...g, aggregate: agg, rollFormula: false, noRollup: false };
  });
  const full: ViewDomain<T> = { ...domain, fields };
  return full;
}

/** Whether group and Total rows show a value for the field. */
export const rollsUp = <T>(f: ViewField<T>) =>
  !f.noRollup && (!!f.aggregate || !!f.rollFormula || f.share?.within === 'total');
/** A number field's Total pick as Edit view shows it: the view's, else the field's own. */
export function totalAggOf<T>(f: ViewField<T>): ViewTotalAgg | 'own' {
  if (f.noRollup) return 'none';
  if (f.aggregate) return f.aggregate;
  return f.rollFormula || f.share ? 'own' : 'none';
}

export const pick = <T>(fields: ViewField<T>[], keys: string[]) =>
  keys.length
    ? keys.map((k) => fields.find((f) => f.key === k)).filter((f): f is ViewField<T> => !!f)
    : fields;

/** A field the filter box can offer: one marked filterable, or any number field. */
export const canFilter = <T>(f: ViewField<T>) => !!f.filterable || f.format !== 'text';
/** The fields a view's filter box offers: the ones it lists, else every field marked filterable. */
export const filterFieldsOf = <T>(fields: ViewField<T>[], keys: string[]) =>
  keys.length ? pick(fields.filter(canFilter), keys) : fields.filter((f) => f.filterable);
/** A view's filters with `tokens` as the ones it opens with, offering every field they use. */
export function withSavedFilters<T>(
  fields: ViewField<T>[],
  filters: CustomViewConfig['filters'],
  tokens: CustomViewConfig['filters']['default'],
): CustomViewConfig['filters'] {
  const offered = filterFieldsOf(fields, filters.fields).map((f) => f.key);
  const missing = [...new Set(tokens.map((t) => t.key))].filter(
    (k) => k !== CONTAINS_KEY && !offered.includes(k),
  );
  return { fields: missing.length ? [...offered, ...missing] : filters.fields, default: tokens };
}

export const label = (v: ViewCellValue) => (v === null ? '—' : String(v));

/**
 * Values over the shown rows: plain fields as read, share fields and formula columns worked out
 * against the row's group (every shown row when not grouped) and every shown row.
 */
export function computedOf<T>(domain: ViewDomain<T>, rows: T[], groupBy: ViewField<T> | null) {
  const byKey = new Map(domain.fields.map((f) => [f.key, f]));
  // A formula reads fields by name (`symbol.price`, a formula's bare key); sums go by field key.
  const byName = nameIndex(domain);
  // An app's own `compute` may read its fields by bare key (`v('day_pl')`), the assistant's formulas by name.
  const field = (k: string) => byName.get(k) ?? byKey.get(k);
  const keyOf = (name: string) => field(name)?.key ?? '';
  const groups = new Map<string, T[]>();
  if (groupBy)
    for (const r of rows) {
      const k = label(groupBy.value(r));
      const g = groups.get(k);
      if (g) g.push(r);
      else groups.set(k, [r]);
    }
  const groupOf = (r: T) => (groupBy ? (groups.get(label(groupBy.value(r))) ?? []) : rows);
  const sums = new Map<T[], Map<string, number>>();
  const sum = (rs: T[], key: string) => {
    const m = sums.get(rs) ?? new Map<string, number>();
    sums.set(rs, m);
    const f = byKey.get(key);
    if (!m.has(key)) m.set(key, f ? rs.reduce((a, r) => a + num(value(f, r)), 0) : 0);
    return m.get(key) ?? 0;
  };
  const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
  // A formula that reaches itself (a draft) reads null rather than looping.
  const busy = new Set<string>();
  // Each worked-out value once per row: sorting, filtering, roll-ups and cells all read it.
  const seen = new Map<string, Map<T, ViewCellValue>>();
  function value(f: ViewField<T>, r: T): ViewCellValue {
    if (!f.share && !f.compute) return f.value(r);
    const m = seen.get(f.key) ?? new Map<T, ViewCellValue>();
    seen.set(f.key, m);
    if (m.has(r)) return m.get(r) ?? null;
    const v = worked(f, r);
    if (!busy.size) m.set(r, v);
    return v;
  }
  function worked(f: ViewField<T>, r: T): ViewCellValue {
    if (f.share) {
      const base = byKey.get(f.share.of);
      if (!base) return null;
      const whole = f.share.within === 'group' ? groupOf(r) : rows;
      return pct(num(value(base, r)), sum(whole, f.share.of));
    }
    if (!f.compute) return f.value(r);
    if (busy.has(f.key)) return null;
    busy.add(f.key);
    try {
      return f.compute(r, {
        value: (k) => {
          const x = field(k);
          return x ? value(x, r) : null;
        },
        groupSum: (k) => sum(groupOf(r), keyOf(k)),
        totalSum: (k) => sum(rows, keyOf(k)),
      });
    } finally {
      busy.delete(f.key);
    }
  }
  /**
   * A set of rows' roll-up: a `total` share is their share of every shown row,
   * an `aggregate` rolls the rows' values, and a formula with none runs over the rows' roll-ups of
   * its inputs (a ratio input is itself recomputed; an input with no roll-up reads null).
   */
  const rolled = new Map<T[], Map<string, ViewCellValue>>();
  function roll(f: ViewField<T>, rs: T[]): ViewCellValue {
    if (f.noRollup) return null;
    if (f.aggregate)
      return rollUp(
        rs.map((r) => value(f, r)),
        f.aggregate,
      );
    if (f.share)
      return f.share.within === 'total' ? pct(sum(rs, f.share.of), sum(rows, f.share.of)) : null;
    if (!f.rollFormula || !f.compute) return null;
    const m = rolled.get(rs) ?? new Map<string, ViewCellValue>();
    rolled.set(rs, m);
    if (m.has(f.key)) return m.get(f.key) ?? null;
    if (busy.has(f.key)) return null;
    busy.add(f.key);
    try {
      const v = f.compute(rs[0] as T, {
        value: (k) => {
          const x = field(k);
          return x ? roll(x, rs) : null;
        },
        groupSum: (k) => sum(rs, keyOf(k)),
        totalSum: (k) => sum(rows, keyOf(k)),
      });
      m.set(f.key, v);
      return v;
    } finally {
      busy.delete(f.key);
    }
  }
  return { value, roll };
}

/**
 * Each formula column that is blank on some of the rows, and why (a blank
 * column said nothing): `blank on 24 of 24 rows: dew_point_f is empty`. The editor shows it under
 * the formula, and the assistant reads it after each card move.
 */
export function formulaBlanks<T>(domain: ViewDomain<T>, rows: T[]): Map<string, string> {
  const out = new Map<string, string>();
  const formulas = domain.fields.filter((f) => f.formula && f.compute);
  if (!formulas.length || !rows.length) return out;
  const c = computedOf(domain, rows, null);
  const byName = nameIndex(domain);
  const read = (k: string, r: T) => {
    const f = byName.get(k);
    return f ? c.value(f, r) : null;
  };
  const total = (k: string) => rows.reduce((a, r) => a + num(read(k, r)), 0);
  for (const f of formulas) {
    const blank = rows.filter((r) => {
      const v = c.value(f, r);
      return v === null || v === '';
    });
    const first = blank[0];
    if (first === undefined) continue;
    const why = whyBlank(f.formula ?? '', {
      value: (k) => read(k, first),
      groupSum: total,
      totalSum: total,
    });
    out.set(f.key, `blank on ${blank.length} of ${rows.length} rows${why ? `: ${why}` : ''}`);
  }
  return out;
}

export const num = (v: ViewCellValue) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A field's group id: its own, else the domain's first group ('' when the domain has none). */
export const groupOf = <T>(domain: ViewDomain<T>, f: ViewField<T>) =>
  f.group ?? domain.groups?.[0]?.id ?? '';

/**
 * A field's name in formulas: the one it was made with (a join's
 * `symbol.price`, a frame's `frame.<frame>.<column>`, a linked domain's `tax_lots.count`), a
 * formula's bare key, else `<domain>.<key>` for the domain's own.
 */
export const fieldName = <T>(domain: ViewDomain<T>, f: ViewField<T>) =>
  f.name ?? (groupOf(domain, f) === FORMULAS_GROUP ? f.key : `${domain.id}.${f.key}`);

/** Each field by its name in formulas. */
export const nameIndex = <T>(domain: ViewDomain<T>) =>
  new Map(domain.fields.map((f) => [fieldName(domain, f), f]));
