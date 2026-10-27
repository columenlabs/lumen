import {
  type CustomViewConfig,
  type ViewCard,
  type ViewChip,
  type ViewFormat,
  type WidgetControl,
  bytesParts,
  controlOn,
  isCountAgg,
  isDollarFormat,
  viewPaginationSchema,
} from '@columenlabs/lumen-ui-types/views';
// Custom views: any number of views on any app, one page for all of them.
// A data domain (holdings, chains, bars, series, research results) describes its fields once in a
// `ViewDomain`; a view is a saved `CustomViewConfig` over that domain, written in the page's Edit
// dialog or by an agent through MCP. This file is LumenView, the view as a card (its table, grouped
// one level deep with collapsible group rows, pivot, totals, sorting, paging), LumenTable and the
// details drawer; LumenLayout (lumen-layout.tsx) is the page around it. Rows are the ones the app
// already loaded; everything here runs on the client.
import {
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortingState,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartCandlestick,
  ChartSpline,
  ChevronRightIcon,
  ChevronsDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns3CogIcon,
  CornerDownRightIcon,
  DownloadIcon,
  ListCollapseIcon,
  PlusIcon,
  SigmaIcon,
  UserPenIcon,
} from 'lucide-react';
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ColorChip, ColorDot } from './color-dot';
import { DrawerSection } from './drawer-section';
import { useFloatingHead } from './floating-head';
import { FreshnessMark, freshnessLine, freshnessOf } from './freshness';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { lazyPart } from './lazy-part';
import { cn } from './lib/utils';
import { useGridCell } from './lumen-grid';
import { LumenSelector } from './lumen-selector';
import { type LumenLoad, LumenSkeleton, LumenStates, useLiveLoad } from './lumen-source';
import { type CardControls, type CardLink, LumenWidget } from './lumen-widget';
import { MAX_COMPARE, useSymbolChart } from './market/lumen-chart';
import { LumenPager } from './pager';
import { maskAmount, useAmountsHidden } from './shell';
import { useSymbolSheet } from './symbol-sheet-context';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { UnitColumns, UnitValue } from './unit-value';
import { EditCell, EditInputCell, EditManyCell } from './view-edit-cell';
import type { ViewEditDialog as ViewEditDialogPart } from './view-editor';
import { fieldOptions } from './view-formulas';
import {
  CHIP_TONE,
  FORMULAS_GROUP,
  type RollLevel,
  type ViewCellValue,
  type ViewChipTone,
  type ViewDomain,
  type ViewField,
  type ViewSubgroup,
  chipsOf,
  computedOf,
  groupOf,
  label,
  pick,
  rollUp,
  rollsUp,
  subgroupOf,
} from './view-model';

// Loaded when it first shows (lazy-part.tsx).
const ViewEditDialog = lazyPart(
  () => import('./view-editor').then((m) => m.ViewEditDialog as ComponentType<object>),
  null,
) as unknown as typeof ViewEditDialogPart;

export type {
  ViewCellValue,
  ViewChipTone,
  ViewDomain,
  ViewField,
  RollLevel,
  ViewFieldGroup,
  ViewSource,
} from './view-model';
export { CHIP_TONE, FORMULAS_GROUP, RUN_STATE_TONE } from './view-model';
export { rollUp } from './view-model';
export type { ViewEditorSection } from './view-editor';

/** Rows a table draws per group, or per unpaged table, before "Show more". */
const DRAW_STEP = 200;
/** Past this many rows a grouped table opens with only its first group open. */
const OPEN_ALL = 500;

/**
 * Rows that share the domain's merge key, folded into one row each: within each group, or across
 * every row when nothing is grouped (no duplicate rows in the flat table).
 */
export function mergeRows<T>(domain: ViewDomain<T>, rows: T[], groupBy: ViewField<T> | null): T[] {
  const merge = domain.merge;
  if (!merge) return rows;
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = `${groupBy ? label(groupBy.value(r)) : ''}\u0000${merge.key(r)}`;
    const b = m.get(k);
    b ? b.push(r) : m.set(k, [r]);
  }
  return [...m.values()].map((rs) => (rs.length > 1 ? merge.rows(rs) : (rs[0] as T)));
}

/** A saved view (`@columenlabs/lumen-ui-types/views`); agents write the same shape through MCP. */
export type { CustomViewConfig };

const MINUS = '−';
/** Text cells longer than this many characters are cut to one line with a tooltip. */
const LONG_TEXT = 48;
/** Rows of a view the assistant sees with each message. */
const ASSISTANT_ROWS = 10;

const formatter = (digits: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const FMT = { 0: formatter(0), 2: formatter(2) } as const;
/** Integer: no decimals and no thousands commas (a year reads 2026). */
const PLAIN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: false });
const digitsOf = (format: ViewFormat, compact?: boolean) =>
  compact || format === 'compact'
    ? COMPACT
    : format === 'integer'
      ? PLAIN
      : format === 'rounded' || format === 'price_rounded'
        ? FMT[0]
        : FMT[2];
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** A value as its field's format reads: tabular figures, a true minus, gain/loss on signed values. */
export function ViewValueCell({
  value,
  format,
  chip,
  tone,
  color,
  amount,
  compact,
  empty,
}: {
  value: ViewCellValue;
  format: ViewFormat;
  /** Text shown as a chip (a view's `chips` setting). */
  chip?: boolean;
  /** The chip's colour (a field's `tone`). */
  tone?: ViewChipTone;
  /** A dot of this colour before text (a field's `color`). */
  color?: string;
  /** A holding amount: shown as `•••••` while Hide amounts is on. */
  amount?: boolean;
  /** Large numbers in short form: $283.1B, 6.1M. */
  compact?: boolean;
  /** What an empty cell says; left out: a dash. */
  empty?: string;
}) {
  const hidden = useAmountsHidden() && !!amount;
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) {
    return <span className="num text-muted-foreground">{empty ?? '—'}</span>;
  }
  if (chip && typeof value === 'string')
    return color ? (
      <ColorChip color={color}>{value}</ColorChip>
    ) : (
      <Badge variant="secondary" className={cn('font-normal', tone && CHIP_TONE[tone])}>
        {value}
      </Badge>
    );
  if (color && typeof value === 'string')
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <ColorDot color={color} className="size-3" />
        <span className="truncate">{value}</span>
      </span>
    );
  if (typeof value === 'string' || format === 'text') {
    const text = hidden ? maskAmount(String(value)) : String(value);
    // Long text stays on one line, cut with an ellipsis; the whole text shows on hover.
    if (text.length <= LONG_TEXT) return <span>{text}</span>;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block max-w-[24rem] truncate">{text}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-md whitespace-normal">{text}</TooltipContent>
      </Tooltip>
    );
  }
  if (format === 'bytes' && !hidden) {
    // A size: its number and unit in the column's unit slot, so a column of sizes lines up.
    const [n, unit] = bytesParts(value);
    return <UnitValue value={`${value < 0 ? MINUS : ''}${n}`} unit={unit} />;
  }
  const abs = hidden ? maskAmount('0') : digitsOf(format, compact).format(Math.abs(value));
  const signed = format === 'signed' || format === 'percent' || format === 'price_signed';
  const sign = value < 0 ? MINUS : signed && value > 0 ? '+' : '';
  const dollar = isDollarFormat(format) ? '$' : '';
  return (
    <span
      className={cn(
        'num whitespace-nowrap',
        signed && (value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : ''),
      )}
    >
      {`${sign}${dollar}${abs}${format === 'percent' || format === 'weight' ? '%' : ''}`}
    </span>
  );
}

/** A row's first cell with its inline chips (a view's `inline` chips), editable where the field is. */
function FirstCell({
  value,
  chips,
}: {
  value: ReactNode;
  chips: { key: string; node: ReactNode }[];
}) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {value}
      {chips.map((c) => (
        <Fragment key={c.key}>{c.node}</Fragment>
      ))}
    </span>
  );
}

/** The row styling every Total and group header shares. */
const ROLLUP = 'bg-muted/50 font-medium hover:bg-muted/50';
// One scroller for the whole view: the tiles, filter and table scroll together
// in one box, one screen tall, so a swipe never stalls where the header pins and the tiles leave the
// screen before the rows move. The header and group rows pin with native sticky inside it (the shadcn
// sticky-header data table pattern); group rows sit right under the header, overlapping it by 1px so
// no gap ever shows, and the next group row slides over the one pinned. Wide tables scroll sideways
// in the same box while the tiles and filter stay put. Cards draw their outline as a border inside
// their box, so no scroller clips it. The box spans the
// page edge to edge and draws the gutter and max width as its own side padding, so its scrollbar sits
// at the screen's edge, never over the cards; its page body drops its side
// padding and max width (`VIEW_PAGE`).
// The bottom gutter is its padding too, and the box is always one screen tall (not just at most), so a
// sideways scrollbar sits on the status bar even on a short page, never floating inside it. Rows pinned to the view's width use `--view-w`, the box's width less its gutters and
// scrollbar (`100cqw` counts the scrollbar, so it alone overflows by the bar's width and draws a
// needless sideways bar); the scroller sets `--view-sb` to its vertical bar's width.
export const VIEW_SCROLL =
  '@container h-[calc(100svh-var(--shell-header-height)-var(--shell-status-height)-var(--shell-gutter))] overflow-auto px-[max(var(--shell-gutter),calc((100%-var(--shell-max-width))/2+var(--shell-gutter)))] pb-(--shell-gutter) [--view-w:calc(100cqw-var(--view-sb,0px))]';
/** The page body around `VIEW_SCROLL`: the scroller draws the side and bottom gutter and max width. */
export const VIEW_PAGE = 'max-w-none px-0 pb-0';
/** A fit table's text cells wrap (numbers keep their own nowrap), so the table fits its width. */
const FIT = '[&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal';
/** The table inside the view's scroller: it never scrolls on its own, so sticky rows pin to the view.
 *  It clips up and down (clip, unlike hidden, makes no scroller), which hides the pinned header's
 *  cap while the header sits at the table's top. */
const IN_VIEW =
  '[&>[data-slot=table-container]]:overflow-x-visible [&>[data-slot=table-container]]:overflow-y-clip';
/** A pinned header cell. Its cap fills the band between a sticky tab row and the header (the
 *  tab row's fade, --intro-fade) with the card, so rows scrolled past the header never show above
 *  it; the card still fades out under the tabs. */
const PINNED_HEAD =
  "sticky top-(--pin-top,0px) z-20 bg-card shadow-[inset_0_-1px_0_var(--color-border)] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-(--intro-fade,0px) before:bg-card before:content-['']";
const PINNED_GROUP =
  'sticky top-[calc(var(--pin-top,0px)+var(--row-h)-1px)] z-10 bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-card))] shadow-[inset_0_1px_0_var(--color-border),inset_0_-1px_0_var(--color-border)]';

function SortIcon({ dir }: { dir: false | 'asc' | 'desc' }) {
  if (dir === 'asc') return <ArrowUpIcon className="size-3" />;
  if (dir === 'desc') return <ArrowDownIcon className="size-3" />;
  return null;
}

/** The details: a folded row's own rows as a table, then the domain's sections. */
export function DetailsBody<T extends RowData>({
  domain,
  row,
  columns,
  chips,
}: {
  domain: ViewDomain<T>;
  row: T;
  columns: ViewField<T>[];
  chips: ViewChip[];
}) {
  const parts = domain.parts?.rows(row) ?? [];
  const by = domain.fields.find((f) => f.key === domain.parts?.by);
  const sections: NonNullable<ViewDomain<T>['details']> = [
    ...(parts.length > (domain.parts?.others ? 0 : 1) && by && domain.parts
      ? [
          {
            id: '_parts',
            label: domain.parts.label,
            icon: by.icon,
            open: true,
            count: () => parts.length,
            render: () => (
              <div className="-mx-1 rounded-md border">
                <LumenTable
                  domain={domain}
                  // Text the rows all share (the symbol, the kind) says nothing here.
                  columns={[
                    by,
                    ...columns.filter(
                      (f) =>
                        f.key !== by.key &&
                        (f.format !== 'text' || new Set(parts.map((r) => f.value(r))).size > 1),
                    ),
                  ]}
                  rows={parts}
                  groupBy={null}
                  chips={chips}
                />
              </div>
            ),
          },
        ]
      : []),
    ...(domain.details ?? []),
  ];
  return (
    <>
      {sections.map((s) => (
        <DrawerSection
          key={`${domain.rowKey(row)}:${s.id}`}
          icon={s.icon}
          title={s.label}
          count={s.count?.(row)}
          hint={s.hint?.(row)}
          defaultOpen={typeof s.open === 'function' ? s.open(row) : s.open}
        >
          {s.render(row)}
        </DrawerSection>
      ))}
    </>
  );
}

/**
 * Rows a server pages: the view shows `rows` as one page, as given (the server already filtered
 * and sorted them), and the pager turns pages through `onPage`.
 */
export interface ServerPaging {
  /** The page shown, from 0. */
  page: number;
  size: number;
  /** Every row the server has for the filter; null when it does not count them. */
  total: number | null;
  /** With no `total`: whether a page follows this one. */
  more: boolean;
  onPage: (page: number) => void;
  onSize?: (size: number) => void;
  sizes?: readonly number[];
  /** The columns the server sorts by; the rest take no header sort, and the view groups nothing
   *  (unless `groups`), since either would order or bucket one page only. */
  sorts?: readonly string[];
  /** Told the sort held (a header click, a revert), to fetch the rows in that order. */
  onSort?: (sort: CustomViewConfig['sort']) => void;
  /** The server groups the rows: the Group button offers the domain's groupable fields, and a
   *  group's rows load when it opens. Without it a server's page groups nothing. */
  groups?: ServerGroups;
}

/** One group a server counted: its key (the group field's value as the view shows it), its row
 *  count (null: not counted), and, once open, the rows loaded so far. */
export interface ServerGroup {
  key: string;
  n: number | null;
  open: boolean;
  /** The rows loaded for an open group, in the server's order. */
  rows: unknown[];
  /** The group has rows past those loaded: its Show more row loads the next. */
  more?: () => void;
  /** Its rows are loading. */
  loading?: boolean;
}

export interface ServerGroups {
  /** Told the field the person groups by (null: none), to fetch that field's groups. */
  onGroup: (key: string | null) => void;
  /** The picked field's groups, in order; null while they load. */
  list: ServerGroup[] | null;
  /** Groups past those listed: a More groups row asks for them. */
  more?: () => void;
  /** The groups come a page at a time instead: the header's pager turns the page (no More
   *  groups row), and `list` is the page shown. */
  pages?: Omit<ServerPaging, 'sorts' | 'onSort' | 'groups'> & { noun?: string };
  /** A group header's click: open or close it. */
  onToggle: (key: string) => void;
  /** Expand all (true) or Collapse all (false): open or close every group listed. */
  onToggleAll?: (open: boolean) => void;
}

export interface LumenViewProps<T> {
  /** The view's domain, its formula columns included (`withViewFields`). */
  domain: ViewDomain<T>;
  config: CustomViewConfig;
  /** The rows the view shows: its page's filter already applied. */
  rows: T[];
  /** Every row before the filter, for "12 of 40 rows"; left out: `rows`. */
  total?: number;
  /** The rows are one page of a server's: the pager pages through the server. */
  paging?: ServerPaging;
  /** The grouping the page picked (its Group by switch); null: flat rows. */
  groupBy?: ViewField<T> | null;
  /** Shows the view's pivot instead of its rows. */
  pivot?: boolean;
  /** What each row opens, by the domain's sub-group key (the page's Group button); null: none,
   *  left out: the view's saved pick. */
  subgroup?: string | null;
  /** The rows' loading state (`useLumenLoad`): the view shows its skeleton, progress bar, ↻, a
   *  failure with Retry and, with Observability details on, its load time. */
  load?: LumenLoad;
  /** Shown in place of the table instead of the rows, e.g. an empty state ("No accounts yet"). */
  state?: ReactNode;
  /** The card's title; left out: the view's name. */
  title?: string;
  /** Row checkboxes (strategy lab): the checked row keys and their setter; the
   *  header box checks every shown row. */
  selection?: { keys: Set<string>; onChange: (keys: Set<string>) => void };
  /** A row click: opens the details drawer, or the row's own page. */
  onDetails?: (row: T) => void;
  /** Rows picked by a tap (a linked table's row filter): a muted fill, no border. */
  tapped?: (row: T) => boolean;
  /** Buttons at the end of a group row's label (pin a group), given its key and rows. */
  groupActions?: (key: string, rows: T[]) => ReactNode;
  /** Its place in a LumenLayout: the layout's edit state and the card's ⋯ menu. */
  controls?: CardControls;
  /** In a LumenLayout's scroller: the table scrolls with the page, its header pinned. */
  inLayout?: boolean;
  /** The card's id on its page (its fold is kept per id); a page's second table passes its own. */
  cardId?: string;
  /** Buttons in the card's header before the pager ("+ Add time"). */
  tools?: ReactNode;
  /** The view's own filter and Group in its header (the filter is the table's,
   *  not the page's), and how many tokens it holds. */
  filter?: ReactNode;
  filterCount?: number;
  /** A line under the filter: the card's Link offer. */
  strip?: ReactNode;
  /** Its link colour on the layout. */
  link?: CardLink;
  /** A short subtitle after the title (a repo path). */
  note?: ReactNode;
  /** The Columns picker in the header: turns any of the domain's fields on
   *  or off and hands back the view's new columns. Left out: no picker. */
  onColumns?: (keys: string[]) => void;
  /** The + at the end of the header (Edits in place): Field (the Columns
   *  picker, at the +), Formula, Your data and Ask the assistant; each left out is not offered. */
  onAddColumn?: AddColumn;
  /** The sort shown, when the page holds it (rule C); left out: the view's saved sort. */
  sort?: CustomViewConfig['sort'];
  /** Told when a header click changes the sort. */
  onSort?: (sort: CustomViewConfig['sort']) => void;
  /** Its controls from its card (Edit widget ▸ Controls); missing keys take the Table defaults. */
  shown?: ViewCard['controls'];
}

/** What the header's + offers. */
export interface AddColumn {
  /** Formula: a column computed from the others; `disabled` says why it is not offered here. */
  formula?: (() => void) | { disabled: string };
  /** Your data: a column the person types; `disabled` says why it is not offered here. */
  yours?: (() => void) | { disabled: string };
}

/** Columns in a view's header: every field of the domain, ticked when it shows. */
function ColumnPicker<T>({
  domain,
  columns,
  onColumns,
  open,
  onOpenChange,
  className,
}: {
  domain: ViewDomain<T>;
  columns: ViewField<T>[];
  onColumns: (keys: string[]) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const keys = columns.map((f) => f.key);
  return (
    <LumenSelector
      multiple
      trigger="icon"
      icon={Columns3CogIcon}
      label="Columns"
      align="end"
      search
      open={open}
      onOpenChange={onOpenChange}
      className={className}
      options={fieldOptions(domain.fields, domain)}
      value={keys}
      onChange={(next) =>
        onColumns(
          next.some((k) => !keys.includes(k))
            ? domain.fields.map((x) => x.key).filter((k) => next.includes(k))
            : keys.filter((k) => next.includes(k)),
        )
      }
    />
  );
}

/**
 * The view's rows as a CSV file: the filtered rows in the view's sort, its
 * shown columns (the grouping first when it is not one), plain numbers; amounts stay masked while
 * Hide amounts is on. The CSV writer loads on the first download, not with the page.
 */
async function downloadCsv<T>({
  name,
  columns,
  rows,
  groupBy,
  sort,
  hidden,
}: {
  name: string;
  columns: ViewField<T>[];
  rows: T[];
  groupBy: ViewField<T> | null;
  sort: CustomViewConfig['sort'];
  hidden: boolean;
}) {
  const fields = groupBy && !columns.includes(groupBy) ? [groupBy, ...columns] : columns;
  const by = sort && fields.find((f) => f.key === sort.key);
  const sorted = by
    ? [...rows].sort((a, b) => {
        const x = by.value(a);
        const y = by.value(b);
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        const c =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y));
        return sort?.desc ? -c : c;
      })
    : rows;
  const cell = (f: ViewField<T>, r: T) => {
    const v = f.value(r);
    if (v === null || (typeof v === 'number' && !Number.isFinite(v))) return '';
    return hidden && f.amount ? maskAmount(String(v)) : v;
  };
  const { default: Papa } = await import('papaparse');
  const csv = Papa.unparse({
    fields: fields.map((f) => f.label),
    data: sorted.map((r) => fields.map((f) => cell(f, r))),
  });
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.trim().replace(/[^\w.-]+/g, '-') || 'view'}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * LumenView (a card of its own): a data
 * view over one domain, as a card. Its header has the view's name, the row count and pager, its ↻
 * and ⋯, and its own filter and Group (they narrow this table only); its body
 * the table (grouped one level, or the pivot) with the loading states.
 */
export function LumenView<T extends RowData>({
  domain,
  config,
  rows,
  total = rows.length,
  paging: server,
  groupBy: pickedGroup = null,
  pivot: pickedPivot = false,
  subgroup,
  load: sourceLoad,
  state,
  title = config.name,
  selection,
  onDetails,
  tapped,
  groupActions,
  controls,
  inLayout: inScroller = false,
  cardId = 'view',
  tools,
  filter,
  filterCount,
  strip,
  link,
  note,
  onColumns,
  onAddColumn,
  sort = config.sort,
  onSort,
  shown,
}: LumenViewProps<T>) {
  // Its controls (Edit widget ▸ Controls): Pager, Columns and Download here.
  const on = (k: WidgetControl) => controlOn({ kind: 'table', controls: shown }, k);
  const cell = useGridCell();
  // A table on the grid scrolls sideways inside its own card; a full-width one out of the grid
  // scrolls with the page.
  const inLayout = inScroller && !cell;
  const columns = pick(domain.fields, config.columns);
  // A server's page groups and pivots nothing (either would cover the one page only), unless the
  // server groups it.
  const groupBy = server && !server.groups ? null : pickedGroup;
  const served = server?.groups && groupBy ? server.groups : null;
  const onGroup = server?.groups?.onGroup;
  useEffect(() => onGroup?.(groupBy?.key ?? null), [onGroup, groupBy?.key]);
  const pivot = server ? false : pickedPivot;
  // Live columns on screen keep their source reading while the market trades (#861).
  const load = useLiveLoad(
    sourceLoad,
    columns.some((c) => {
      const r = freshnessOf(domain, c);
      return r === 'live' || r === 'calc';
    }),
  );
  const chips = chipsOf(config);
  // Server groups: the open groups' rows, each object once (a row in two groups shows in both).
  const groupRows = useMemo(
    () =>
      served ? [...new Set((served.list ?? []).flatMap((g) => (g.open ? g.rows : [])))] : null,
    [served],
  ) as T[] | null;
  const tableRows = useMemo(
    () => groupRows ?? mergeRows(domain, rows, groupBy),
    [groupRows, domain, rows, groupBy],
  );
  const amountsHidden = useAmountsHidden();
  // Flat tables page their rows, 25 a page unless the view says otherwise; the size picker and
  // the page buttons sit in the card's header. Views saved before then
  // carry no pagination, so they read the defaults.
  const isMobile = useIsMobile();
  const pagination = config.pagination ?? viewPaginationSchema.parse({});
  const [pageSize, setPageSize] = useState<number>(pagination.size);
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => setPageSize(pagination.size), [pagination.size]);
  const sub = subgroupOf(domain, subgroup === undefined ? config.subgroup : subgroup);
  // Folded lines and their rows stay on one page, so a fold shows every row like a grouping.
  const paging =
    !server && pagination.on && on('pager') && !state && !groupBy && !pivot && !sub?.under;
  // A fit table wraps its text to the width there is; the rest scroll sideways.
  // A phone has no width to fit to: every table scrolls sideways there.
  const fit = config.width === 'fit' && !pivot && !isMobile;
  const pages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const page = Math.min(pageIndex, pages - 1);
  const count = rows.length === total ? `${total} rows` : `${rows.length} of ${total} rows`;
  // The page holds while rows change in place (a tick, a label edit, a refresh, a bulk apply): only
  // a new filter (a different set of rows), grouping, sort or page size starts from the first page.
  // A page past the end after rows go is clamped above (`page`).
  const rowSet = useMemo(
    () =>
      rows
        .map((r) => domain.rowKey(r))
        .sort()
        .join('\u0000'),
    [rows, domain],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on these changes only
  useEffect(() => setPageIndex(0), [rowSet, pageSize, groupBy?.key, sort?.key, sort?.desc]);
  const sorted = (s: CustomViewConfig['sort']) => {
    setPageIndex(0);
    onSort?.(s);
  };

  // Checked rows with a chart symbol open one compare chart (up to 8).
  const openChart = useSymbolChart();
  const chartField = domain.fields.find((f) => f.chart);
  const picked = useMemo(() => {
    if (!selection?.keys.size || !chartField?.chart) return [];
    const out = new Set<string>();
    for (const r of rows)
      if (selection.keys.has(domain.rowKey(r))) {
        const t = chartField.chart(r);
        if (t) out.add(t);
      }
    return [...out].slice(0, MAX_COMPARE);
  }, [selection, chartField, rows, domain]);
  const compare =
    openChart && picked.length > 1 ? (
      <IconButton
        icon={ChartSpline}
        label={`Compare ${picked.join(', ')}`}
        variant="outline"
        onClick={() => openChart(picked)}
      />
    ) : null;

  // A server's page: the pager counts from the server's total, or the rows seen so far. Server
  // groups page themselves: the header counts them.
  const pager = served?.pages ? (
    <LumenPager
      total={
        served.pages.total ?? served.pages.page * served.pages.size + (served.list?.length ?? 0)
      }
      page={served.pages.page}
      size={served.pages.size}
      onPage={served.pages.onPage}
      onSize={served.pages.onSize ?? (() => {})}
      sizes={served.pages.sizes ?? [served.pages.size]}
      noun={served.pages.noun ?? 'groups'}
      more={served.pages.total === null && served.pages.more}
    />
  ) : served ? (
    <span className="num px-2 text-xs text-muted-foreground">
      {served.list ? `${served.list.length.toLocaleString()}${served.more ? '+' : ''} groups` : ''}
    </span>
  ) : server ? (
    <LumenPager
      total={server.total ?? server.page * server.size + rows.length}
      page={server.page}
      size={server.size}
      onPage={server.onPage}
      onSize={server.onSize ?? (() => {})}
      sizes={server.sizes ?? [server.size]}
      more={server.total === null && server.more}
    />
  ) : paging ? (
    <LumenPager
      total={tableRows.length}
      page={page}
      size={pageSize}
      onPage={setPageIndex}
      onSize={setPageSize}
      noun={rows.length === total ? 'rows' : `of ${total} rows`}
    />
  ) : (
    <span className="num px-2 text-xs text-muted-foreground">{count}</span>
  );

  const table =
    pivot && config.pivot ? (
      <PivotTable domain={domain} rows={rows} pivot={config.pivot} />
    ) : (
      <LumenTable
        domain={domain}
        columns={columns}
        rows={tableRows}
        groupBy={groupBy}
        subgroup={sub}
        chips={chips}
        page={paging ? { index: page, size: pageSize } : null}
        inView={inLayout}
        fit={fit}
        onDetails={onDetails}
        tapped={tapped}
        selection={selection}
        groupActions={groupActions}
        sort={sort}
        onSort={sorted}
        serverSorts={server ? (server.sorts ?? []) : undefined}
        serverGroups={served}
        total={config.total !== false}
        add={
          onAddColumn || onColumns
            ? { ...onAddColumn, field: onColumns && { domain, columns, onColumns } }
            : undefined
        }
      />
    );
  return (
    <LumenWidget
      id={cardId}
      kind="table"
      style="table"
      title={title}
      controls={controls}
      tools={
        state ? (
          tools
        ) : (
          <>
            {tools}
            {compare}
            {pager}
            {onColumns && !onAddColumn && on('columns') && (
              <ColumnPicker domain={domain} columns={columns} onColumns={onColumns} />
            )}
            {!pivot && on('download') && (
              <IconButton
                icon={DownloadIcon}
                label="Download CSV"
                // A phone's card header has room for the pager, filter, refresh and menu only.
                className="max-md:hidden"
                onClick={() =>
                  downloadCsv({
                    name: title,
                    columns,
                    rows: tableRows,
                    groupBy,
                    sort: config.sort,
                    hidden: amountsHidden,
                  })
                }
              />
            )}
          </>
        )
      }
      filter={state ? undefined : filter}
      filterCount={filterCount}
      strip={state ? undefined : strip}
      link={link}
      note={note}
      load={load}
      shown={shown}
      rows={total}
      pinned={inLayout && !fit}
      className={cn('relative', !inLayout && 'overflow-x-auto overflow-y-hidden [--pin-top:0px]')}
    >
      {state ??
        (load ? (
          <LumenStates load={load} skeleton={<LumenSkeleton rows={10} />}>
            {table}
          </LumenStates>
        ) : (
          table
        ))}
    </LumenWidget>
  );
}

/**
 * The + at the end of a table's header (Edits in place): Field opens the
 * Columns picker here, Formula the view's formula editor, Your data a column the person types,
 * Ask the assistant the composer pointed at this card. On phone each opens as a sheet.
 */
function AddColumnMenu<T>({
  add,
  fieldOpen,
  onFieldOpen,
}: {
  add: NonNullable<LumenTableProps<T>['add']>;
  fieldOpen: boolean;
  onFieldOpen: (open: boolean) => void;
}) {
  const yoursOff = add.yours && typeof add.yours !== 'function' ? add.yours.disabled : null;
  const formulaOff = add.formula && typeof add.formula !== 'function' ? add.formula.disabled : null;
  const only = add.field && !add.formula && !add.yours;
  return (
    <span className="relative inline-flex items-center">
      {add.field && (
        <ColumnPicker
          {...add.field}
          open={fieldOpen}
          onOpenChange={onFieldOpen}
          className={only ? undefined : 'absolute inset-0 size-full opacity-0'}
        />
      )}
      {!only && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={PlusIcon}
              size="icon-xs"
              label="Add column"
              className="relative text-muted-foreground"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {add.field && (
              <DropdownMenuItem onSelect={() => onFieldOpen(true)}>
                <Columns3CogIcon /> Field
                <span className="ml-auto text-muted-foreground text-xs">the data model</span>
              </DropdownMenuItem>
            )}
            {add.formula && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <DropdownMenuItem
                      disabled={!!formulaOff}
                      onSelect={typeof add.formula === 'function' ? add.formula : undefined}
                    >
                      <SigmaIcon /> Formula
                      <span className="ml-auto text-muted-foreground text-xs">over columns</span>
                    </DropdownMenuItem>
                  </span>
                </TooltipTrigger>
                {formulaOff && <TooltipContent>{formulaOff}</TooltipContent>}
              </Tooltip>
            )}
            {add.yours && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <DropdownMenuItem
                      disabled={!!yoursOff}
                      onSelect={typeof add.yours === 'function' ? add.yours : undefined}
                    >
                      <UserPenIcon /> Your data
                      <span className="ml-auto text-muted-foreground text-xs">you type it</span>
                    </DropdownMenuItem>
                  </span>
                </TooltipTrigger>
                {yoursOff && <TooltipContent>{yoursOff}</TooltipContent>}
              </Tooltip>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  );
}

/** A field's colour for its header: its topic's source (a broker green, an app brown) where
 *  the group names one, else its group's (Holding, Symbol, Account, Formulas). */
export function colorOf<T>(domain: ViewDomain<T>, f: ViewField<T> | undefined) {
  if (!f || !domain.groups?.length) return null;
  const id = groupOf(domain, f);
  if (id === FORMULAS_GROUP) return 'var(--color-muted-foreground)';
  const g = domain.groups.find((x) => x.id === id);
  return (f.topic && g?.sources?.[f.topic]?.color) || g?.color || null;
}
/** Where a field comes from, for its header's tooltip: Holding › Basket,
 *  Symbol › Analysts › Target · a broker live. */
function pathOf<T>(domain: ViewDomain<T>, f: ViewField<T>) {
  const id = groupOf(domain, f);
  const g = id === FORMULAS_GROUP ? undefined : domain.groups?.find((x) => x.id === id);
  const path = [id === FORMULAS_GROUP ? 'Formulas' : g?.label, f.topic, f.label]
    .filter(Boolean)
    .join(' › ');
  const src = f.topic ? g?.sources?.[f.topic] : undefined;
  return src ? `${path} · ${[src.name, src.detail].filter(Boolean).join(' ')}` : path;
}
/** Every header carries its colour (`colorOf`), text and a 2px rule. */
const ruleOf = (color: string | null) =>
  color ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined;

const alignOf = (format: ViewFormat) => (format === 'text' ? 'text-left' : 'text-right');
/** A column's cell classes: its alignment, and hidden on phones where the field says so. */
/** An ISO date, alone or with a time after it: `2026-10-14`, `2026-10-14 16:17`. */
const isDateText = (v: unknown) =>
  typeof v === 'string' && v.length <= 25 && /^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(v);
const colOf = <T,>(f: ViewField<T> | undefined) =>
  cn(alignOf(f?.format ?? 'text'), f?.hideOnPhone && 'max-md:hidden');
/**
 * A column's cell props: its classes, its key (`data-col`), and `data-units` once a `UnitValue`
 * has drawn in it. Every cell of such a column (header, dash, Total) then right-aligns on the
 * numbers' edge while the units hang in the gutter (theme.css), so one column has one edge.
 */
const colPropsOf =
  (units: ReadonlySet<string>) =>
  <T,>(f: ViewField<T> | undefined, ...more: (string | false | undefined | null)[]) => ({
    className: cn(colOf(f), ...more),
    'data-col': f?.key,
    'data-units': f && units.has(f.key) ? '' : undefined,
  });

/**
 * A column's widest cell (`maxWidth`): the first column defaults to `--lead-col-max` (18rem in
 * theme.css), so one long name never pushes the other columns off screen; `false` lifts it.
 */
const capOf = <T,>(f: ViewField<T>, i: number) =>
  f.maxWidth === false ? undefined : (f.maxWidth ?? (i === 0 ? 'var(--lead-col-max)' : undefined));
/** Holds a cell to its column's cap on one line: text past it ends in an ellipsis. */
function CappedCell({
  max,
  title,
  children,
}: { max: string | undefined; title?: string; children: ReactNode }) {
  if (!max) return children;
  return (
    <div
      className="flex min-w-0 *:min-w-0 *:max-w-full *:truncate"
      style={{ maxWidth: max }}
      title={title}
    >
      {children}
    </div>
  );
}

/** The flat or grouped table: sortable headers, a Total row, group rows that collapse. */
// Sorting, and paging of flat tables (the page is LumenView's, set right of the row count).
const SORTING = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
});
/** The plain table LumenView draws, also standalone for lists that are not a whole view; with
 *  `load` it shows its own skeleton, progress bar and failure. */
export function LumenTable<T extends RowData>({
  load,
  ...props
}: LumenTableProps<T> & { load?: LumenLoad }) {
  if (!load) return <LumenTableRows {...props} />;
  return (
    <div className="relative">
      <LumenStates load={load}>
        <LumenTableRows {...props} />
      </LumenStates>
    </div>
  );
}

export interface LumenTableProps<T> {
  domain: ViewDomain<T>;
  /** The fields shown, in order; every field of the domain when left out. */
  columns?: ViewField<T>[];
  rows: T[];
  groupBy?: ViewField<T> | null;
  chips?: ViewChip[];
  /** The page a flat table shows; null shows every row. */
  page?: { index: number; size: number } | null;
  /** The view page's own table, which scrolls with the page rather than in its card. */
  inView?: boolean;
  /** Text cells wrap so the table fits the width there is, rather than scrolling sideways. */
  fit?: boolean;
  onDetails?: (row: T) => void;
  tapped?: LumenViewProps<T>['tapped'];
  selection?: LumenViewProps<T>['selection'];
  groupActions?: LumenViewProps<T>['groupActions'];
  /** The view's default sort; a header click changes it for the visit. */
  sort?: CustomViewConfig['sort'];
  /** Told the sort a header click sets, so a page can hold or save it (rule C). */
  onSort?: (sort: CustomViewConfig['sort']) => void;
  /** The rows come sorted by a server, which sorts by these columns only: a header click asks
   *  the server (through `onSort`) and the other headers take no click. */
  serverSorts?: readonly string[];
  /** The + Add column head at the end of the header. */
  add?: AddColumn & {
    field?: { domain: ViewDomain<T>; columns: ViewField<T>[]; onColumns: (keys: string[]) => void };
  };
  /** Draws the Total row under the rows; the view's `total: false` leaves it out. */
  total?: boolean;
  /** What each row opens under it (`subgroupOf`); null: rows open nothing but their panel. */
  subgroup?: ViewSubgroup<T> | null;
  /** The groups come from a server (`ServerPaging.groups`): their order, counts and open state,
   *  and each open group's rows. */
  serverGroups?: ServerGroups | null;
}

/** The table's sort from a view's: none when its column is not shown, or the server cannot sort
 *  by it. */
function sortingOf<T>(
  sort: CustomViewConfig['sort'] | undefined,
  columns: ViewField<T>[],
  serverSorts: readonly string[] | undefined,
): SortingState {
  if (!sort || (serverSorts && !serverSorts.includes(sort.key))) return [];
  return columns.some((f) => f.key === sort.key) ? [{ id: sort.key, desc: sort.desc }] : [];
}

function LumenTableRows<T extends RowData>({
  domain,
  columns = domain.fields,
  rows,
  groupBy = null,
  chips = [],
  page = null,
  inView = false,
  fit = false,
  onDetails,
  tapped,
  selection,
  groupActions,
  sort,
  onSort,
  serverSorts,
  total = true,
  subgroup = null,
  add,
  serverGroups = null,
}: LumenTableProps<T>) {
  const isMobile = useIsMobile();
  const [sorting, setSorting] = useState<SortingState>(() => sortingOf(sort, columns, serverSorts));
  // A saved sort patched while the table is open (the assistant's card move) applies at once.
  const savedSort = JSON.stringify(sort ?? null);
  const savedSortRef = useRef(savedSort);
  useEffect(() => {
    if (savedSortRef.current === savedSort) return;
    savedSortRef.current = savedSort;
    setSorting(sortingOf(sort, columns, serverSorts));
  }, [savedSort, sort, columns, serverSorts]);
  const paging = page !== null && !groupBy;
  const pagination: PaginationState = {
    pageIndex: paging ? page.index : 0,
    pageSize: paging ? page.size : Math.max(rows.length, 1),
  };
  // Groups whose state differs from where they start: open, or past OPEN_ALL rows only the first.
  // Columns a UnitValue has drawn in (`UnitColumns`): their cells share the numbers' edge.
  const [units, setUnits] = useState<ReadonlySet<string>>(() => new Set());
  const markUnits = useCallback(
    (key: string) => setUnits((s) => (s.has(key) ? s : new Set(s).add(key))),
    [],
  );
  const colProps = colPropsOf(units);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Map<string, number>>(new Map());
  // Under a sub-group's `flat` grouping each row names itself by its sub-group key instead of
  // folding; the first column keeps its place to show that name.
  const flat = !!groupBy && !!subgroup?.flat?.includes(groupBy.key);
  // The grouped field is the group row's label, so its column hides (a flat lead stays).
  // Each key once: two columns under one React key can lose a cell on a re-render, and every
  // row after it slides left by one.
  const visible = columns.filter(
    (f, i) =>
      (f.key !== groupBy?.key || (flat && i === 0)) &&
      columns.findIndex((x) => x.key === f.key) === i,
  );
  // Inline chips sit on the first column, next to the row's name, not in their own.
  const inline = visible.filter(
    (f, i) => i > 0 && chips.some((c) => c.key === f.key && c.placement === 'inline'),
  );
  const shown = visible.filter((f) => !inline.includes(f));
  // On a narrow phone each row reads as a card (theme.css, `data-card`): its name and one figure
  // (the sorted one, else the first number or date) on the first line, the rest on the second.
  // Numbers and dates keep their width there; only text shortens.
  const short = (f: ViewField<T>) =>
    f.format !== 'text' || (rows[0] !== undefined && isDateText(f.value(rows[0])));
  const meta = (
    shown.find((f, i) => i > 0 && f.key === sorting[0]?.id && short(f)) ??
    shown.find((f, i) => i > 0 && short(f))
  )?.key;
  const cardOf = (f: ViewField<T>) =>
    f === shown[0] ? 'lead' : f.key === meta ? 'meta' : short(f) ? 'num' : 'text';
  const col = (f: ViewField<T> | undefined, ...more: (string | false | undefined | null)[]) => ({
    ...colProps(f, ...more),
    'data-card': f ? cardOf(f) : undefined,
    'data-card-unit': f?.cardUnit,
  });
  const computed = useMemo(() => computedOf(domain, rows, groupBy), [domain, rows, groupBy]);
  // Values per editable field, offered when a cell is edited: the field's own list when it has
  // one (every value, in use or not), else the values in the shown rows.
  const options = useMemo(() => {
    const m = new Map<string, { inUse: string[]; unused: string[] }>();
    for (const f of visible)
      if (f.edit)
        m.set(
          f.key,
          f.edit.options?.() ?? {
            inUse: [
              ...new Set(
                rows
                  .flatMap((r) => (f.values ? f.values(r) : [f.value(r)]))
                  .filter((v): v is string => typeof v === 'string' && v !== ''),
              ),
            ].sort(),
            unused: [],
          },
        );
    return m;
  }, [visible, rows]);
  // A symbol cell opens the app's chart dialog, where the app mounts one.
  // Where the app also mounts the Symbol sheet, the ticker opens the sheet and the chart
  // icon still opens the chart dialog.
  const openSheet = useSymbolSheet();
  const openChart = useSymbolChart();
  const cellOf = (f: ViewField<T>, row: T, chip: boolean) => {
    const ticker = (openSheet || openChart) && f.chart?.(row);
    const cell = plainCellOf(f, row, chip);
    if (!ticker) return cell;
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
    // Muted until hovered, then lit.
    const icon = (
      <ChartCandlestick className="size-3.5 text-muted-foreground/50 transition-colors group-hover/button:text-primary group-focus-visible/button:text-primary" />
    );
    const button = (label: string, open: (t: string) => void, children: ReactNode) => (
      <Button
        variant="link"
        className="h-auto gap-1.5 p-0 font-[inherit] text-inherit"
        aria-label={label}
        onClick={(e) => {
          stop(e);
          open(ticker);
        }}
        onKeyDown={stop}
      >
        {children}
      </Button>
    );
    if (!openSheet)
      return (
        openChart &&
        button(
          `Chart ${ticker}`,
          openChart,
          <>
            {cell}
            {icon}
          </>,
        )
      );
    return (
      <span className="inline-flex items-center gap-1.5">
        {button(`Open ${ticker}`, openSheet, cell)}
        {openChart && button(`Chart ${ticker}`, (t) => openChart(t), icon)}
      </span>
    );
  };
  // A date never wraps, in any table, fit or not.
  const plainCellOf = (f: ViewField<T>, row: T, chip: boolean) => {
    const v = computed.value(f, row);
    const cell = valueCellOf(f, row, chip, v);
    return isDateText(v) ? <span className="whitespace-nowrap">{cell}</span> : cell;
  };
  const valueCellOf = (
    f: ViewField<T>,
    row: T,
    chip: boolean,
    v: ReturnType<typeof computed.value>,
  ) => {
    if (f.render) return f.render(row);
    if (!f.edit)
      return (
        <ViewValueCell
          value={v}
          format={f.format}
          chip={chip}
          tone={chip ? f.tone?.(row) : undefined}
          color={typeof v === 'string' ? f.color?.(v) : undefined}
          amount={f.amount}
          compact={f.compact}
          empty={f.empty}
        />
      );
    const edit = f.edit;
    const many = edit.many;
    if (many)
      return (
        <EditManyCell
          label={f.label}
          values={f.values?.(row) ?? (typeof v === 'string' && v !== '' ? [v] : [])}
          options={options.get(f.key)?.inUse ?? []}
          unused={options.get(f.key)?.unused}
          note={edit.note?.(row)}
          colorOf={f.color}
          iconOf={f.iconOf}
          onSave={(values) => many(row, values)}
        />
      );
    const save = edit.save;
    if (!save) return <ViewValueCell value={v} format={f.format} chip={chip} />;
    if (edit.input)
      return (
        <EditInputCell
          label={f.label}
          value={typeof v === 'number' || typeof v === 'string' ? v : null}
          type={edit.input}
          edited={edit.edited?.(row) ?? false}
          onSave={(value) => save(row, value)}
        >
          <ViewValueCell value={v} format={f.format} amount={f.amount} compact={f.compact} />
        </EditInputCell>
      );
    return (
      <EditCell
        label={f.label}
        value={typeof v === 'string' && v !== '' ? v : null}
        options={options.get(f.key)?.inUse ?? []}
        unused={options.get(f.key)?.unused}
        chip={chip}
        note={edit.note?.(row)}
        colorOf={f.color}
        fixed={edit.fixed}
        edited={edit.edited?.(row) ?? false}
        onSave={(value) => save(row, value)}
      />
    );
  };
  // A column's `cell` function is a component type to flexRender, so a new function means every
  // cell remounts (a cell being typed into loses its box). The defs change
  // only when the columns do; each cell reads the latest renderers through `latest`.
  const latest = useRef({ shown, cellOf, inline, chips, computed });
  latest.current = { shown, cellOf, inline, chips, computed };
  const shownKeys = shown.map((f) => f.key).join(',');
  const inlineOn = inline.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the columns shown; the rest comes through `latest`
  const defs = useMemo<ColumnDef<typeof SORTING, T>[]>(
    () =>
      shown.map((f, i) => ({
        id: f.key,
        accessorFn: (r) => {
          const { shown: now, computed } = latest.current;
          return computed.value(now[i] ?? f, r) ?? undefined;
        },
        sortUndefined: 'last',
        enableSorting: !serverSorts || serverSorts.includes(f.key),
        header: i === 0 && flat && subgroup ? subgroup.label : f.label,
        cell: ({ row }) => {
          const { shown: now, cellOf, inline, chips, computed } = latest.current;
          const field = now[i] ?? f;
          const chip = chips.some((c) => c.key === field.key);
          const v = computed.value(field, row.original);
          return (
            <CappedCell
              max={capOf(field, i)}
              title={!field.render && typeof v === 'string' ? v : undefined}
            >
              {i === 0 && inline.length ? (
                <FirstCell
                  value={cellOf(field, row.original, chip)}
                  chips={inline.flatMap((x) => {
                    const v = computed.value(x, row.original);
                    if (!x.edit && (v === null || v === '')) return [];
                    return [{ key: x.key, node: cellOf(x, row.original, true) }];
                  })}
                />
              ) : (
                cellOf(field, row.original, chip)
              )}
            </CappedCell>
          );
        },
      })),
    [shownKeys, inlineOn, serverSorts?.join(','), flat],
  );
  const table = useTable({
    features: SORTING,
    data: rows,
    columns: defs,
    state: { sorting, pagination },
    // A server's rows come sorted; the table only shows which column it sorted by.
    manualSorting: !!serverSorts,
    onSortingChange: (u) => {
      const next = typeof u === 'function' ? u(sorting) : u;
      setSorting(next);
      const first = next[0];
      onSort?.(first ? { key: first.id, desc: first.desc } : null);
    },
    autoResetPageIndex: false,
  });
  // Phone: a long press on a header opens the Columns picker as a sheet.
  const [fieldOpen, setFieldOpen] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = () => {
    if (!add?.field) return;
    press.current = setTimeout(() => setFieldOpen(true), 500);
  };
  const pressEnd = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };
  const sorted = table.getRowModel().rows;
  const groups = useMemo(() => {
    if (!groupBy) return null;
    if (serverGroups) {
      const byRow = new Map(sorted.map((r) => [r.original as unknown, r]));
      return (serverGroups.list ?? []).map(
        (g) => [g.key, g.rows.flatMap((o) => byRow.get(o) ?? [])] as [string, typeof sorted],
      );
    }
    const m = new Map<string, typeof sorted>();
    for (const r of sorted) {
      const k = label(groupBy.value(r.original));
      const b = m.get(k);
      b ? b.push(r) : m.set(k, [r]);
    }
    return [...m];
  }, [groupBy, sorted, serverGroups]);
  const span = shown.length + (selection ? 1 : 0) + (add ? 1 : 0);
  const served = new Map((serverGroups?.list ?? []).map((g) => [g.key, g]));
  const startsOpen = (i: number) => rows.length <= OPEN_ALL || i === 0;
  const isOpen = (key: string, i: number) =>
    serverGroups ? !!served.get(key)?.open : startsOpen(i) !== flipped.has(key);
  const anyClosed = !!groups?.some(([k], i) => !isOpen(k, i));
  const setAll = (open: boolean) =>
    serverGroups
      ? serverGroups.onToggleAll?.(open)
      : setFlipped(
          new Set((groups ?? []).filter((_, i) => startsOpen(i) !== open).map(([k]) => k)),
        );
  const keyOf = domain.rowKey;
  const toggle = (keys: string[], on: boolean) => {
    if (!selection) return;
    const next = new Set(selection.keys);
    for (const k of keys) on ? next.add(k) : next.delete(k);
    selection.onChange(next);
  };
  const allKeys = rows.map(keyOf);
  const allOn = allKeys.length > 0 && allKeys.every((k) => selection?.keys.has(k));
  const someOn = allKeys.some((k) => selection?.keys.has(k));
  const selectCell = (key: string, name: string) =>
    selection && (
      <TableCell data-card="select" className="w-8 pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selection.keys.has(key)}
          onCheckedChange={(on) => toggle([key], on === true)}
          aria-label={`Select ${name}`}
        />
      </TableCell>
    );

  // The rows whose open state the person flipped: a sub-group that starts open (`open`) lists
  // the closed ones, any other the open ones.
  const [partFlips, setOpenParts] = useState<Set<string>>(new Set());
  const openParts = {
    has: (k: string) => (subgroup?.open && !domain.panel ? !partFlips.has(k) : partFlips.has(k)),
  };
  // A server group's roll-ups would add up its loaded rows only, so they and the Total stay off.
  const hasTotal = total && !serverGroups && shown.some(rollsUp);
  // A group row's label spans the leading columns that roll nothing up.
  const rolls = (f: ViewField<T>) => !f.noRollup && (!!f.aggregate || !!f.rollFormula || !!f.share);
  const lead = Math.max(
    1,
    shown.findIndex((f, i) => i > 0 && rolls(f)) < 0
      ? shown.length
      : shown.findIndex((f, i) => i > 0 && rolls(f)),
  );
  // On a phone the hideOnPhone columns are gone, so the label spans only the leading ones still
  // drawn; spanning the hidden ones too pushed the group's totals right of their headers.
  const leadSpan = Math.max(
    1,
    lead - (isMobile ? shown.slice(0, lead).filter((f) => f.hideOnPhone).length : 0),
  );
  const rollCell = (f: ViewField<T>, members: T[], level: RollLevel) =>
    rollsUp(f) && f.rollRender ? (
      f.rollRender(members, level)
    ) : rollsUp(f) ? (
      <ViewValueCell
        value={computed.roll(f, members)}
        format={f.aggregate && isCountAgg(f.aggregate) ? 'rounded' : f.format}
        amount={f.aggregate !== 'count' && f.amount}
        compact={f.compact}
      />
    ) : null;
  const rollCells = (members: T[]) =>
    shown.map((f) => (
      <TableCell key={f.key} {...col(f)}>
        {rollCell(f, members, 'total')}
      </TableCell>
    ));

  // A row's chevron opens one level under it, closed by default: its panel, else the view's
  // sub-group ("Each row opens"; None opens nothing).
  const partsOf = (row: T) => (domain.panel ? [] : (subgroup?.rows?.(row) ?? []));
  const panelOf = (row: T) => domain.panel?.render(row) ?? null;
  const opens = (row: T) => (domain.panel ? panelOf(row) !== null : partsOf(row).length > 1);
  const openLabel = () => domain.panel?.label ?? subgroup?.label.toLowerCase() ?? 'parts';
  const folds = !domain.panel && !!subgroup?.under && !flat;
  // Every folded line's key, so the header's menu can open or close them all at once.
  const foldKeys = (): string[] => {
    const under = folds ? subgroup?.under : undefined;
    if (!under || !groups) return [];
    return groups.flatMap(([g, ms]) => {
      const counts = new Map<string, number>();
      for (const r of ms) counts.set(under(r.original), (counts.get(under(r.original)) ?? 0) + 1);
      return [...counts]
        .filter(([, n]) => n > 1 || subgroup?.always)
        .map(([k]) => `under:${g}\u0000${k}`);
    });
  };
  const anyFoldClosed = folds && foldKeys().some((k) => !openParts.has(k));
  const setAllParts = (open: boolean) =>
    setOpenParts(new Set(open === !!subgroup?.open ? [] : foldKeys()));
  const titleOf = (key: string, rows: T[]) =>
    subgroup?.title?.(key, rows, groupBy?.key ?? null) ?? key;
  const flatName = (row: T) =>
    flat && subgroup?.under ? (
      <span className="flex min-w-0 items-center gap-1.5">
        {subgroup.mark?.(subgroup.under(row), [row])}
        <span className="truncate">{titleOf(subgroup.under(row), [row])}</span>
      </span>
    ) : null;
  const nests = folds || sorted.some((r) => opens(r.original));
  const chevron = (k: string, name: string) => (
    <Button
      variant="ghost"
      size="icon-xs"
      className="-ml-1"
      aria-expanded={openParts.has(k)}
      aria-label={`${openParts.has(k) ? 'Hide' : 'Show'} ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        setOpenParts((o) => {
          const n = new Set(o);
          n.has(k) ? n.delete(k) : n.add(k);
          return n;
        });
      }}
    >
      <ChevronRightIcon className={cn('transition-transform', openParts.has(k) && 'rotate-90')} />
    </Button>
  );
  const partRow = (p: T, name?: (row: T) => string) => (
    <TableRow
      key={`part:${keyOf(p)}`}
      className={cn(
        'bg-muted/30 text-muted-foreground hover:bg-muted',
        onDetails && 'cursor-pointer',
      )}
      onClick={onDetails ? () => onDetails(p) : undefined}
    >
      {selection && <TableCell />}
      {shown.map((f, i) => (
        <TableCell key={f.key} {...col(f, i === 0 && 'pl-12')}>
          {i === 0 ? (
            <span className="flex items-center gap-2">
              <CornerDownRightIcon className="size-3.5 shrink-0" />
              {/* A field sub-group names no part: its rows show their own first column. */}
              <CappedCell max={capOf(f, 0)}>
                {name
                  ? name(p)
                  : cellOf(
                      f,
                      p,
                      chips.some((c) => c.key === f.key),
                    )}
              </CappedCell>
            </span>
          ) : (
            cellOf(
              f,
              p,
              chips.some((c) => c.key === f.key),
            )
          )}
        </TableCell>
      ))}
      {add && <TableCell />}
    </TableRow>
  );
  // The whole row opens the details drawer.
  const dataRow = (r: (typeof sorted)[number]) => (
    <Fragment key={domain.rowKey(r.original)}>
      <TableRow
        key={domain.rowKey(r.original)}
        data-row={domain.rowKey(r.original)}
        data-state={tapped?.(r.original) ? 'selected' : undefined}
        className={cn('group/row', onDetails && 'cursor-pointer')}
        tabIndex={onDetails ? 0 : undefined}
        onClick={onDetails ? () => onDetails(r.original) : undefined}
        onKeyDown={
          onDetails
            ? (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDetails(r.original);
                }
              }
            : undefined
        }
      >
        {selectCell(keyOf(r.original), keyOf(r.original))}
        {r.getAllCells().map((c, i) => (
          <TableCell
            key={c.id}
            {...col(shown[i], groupBy && i === 0 && 'pl-8')}
            style={{ background: shown[i]?.tint?.(r.original) }}
          >
            {i === 0 && nests ? (
              <span className="flex items-center gap-1">
                {opens(r.original) ? (
                  chevron(keyOf(r.original), openLabel())
                ) : (
                  <span className="-ml-1 size-6 shrink-0" />
                )}
                {flexRender(c.column.columnDef.cell, c.getContext())}
              </span>
            ) : i === 0 && flat ? (
              flatName(r.original)
            ) : (
              flexRender(c.column.columnDef.cell, c.getContext())
            )}
          </TableCell>
        ))}
        {add && <TableCell />}
      </TableRow>
      {openParts.has(keyOf(r.original)) &&
        partsOf(r.original).map((p) => partRow(p, subgroup?.name))}
      {openParts.has(keyOf(r.original)) && domain.panel ? (
        <TableRow
          key={`panel:${keyOf(r.original)}`}
          data-slot="row-panel"
          className="bg-muted/20 hover:bg-muted/20"
        >
          <TableCell colSpan={span} className="p-0 whitespace-normal">
            {/* Pinned to the table's left edge, so a wide table never scrolls the panel away. */}
            <div className="sticky left-0 w-[min(56rem,calc(100vw-2rem))] max-w-full px-4 py-3 md:pl-10">
              {panelOf(r.original)}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );

  // Rows sharing the sub-group's `under` key fold into one rolled-up line that opens them; a key
  // with one row keeps that row (NVDA opens Shares, then each option).
  const foldRow = (key: string, members: typeof sorted, scope: string) => {
    const k = `under:${scope}\u0000${key}`;
    const ms = members.map((m) => m.original);
    return (
      <Fragment key={k}>
        {/* The whole folded line opens and closes its rows. */}
        <TableRow
          data-row={k}
          className="cursor-pointer hover:bg-muted has-aria-expanded:hover:bg-muted"
          onClick={() =>
            setOpenParts((o) => {
              const n = new Set(o);
              n.has(k) ? n.delete(k) : n.add(k);
              return n;
            })
          }
        >
          {selection && <TableCell />}
          {shown.map((f, i) => (
            <TableCell key={f.key} {...col(f, groupBy && i === 0 && 'pl-8')}>
              {i === 0 ? (
                <span className="flex items-center gap-1">
                  {chevron(k, `${key} ${openLabel()}`)}
                  {subgroup?.mark?.(key, ms)}
                  <span className="font-medium" title={titleOf(key, ms) === key ? undefined : key}>
                    {titleOf(key, ms)}
                  </span>
                  <span className="num text-xs text-muted-foreground">{ms.length}</span>
                </span>
              ) : (
                rollCell(f, ms, 'fold')
              )}
            </TableCell>
          ))}
          {add && <TableCell />}
        </TableRow>
        {openParts.has(k) && ms.map((p) => partRow(p, subgroup?.name))}
      </Fragment>
    );
  };
  const rowsOf = (list: typeof sorted, scope: string) => {
    const under = folds ? subgroup?.under : undefined;
    if (!under) return list.map(dataRow);
    const m = new Map<string, typeof sorted>();
    for (const r of list) {
      const k = under(r.original);
      const b = m.get(k);
      b ? b.push(r) : m.set(k, [r]);
    }
    return [...m].map(([k, ms]) =>
      ms.length > 1 || subgroup?.always
        ? foldRow(k, ms, scope)
        : dataRow(ms[0] as (typeof sorted)[number]),
    );
  };
  // A table draws at most DRAW_STEP rows per group (or per unpaged table) until asked for more
  // (a grouped view of a quarter's holdings history drew ~1M elements and
  // crashed the browser).
  const drawn = (list: typeof sorted, scope: string) => {
    const limit = more.get(scope) ?? DRAW_STEP;
    const out = rowsOf(list.slice(0, limit), scope);
    const left = list.length - limit;
    if (left <= 0) return out;
    return [
      ...out,
      <TableRow key={`${scope}:more`} data-more>
        <TableCell colSpan={span} className="py-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setMore((m) => new Map(m).set(scope, limit + DRAW_STEP))}
          >
            <ChevronsDownIcon />
            Show {Math.min(left, DRAW_STEP).toLocaleString()} more
            <span className="num font-normal text-muted-foreground">
              of {left.toLocaleString()}
            </span>
          </Button>
        </TableCell>
      </TableRow>,
    ];
  };
  // A server group's rows as loaded, then its Show more (the server's next rows) or loading row.
  const servedRows = (list: typeof sorted, key: string) => {
    const g = served.get(key);
    const out = rowsOf(list, key);
    if (!g?.more && !g?.loading)
      return out.length
        ? out
        : [
            <TableRow key={`${key}:none`}>
              <TableCell colSpan={span} className="py-2 text-center text-xs text-muted-foreground">
                No rows match.
              </TableCell>
            </TableRow>,
          ];
    return [
      ...out,
      <TableRow key={`${key}:more`} data-more>
        <TableCell colSpan={span} className="py-1">
          {g.loading ? (
            <span className="px-2 text-xs text-muted-foreground">Loading…</span>
          ) : (
            <Button variant="ghost" size="xs" onClick={g.more}>
              <ChevronsDownIcon />
              Show more
              {g.n !== null && (
                <span className="num font-normal text-muted-foreground">
                  of {(g.n - list.length).toLocaleString()}
                </span>
              )}
            </Button>
          )}
        </TableCell>
      </TableRow>,
    ];
  };
  const box = useRef<HTMLDivElement>(null);
  useFloatingHead(box, !inView);
  return (
    <div
      ref={box}
      className={cn(
        inView ? IN_VIEW : 'overflow-x-auto overflow-y-hidden [--pin-top:0px]',
        fit && FIT,
      )}
    >
      <UnitColumns.Provider value={markUnits}>
        <Table data-cards="">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {selection && (
                  <TableHead className={cn('w-8 pr-0', PINNED_HEAD)}>
                    <Checkbox
                      checked={allOn ? true : someOn ? 'indeterminate' : false}
                      onCheckedChange={(on) => toggle(allKeys, on === true)}
                      aria-label="Select every row"
                    />
                  </TableHead>
                )}
                {hg.headers.map((h, i) => (
                  <TableHead
                    key={h.id}
                    {...col(shown[i], PINNED_HEAD)}
                    style={ruleOf(colorOf(domain, shown[i]))}
                    onPointerDown={pressStart}
                    onPointerUp={pressEnd}
                    onPointerLeave={pressEnd}
                    onPointerCancel={pressEnd}
                    onContextMenu={(e) => {
                      if (press.current) e.preventDefault();
                    }}
                    aria-sort={
                      h.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : h.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : undefined
                    }
                  >
                    {i === 0 && groups && folds && !serverGroups && (
                      // Groups and their folded lines: open everything, close the folded lines
                      // only, or close every group.
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            icon={
                              anyClosed || anyFoldClosed ? ChevronsUpDownIcon : ChevronsDownUpIcon
                            }
                            size="icon-xs"
                            className="-ml-2 mr-1 align-middle"
                            label="Expand or collapse rows"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-52">
                          <DropdownMenuItem
                            onSelect={() => {
                              setAll(true);
                              setAllParts(true);
                            }}
                          >
                            <ChevronsUpDownIcon /> Expand all
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setAll(true);
                              setAllParts(false);
                            }}
                          >
                            <ListCollapseIcon /> Close every {subgroup?.label.toLowerCase()}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setAll(false)}>
                            <ChevronsDownUpIcon /> Collapse all
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {i === 0 &&
                      groups &&
                      !(folds && !serverGroups) &&
                      (!serverGroups || serverGroups.onToggleAll) && (
                        // Expand or collapse every group at once.
                        <IconButton
                          icon={anyClosed ? ChevronsUpDownIcon : ChevronsDownUpIcon}
                          size="icon-xs"
                          className="-ml-2 mr-1 align-middle"
                          label={anyClosed ? 'Expand all groups' : 'Collapse all groups'}
                          onClick={() => setAll(anyClosed)}
                        />
                      )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="xs"
                          className={cn('font-medium', !(i === 0 && groups) && '-mx-2')}
                          style={{ color: colorOf(domain, shown[i]) ?? undefined }}
                          onClick={
                            h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined
                          }
                        >
                          {shown[i] ? <FreshnessMark domain={domain} field={shown[i]} /> : null}
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <SortIcon dir={h.column.getIsSorted()} />
                        </Button>
                      </TooltipTrigger>
                      {shown[i] && (domain.groups?.length || freshnessOf(domain, shown[i])) ? (
                        <TooltipContent>
                          {domain.groups?.length ? <div>{pathOf(domain, shown[i])}</div> : null}
                          {freshnessLine(domain, shown[i]) ? (
                            <div>{freshnessLine(domain, shown[i])}</div>
                          ) : null}
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  </TableHead>
                ))}
                {add && (
                  <TableHead className={cn('w-8 pl-1', PINNED_HEAD)}>
                    <AddColumnMenu add={add} fieldOpen={fieldOpen} onFieldOpen={setFieldOpen} />
                  </TableHead>
                )}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {!rows.length && !serverGroups?.list?.length && (
              <TableRow>
                <TableCell colSpan={span} className="py-6 text-center text-muted-foreground">
                  No rows match.
                </TableCell>
              </TableRow>
            )}
            {groups && groupBy
              ? groups.map(([key, members], gi) => {
                  const open = isOpen(key, gi);
                  return (
                    <Fragment key={key}>
                      <TableRow className={ROLLUP} data-group={key}>
                        {selection && (
                          <TableCell className={cn('w-8 pr-0', PINNED_GROUP)}>
                            <Checkbox
                              checked={
                                members.every((m) => selection.keys.has(keyOf(m.original)))
                                  ? true
                                  : members.some((m) => selection.keys.has(keyOf(m.original)))
                                    ? 'indeterminate'
                                    : false
                              }
                              onCheckedChange={(on) =>
                                toggle(
                                  members.map((m) => keyOf(m.original)),
                                  on === true,
                                )
                              }
                              aria-label={`Select every row of ${key}`}
                            />
                          </TableCell>
                        )}
                        {shown.slice(lead - 1).map((f, i) =>
                          i === 0 ? (
                            <TableCell key={f.key} colSpan={leadSpan} className={PINNED_GROUP}>
                              <Button
                                variant="ghost"
                                size="xs"
                                className="-mx-2 hover:bg-transparent aria-expanded:bg-transparent"
                                aria-expanded={open}
                                aria-label={`${open ? 'Collapse' : 'Expand'} ${key}`}
                                onClick={() =>
                                  serverGroups
                                    ? serverGroups.onToggle(key)
                                    : setFlipped((c) => {
                                        const n = new Set(c);
                                        n.has(key) ? n.delete(key) : n.add(key);
                                        return n;
                                      })
                                }
                              >
                                <ChevronRightIcon
                                  className={cn('transition-transform', open && 'rotate-90')}
                                />
                                <GroupMark field={groupBy} value={key} />
                                {key}
                                <span className="num font-normal text-muted-foreground">
                                  {serverGroups
                                    ? (served.get(key)?.n?.toLocaleString() ?? '')
                                    : members.length}
                                </span>
                              </Button>
                              {groupActions?.(
                                key,
                                members.map((m) => m.original),
                              )}
                            </TableCell>
                          ) : (
                            <TableCell key={f.key} {...col(f, PINNED_GROUP)}>
                              {!serverGroups &&
                                rollCell(
                                  f,
                                  members.map((m) => m.original),
                                  'group',
                                )}
                            </TableCell>
                          ),
                        )}
                        {/* The + column's cell, so the group's band runs to the table's edge. */}
                        {add && <TableCell className={PINNED_GROUP} />}
                      </TableRow>
                      {open && (serverGroups ? servedRows(members, key) : drawn(members, key))}
                    </Fragment>
                  );
                })
              : drawn(sorted, '')}
            {serverGroups?.more && !serverGroups.pages && (
              <TableRow data-more>
                <TableCell colSpan={span} className="py-1">
                  <Button variant="ghost" size="xs" onClick={serverGroups.more}>
                    <ChevronsDownIcon />
                    More groups
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {hasTotal && rows.length > 0 && (
              <TableRow className={cn(ROLLUP, 'border-t-2')} data-total>
                {selection && <TableCell />}
                {rollCells(rows).map((cell, i) =>
                  i === 0 && !(shown[0] && rollsUp(shown[0])) ? (
                    <TableCell key="total">Total</TableCell>
                  ) : (
                    cell
                  ),
                )}
                {add && <TableCell />}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </UnitColumns.Provider>
    </div>
  );
}

/** One value rolled up into a rows × columns grid, with totals where the roll-up adds. */
function PivotTable<T>({
  domain,
  rows,
  pivot,
}: {
  domain: ViewDomain<T>;
  rows: T[];
  pivot: NonNullable<CustomViewConfig['pivot']>;
}) {
  const field = (k: string) => domain.fields.find((f) => f.key === k);
  const rf = field(pivot.rows);
  const cf = field(pivot.columns);
  const vf = field(pivot.value);
  const grid = useMemo(() => {
    if (!rf || !cf || !vf) return null;
    const rowKeys = [...new Set(rows.map((r) => label(rf.value(r))))].sort();
    const colKeys = [...new Set(rows.map((r) => label(cf.value(r))))].sort();
    const cell = (rk: string | null, ck: string | null) =>
      rollUp(
        rows
          .filter(
            (r) =>
              (rk === null || label(rf.value(r)) === rk) &&
              (ck === null || label(cf.value(r)) === ck),
          )
          .map(vf.value),
        pivot.agg,
      );
    return { rowKeys, colKeys, cell };
  }, [rows, rf, cf, vf, pivot.agg]);
  if (!grid || !rf || !cf || !vf) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        This view's pivot names a field the data does not have.
      </p>
    );
  }
  const totals = pivot.agg === 'sum' || pivot.agg === 'count';
  const fmt: ViewFormat = isCountAgg(pivot.agg) ? 'rounded' : vf.format;
  const amount = pivot.agg !== 'count' && vf.amount;
  return (
    <div className={IN_VIEW} data-testid="view-pivot">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={PINNED_HEAD} style={ruleOf(colorOf(domain, rf))}>
              <span className="flex items-center gap-1.5">
                <rf.icon className="size-3.5" />
                <span style={{ color: colorOf(domain, rf) ?? undefined }}>{rf.label}</span> \{' '}
                <span style={{ color: colorOf(domain, cf) ?? undefined }}>{cf.label}</span>
                <span className="font-normal text-muted-foreground">
                  (<span style={{ color: colorOf(domain, vf) ?? undefined }}>{vf.label}</span>,{' '}
                  {pivot.agg})
                </span>
              </span>
            </TableHead>
            {grid.colKeys.map((c) => (
              <TableHead
                key={c}
                className={cn('text-right', PINNED_HEAD)}
                style={ruleOf(colorOf(domain, cf))}
              >
                {c}
              </TableHead>
            ))}
            {totals && <TableHead className={cn('text-right', PINNED_HEAD)}>Total</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {grid.rowKeys.map((r) => (
            <TableRow key={r} data-row={r}>
              <TableCell>{r}</TableCell>
              {grid.colKeys.map((c) => (
                <TableCell key={c} className="text-right">
                  <ViewValueCell value={grid.cell(r, c)} format={fmt} amount={amount} />
                </TableCell>
              ))}
              {totals && (
                <TableCell className={cn('text-right', ROLLUP)}>
                  <ViewValueCell value={grid.cell(r, null)} format={fmt} amount={amount} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {totals && (
            <TableRow className={cn(ROLLUP, 'border-t-2')} data-total>
              <TableCell>Total</TableCell>
              {grid.colKeys.map((c) => (
                <TableCell key={c} className="text-right">
                  <ViewValueCell value={grid.cell(null, c)} format={fmt} amount={amount} />
                </TableCell>
              ))}
              <TableCell className="text-right">
                <ViewValueCell value={grid.cell(null, null)} format={fmt} amount={amount} />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** A group heading's mark: its value's icon in its colour, else its colour's dot, else the
 *  field's icon. */
function GroupMark<T>({ field, value }: { field: ViewField<T>; value: string }) {
  const color = field.color?.(value);
  const Icon = field.iconOf?.(value);
  if (Icon)
    return (
      <span className="inline-flex" style={color ? { color } : undefined}>
        <Icon className="size-3.5" />
      </span>
    );
  if (color) return <ColorDot color={color} />;
  return <field.icon />;
}
