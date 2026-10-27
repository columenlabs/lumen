// LumenCoverageMap: the one coverage
// grid every app uses. A page hands it a source of facts (row, period, have, expected, job state) and
// props; the component folds the facts into column blocks and draws them, with its own loading states,
// ↻, zoom chips, legend of the states on screen, and a click that queues a backfill or drills in.
// shadcn has no heatmap, so the grid is a CSS grid of native buttons with shadcn Tooltips.
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Grid3x3Icon, ListPlusIcon, ListXIcon, type LucideIcon } from 'lucide-react';
import {
  type ReactNode,
  isValidElement,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CoverageCell,
  type CoverageJobState,
  CoverageLegend,
  type CoverageLevel,
  CoverageTip,
  coverageLabel,
  coverageLevel,
  firstJobState,
} from './coverage-cells';
import { FoldChevron, useFolds, usePageKey } from './fold';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import { LumenStates, useLumenSource } from './lumen-source';
import { LumenWidget } from './lumen-widget';
import { LumenPager } from './pager';
import { useScrollFade } from './scroll-fade';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** One count at the finest grain a page has: a day (`2026-10-12`) or a month (`2026-10`). */
export interface CoverageFact {
  row: string;
  period: string;
  /** Sessions, days or rows there. */
  have: number;
  /** Sessions, days or rows expected; 0 when nothing is. */
  expected: number;
  /** A backfill's state while it touches this period. */
  state?: CoverageJobState;
  /** Shown in the tooltip, e.g. why a job failed. */
  note?: string;
}

/** A row's own text and summary values; rows show in this order. */
export interface CoverageRow {
  row: string;
  /** Shown instead of `row` (a series code). */
  label?: string;
  /** A muted line under the label. */
  sub?: string;
  /** A small tag after the label (a resolution, `Index`, how far behind). */
  badge?: ReactNode;
  /** Section header the row sits under (with `groupBy`). */
  group?: string;
  first?: string | null;
  last?: string | null;
}

/** What a coverage source returns (map an API response to it with the query's `select`). */
export interface CoverageData {
  facts: CoverageFact[];
  rows: CoverageRow[];
  /** The month still running (`YYYY-MM`): its block shows as This period when complete so far. */
  current?: string;
}

export type CoverageBlock = 'day' | 'week' | 'month' | 'quarter' | 'year';
/** `rows`: what is in hand; `counts`: in hand / expected (`9,212 / 9,712`). */
export type CoverageSummary = 'complete' | 'first' | 'last' | 'rows' | 'counts';

/** A backfill pick: each row with the months its picked blocks cover. */
export type CoveragePick = { row: string; months: string[] }[];

/** `TRaw` is what the query fetches; its `select` maps it to facts. */
export interface LumenCoverageMapProps<TRaw = unknown, TKey extends QueryKey = QueryKey> {
  source: UseQueryOptions<TRaw, Error, CoverageData, TKey>;
  /** Card title; may name the block (`Snapshot days`). */
  title: string;
  icon?: LucideIcon;
  /** Row heading (`Underlying`) and where a row's label links (`/market/$symbol`, its search);
   *  a row with no link (undefined) is plain text. */
  rows: {
    title: string;
    link?: (
      row: string,
    ) => { to: string; params?: Record<string, string>; search?: object } | undefined;
  };
  /** `grid`: rows × time. `months`: the first row's facts, one line per year, Jan to Dec. */
  layout?: 'grid' | 'months';
  /** Column size, the same as a backfill block. */
  block?: CoverageBlock;
  /** Block choices shown as chips. */
  zoom?: CoverageBlock[];
  /** The last N blocks of `block`; other zoom levels show all. Opens scrolled to today either way. */
  window?: number | 'all';
  /** What the tooltip counts. */
  unit?: string;
  /** Right-hand columns; a phone keeps Complete only. */
  summary?: CoverageSummary[];
  /** `backfill`: tap a block, then another to pick the range between (a year's label picks its
   *  year), then the selection bar's buttons. `drill`: a click opens the block. */
  select?: 'backfill' | 'drill';
  /** Months a backfill can take (the source's own limits). */
  selectable?: (row: string, month: string) => boolean;
  onQueue?: (pick: CoveragePick) => Promise<unknown> | undefined;
  /** The selection bar's queue button (`Queue backfill`). */
  queueLabel?: string;
  /** What the months to queue come to, shown after their count (`1,240 messages · about 2 h`). */
  pickNote?: (pick: CoveragePick) => string;
  /** Months already queued that a pick can take back out, with the bar's Remove from queue. */
  removable?: (row: string, month: string) => boolean;
  onRemove?: (pick: CoveragePick) => Promise<unknown> | undefined;
  /** An app's own words for some states, in the tooltip and legend (`{ running: 'Copying' }`). */
  stateLabels?: Partial<Record<CoverageLevel, string>>;
  /** Picks these months as if clicked (pass a new object each time); nothing is queued until the bar's button. */
  preselect?: CoveragePick;
  /** In the selection bar while nothing is picked: quick picks (buttons that set `preselect`). */
  pickTools?: ReactNode;
  /** The drilled block (`2026-09`) and the click that changes it. */
  drilled?: string | null;
  onDrill?: (row: string, period: string) => void;
  /** Section headers by each row's `group`. */
  groupBy?: boolean;
  /** Under the grid at the right, e.g. how the cells are shaded. */
  hint?: ReactNode;
  /** Rows a page (grid layout), with the LumenView pager in the header; off when left out. */
  pageSize?: number;
  /** A source that returns one page of rows: the pager in the header turns its pages. */
  pager?: {
    total: number;
    /** 0-based. */
    page: number;
    size: number;
    sizes?: readonly number[];
    onPage: (page: number) => void;
    onSize: (size: number) => void;
  };
  /** Inputs in the header before the zoom chips. */
  tools?: ReactNode;
  /** Its rows' LumenTokenizedFilter in the card header, and how many chips it holds. */
  filter?: ReactNode;
  filterCount?: number;
  /** Shown in place of the grid when the source has no rows. */
  empty?: ReactNode;
  /** Start the query when the card scrolls into view. */
  lazy?: boolean;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BLOCK_LABEL: Record<CoverageBlock, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

/** Monday of `day`'s week. */
function weekOf(day: string) {
  const t = Date.parse(day);
  const wd = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - wd * 86_400_000).toISOString().slice(0, 10);
}

/** The block a period falls in. Month facts never fold into days or weeks. */
export function blockOf(period: string, block: CoverageBlock): string {
  if (block === 'year') return period.slice(0, 4);
  if (block === 'quarter')
    return `${period.slice(0, 4)}-Q${Math.floor((Number(period.slice(5, 7)) - 1) / 3) + 1}`;
  if (block === 'month' || period.length === 7) return period.slice(0, 7);
  return block === 'week' ? weekOf(period) : period;
}

/** Every month from `from` to `to` (`YYYY-MM`), inclusive. */
function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  while (y * 12 + m <= end) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** `2026-09` → `Sep 2026`, `2026-Q3` → `2026 Q3`, days stay as they are. */
export function blockName(key: string) {
  if (/^\d{4}-\d{2}$/.test(key)) return `${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  return key.replace('-Q', ' Q');
}

function headLabel(key: string, block: CoverageBlock, count: number) {
  if (block === 'year') return `'${key.slice(2, 4)}`;
  if (block === 'quarter') return key.endsWith('Q1') ? key.slice(0, 4) : '';
  if (block === 'month') {
    const m = Number(key.slice(5, 7));
    if (count > 60) return m === 1 ? key.slice(0, 4) : '';
    return m % 3 === 1 ? `${MON[m - 1]} ${key.slice(2, 4)}` : '';
  }
  return key.slice(8, 10) <= '07' && (block === 'week' || key.slice(8, 10) === '01')
    ? `${MON[Number(key.slice(5, 7)) - 1]}`
    : '';
}

const fmtInt = (n: number) => n.toLocaleString('en-US');
const fmtPct = (have: number, expected: number) =>
  expected > 0 ? `${((Math.min(have, expected) / expected) * 100).toFixed(1)}%` : '–';

interface Folded {
  have: number;
  expected: number;
  level: CoverageLevel;
  notes: string[];
  months: string[];
}

/** Facts → `row → block → sums`, and each row's totals over all its facts. */
function fold(data: CoverageData, block: CoverageBlock) {
  const cells = new Map<string, Map<string, Folded & { state: CoverageJobState | null }>>();
  const totals = new Map<string, { have: number; expected: number }>();
  for (const f of data.facts) {
    const key = blockOf(f.period, block);
    const row = cells.get(f.row) ?? new Map();
    cells.set(f.row, row);
    const c = row.get(key) ?? {
      have: 0,
      expected: 0,
      level: 'none' as CoverageLevel,
      notes: [],
      months: [],
      state: null,
    };
    c.have += f.expected > 0 ? Math.min(f.have, f.expected) : f.have;
    c.expected += f.expected;
    c.state = firstJobState(c.state, f.state);
    if (f.note) c.notes.push(f.note);
    const month = f.period.slice(0, 7);
    if (!c.months.includes(month)) c.months.push(month);
    row.set(key, c);
    const t = totals.get(f.row) ?? { have: 0, expected: 0 };
    t.have += f.expected > 0 ? Math.min(f.have, f.expected) : f.have;
    t.expected += f.expected;
    totals.set(f.row, t);
  }
  for (const row of cells.values()) {
    for (const c of row.values()) {
      c.level = coverageLevel(c.have, c.expected, {
        current: !!data.current && c.months.includes(data.current),
        state: c.state,
      });
    }
  }
  return { cells, totals };
}

/** The column blocks: every block from the first fact to today (or the last fact). */
function columns(data: CoverageData, block: CoverageBlock): string[] {
  const periods = data.facts.map((f) => f.period).sort();
  const first = periods[0];
  if (!first) return [];
  if (block === 'day' || block === 'week') {
    return [...new Set(periods.map((p) => blockOf(p, block)))];
  }
  const last = [periods.at(-1) as string, data.current ?? ''].sort().at(-1) as string;
  const out: string[] = [];
  for (const m of monthsBetween(first.slice(0, 7), last.slice(0, 7))) {
    const k = blockOf(m, block);
    if (out.at(-1) !== k) out.push(k);
  }
  return out;
}

const SUMMARY_HEAD: Record<CoverageSummary, string> = {
  complete: 'Complete',
  first: 'First',
  last: 'Last',
  rows: '',
  counts: '',
};
const SUMMARY_WIDTH: Record<CoverageSummary, string> = {
  complete: '5rem',
  first: '6.5rem',
  last: '6.5rem',
  rows: '5rem',
  counts: '9rem',
};
/** In hand / expected; a row with nothing expected shows only what it has. */
const fmtCounts = (have: number, expected: number) =>
  expected > 0 ? `${fmtInt(have)} / ${fmtInt(expected)}` : fmtInt(have);

/** A grid-shaped skeleton: label column plus empty cells, so nothing jumps when data lands. */
function GridSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-[5px] py-1">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-16 shrink-0" />
          <Skeleton className="h-[18px] flex-1" />
        </div>
      ))}
    </div>
  );
}

/** `symbols`, `series`: the row title as a count noun. */
/** The narrowest a block gets before the map scrolls sideways. */
const CELL_MIN = 14;

const plural = (title: string) => {
  const t = title.toLowerCase();
  return t.endsWith('s') ? t : `${t}s`;
};

/** Whether two row badges draw the same: same element types and props, children compared alike. */
function sameNode(a: ReactNode, b: ReactNode): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameNode(x, b[i]));
  if (!isValidElement(a) || !isValidElement(b) || a.type !== b.type || a.key !== b.key)
    return false;
  const pa = a.props as Record<string, unknown>;
  const pb = b.props as Record<string, unknown>;
  const keys = Object.keys(pa);
  return (
    keys.length === Object.keys(pb).length &&
    keys.every((k) =>
      k === 'children' ? sameNode(pa[k] as ReactNode, pb[k] as ReactNode) : Object.is(pa[k], pb[k]),
    )
  );
}

interface RowLook {
  mobile: boolean;
  /** The strip is scrolled on from its start (it fades there): a phone's names start past the fade. */
  inset?: boolean;
  groupBy: boolean;
  select?: 'backfill' | 'drill';
  sums: CoverageSummary[];
  drilled: string | null;
  link?: LumenCoverageMapProps['rows']['link'];
}

/**
 * One row of the grid: its name, cells and summary. It draws again only when something it shows
 * changes (`sig`), so a poll redraws the rows whose blocks moved and a pick redraws one row
 * (a 100-row map used to redraw all 13,000 cells on every poll).
 */
const MapRow = memo(
  function MapRow({
    r,
    cols,
    marks,
    picks,
    start,
    previews,
    total,
    look,
  }: {
    r: CoverageRow;
    cols: string[];
    marks: ({
      level: CoverageLevel;
      canPick: boolean;
      fill?: number;
      kind?: 'add' | 'remove';
    } | null)[];
    picks: string[];
    /** The first block of a range being picked, and the blocks it would pick. */
    start?: string;
    previews: string[];
    total: { have: number; expected: number };
    look: RowLook;
    sig: string;
  }) {
    const text = r.label ?? r.row;
    const link = look.link?.(r.row);
    return (
      <>
        <span
          // Rows sit indented under their group's name.
          className={cn(
            look.mobile
              ? 'col-span-full -mb-0.5 flex min-w-0'
              : 'sticky left-0 z-1 flex min-w-0 flex-col bg-card pr-2',
            look.groupBy && (look.mobile ? 'pl-1.5' : 'pl-3'),
          )}
        >
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5',
              look.mobile && 'sticky left-0 max-w-[calc(var(--view-w,100vw)-4rem)] text-xs',
              look.mobile && look.inset && 'left-8',
            )}
          >
            {link ? (
              <Link
                {...link}
                className="num truncate font-medium hover:text-primary hover:underline"
              >
                {text}
              </Link>
            ) : (
              <span className="num truncate font-medium">{text}</span>
            )}
            {r.badge}
          </span>
          {r.sub && !look.mobile && (
            <span className="truncate text-[11px] text-muted-foreground">{r.sub}</span>
          )}
        </span>
        {cols.map((k, i) => {
          const m = marks[i];
          if (!m) return <span key={k} />;
          return (
            <CoverageCell
              key={k}
              level={m.level}
              fill={m.fill}
              label={`${text} · ${blockName(k)}`}
              tip={`${r.row}|${k}`}
              picked={picks.includes(k) || look.drilled === k}
              mark={picks.includes(k) ? m.kind : undefined}
              start={start === k}
              preview={m.canPick && previews.includes(k)}
              pickable={look.select === 'backfill' || look.select === 'drill'}
              disabled={look.select === 'backfill' ? !m.canPick : look.select !== 'drill'}
              className="h-[18px]"
            />
          );
        })}
        {look.sums.map((s) => (
          <span
            key={s}
            className={cn(
              'num pl-3 text-right text-xs whitespace-nowrap',
              s !== 'complete' && 'text-muted-foreground',
            )}
          >
            {s === 'complete'
              ? fmtPct(total.have, total.expected)
              : s === 'first'
                ? (r.first ?? '—')
                : s === 'last'
                  ? (r.last ?? '—')
                  : s === 'counts'
                    ? fmtCounts(total.have, total.expected)
                    : fmtInt(total.have)}
          </span>
        ))}
      </>
    );
  },
  (a, b) => a.sig === b.sig && sameNode(a.r.badge, b.r.badge),
);

export function LumenCoverageMap<TRaw, TKey extends QueryKey>({
  source,
  title,
  icon = Grid3x3Icon,
  rows: rowSpec,
  layout = 'grid',
  block: initialBlock = 'month',
  zoom,
  window = 'all',
  unit = 'sessions',
  summary = ['complete', 'last'],
  select,
  selectable = () => true,
  onQueue,
  queueLabel = 'Queue backfill',
  pickNote,
  removable = () => false,
  onRemove,
  preselect,
  pickTools,
  stateLabels,
  drilled = null,
  onDrill,
  groupBy = false,
  hint,
  pageSize: initialPageSize,
  pager,
  tools,
  filter,
  filterCount,
  empty,
  lazy = false,
}: LumenCoverageMapProps<TRaw, TKey>) {
  const { data, load: raw, ref } = useLumenSource(source, { lazy });
  // A coverage map refreshes in place: any refresh, asked for or a poll, only spins its ↻; no bar or dimming over the cells.
  const load = { ...raw, fetching: raw.fetching || raw.background };
  const cells = { ...raw, fetching: false, refreshing: false };
  const mobile = useIsMobile();
  const [block, setBlock] = useState<CoverageBlock>(layout === 'months' ? 'month' : initialBlock);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState(false);
  // A range: the first tap picks a block and starts it, the next tap in the row picks every block
  // between. Started on a picked block, the range unpicks instead (`remove`).
  // `over` is the block under the pointer meanwhile; `last` anchors shift-click.
  const [start, setStart] = useState<{ row: string; key: string; remove: boolean } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const last = useRef<{ row: string; index: number } | null>(null);
  // A preselect picks its months as if clicked; it replaces the current pick.
  useEffect(() => {
    if (!preselect) return;
    setPicked(new Set(preselect.flatMap((p) => p.months.map((m) => `${p.row}|${m}`))));
    setStart(null);
  }, [preselect]);
  const scroller = useRef<HTMLDivElement>(null);
  const edge = useScrollFade(scroller);
  const [pageSize, setPageSize] = useState(initialPageSize ?? 0);
  const [pageIndex, setPageIndex] = useState(0);

  const folded = useMemo(() => (data ? fold(data, block) : null), [data, block]);
  // Group headers fold their rows, remembered in the browser per page.
  const [folds, setFold] = useFolds();
  const foldKey = `group:${usePageKey()}:${title}:`;
  const cols = useMemo(() => {
    if (!data || layout === 'months') return [];
    const all = columns(data, block);
    return typeof window === 'number' && block === initialBlock ? all.slice(-window) : all;
  }, [data, block, layout, window, initialBlock]);

  // Open at today: the newest blocks are on the right. Zoom never moves the page, only this strip.
  // Only a new set of columns scrolls it; a refresh of the same columns keeps where the reader is.
  const strip = `${layout}|${block}|${cols.length}|${cols[0] ?? ''}|${cols.at(-1) ?? ''}|${folded ? 1 : 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the columns change
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && layout === 'grid') el.scrollLeft = el.scrollWidth;
    edge.update();
  }, [strip]);

  const sums = mobile ? summary.filter((s) => s === 'complete') : summary;
  const rowsHead = `${unit[0]?.toUpperCase() ?? ''}${unit.slice(1)}`;
  const levels = new Set<CoverageLevel>();
  const unitLabel = (have: number, expected: number) =>
    expected > 0 ? `${fmtInt(have)} of ${fmtInt(expected)} ${unit}` : 'Not expected';

  const toggle = (row: string, keys: string[], mode: 'toggle' | 'add' | 'remove') =>
    setPicked((prev) => {
      const next = new Set(prev);
      const ids = keys.map((k) => `${row}|${k}`);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (mode === 'remove' || (mode === 'toggle' && all)) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const pickedMonths = (keep = selectable): CoveragePick => {
    const byRow = new Map<string, Set<string>>();
    for (const id of picked) {
      const cut = id.lastIndexOf('|');
      const row = id.slice(0, cut);
      const c = folded?.cells.get(row)?.get(id.slice(cut + 1));
      const set = byRow.get(row) ?? new Set();
      for (const m of c?.months ?? []) if (keep(row, m)) set.add(m);
      byRow.set(row, set);
    }
    return [...byRow]
      .filter(([, ms]) => ms.size)
      .map(([row, ms]) => ({ row, months: [...ms].sort() }));
  };

  const queue = async (remove = false) => {
    const act = remove ? onRemove : onQueue;
    if (!act) return;
    setQueueing(true);
    try {
      await act(pickedMonths(remove ? removable : selectable));
      setPicked(new Set());
      setStart(null);
    } finally {
      setQueueing(false);
    }
  };

  const rowTotal = layout === 'grid' && data ? data.rows.length || (folded?.cells.size ?? 0) : 0;
  const page = pageSize ? Math.min(pageIndex, Math.max(0, Math.ceil(rowTotal / pageSize) - 1)) : 0;

  // One tooltip for the whole map, filled in for the hovered cell (`row|block`).
  const tipFor = (tip: string) => {
    const cut = tip.lastIndexOf('|');
    const row = tip.slice(0, cut);
    const k = tip.slice(cut + 1);
    const c = folded?.cells.get(row)?.get(k);
    if (!c) return null;
    const text = data?.rows.find((r) => r.row === row)?.label ?? row;
    return {
      label: `${text} · ${blockName(k)}`,
      detail: (
        <>
          <div>
            {unitLabel(c.have, c.expected)} · {stateLabels?.[c.level] ?? coverageLabel(c.level)}
          </div>
          {c.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
          {layout === 'months' && select === 'drill' && <div>Click to see its days</div>}
        </>
      ),
    };
  };

  /** A block a pick can take: a month in it can be queued, or taken out of the queue. */
  const canPick = (row: string, key: string) =>
    !!folded?.cells
      .get(row)
      ?.get(key)
      ?.months.some((m) => selectable(row, m) || (onRemove !== undefined && removable(row, m)));
  /** What picking a block does: queue its months, or take them out of the queue. */
  const kindOf = (row: string, key: string): 'add' | 'remove' =>
    folded?.cells
      .get(row)
      ?.get(key)
      ?.months.some((m) => selectable(row, m))
      ? 'add'
      : 'remove';
  /** A row's blocks in time order; the months layout runs across years. */
  const orderOf = (row: string) =>
    layout === 'months' ? [...(folded?.cells.get(row)?.keys() ?? [])].sort() : cols;

  // One click handler for every cell: drill, or pick (shift-click picks a range in the row).
  const onCellClick = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-cell]') : null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    const tip = el.dataset.cell ?? '';
    const cut = tip.lastIndexOf('|');
    const row = tip.slice(0, cut);
    const k = tip.slice(cut + 1);
    if (select === 'drill') {
      onDrill?.(row, k);
      return;
    }
    if (select !== 'backfill') return;
    const order = orderOf(row);
    const i = order.indexOf(k);
    const range = (from: number, mode: 'add' | 'remove' = 'add') => {
      const [lo, hi] = [from, i].sort((x, y) => x - y) as [number, number];
      toggle(
        row,
        order.slice(lo, hi + 1).filter((key) => canPick(row, key)),
        mode,
      );
    };
    if (e.shiftKey && last.current?.row === row) {
      range(last.current.index);
      setStart(null);
    } else if (start?.row === row) {
      // The second tap ends the range. On its own first block it only ends it: a picked range
      // start is out already, a new one goes back out.
      if (start.key === k) toggle(row, [k], 'remove');
      else range(order.indexOf(start.key), start.remove ? 'remove' : 'add');
      setStart(null);
    } else {
      const remove = picked.has(`${row}|${k}`);
      toggle(row, [k], remove ? 'remove' : 'add');
      setStart({ row, key: k, remove });
    }
    setOver(null);
    last.current = { row, index: i };
  };

  // While a range is open, the block under the pointer shows what the next tap would pick.
  const onCellOver = (e: React.PointerEvent<HTMLElement>) => {
    if (!start) return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-cell]') : null;
    const tip = el?.dataset.cell ?? '';
    const cut = tip.lastIndexOf('|');
    if (el && tip.slice(0, cut) === start.row) setOver(tip.slice(cut + 1));
  };
  const previewOf = (row: string): string[] => {
    if (!start || start.row !== row || !over) return [];
    const order = orderOf(row);
    const [lo, hi] = [order.indexOf(start.key), order.indexOf(over)].sort((x, y) => x - y) as [
      number,
      number,
    ];
    // An unpicking range previews the picked blocks it would take out; a picking one the rest.
    return lo < 0
      ? []
      : order
          .slice(lo, hi + 1)
          .filter((k) =>
            k === start.key ? start.remove : picked.has(`${row}|${k}`) === start.remove,
          );
  };
  const picking = picked.size > 0 || !!start;
  // Picking fades the blocks a pick can't take, so what can be picked stands out.
  const routes = {
    onClick: onCellClick,
    onPointerOver: onCellOver,
    onPointerLeave: () => setOver(null),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') setStart(null);
    },
  };
  const fade = select === 'backfill' && picking && '[&_[data-cell]:disabled]:opacity-30';

  let body: ReactNode = null;
  if (data && folded) {
    if (layout === 'months') {
      const row = data.rows[0]?.row ?? data.facts[0]?.row ?? '';
      const cells = folded.cells.get(row) ?? new Map<string, Folded>();
      const previews = new Set(previewOf(row));
      const years = [...new Set([...cells.keys()].map((k) => k.slice(0, 4)))].sort().reverse();
      const sumCols = sums.map((s) => SUMMARY_WIDTH[s]).join(' ');
      const grid = {
        gridTemplateColumns: `${mobile ? '2.75rem' : '4rem'} repeat(12, minmax(${mobile ? '14px' : '18px'}, 1fr)) ${sumCols}`,
      };
      body = (
        <div className={cn('grid items-center gap-[3px]', fade)} style={grid} {...routes}>
          <span className="text-xs text-muted-foreground">Year</span>
          {MON.map((m, i) => (
            <span key={m} className="text-xs text-muted-foreground">
              {mobile ? (i % 3 === 0 ? m : '') : m}
            </span>
          ))}
          {sums.map((s) => (
            <span key={s} className="pl-3 text-right text-xs text-muted-foreground">
              {s === 'rows' || s === 'counts' ? rowsHead : SUMMARY_HEAD[s]}
            </span>
          ))}
          {years.map((y) => {
            let have = 0;
            let expected = 0;
            // A year's label picks the months in it that can be queued (again: takes them out).
            const yearKeys = MON.map((_, i) => `${y}-${String(i + 1).padStart(2, '0')}`).filter(
              (k) => canPick(row, k) && kindOf(row, k) === 'add',
            );
            return [
              select === 'backfill' && yearKeys.length ? (
                <button
                  key={`${y}-label`}
                  type="button"
                  aria-label={`Pick ${y}`}
                  className="num -ml-1 w-fit cursor-pointer rounded px-1 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    toggle(row, yearKeys, 'toggle');
                    setStart(null);
                  }}
                >
                  {y}
                </button>
              ) : (
                <span key={`${y}-label`} className="num text-xs">
                  {y}
                </span>
              ),
              ...MON.map((_, i) => {
                const key = `${y}-${String(i + 1).padStart(2, '0')}`;
                const c = cells.get(key);
                if (!c) return <span key={key} />;
                levels.add(c.level);
                have += c.have;
                expected += c.expected;
                return (
                  <CoverageCell
                    key={key}
                    level={c.level}
                    fill={c.expected > 0 ? c.have / c.expected : undefined}
                    label={`${row} · ${blockName(key)}`}
                    tip={`${row}|${key}`}
                    picked={picked.has(`${row}|${key}`) || drilled === key}
                    mark={picked.has(`${row}|${key}`) ? kindOf(row, key) : undefined}
                    start={start?.key === key}
                    preview={previews.has(key) && canPick(row, key)}
                    pickable={select === 'backfill' || select === 'drill'}
                    disabled={select === 'backfill' ? !canPick(row, key) : select !== 'drill'}
                    className={mobile ? 'h-4' : 'h-5'}
                  />
                );
              }),
              ...sums.map((s) => (
                <span
                  key={`${y}-${s}`}
                  className={cn(
                    'num pl-3 text-right text-xs',
                    s !== 'complete' && 'text-muted-foreground',
                  )}
                >
                  {s === 'complete'
                    ? fmtPct(have, expected)
                    : s === 'rows'
                      ? fmtInt(have)
                      : s === 'counts'
                        ? fmtCounts(have, expected)
                        : ''}
                </span>
              )),
            ];
          })}
        </div>
      );
    } else {
      // Rows with badges (index tags, a lag) get room for them beside the name.
      const label = mobile ? '4rem' : data.rows.some((r) => r.badge) ? '10rem' : '7rem';
      // Blocks never shrink below a tappable size: past that the map scrolls
      // sideways with the names column pinned, opening at today.
      const cell = `minmax(${CELL_MIN}px, 1fr)`;
      const grid = {
        // A phone puts each name on its own line above its blocks, so blocks never run under it.
        gridTemplateColumns: `${mobile ? '' : `${label} `}repeat(${cols.length}, ${cell}) ${sums.map((s) => SUMMARY_WIDTH[s]).join(' ')}`,
      };
      const allRows: CoverageRow[] = data.rows.length
        ? data.rows
        : [...folded.cells.keys()].map((row) => ({ row }));
      const rowList = pageSize ? allRows.slice(page * pageSize, (page + 1) * pageSize) : allRows;
      const groupSize = new Map<string | undefined, number>();
      if (groupBy)
        for (const r of rowList) groupSize.set(r.group, (groupSize.get(r.group) ?? 0) + 1);
      const pickedBy = new Map<string, string[]>();
      for (const id of picked) {
        const cut = id.lastIndexOf('|');
        const row = id.slice(0, cut);
        pickedBy.set(row, [...(pickedBy.get(row) ?? []), id.slice(cut + 1)]);
      }
      const look = {
        mobile,
        inset: edge.side === 'start' || edge.side === 'both',
        groupBy,
        select,
        sums,
        drilled,
        link: rowSpec.link,
      };
      let group: string | undefined;
      body = (
        <div className={cn('grid min-w-min items-center gap-[3px]', fade)} style={grid} {...routes}>
          {!mobile && (
            <span className="sticky left-0 z-1 bg-card text-xs text-muted-foreground">
              {rowSpec.title}
            </span>
          )}
          {cols.map((k) => (
            <span
              key={k}
              className="num h-4 overflow-visible text-[11px] whitespace-nowrap text-muted-foreground"
            >
              {headLabel(k, block, cols.length)}
            </span>
          ))}
          {sums.map((s) => (
            <span key={s} className="pl-3 text-right text-xs text-muted-foreground">
              {s === 'rows' || s === 'counts' ? rowsHead : SUMMARY_HEAD[s]}
            </span>
          ))}
          {rowList.flatMap((r) => {
            const out: ReactNode[] = [];
            const shut = groupBy && folds.has(foldKey + (r.group ?? ''));
            if (groupBy && r.group !== group) {
              group = r.group;
              const name = r.group ?? '';
              const toggle = () => setFold(foldKey + name, !shut);
              out.push(
                <span
                  key={`group-${r.group}`}
                  className="col-span-full mt-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                >
                  {/* Sticky inside the full-width row, so the name stays in sight while the map scrolls.
                      Its chevron folds the group's rows. */}
                  <span className="sticky left-0 -ml-1.5 inline-flex items-center gap-1.5 py-0.5 pr-1 pl-1.5">
                    {name}
                    <Badge variant="secondary" className="num h-4 px-1.5 text-[10px]">
                      {groupSize.get(r.group) ?? 0}
                    </Badge>
                    <FoldChevron folded={shut} label={name} onToggle={toggle} className="size-4" />
                  </span>
                </span>,
              );
            }
            if (shut) return out;
            const rowCells = folded.cells.get(r.row);
            const marks = cols.map((k) => {
              const c = rowCells?.get(k);
              if (!c) return null;
              levels.add(c.level);
              return {
                level: c.level,
                canPick: select === 'backfill' && canPick(r.row, k),
                fill: c.expected > 0 ? c.have / c.expected : undefined,
                kind: select === 'backfill' && canPick(r.row, k) ? kindOf(r.row, k) : undefined,
              };
            });
            const picks = pickedBy.get(r.row) ?? [];
            const rowStart = start?.row === r.row ? start.key : undefined;
            const previews = previewOf(r.row);
            out.push(
              <MapRow
                key={r.row}
                r={r}
                cols={cols}
                marks={marks}
                picks={picks}
                start={rowStart}
                previews={previews}
                total={folded.totals.get(r.row) ?? { have: 0, expected: 0 }}
                look={look}
                sig={[
                  r.label,
                  r.sub,
                  r.first,
                  r.last,
                  JSON.stringify(rowSpec.link?.(r.row) ?? null),
                  mobile,
                  look.inset,
                  groupBy,
                  select,
                  sums.join(),
                  drilled,
                  cols.length,
                  cols[0],
                  cols.at(-1),
                  picks.join(),
                  rowStart,
                  previews.join(),
                  marks
                    .map((m) =>
                      m ? `${m.level}${m.canPick ? '+' : ''}${m.kind ?? ''}${m.fill ?? ''}` : '',
                    )
                    .join(),
                  JSON.stringify(folded.totals.get(r.row) ?? null),
                ].join('\u0001')}
              />,
            );
            return out;
          })}
        </div>
      );
    }
  }

  const pick = picked.size ? pickedMonths() : [];
  const queueCount = pick.reduce((n, p) => n + p.months.length, 0);
  const unpick = picked.size && onRemove ? pickedMonths(removable) : [];
  const removeCount = unpick.reduce((n, p) => n + p.months.length, 0);
  const pickedCount = queueCount + removeCount;
  const pickedRows = [...new Set([...pick, ...unpick].map((p) => p.row))];
  const rowName = (row: string) => data?.rows.find((r) => r.row === row)?.label ?? row;
  const months = (n: number) => `${n} month${n > 1 ? 's' : ''}`;
  const word = layout === 'months' ? 'month' : 'block in the row';

  const head = (
    <>
      {tools}
      {zoom && layout === 'grid' && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={block}
          onValueChange={(v) => {
            if (!v) return;
            setBlock(v as CoverageBlock);
            setPicked(new Set());
            setStart(null);
          }}
          aria-label="Block size"
          className="max-sm:hidden"
        >
          {zoom.map((z) => (
            <ToggleGroupItem key={z} value={z}>
              {BLOCK_LABEL[z]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {pager ? (
        <LumenPager
          total={pager.total}
          page={pager.page}
          size={pager.size}
          sizes={pager.sizes}
          onPage={pager.onPage}
          onSize={pager.onSize}
          noun={plural(rowSpec.title)}
        />
      ) : (
        pageSize > 0 &&
        layout === 'grid' &&
        data && (
          <LumenPager
            total={rowTotal}
            page={page}
            size={pageSize}
            onPage={setPageIndex}
            onSize={(n) => {
              setPageSize(n);
              setPageIndex(0);
            }}
            noun={plural(rowSpec.title)}
          />
        )
      )}
    </>
  );

  return (
    <div ref={ref} className="min-w-0">
      <LumenWidget
        id={title}
        kind={null}
        icon={icon}
        title={title}
        tools={head}
        filter={filter}
        filterCount={filterCount}
        load={load}
        rows={data?.rows.length}
        pad={false}
      >
        <div className="flex flex-col gap-3 px-3 pt-3 pb-3">
          <LumenStates
            load={cells}
            skeleton={<GridSkeleton />}
            empty={data && !data.rows.length && !data.facts.length ? empty : undefined}
          >
            {select === 'backfill' && (
              // The selection bar keeps its place above the map, picked or not, so the map never moves.
              <div
                aria-live="polite"
                className={cn(
                  'flex min-h-11 flex-wrap items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
                  pickedCount > 0
                    ? 'bg-foreground/5 ring-1 ring-foreground ring-inset'
                    : 'bg-muted',
                )}
              >
                <span className="min-w-0 flex-1 basis-56">
                  {pickedCount > 0 ? (
                    <>
                      {/* The months layout has one row, named in the title already. */}
                      {layout === 'grid' && (
                        <span className="num font-semibold">{`${pickedRows.map(rowName).join(', ')} · `}</span>
                      )}
                      <span className="font-semibold">{`${months(pickedCount)} picked`}</span>
                      <span className="text-muted-foreground">
                        {pickNote && queueCount > 0 ? ` · ${pickNote(pick)}` : ''}
                        {start
                          ? ` · Tap another ${word} to ${start.remove ? 'unpick' : 'pick'} the range`
                          : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {pickTools
                        ? 'Pick on the map, or'
                        : `Tap a ${word}, then another to pick the range`}
                    </span>
                  )}
                </span>
                {pickedCount > 0 ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPicked(new Set());
                        setStart(null);
                      }}
                    >
                      Clear
                    </Button>
                    {removeCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={queueing}
                        onClick={() => void queue(true)}
                      >
                        <ListXIcon /> Remove from queue · {months(removeCount)}
                      </Button>
                    )}
                    {queueCount > 0 && (
                      <Button
                        size="sm"
                        disabled={queueing || !onQueue}
                        onClick={() => void queue()}
                      >
                        <ListPlusIcon /> {queueLabel} · {months(queueCount)}
                      </Button>
                    )}
                  </>
                ) : (
                  pickTools
                )}
              </div>
            )}
            <div
              ref={scroller}
              onScroll={edge.update}
              data-fade={edge.side}
              className="overflow-x-auto overflow-y-hidden pb-1"
            >
              {/* The months layout fits its twelve months to the card; the grid scrolls sideways. */}
              <CoverageTip
                content={tipFor}
                className={layout === 'months' ? 'min-w-0' : 'w-max min-w-full'}
              >
                {body}
              </CoverageTip>
            </div>
            <div className="border-t pt-3">
              <CoverageLegend
                levels={levels}
                labels={stateLabels}
                hint={
                  hint ??
                  (select === 'backfill'
                    ? 'Tap a block, then another for a range'
                    : select === 'drill'
                      ? 'Click a block to see its days'
                      : undefined)
                }
              />
            </div>
          </LumenStates>
        </div>
      </LumenWidget>
    </div>
  );
}
