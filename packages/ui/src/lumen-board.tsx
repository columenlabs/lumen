// LumenBoard: items in columns by stage (a plan's checkpoints, a pipeline's steps). Each column
// scrolls on its own; the board scrolls sideways inside its own box, never the page. On a narrow
// box the columns become a snap scroller, one column a screen, with a LumenSelector to jump to one.
// A card is one line: an optional tick slot, the title (it truncates, the whole of it on hover),
// then a muted meta and badges. Moving a card is a menu of columns, so it works by keyboard and
// needs no drag library.
import { ArrowRightLeftIcon, KanbanIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNarrow } from './hooks/use-narrow';
import { cn } from './lib/utils';
import { LumenBoundary } from './lumen-boundary';
import { LumenSelector } from './lumen-selector';
import { IconButton } from './page';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export interface BoardColumn {
  id: string;
  label: string;
  /** The count in the header; the number of its items by default. */
  count?: number;
}

export interface BoardItem {
  id: string;
  /** The `BoardColumn` id it sits in. */
  column: string;
  title: string;
  /** One muted line after the title: a due date, an owner. */
  meta?: ReactNode;
  /** Small marks at the card's end (`Badge`, `ColorChip`). */
  badges?: ReactNode;
}

export interface LumenBoardProps<T extends BoardItem = BoardItem> {
  columns: readonly BoardColumn[];
  items: readonly T[];
  /** A card was opened: show the app's drawer. */
  onOpen?: (item: T) => void;
  /** Moves a card; with it each card offers a Move to menu (hover, focus or tap on a phone). */
  onMove?: (item: T, toColumn: string) => void;
  /** Draws a card's body in place of the title, meta and badges. Keep it to one line. */
  renderCard?: (item: T) => ReactNode;
  /** A slot before the title: a done tick (a `Checkbox`). */
  tick?: (item: T) => ReactNode;
  /** An empty column's line. */
  empty?: ReactNode;
  /** How tall a column's list may grow before it scrolls (any CSS length). */
  maxHeight?: string;
  className?: string;
}

export function LumenBoard<T extends BoardItem>({
  columns,
  items,
  onOpen,
  onMove,
  renderCard,
  tick,
  empty = 'Nothing here',
  maxHeight = '70vh',
  className,
}: LumenBoardProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(box);
  const [shown, setShown] = useState(columns[0]?.id ?? '');
  const byColumn = useMemo(() => {
    const map = new Map<string, T[]>(columns.map((c) => [c.id, []]));
    for (const it of items) map.get(it.column)?.push(it);
    return map;
  }, [columns, items]);

  // On a phone the picker follows the swipe, and a pick scrolls to its column.
  const onScroll = () => {
    const el = strip.current;
    if (!narrow || !el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    const id = columns[i]?.id;
    if (id && id !== shown) setShown(id);
  };
  const jump = (id: string) => {
    setShown(id);
    const el = strip.current;
    const i = columns.findIndex((c) => c.id === id);
    if (el && i >= 0) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  // A column that goes away leaves the picker on the first.
  useEffect(() => {
    if (!columns.some((c) => c.id === shown)) setShown(columns[0]?.id ?? '');
  }, [columns, shown]);

  const countOf = (c: BoardColumn) => c.count ?? byColumn.get(c.id)?.length ?? 0;
  return (
    <div ref={box} className={cn('flex min-w-0 flex-col gap-2', className)}>
      {narrow && columns.length > 1 ? (
        <LumenSelector
          label="Column"
          icon={KanbanIcon}
          value={shown}
          onChange={jump}
          options={columns.map((c) => ({
            value: c.id,
            label: c.label,
            detail: String(countOf(c)),
          }))}
          className="w-full"
        />
      ) : null}
      <div
        ref={strip}
        onScroll={onScroll}
        className={cn(
          'flex min-w-0 overflow-x-auto overscroll-x-contain',
          narrow ? 'snap-x snap-mandatory' : 'gap-3 pb-1',
        )}
      >
        {columns.map((c) => {
          const list = byColumn.get(c.id) ?? [];
          return (
            <section
              key={c.id}
              aria-label={c.label}
              className={cn(
                'flex shrink-0 flex-col rounded-lg border bg-muted/30',
                narrow ? 'w-full snap-start' : 'w-72',
              )}
            >
              <header className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={c.label}>
                  {c.label}
                </h3>
                <span className="num shrink-0 text-xs text-muted-foreground">{countOf(c)}</span>
              </header>
              <div className="overflow-y-auto p-2" style={{ maxHeight }}>
                <LumenBoundary where={`board:${c.id}`}>
                  {list.length ? (
                    <ul className="flex flex-col gap-1.5">
                      {list.map((it) => (
                        <li key={it.id}>
                          <BoardCard
                            item={it}
                            columns={columns}
                            onOpen={onOpen}
                            onMove={onMove}
                            renderCard={renderCard}
                            tick={tick}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-1 py-6 text-center text-sm text-muted-foreground">{empty}</p>
                  )}
                </LumenBoundary>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard<T extends BoardItem>({
  item,
  columns,
  onOpen,
  onMove,
  renderCard,
  tick,
}: {
  item: T;
  columns: readonly BoardColumn[];
  onOpen?: (item: T) => void;
  onMove?: (item: T, toColumn: string) => void;
  renderCard?: (item: T) => ReactNode;
  tick?: (item: T) => ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div
      className={cn(
        'group/card flex min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm shadow-xs hover:bg-muted/60 focus-within:ring-3 focus-within:ring-ring/30',
        menu && 'bg-muted/60',
      )}
    >
      {tick ? <span className="flex shrink-0 items-center">{tick(item)}</span> : null}
      <button
        type="button"
        onClick={() => onOpen?.(item)}
        title={item.title}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        {renderCard ? (
          renderCard(item)
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.meta ? (
              <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                {item.meta}
              </span>
            ) : null}
            {item.badges ? (
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                {item.badges}
              </span>
            ) : null}
          </>
        )}
      </button>
      {onMove ? (
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={ArrowRightLeftIcon}
              label="Move to"
              size="icon-xs"
              className={cn(
                'shrink-0 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100',
                menu && 'opacity-100',
              )}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={item.column}
              onValueChange={(to) => to !== item.column && onMove(item, to)}
            >
              {columns.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id}>
                  <span className="truncate">{c.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
