// LumenGrid: an
// LumenLayout's cards on a real grid, react-grid-layout underneath. A desktop has 6 columns, a phone
// 2; rows are 8px. A card is placed at x, y and sized w by h; a card with no h is as tall as what it
// shows (measured), and cards that start on the same row match the tallest of them. While the layout
// is edited, cards move by their grip and size from their corner; a card resized keeps its height.
// Outside Edit layout a full-width table stays out of the grid, so it keeps scrolling sideways with
// the page while the cards around it stay put.
import {
  GRID_BLOCK_ROWS,
  GRID_COLS,
  GRID_PHONE_COLS,
  GRID_ROW_PX,
  type ViewCardPlace,
} from '@columenlabs/lumen-types/views';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GridLayout,
  type Layout,
  type LayoutItem,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout';
import { cn } from './lib/utils';
import { LumenBoundary } from './lumen-boundary';

/** The gap between cards, the shell's section gap. */
export const GRID_GAP = 12;
/** Narrower than this the grid has the phone's 2 columns. */
const PHONE_BELOW = 720;
/** A card's height before it is measured. */
const GUESS = GRID_BLOCK_ROWS * 2;

/** One card on the grid. */
export interface GridCard {
  id: string;
  /** Columns of 6 it spans on a desktop. */
  w: number;
  /** Rows of 8px; left out, as tall as it draws. */
  h?: number;
  x?: number;
  y?: number;
  /** Its own place on a phone. */
  phone?: ViewCardPlace;
  /** A full-width table: outside Edit layout it sits between the grid's runs, scrolling sideways. */
  wide?: boolean;
  /** A card the page builds in code: it is laid out but not moved or sized. */
  locked?: boolean;
  node: ReactNode;
}

/** Where a card was put while editing: its columns, row, width and, once resized, its height. */
export interface GridPlace {
  id: string;
  x: number;
  y: number;
  w: number;
  h?: number;
}

/** Inside a grid cell: `fixed` when the cell has a height of its own, so the card fills it. */
const GridCellContext = createContext<{ fixed: boolean } | null>(null);
export const useGridCell = () => useContext(GridCellContext);

const CARD = '[data-slot=lumen-card]';
const rowsOf = (px: number) => Math.max(2, Math.ceil((px + GRID_GAP) / GRID_ROW_PX));
const byPlace = (a: LayoutItem, b: LayoutItem) => a.y - b.y || a.x - b.x;

type Sized = { id: string; w: number; h: number; x?: number; y?: number };

/** Cards placed where they say and, in order after them, the ones that do not, row by row. */
function arrange(cards: Sized[], cols: number, top: number): LayoutItem[] {
  const out: LayoutItem[] = [];
  let bottom = top;
  for (const c of cards)
    if (c.x !== undefined && c.y !== undefined) {
      const w = Math.min(c.w, cols);
      out.push({ i: c.id, x: Math.min(c.x, cols - w), y: top + c.y, w, h: c.h });
      bottom = Math.max(bottom, top + c.y + c.h);
    }
  let x = 0;
  let row = 0;
  for (const c of cards) {
    if (c.x !== undefined && c.y !== undefined) continue;
    const w = Math.min(c.w, cols);
    if (x + w > cols) {
      x = 0;
      row += 1;
    }
    // Rows far apart: compacting pulls each up under the row before it.
    out.push({ i: c.id, x, y: bottom + row * 10_000, w, h: c.h });
    x += w;
  }
  return out;
}

/** The highest row a laid-out set reaches. */
const bottomOf = (items: LayoutItem[]) => items.reduce((m, it) => Math.max(m, it.y + it.h), 0);

/**
 * The grid's layout: the page's lead cards, then the saved ones where they were placed, then the
 * page's other cards, compacted upward; cards of measured height starting on the same row take the
 * tallest's height.
 */
export function gridLayout(
  groups: GridCard[][],
  heights: Record<string, number>,
  phone: boolean,
): LayoutItem[] {
  const cols = phone ? GRID_PHONE_COLS : GRID_COLS;
  const auto = new Set<string>();
  const sized = (c: GridCard): Sized => {
    const own = phone ? c.phone?.h : c.h;
    if (own === undefined) auto.add(c.id);
    const h = own ?? heights[c.id] ?? GUESS;
    if (!phone) return { id: c.id, w: c.w, h, x: c.x, y: c.y };
    if (c.phone) return { id: c.id, w: c.phone.w, h, x: c.phone.x, y: c.phone.y };
    return { id: c.id, w: c.w <= 1 ? 1 : GRID_PHONE_COLS, h };
  };
  // A phone with no places of its own keeps the desktop's reading order.
  const ordered = phone
    ? groups.map((g) => {
        if (g.some((c) => c.phone)) return g;
        const at = new Map(gridLayout([g], heights, false).map((it) => [it.i, it]));
        return [...g].sort((a, b) => {
          const pa = at.get(a.id);
          const pb = at.get(b.id);
          return pa && pb ? byPlace(pa, pb) : 0;
        });
      })
    : groups;
  let items: LayoutItem[] = [];
  for (const g of ordered) items = [...items, ...arrange(g.map(sized), cols, bottomOf(items))];
  // A row settles only once the one above it has, so match heights and compact until nothing moves.
  let laid = [...verticalCompactor.compact(items, cols)];
  for (let pass = 0; pass < laid.length; pass++) {
    const tallest = new Map<number, number>();
    for (const it of laid) tallest.set(it.y, Math.max(tallest.get(it.y) ?? 0, it.h));
    let changed = false;
    const even = laid.map((it) => {
      const h = auto.has(it.i) ? (tallest.get(it.y) ?? it.h) : it.h;
      if (h !== it.h) changed = true;
      return h === it.h ? it : { ...it, h };
    });
    if (!changed) break;
    laid = [...verticalCompactor.compact(even, cols)];
  }
  return laid.sort(byPlace);
}

/** A cell measures what it draws when it has no height of its own (a frame: its parts). */
function Cell({
  id,
  fixed,
  report,
  children,
}: {
  id: string;
  fixed: boolean;
  report: (id: string, px: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cell = ref.current;
    if (fixed || !cell) return;
    const measure = () => {
      const el = cell.firstElementChild as HTMLElement | null;
      if (!el) return report(id, 0);
      // A card fills its cell (through a wrapper too), so its height is its parts': header,
      // filter, body and footer, plus whatever else the wrapper holds.
      const card = el.matches(CARD) ? el : el.querySelector<HTMLElement>(`:scope > ${CARD}`);
      const px = card
        ? [...card.children].reduce((s, c) => s + (c as HTMLElement).offsetHeight, 0) +
          (card.offsetHeight - card.clientHeight) +
          (el.offsetHeight - card.offsetHeight)
        : el.offsetHeight;
      report(id, px);
    };
    measure();
    const ro = new ResizeObserver(measure);
    const el = cell.firstElementChild;
    const card = el?.matches(CARD) ? el : el?.querySelector(`:scope > ${CARD}`);
    if (el) ro.observe(el);
    if (card) for (const c of card.children) ro.observe(c);
    return () => ro.disconnect();
  });
  const value = useMemo(() => ({ fixed }), [fixed]);
  return (
    <GridCellContext.Provider value={value}>
      <div
        ref={ref}
        className="h-full [&>*:has(>[data-slot=lumen-card])]:h-full"
        style={{ paddingBottom: GRID_GAP }}
      >
        {children}
      </div>
    </GridCellContext.Provider>
  );
}

const gridConfig = (phone: boolean) => ({
  cols: phone ? GRID_PHONE_COLS : GRID_COLS,
  rowHeight: GRID_ROW_PX,
  margin: [GRID_GAP, 0] as const,
  containerPadding: [0, 0] as const,
});

/** The page's cards on the grid; `onPlace` makes them movable and sizable (Edit layout). */
export function LumenGrid({
  lead = [],
  cards,
  tail = [],
  editing,
  onPlace,
}: {
  /** The page's own cards before the saved ones, and after them. */
  lead?: GridCard[];
  cards: GridCard[];
  tail?: GridCard[];
  editing: boolean;
  /** Told every card's place after a move or resize, and whether it was on the phone's grid. */
  onPlace?: (places: GridPlace[], phone: boolean) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const phone = width < PHONE_BELOW;
  const [heights, setHeights] = useState<Record<string, number>>({});
  const report = useCallback(
    (id: string, px: number) =>
      setHeights((h) => {
        const r = rowsOf(px);
        return h[id] === r ? h : { ...h, [id]: r };
      }),
    [],
  );
  const all = [...lead, ...cards, ...tail];
  const byId = new Map(all.map((c) => [c.id, c]));
  const layout = gridLayout([lead, cards, tail], heights, phone);
  const own = (c: GridCard) => (phone ? c.phone?.h : c.h);
  const cell = (c: GridCard) => (
    <div key={c.id} data-locked={c.locked || undefined}>
      <Cell id={c.id} fixed={own(c) !== undefined} report={report}>
        <LumenBoundary where={c.id}>{c.node}</LumenBoundary>
      </Cell>
    </div>
  );
  const measure = (
    <div ref={containerRef} aria-hidden className="sticky left-0 h-0 w-(--view-w) -mb-3" />
  );

  if (editing) {
    const commit = (l: Layout, resized?: string) =>
      onPlace?.(
        [...l]
          .filter((it) => !byId.get(it.i)?.locked)
          .sort(byPlace)
          .map((it) => {
            const c = byId.get(it.i);
            const h = it.i === resized ? it.h : c && own(c);
            return { id: it.i, x: it.x, y: it.y, w: it.w, ...(h === undefined ? {} : { h }) };
          }),
        phone,
      );
    return (
      <>
        {measure}
        <div className="sticky left-0 w-(--view-w)" style={{ marginBottom: -GRID_GAP }}>
          {mounted && (
            <GridLayout
              width={width}
              layout={layout.map((it) =>
                byId.get(it.i)?.locked ? { ...it, isDraggable: false, isResizable: false } : it,
              )}
              gridConfig={gridConfig(phone)}
              dragConfig={{ handle: '.lumen-drag', threshold: 4 }}
              resizeConfig={{ enabled: true, handles: ['se'] }}
              compactor={verticalCompactor}
              className="lumen-grid lumen-grid-edit"
              onDragStop={(l) => commit(l)}
              onResizeStop={(l, _o, n) => commit(l, n?.i)}
            >
              {layout.flatMap((it) => {
                const c = byId.get(it.i);
                return c ? [cell(c)] : [];
              })}
            </GridLayout>
          )}
        </div>
      </>
    );
  }

  // Outside Edit layout: runs of cards on the grid, with each full-width table between them.
  const parts: (GridCard | LayoutItem[])[] = [];
  for (const it of layout) {
    const c = byId.get(it.i);
    if (!c) continue;
    const last = parts[parts.length - 1];
    if (c.wide) parts.push(c);
    else if (Array.isArray(last)) last.push(it);
    else parts.push([it]);
  }
  return (
    <>
      {measure}
      {mounted &&
        parts.map((p) =>
          Array.isArray(p) ? (
            <GridRun
              key={p.map((it) => it.i).join()}
              items={p}
              phone={phone}
              width={width}
              cell={(id) => {
                const c = byId.get(id);
                return c ? cell(c) : null;
              }}
            />
          ) : (
            // A full-width card that is no table (a note, a chart) stays put while a table scrolls.
            <div
              key={p.id}
              className="not-has-[table]:sticky not-has-[table]:left-0 not-has-[table]:w-(--view-w)"
            >
              {p.node}
            </div>
          ),
        )}
    </>
  );
}

/** Cards between two full-width tables: their own grid, from the row the first starts on. */
function GridRun({
  items,
  phone,
  width,
  cell,
}: {
  items: LayoutItem[];
  phone: boolean;
  width: number;
  cell: (id: string) => ReactNode;
}) {
  const top = Math.min(...items.map((it) => it.y));
  const layout = items.map((it) => ({ ...it, y: it.y - top, static: true }));
  return (
    <div className={cn('sticky left-0 w-(--view-w)')} style={{ marginBottom: -GRID_GAP }}>
      <GridLayout
        width={width}
        layout={layout}
        gridConfig={gridConfig(phone)}
        dragConfig={{ enabled: false }}
        resizeConfig={{ enabled: false }}
        compactor={verticalCompactor}
        className="lumen-grid"
      >
        {items.map((it) => cell(it.i))}
      </GridLayout>
    </div>
  );
}
