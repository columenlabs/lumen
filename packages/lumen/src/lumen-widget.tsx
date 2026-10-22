import {
  type MarketWindow,
  OUTLOOK_INDEXES,
  marketWindows,
} from '@columenlabs/lumen-ui-types/market';
// LumenSavedWidget (as blocks; renamed): a page (LumenLayout) is an ordered list of cards, each a third, half, two thirds or the full width.
// A card is the view (LumenView) or a widget. Chart and top-N widgets read every row of the view
// (the table's filter is the table's), narrowed by their own tokens, and work their chart out here in the browser:
// nothing new is fetched; market and price chart widgets read their own data. LumenLayout lays the
// cards out; this file draws the card frame every card shares (its header, ↻ and ⋯ menu), each
// widget, the Edit layout bar, Add widget (Pre-built and Build your own) and Edit widget.
import {
  ALLOCATION_MAX,
  type CustomViewConfig,
  VIEW_CARD_KIND_NAMES,
  type ViewCard,
  type ViewCardKind,
  type ViewFormat,
  type ViewTile,
  type ViewWidget,
  WIDGET_STYLES,
  type WidgetControl,
  controlOn,
  isDollarFormat,
  isRowCard,
  isTableCard,
  trendBuckets,
  viewCardKinds,
  viewCardSchema,
  viewWidgetCatalog,
  widgetStyleId,
  widgetStyleOf,
} from '@columenlabs/lumen-ui-types/views';
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  CandlestickChartIcon,
  ChartLineIcon,
  ChartPieIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  EyeOffIcon,
  FoldVerticalIcon,
  FunnelIcon,
  GripVerticalIcon,
  InfoIcon,
  LayoutGridIcon,
  ListOrderedIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Rows3Icon,
  SparklesIcon,
  SquareIcon,
  TableIcon,
  Trash2Icon,
  TrendingUpIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistant, useAssistantName } from './assistant-context';
import { LumenConfirm } from './confirm';
import { FoldChevron, useFolded, usePageKey } from './fold';
import { GrowthChart } from './growth-chart';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { LumenBoundary } from './lumen-boundary';
import {
  type FilterField,
  LumenTokenizedFilter,
  filterByTokens,
  useLumenFilter,
} from './lumen-filter';
import { useGridCell } from './lumen-grid';
import {
  CardIdProvider,
  type LinkColor,
  LinkDot,
  LinkPicker,
  linkVar,
  useLinks,
} from './lumen-links';
import { LumenSelector } from './lumen-selector';
import {
  LumenFreshness,
  LumenLazy,
  type LumenLoad,
  LumenLoadFooter,
  LumenRefresh,
  LumenStates,
} from './lumen-source';
import { TrendBody } from './lumen-trend';
import {
  AllocationBar,
  Donut,
  Headline,
  RankedBars,
  STACK_MAX,
  StackedBars,
} from './lumen-widget-charts';
import { useHasMarket } from './market/live';
import { useBarsUrl, useLumenChart } from './market/lumen-chart';
import { MarketWidget } from './market/market-widget';
import { maskAmount, useAmountsHidden } from './shell';
import { SummaryCardsEditor, summaryCardIssues } from './summary-cards';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { type ChartConfig, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  dialogBody,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Skeleton } from './ui/skeleton';
import { Switch } from './ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { fieldOptions } from './view-formulas';
import {
  type ViewCellValue,
  type ViewDomain,
  type ViewField,
  computedOf,
  label,
  summaryCash,
} from './view-model';
import { WidgetControlsEditor } from './widget-controls';
import { dateFields } from './widget-settings';

/** Each style's icon, by its id in `WIDGET_STYLES`; a style left out takes its kind's. */
const STYLE_ICONS: Record<string, LucideIcon> = {
  'table:table': TableIcon,
  'table:top_n': ListOrderedIcon,
  'metric:number': SquareIcon,
  'metric:row': LayoutGridIcon,
  'metric:spark': ActivityIcon,
  'metric:tracker': ActivityIcon,
  'allocation:bar': Rows3Icon,
  'allocation:donut': ChartPieIcon,
  'allocation:bar_list': BarChart3Icon,
  'chart:price': ChartLineIcon,
  'chart:growth': TrendingUpIcon,
  'chart:market': CandlestickChartIcon,
};
const KIND_ICONS: Record<ViewCardKind, LucideIcon> = {
  table: TableIcon,
  metric: SquareIcon,
  allocation: ChartPieIcon,
  chart: ActivityIcon,
};
/** A card's icon, from its kind and style. */
export const cardIcon = (c: { kind: ViewCardKind; style?: string }): LucideIcon =>
  STYLE_ICONS[widgetStyleId(c)] ?? KIND_ICONS[c.kind];
/** The widths a card can take, in columns of the desktop's 6. */
export const CARD_COLUMNS = [1, 2, 3, 4, 5, 6] as const;
/** The longest name a widget takes. */
export const CARD_TITLE_MAX = 40;

export const cardTitle = (b: ViewCard, viewName: string) =>
  b.title ??
  (isTableCard(b) ? viewName : b.kind === 'page' ? b.id : (widgetStyleOf(b)?.name ?? b.kind));

/** The domain's fields as the filter box reads them, for a card's own tokens. */
export function cardFilterFields<T>(fields: ViewField<T>[]): FilterField<T>[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    icon: f.icon,
    values:
      f.values ??
      ((row: T) => {
        const v = f.value(row);
        return v === null ? [] : [String(v)];
      }),
    number:
      f.format === 'text'
        ? undefined
        : (row: T) => {
            const v = f.value(row);
            return typeof v === 'number' ? v : null;
          },
  }));
}

// ── Values ─────────────────────────────────────────────────────────────────────────────────────

const MINUS = '−';
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
/** A chart value in short form: $12.3K, −4.1%, 1.2M; masked while Hide amounts is on. */
function short(v: number, format: ViewFormat, hidden: boolean) {
  if (hidden) return maskAmount('0');
  const sign = v < 0 ? MINUS : '';
  const abs = Math.abs(v);
  if (format === 'percent' || format === 'weight') return `${sign}${abs.toFixed(1)}%`;
  if (isDollarFormat(format)) return `${sign}$${COMPACT.format(abs)}`;
  return `${sign}${COMPACT.format(abs)}`;
}
/** A chart value in full, for tooltips: $491,712.34, −4.1%; masked while Hide amounts is on. */
function exact(v: number, format: ViewFormat, hidden: boolean) {
  if (hidden) return maskAmount('0');
  const sign = v < 0 ? MINUS : '';
  const abs = Math.abs(v);
  if (format === 'percent' || format === 'weight') return `${sign}${abs.toFixed(2)}%`;
  const n = abs.toLocaleString('en-US', {
    maximumFractionDigits: format === 'rounded' || format === 'price_rounded' ? 0 : 2,
    useGrouping: format !== 'integer',
  });
  return `${sign}${isDollarFormat(format) ? '$' : ''}${n}`;
}
const pct = (v: number, total: number) => `${total ? ((v / total) * 100).toFixed(1) : '0.0'}%`;

/** One colour per name, by size, so the largest never share one; Cash is always grey. */
const PALETTE = [1, 2, 3, 4, 5, 6, 9, 7, 10].map((i) => `var(--chart-${i})`);
const colorOf = (name: string, i: number) =>
  /cash/i.test(name) ? 'var(--chart-8)' : (PALETTE[i % PALETTE.length] ?? 'var(--chart-1)');

/** `value` summed by `by` over the rows, largest first; rows with no `by` read as —. */
function sumBy<T>(
  rows: T[],
  by: ViewField<T>,
  value: ViewField<T>,
  read: (f: ViewField<T>, r: T) => ViewCellValue,
) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = read(value, r);
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const k = label(read(by, r));
    m.set(k, (m.get(k) ?? 0) + v);
  }
  return [...m].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
}

// ── Widget bodies ──────────────────────────────────────────────────────────────────────────────

const Empty = ({ children = 'Nothing to show for these rows.' }: { children?: ReactNode }) => (
  <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
);

/** A chart, top-N or market widget's body over `rows` (the view's shown rows). */
export function WidgetBody<T>({
  card,
  domain,
  rows,
  fields,
  merge,
  onDetails,
}: {
  card: ViewCard;
  domain: ViewDomain<T>;
  /** Every row of the view (not the table's filter). */
  rows: T[];
  fields: FilterField<T>[];
  /** Folds rows the way the view's flat table does (one line per symbol). */
  merge: (rows: T[]) => T[];
  onDetails?: (row: T) => void;
}) {
  const hidden = useAmountsHidden();
  const own = useMemo(() => filterByTokens(rows, fields, card.filter), [rows, fields, card.filter]);
  // Shares and formulas read against every shown row, not just the card's.
  const computed = useMemo(() => computedOf(domain, rows, null), [domain, rows]);
  const read = computed.value;
  const field = (k: string) => domain.fields.find((f) => f.key === k);
  if (card.kind === 'page') return null;
  if (card.kind === 'chart' && card.style === 'market')
    return <MarketWidget symbols={card.symbols} style={card.layout} />;
  if ('date' in card) {
    const date = field(card.date);
    const values = card.values.map(field).filter((f): f is ViewField<T> => !!f);
    if (!date || !values.length) return <Empty>This widget's fields are not in this view.</Empty>;
    return (
      <TrendBody
        style={card.style}
        date={date}
        values={values}
        bucket={card.bucket}
        agg={card.agg}
        rows={own}
        read={read}
        legend={controlOn(card, 'legend')}
      />
    );
  }
  if (card.kind === 'table' && card.style === 'top_n') {
    const sort = field(card.sort);
    const cols = card.columns.map(field).filter((f): f is ViewField<T> => !!f);
    if (!sort || !cols.length) return <Empty>This widget's fields are not in this view.</Empty>;
    const top = merge(own)
      .map((r) => ({ r, v: read(sort, r) }))
      .filter((x) => x.v !== null)
      .sort((a, b) => {
        const d =
          typeof a.v === 'number' && typeof b.v === 'number'
            ? a.v - b.v
            : String(a.v).localeCompare(String(b.v));
        return card.desc ? -d : d;
      })
      .slice(0, card.n);
    if (!top.length) return <Empty />;
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((f) => (
              <TableHead key={f.key} className={f.format === 'text' ? '' : 'text-right'}>
                {f.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {top.map(({ r }) => (
            <TableRow
              key={domain.rowKey(r)}
              className={onDetails ? 'cursor-pointer' : undefined}
              onClick={onDetails && (() => onDetails(r))}
            >
              {cols.map((f) => (
                <TableCell key={f.key} className={f.format === 'text' ? '' : 'text-right'}>
                  <WidgetValue value={read(f, r)} field={f} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  if (card.kind !== 'allocation') return null;
  const by = field(card.by);
  const value = field(card.value);
  if (!by || !value) return <Empty>This widget's fields are not in this view.</Empty>;
  const masked = hidden && !!value.amount;
  const fmt = (v: number) => short(v, value.format, masked);
  const sums = sumBy(own, by, value, read);
  // An empty value reads "No sector", not "—"; counts say "1 sector", "3 sectors".
  const shown = (name: string, f: { label: string }) =>
    name === label(null) ? `No ${f.label.toLowerCase()}` : name;
  const count = (n: number) => `${n} ${by.label.toLowerCase()}${n === 1 ? '' : 's'}`;
  if (card.style === 'bar_list') {
    const bars = sums
      .filter((x) => x.v !== 0)
      .sort((a, b) => (card.desc ? b.v - a.v : a.v - b.v))
      .slice(0, card.n);
    if (!bars.length) return <Empty />;
    const net = bars.reduce((t, x) => t + x.v, 0);
    const abs = bars.reduce((t, x) => t + Math.abs(x.v), 0);
    const up = bars.filter((b) => b.v > 0).length;
    // Split by: each bar's parts by a text field, its 5 largest overall coloured as a donut of
    // that field colours them, the rest Other.
    const stackF = !card.signed && card.stack ? field(card.stack) : undefined;
    const stack = (() => {
      if (!stackF || stackF.key === by.key) return null;
      const order = sumBy(own, stackF, value, read).filter((x) => x.v > 0);
      // A split needs two known parts; with fewer (no sectors set yet) plain bars read better.
      if (order.filter((x) => x.name !== label(null)).length < 2) return null;
      const top = order.slice(0, STACK_MAX).map((x) => x.name);
      const parts = [...top, ...(order.length > STACK_MAX ? ['Other'] : [])].map((name, i) => ({
        name: shown(name, stackF),
        key: `p${i}`,
        fill: name === 'Other' ? 'var(--muted-foreground)' : colorOf(name, i),
      }));
      const keyOf = (n: string) => `p${top.includes(n) ? top.indexOf(n) : top.length}`;
      const rows = bars.map((b) => {
        const r: Record<string, number | string> = { name: shown(b.name, by), total: b.v };
        for (const x of own) {
          if (label(read(by, x)) !== b.name) continue;
          const v = read(value, x);
          if (typeof v !== 'number' || v <= 0) continue;
          const k = keyOf(label(read(stackF, x)));
          r[k] = ((r[k] as number) ?? 0) + v;
        }
        return r;
      });
      return { rows, parts };
    })();
    return (
      <>
        <Headline
          value={`${card.signed && net > 0 ? '+' : ''}${fmt(net)}`}
          tone={card.signed ? (net >= 0 ? 'gain' : 'loss') : undefined}
          caption={
            card.signed
              ? `net · ${up} up, ${bars.length - up} down`
              : `${value.label.toLowerCase()} across ${count(bars.length)}`
          }
        />
        {stack ? (
          <StackedBars
            rows={stack.rows}
            parts={stack.parts}
            fmt={fmt}
            exact={(v) => exact(v, value.format, masked)}
            share={(v) => pct(v, abs)}
          />
        ) : (
          <RankedBars
            id={card.id}
            items={bars.map((b, i) => ({
              ...b,
              name: shown(b.name, by),
              fill: card.signed ? (b.v >= 0 ? 'var(--gain)' : 'var(--loss)') : colorOf(b.name, i),
            }))}
            signed={card.signed}
            fmt={fmt}
            share={(v) => pct(Math.abs(v), abs)}
          />
        )}
      </>
    );
  }
  const parts = sums.filter((x) => x.v > 0).map((x) => ({ ...x, name: shown(x.name, by) }));
  const total = parts.reduce((t, x) => t + x.v, 0);
  const known = parts.filter((x) => x.name !== shown(label(null), by)).length;
  if (!total) return <Empty />;
  // Donut: `max` slices in all, Other the last. Allocation: the largest `max`, then Other.
  const keep = card.style === 'donut' ? card.max - 1 : (card.max ?? ALLOCATION_MAX);
  const limit = card.style === 'donut' ? card.max : keep;
  const rest = parts.length > limit ? parts.slice(keep) : [];
  const slices = rest.length
    ? [...parts.slice(0, keep), { name: 'Other', v: rest.reduce((t, x) => t + x.v, 0) }]
    : parts;
  const colored = slices.map((s, i) => ({
    ...s,
    key: `s${i}`,
    fill: s.name === 'Other' ? 'var(--muted-foreground)' : colorOf(s.name, i),
  }));
  if (card.style === 'donut')
    return (
      <Donut
        items={colored}
        total={total}
        fmt={fmt}
        share={(v) => pct(v, total)}
        caption={count(known)}
        legend={controlOn(card, 'legend')}
      />
    );
  // Allocation: one stacked bar, no legend; each wide slice names itself, and hovering a slice
  // gives its exact value and share, Other its 10 largest. The tooltip may leave the card.
  const config: ChartConfig = Object.fromEntries(
    colored.map((s) => [s.key, { label: s.name, color: s.fill }]),
  );
  const line = (name: string, v: number, fill?: string) => (
    <span key={name} className="flex w-full items-center gap-2">
      {fill && <span className="size-2 shrink-0 rounded-full" style={{ background: fill }} />}
      <span className="truncate font-medium">{name}</span>
      <span className="num ml-auto pl-3 whitespace-nowrap">
        {exact(v, value.format, masked)} · {pct(v, total)}
      </span>
    </span>
  );
  return (
    <div className="py-1">
      <Headline
        value={fmt(total)}
        caption={`${count(known)} · largest ${colored[0]?.name ?? ''} ${pct(colored[0]?.v ?? 0, total)}`}
      />
      <AllocationBar
        items={colored}
        total={total}
        config={config}
        share={(v) => pct(v, total)}
        tooltip={
          <ChartTooltip
            cursor={false}
            shared={false}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 50 }}
            content={
              <ChartTooltipContent
                hideLabel
                className="min-w-48 max-w-72"
                formatter={(v, name) => {
                  const s = colored.find((c) => c.key === name);
                  if (s?.name !== 'Other') return line(s?.name ?? String(name), Number(v), s?.fill);
                  return (
                    <span className="flex w-full flex-col gap-1">
                      {line(`Other (${rest.length})`, Number(v), s.fill)}
                      <span className="flex flex-col gap-0.5 border-t pt-1 text-muted-foreground">
                        {rest.slice(0, 10).map((x) => line(x.name, x.v))}
                        {rest.length > 10 && <span>+{rest.length - 10} more</span>}
                      </span>
                    </span>
                  );
                }}
              />
            }
          />
        }
      />
    </div>
  );
}

/** A top-N cell as its field reads, short where the field is short. */
function WidgetValue<T>({ value, field }: { value: ViewCellValue; field: ViewField<T> }) {
  const hidden = useAmountsHidden() && !!field.amount;
  if (value === null) return <span className="num text-muted-foreground">—</span>;
  if (typeof value === 'string')
    return <span className="whitespace-nowrap">{hidden ? maskAmount(value) : value}</span>;
  const signed =
    field.format === 'signed' || field.format === 'percent' || field.format === 'price_signed';
  const text =
    field.format === 'integer'
      ? `${value < 0 ? MINUS : ''}${Math.abs(value).toFixed(0)}`
      : field.format === 'percent' || field.format === 'weight'
        ? `${value < 0 ? MINUS : signed && value > 0 ? '+' : ''}${Math.abs(value).toFixed(1)}%`
        : `${value < 0 ? MINUS : signed && value > 0 ? '+' : ''}${isDollarFormat(field.format) ? '$' : ''}${
            field.compact || field.format === 'compact'
              ? COMPACT.format(Math.abs(value))
              : Math.abs(value).toLocaleString('en-US', {
                  maximumFractionDigits:
                    field.format === 'rounded' || field.format === 'price_rounded' ? 0 : 2,
                })
          }`;
  return (
    <span
      className={cn(
        'num whitespace-nowrap',
        signed && (value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : ''),
      )}
    >
      {hidden ? maskAmount('0') : text}
    </span>
  );
}

// ── The card ───────────────────────────────────────────────────────────────────────────────────

export type CardAction = 'edit' | 'duplicate' | 'up' | 'down' | 'remove';

/** What LumenLayout gives each of its cards: the layout's edit state and the card's place in it. */
export interface CardControls {
  /** The page's layout is being edited. */
  layout: boolean;
  /** The person may change this view (an app view is read-only). */
  editable: boolean;
  first: boolean;
  last: boolean;
  /** A card given its own height by its corner: back to as tall as it draws. */
  onFit?: () => void;
  onAction: (a: CardAction) => void;
  /** A card the page draws itself: it moves and sizes, but has no Edit, Duplicate or Remove. */
  fixed?: boolean;
}

/**
 * The frame every card shares, widget or view: drag handle while
 * the layout is edited, icon, title, a short note, the card's own tools (a view's pager), its ↻ and
 * load time when it has a source, the width switch while editing, and its ⋯ menu. The body sits in
 * a `relative` box so a view's progress bar runs along its top.
 */
/** Wider than this, a card's filter sits in its header line; narrower, on a line of its own. */
const FILTER_INLINE_PX = 720;

/** The header's width, so its filter knows whether it fits on the title's line. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A card's link colour on its frame. */
export interface CardLink {
  color: LinkColor | null;
  onPick: (c: LinkColor | null) => void;
  /** What it follows from other cards' linked chips: `IRA, Roth`. */
  follows?: string;
  /** Its own filter's linked chips (the phone's count beside the funnel). */
  linked?: number;
}

export function LumenWidget({
  id,
  kind,
  icon,
  title,
  note,
  controls,
  tools,
  filter,
  filterCount = 0,
  load,
  rows,
  loadNote,
  pad = true,
  pinned = false,
  compact = false,
  className,
  children,
  link: given,
  help,
  assistant,
  strip,
  shown,
  style,
}: {
  id: string;
  /** Its controls (Edit widget ▸ Controls): Ask the assistant, Refresh, Filter box and
   *  Footer show or hide here; missing keys take the type's default. */
  shown?: ViewCard['controls'];
  /** Its style, where it sets the type (a trend's spark or tracker is a Metric). */
  style?: string;
  /** ⓘ How to read: a few lines on what the card shows and how to read it,
   *  opened from the header. */
  help?: ReactNode;
  /** ✦ Ask the assistant on every card where the assistant answers: what the assistant needs beyond the
   *  card's title to read it ("Tune tn_… of playbook …: read it with tune_read"); false: no button. */
  assistant?: string | false;
  /** Its link colour: the square before the title, what it follows after it,
   *  and how many of its filter's chips are linked. Left out: the page's colour for `id` (every
   *  card carries the square); false: none (a form, with no data to link). */
  link?: CardLink | false;
  /** The card's kind; null for a card a page builds in code (not in the view's config). */
  kind: ViewCardKind | null;
  icon?: LucideIcon;
  title: string;
  note?: ReactNode;
  /** Left out: a card the layout cannot edit. */
  controls?: CardControls;
  /** Buttons before the ↻, e.g. a view's pager. */
  tools?: ReactNode;
  /** The card's own filter (a view's LumenTokenizedFilter and Group): on the title's line
   *  when the header is wide, on a line under it when narrow, behind a funnel button on phone. */
  filter?: ReactNode;
  /** Active filter tokens, the count on the phone's funnel button. */
  filterCount?: number;
  /**
   * A line under the header and filter (widget anatomy zone 4): what the card
   * follows, or an offer such as Link to Holdings by Symbol.
   */
  strip?: ReactNode;
  /** The card's source: its ↻, and its load time below the body. */
  load?: LumenLoad;
  rows?: number;
  /** Said in the load line instead of rows, e.g. "from the view's rows". */
  loadNote?: string;
  pad?: boolean;
  /** The header stays in sight while a wide view scrolls sideways under it. */
  pinned?: boolean;
  /** A LumenCard (one number): its title is a small label over the number, no rule under it. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [removing, setRemoving] = useState(false);
  const cell = useGridCell();
  const links = useLinks();
  const link =
    given === false
      ? undefined
      : (given ??
        (links ? { color: links.colorOf(id), onPick: (c) => links.setColor(id, c) } : undefined));
  const Icon = icon ?? (kind ? cardIcon({ kind, style }) : LayoutGridIcon);
  const layout = !!controls?.layout;
  // A small card (one number) shows only its title until the page is in Edit layout.
  const bare = compact && !layout;
  const on = (k: WidgetControl) => kind === null || controlOn({ kind, style, controls: shown }, k);
  // A page's own card (kind null) says it is a table when it draws one (`style` table).
  const styleId = kind
    ? widgetStyleId({ kind, style })
    : style === 'table'
      ? 'table:table'
      : 'page';
  const table = kind === 'table' && style === 'table';
  const ask = useAskAssistant(id, title, on('ask') ? assistant : false, styleId);
  const assistantName = useAssistantName();
  // A card folds to its header on its chevron only (a click elsewhere on the
  // header does nothing); the browser remembers it per page. Never while arranging cards.
  const [stored, setFolded] = useFolded(`card:${usePageKey()}:${id}`);
  // Header off (Edit widget ▸ Controls): the card is its body alone, a clean
  // card; Edit layout shows every header, so its link colour and menu stay in reach there.
  const headerOff = !compact && !on('header');
  const headless = headerOff && !layout;
  const folded = stored && !layout && !bare && !headless;
  const toggle = () => setFolded(!folded);
  const own = kind !== null;
  const mobile = useIsMobile();
  const [head, headWidth] = useWidth();
  const [filterOpen, setFilterOpen] = useState(false);
  const showFilter = !!filter && !layout && !folded && on('filter');
  const inline = showFilter && !mobile && headWidth >= FILTER_INLINE_PX;
  const below = showFilter && !inline && (!mobile || filterOpen);
  // A row of numbers with no header drops its own frame: its cards sit on the page.
  const flat = headless && styleId === 'metric:row';
  return (
    <CardIdProvider id={id}>
      <Card
        data-slot="lumen-card"
        data-card={id}
        data-card-title={title}
        data-card-kind={styleId}
        className={cn(
          // A border, not the card's ring: a ring draws outside the box, so the page's scroller
          // clipped it wherever a card touched its edge (the top row's top line).
          'h-full gap-0 border border-foreground/10 py-0 ring-0',
          folded && 'h-auto',
          // The allocation bar's tooltip reaches past its short card, over the cards below.
          styleId === 'allocation:bar' ? 'relative overflow-visible hover:z-20' : 'overflow-clip',
          // The edit outline sits inside the card, over its pinned rows: an outer one is clipped by
          // the page's scroller, and an inset outline paints under the sticky header and group rows.
          layout &&
            "relative after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-[inherit] after:border-2 after:border-primary/40 after:border-dashed after:content-['']",
          flat && 'border-0 bg-transparent shadow-none',
          className,
        )}
      >
        {!headless && (
          <div
            ref={head}
            className={cn(
              'flex shrink-0 items-center gap-2 px-3',
              compact ? 'h-8' : 'h-10 border-b',
              (folded || below) && 'border-b-0',
              pinned && 'sticky left-0 w-(--view-w) max-w-full',
            )}
          >
            {layout && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="lumen-drag -ml-1 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
                aria-label={`Drag ${title}`}
              >
                <GripVerticalIcon />
              </Button>
            )}
            {link && !bare && (
              <LinkPicker color={link.color} onPick={link.onPick} label={title} className="-mr-1" />
            )}
            {!compact && <Icon className="size-4 shrink-0 text-muted-foreground" />}
            <span
              className={cn(
                'truncate',
                compact ? 'text-xs text-muted-foreground' : 'text-sm font-semibold',
              )}
            >
              {title}
            </span>
            {link?.color && link.follows && !folded && (
              <span
                className="min-w-0 shrink truncate text-xs"
                style={{ color: linkVar(link.color) }}
                title={`Follows ${link.follows}`}
              >
                · {link.follows}
              </span>
            )}
            {layout && headerOff && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="shrink-0 gap-1 text-muted-foreground">
                    <EyeOffIcon /> Header off
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  Shown only in Edit layout. Change it in Edit widget ▸ Controls.
                </TooltipContent>
              </Tooltip>
            )}
            {!layout && !bare && (
              <FoldChevron folded={folded} label={title} onToggle={toggle} className="-ml-1" />
            )}
            {folded && rows != null && (
              <span className="shrink-0 text-xs text-muted-foreground num">
                {rows.toLocaleString()} {rows === 1 ? 'row' : 'rows'}
              </span>
            )}
            {inline && (
              <div data-card-filter className="flex min-w-40 max-w-xl flex-1 items-center gap-2">
                {filter}
              </div>
            )}
            {note && !layout && !folded && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {note}
              </span>
            )}
            <span className={cn('ml-auto flex shrink-0 items-center gap-1', bare && 'hidden')}>
              {!layout && load?.updated && <LumenFreshness load={load} />}
              {!layout && !folded && tools}
              {showFilter && mobile && link?.color && !!link.linked && (
                <span
                  className="num flex items-center gap-1 text-xs text-muted-foreground"
                  title={`${link.linked} linked`}
                >
                  <LinkDot color={link.color} className="size-2" />
                  {link.linked}
                </span>
              )}
              {showFilter && mobile && (
                <span className="relative">
                  <IconButton
                    icon={FunnelIcon}
                    label={filterOpen ? 'Hide filter' : 'Filter'}
                    aria-expanded={filterOpen}
                    className={cn(filterOpen && 'text-primary')}
                    onClick={() => setFilterOpen(!filterOpen)}
                  />
                  {filterCount > 0 && (
                    <Badge className="num pointer-events-none absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]">
                      {filterCount}
                    </Badge>
                  )}
                </span>
              )}
              {!layout && !folded && help && <CardHelp title={title}>{help}</CardHelp>}
              {!layout && load && on('refresh') && (
                <LumenRefresh load={load} label={`Refresh ${title}`} />
              )}
              {(controls?.editable || (!layout && (ask || load?.editScript))) && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <IconButton icon={MoreHorizontalIcon} label={`${title} menu`} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {ask && !layout && (
                      <DropdownMenuItem onSelect={ask}>
                        <SparklesIcon /> Ask {assistantName}
                      </DropdownMenuItem>
                    )}
                    {load?.editScript && !layout && (
                      <DropdownMenuItem onSelect={load.editScript}>
                        <CodeIcon /> Script
                      </DropdownMenuItem>
                    )}
                    {(ask || load?.editScript) && !layout && controls?.editable && (
                      <DropdownMenuSeparator />
                    )}
                    {controls?.editable && (
                      <>
                        {!controls.fixed && (
                          <>
                            <DropdownMenuItem onSelect={() => controls.onAction('edit')}>
                              <PencilIcon /> Edit widget
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!own}
                              onSelect={() => controls.onAction('duplicate')}
                            >
                              <CopyIcon /> Duplicate
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem
                          disabled={controls.first}
                          onSelect={() => controls.onAction('up')}
                        >
                          <ArrowUpIcon /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={controls.last}
                          onSelect={() => controls.onAction('down')}
                        >
                          <ArrowDownIcon /> Move down
                        </DropdownMenuItem>
                        {controls.onFit && (
                          <DropdownMenuItem onSelect={controls.onFit}>
                            <FoldVerticalIcon /> Fit height
                          </DropdownMenuItem>
                        )}
                        {!controls.fixed && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-muted-foreground focus:text-destructive"
                              onSelect={() => setRemoving(true)}
                            >
                              <Trash2Icon /> Remove
                            </DropdownMenuItem>
                          </>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          </div>
        )}
        {below && !headless && (
          <div
            data-card-filter
            className={cn(
              'flex items-center gap-2 border-b px-3 pb-2',
              pinned && 'sticky left-0 w-(--view-w) max-w-full',
            )}
          >
            {filter}
          </div>
        )}
        {strip && !layout && !folded && !headless ? (
          <div
            data-card-strip
            className={cn(
              'flex min-w-0 items-center gap-2 border-b px-3 py-1.5 empty:hidden',
              pinned && 'sticky left-0 w-(--view-w) max-w-full',
            )}
          >
            {strip}
          </div>
        ) : null}
        <div
          hidden={folded}
          className={cn(
            'relative min-w-0',
            // On the grid a card fills its cell: with a height of its own its body scrolls; one as
            // tall as it draws keeps its body's height, so the grid can measure it.
            !cell ? 'flex-1' : cell.fixed && 'min-h-0 flex-1 overflow-auto',
            pad && !table && !flat && (compact ? 'px-3 pb-3' : 'p-3'),
          )}
        >
          <LumenBoundary where={id}>{children}</LumenBoundary>
        </div>
        {!layout && !folded && load && on('footer') && (
          // The load line sits at the card's foot, whatever the body's height.
          <div
            className={cn('mt-auto shrink-0', pinned && 'sticky left-0 w-(--view-w) max-w-full')}
          >
            <LumenLoadFooter load={load} rows={rows} note={loadNote} />
          </div>
        )}
        {controls && (
          <LumenConfirm
            open={removing}
            onOpenChange={setRemoving}
            title={`Remove ${title}?`}
            description={table ? 'Add widget brings a table back.' : 'Add widget brings it back.'}
            action="Remove"
            onConfirm={() => controls.onAction('remove')}
          />
        )}
      </Card>
    </CardIdProvider>
  );
}

/**
 * One widget in its card. Widgets over the view's rows (tiles,
 * charts, top N) load with the view: its states, its ↻. Market and price chart widgets read their own
 * data and start once their card scrolls into view.
 */
export function LumenSavedWidget<T>({
  widget,
  title,
  domain,
  rows,
  fields,
  merge,
  onDetails,
  load,
  tiles,
  controls,
  link,
}: {
  widget: ViewWidget;
  /** Its link colour and what it follows (the layout narrows `rows` by it). */
  link?: CardLink;
  title: string;
  domain: ViewDomain<T>;
  /** Every row of the view (not the table's filter). */
  rows: T[];
  fields: FilterField<T>[];
  /** Folds rows the way the view's flat table does (one line per symbol). */
  merge: (rows: T[]) => T[];
  onDetails?: (row: T) => void;
  /** The view's rows' loading state, for widgets drawn from them. */
  load?: LumenLoad;
  /** The tiles widget's tiles, drawn by the layout. */
  tiles?: ReactNode;
  controls?: CardControls;
}) {
  const row = isRowCard(widget);
  const number = widget.kind === 'metric' && 'tile' in widget;
  const head = row ? domain.tilesHead?.(rows) : undefined;
  const compact = number;
  const frame = {
    id: widget.id,
    kind: widget.kind,
    title: head?.title ?? title,
    compact,
    controls,
    link,
    shown: widget.controls,
    style: widget.style,
    note:
      head?.note ??
      (widget.filter.length
        ? widget.filter.map((t) => `${t.not ? 'not ' : ''}${t.value}`).join(', ')
        : undefined),
    tools: head?.tools,
  };
  if (widget.kind === 'chart' && widget.style === 'price')
    return <ChartCard widget={widget} frame={frame} />;
  if (widget.kind === 'chart' && widget.style === 'growth')
    return <GrowthCard widget={widget} frame={frame} domain={domain} rows={rows} load={load} />;
  if (widget.kind === 'chart' && widget.style === 'market')
    return (
      <LumenWidget {...frame}>
        {/* A live market card reads its own feed: it starts once scrolled into view. */}
        <LumenLazy>
          <MarketWidget symbols={widget.symbols} style={widget.layout} />
        </LumenLazy>
      </LumenWidget>
    );
  const body =
    row || number ? (
      tiles
    ) : (
      <WidgetBody
        card={widget}
        domain={domain}
        rows={rows}
        fields={fields}
        merge={merge}
        onDetails={onDetails}
      />
    );
  return (
    <LumenWidget
      {...frame}
      pad={widgetStyleId(widget) !== 'table:top_n'}
      load={load}
      loadNote="from the view's rows"
    >
      {load ? (
        // A failed view says so once, in its table; its widgets just wait for its rows.
        <LumenStates
          load={{ ...load, error: null }}
          empty={load.error ? <Empty>Shows once the view's rows load.</Empty> : undefined}
          kind="widget"
          skeleton={row || number ? body : <Skeleton className="h-40 w-full" />}
        >
          {body}
        </LumenStates>
      ) : (
        body
      )}
    </LumenWidget>
  );
}

/** Growth of $1: the domain's lines for the shown rows, its bands and markers. */
function GrowthCard<T>({
  widget,
  frame,
  domain,
  rows,
  load,
}: {
  widget: Extract<ViewWidget, { kind: 'chart'; style: 'growth' }>;
  frame: Omit<Parameters<typeof LumenWidget>[0], 'children'>;
  domain: ViewDomain<T>;
  rows: T[];
  load?: LumenLoad;
}) {
  const g = domain.growth;
  const lines = useMemo(() => g?.lines(rows) ?? [], [g, rows]);
  const bands = useMemo(() => g?.bands?.(rows) ?? [], [g, rows]);
  const loading = !!load?.loading || !!g?.loading;
  return (
    <LumenWidget
      {...frame}
      tools={g?.tools}
      note={g?.note ?? frame.note}
      load={load}
      rows={lines.length}
    >
      {!g ? (
        <Empty>This view has no curves to draw.</Empty>
      ) : loading && !lines.length ? (
        <Skeleton className="h-64 w-full" />
      ) : lines.length ? (
        <GrowthChart
          lines={lines}
          scale={widget.scale}
          bands={bands}
          markers={g.markers}
          ytd={false}
          className="aspect-auto h-64 w-full md:h-80"
        />
      ) : (
        <Empty>No lines yet: run a row to draw it.</Empty>
      )}
    </LumenWidget>
  );
}

/** The price chart widget: LumenChart in a card, with its own source, ↻ and load time. A change to
 *  its symbol, window or type starts the chart over. */
function ChartCard(props: {
  widget: Extract<ViewWidget, { kind: 'chart'; style: 'price' }>;
  frame: Omit<Parameters<typeof LumenWidget>[0], 'children'>;
}) {
  const { symbol, window, type } = props.widget;
  return <ChartCardBody key={`${symbol}|${window}|${type}`} {...props} />;
}

function ChartCardBody({
  widget,
  frame,
}: {
  widget: Extract<ViewWidget, { kind: 'chart'; style: 'price' }>;
  frame: Omit<Parameters<typeof LumenWidget>[0], 'children'>;
}) {
  const chart = useLumenChart({
    symbols: [widget.symbol],
    window: widget.window,
    type: widget.type,
    indicators: [],
    lazy: true,
    windows: controlOn(widget, 'window'),
  });
  return (
    <div ref={chart.ref} className="h-full">
      <LumenWidget {...frame} load={chart.noDesk ? undefined : chart.load} rows={chart.rows}>
        <div className="flex flex-col gap-3">{chart.element}</div>
      </LumenWidget>
    </div>
  );
}

/** The page header's layout slot while a page's layout is edited: Add widget, Cancel and Save,
 *  icons only (in the header, not a bar of their own: Cancel
 *  drops the changes and leaves, in place of Reset). */
export function LayoutActions({
  onCancel,
  onAdd,
  onSave,
  onReset,
}: {
  onCancel: () => void;
  onAdd: () => void;
  onSave: () => void;
  /** A built-in page the person changed: puts it back to its default. */
  onReset?: () => void;
}) {
  return (
    <>
      {onReset && (
        <LumenConfirm
          title="Reset this page to its default?"
          description="Your changes to its widgets, columns and filters go, and the built-in page comes back."
          action="Reset to default"
          destructive={false}
          onConfirm={onReset}
        >
          <IconButton icon={RotateCcwIcon} label="Reset to default" />
        </LumenConfirm>
      )}
      <IconButton icon={PlusIcon} label="Add widget" onClick={onAdd} />
      <IconButton icon={XIcon} label="Cancel layout changes" onClick={onCancel} />
      <IconButton icon={CheckIcon} label="Save layout" variant="default" onClick={onSave} />
    </>
  );
}

/** The chip beside the title while a page's layout is edited. */
export function LayoutChip() {
  return (
    <Badge variant="secondary" className="font-normal">
      <PencilIcon /> Editing layout
    </Badge>
  );
}

// ── Add and edit ───────────────────────────────────────────────────────────────────────────────

/** An id not yet used in `cards`: `base`, else `base_2`, `base_3`... */
export function freeId(cards: ViewCard[], base: string) {
  const taken = new Set(cards.map((b) => b.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

const isText = <T,>(f: ViewField<T>) => f.format === 'text' && !f.render;
const isNumber = <T,>(f: ViewField<T>) => f.format !== 'text' && !f.render;
/** A new card of a style (`kind:style`) with sensible fields of this domain. */
export function draftOf<T>(styleId: string, domain: ViewDomain<T>, cards: ViewCard[]): ViewCard {
  const [kind = 'table', style = 'table'] = styleId.split(':');
  const texts = domain.fields.filter(isText);
  const nums = domain.fields.filter(isNumber);
  const by = (texts.find((f) => f.groupable) ?? texts[0])?.key ?? '';
  const value =
    (
      nums.find((f) => f.key === 'market_value' || f.key === 'value') ??
      nums.find((f) => f.amount) ??
      nums[0]
    )?.key ?? '';
  const base = { id: freeId(cards, style), title: null, filter: [], kind, style };
  const trend = { date: dateFields(domain)[0]?.key ?? '', values: [value] };
  switch (styleId) {
    case 'table:top_n':
      return viewCardSchema.parse({
        ...base,
        sort: value,
        columns: [texts[0]?.key, value].filter(Boolean),
        w: 3,
      });
    case 'table:table':
    case 'metric:row':
      return viewCardSchema.parse(base);
    case 'chart:price':
      return viewCardSchema.parse({ ...base, symbol: 'SPX', w: 3 });
    case 'chart:growth':
      return viewCardSchema.parse({ ...base, w: 6 });
    case 'chart:market':
      return viewCardSchema.parse({ ...base, symbols: [...OUTLOOK_INDEXES], layout: 'lines' });
    case 'metric:number':
    case 'metric:progress_bar':
    case 'metric:progress_circle': {
      const f = nums.find((x) => x.key === value);
      return viewCardSchema.parse({
        ...base,
        tile: { key: 'tile_1', label: f?.label ?? 'Card', field: value, agg: 'sum' },
      });
    }
    case 'allocation:bar':
    case 'allocation:donut':
    case 'allocation:bar_list':
      return viewCardSchema.parse({ ...base, by, value, w: style === 'bar' ? 6 : 2 });
    default:
      return viewCardSchema.parse({ ...base, ...trend });
  }
}

/** Whether the app can draw a style: Market needs its live feed, Price its history route, Growth
 *  of $1 a domain that draws curves. */
export function useOffered<T>(domain: ViewDomain<T>) {
  const market = useHasMarket();
  const charts = !!useBarsUrl();
  return (styleId: string) =>
    styleId === 'chart:market'
      ? market
      : styleId === 'chart:price'
        ? charts
        : styleId === 'chart:growth'
          ? !!domain.growth
          : true;
}

function PickCard({
  icon: Icon,
  name,
  note,
  added,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  name: string;
  note: string;
  added?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-auto justify-start gap-3 p-3 text-left font-normal whitespace-normal"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </span>
      {added && (
        <Badge variant="secondary" className="ml-auto font-normal">
          <CheckIcon /> Added
        </Badge>
      )}
    </Button>
  );
}

/** Add widget: the domain's pre-built widgets, or a kind to build. */
export function AddWidgetDialog<T>({
  open,
  onOpenChange,
  domain,
  cards,
  onAdd,
  onBuild,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  domain: ViewDomain<T>;
  cards: ViewCard[];
  /** Adds a ready card (a pre-built widget, or the view's tiles or the view itself). */
  onAdd: (card: ViewCard) => void;
  /** Opens Edit widget on a new card of a kind. */
  onBuild: (card: ViewCard) => void;
}) {
  const catalog = viewWidgetCatalog[domain.id] ?? [];
  const keys = new Set(domain.fields.map((f) => f.key));
  const hasRow = cards.some(isRowCard);
  const full = cards.length >= 12;
  const offered = useOffered(domain);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add widget</DialogTitle>
          <DialogDescription>
            Widgets use this view's rows and their own filter
            {full ? '. A page holds 12 cards at most.' : '.'}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={catalog.length ? 'prebuilt' : 'own'}>
          <TabsList>
            <TabsTrigger value="prebuilt">
              <PackageIcon />
              Pre-built
            </TabsTrigger>
            <TabsTrigger value="own">
              <WrenchIcon />
              Build your own
            </TabsTrigger>
          </TabsList>
          <TabsContent value="prebuilt" className={dialogBody}>
            {catalog.length ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {catalog.map((it) => {
                  const added = cards.some((b) => b.id === it.widget.id);
                  const fits = [
                    ...('by' in it.widget ? [it.widget.by, it.widget.value] : []),
                    ...(it.widget.kind === 'table' && it.widget.style === 'top_n'
                      ? [it.widget.sort, ...it.widget.columns]
                      : []),
                  ].every((k) => keys.has(k));
                  return (
                    <PickCard
                      key={it.widget.id}
                      icon={cardIcon(it.widget)}
                      name={it.name}
                      note={it.note}
                      added={added}
                      disabled={added || full || !fits}
                      onClick={() => onAdd(it.widget)}
                    />
                  );
                })}
              </div>
            ) : (
              <Empty>No pre-built widgets for this view yet: build your own.</Empty>
            )}
          </TabsContent>
          <TabsContent value="own" className={cn(dialogBody, 'flex flex-col gap-4')}>
            {viewCardKinds.map((kind) => {
              const styles = WIDGET_STYLES.filter((w) => w.kind === kind && offered(w.id));
              if (!styles.length) return null;
              return (
                <div key={kind} className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {VIEW_CARD_KIND_NAMES[kind]}
                  </span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {styles.map((w) => {
                      // A table goes on as it is; the page's first row of numbers shows the
                      // view's cards, any other starts empty in Edit widget.
                      const ready = w.id === 'table:table' || (w.id === 'metric:row' && !hasRow);
                      return (
                        <PickCard
                          key={w.id}
                          icon={cardIcon(w)}
                          name={w.name}
                          note={w.note}
                          disabled={full}
                          onClick={() =>
                            ready
                              ? onAdd(draftOf(w.id, domain, cards))
                              : onBuild(
                                  w.id === 'metric:row'
                                    ? viewCardSchema.parse({
                                        ...draftOf(w.id, domain, cards),
                                        tiles: [],
                                      })
                                    : draftOf(w.id, domain, cards),
                                )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** A page's cards after `action` on card `i`, or null for Edit (the caller opens a dialog). */
export function cardsAfter(cards: ViewCard[], i: number, action: CardAction) {
  const b = cards[i];
  if (!b || action === 'edit') return null;
  const next = [...cards];
  if (action === 'remove') next.splice(i, 1);
  if (action === 'duplicate')
    next.splice(i + 1, 0, { ...b, id: freeId(cards, b.id.replace(/_\d+$/, '')) });
  // Moving up or down swaps places with the card before or after it in reading order.
  const swap = (a: number, c: number) => {
    const A = next[a] as ViewCard;
    const C = next[c] as ViewCard;
    next[a] = { ...C, x: A.x, y: A.y, phone: A.phone };
    next[c] = { ...A, x: C.x, y: C.y, phone: C.phone };
  };
  if (action === 'up' && i > 0) swap(i - 1, i);
  if (action === 'down' && i < next.length - 1) swap(i, i + 1);
  if (action === 'duplicate') {
    const { x: _x, y: _y, phone: _p, ...copy } = next[i + 1] as ViewCard;
    next[i + 1] = copy as ViewCard;
  }
  return next;
}

export type { CustomViewConfig };

/** ⓘ How to read: the card's own few lines on what it shows and what to look for. */
function CardHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton icon={InfoIcon} label={`How to read ${title}`} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="mb-1.5 font-medium">How to read {title}</p>
        <div className="flex flex-col gap-1.5 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Ask the assistant, the card's ⋯ menu on every card: opens the panel pointed at this
 * card with a suggested question in the composer, which the person edits and sends. Reading charts
 * and verdicts is judgement, so the question asks for Bolt, the tier the assistant calls in for it.
 */
function useAskAssistant(
  id: string,
  title: string,
  hint: string | false | undefined,
  card: string,
) {
  const z = useAssistant();
  if (!z?.ready || hint === false) return null;
  return () => {
    const where = typeof document === 'undefined' ? undefined : document.title || undefined;
    z.draft(
      `Explain the "${title}" card on this page: what it shows, what stands out, and what I should do next.${
        hint ? ` ${hint}` : ''
      } Use Bolt to read it.`,
      [{ kind: 'card', label: title, id, card, where }],
    );
  };
}
