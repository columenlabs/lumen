// A small labelled number with optional lines under it (lines): a view's widgets and tiles, and an app's stat tiles.
// TileToggleGroup is the clickable kind: one joined strip of tiles that picks what a page shows,
// set beside plain Tiles in a page's header row (an app coverage pages, 2026-10-09). On desktop
// every tile in the row is one fixed width (`TILE_WIDTH`), the row does not stretch, and it never
// wraps: `TileRow` keeps it on one line and narrow screens shrink the tiles instead.
import type { ReactNode } from 'react';
import { cn } from './lib/utils';
import { Card } from './ui/card';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

function TileBody({
  label,
  value,
  caption,
  lines,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  lines?: ReactNode[];
  valueClassName?: string;
}) {
  return (
    <>
      <span className="w-full truncate text-xs text-muted-foreground">{label}</span>
      <span className={cn('num truncate text-xl leading-7 font-semibold', valueClassName)}>
        {value}
      </span>
      {caption ? (
        <span className="num line-clamp-2 text-xs text-muted-foreground">{caption}</span>
      ) : null}
      {lines?.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a card's lines in their saved order
        <span key={i} className="num line-clamp-2 text-xs text-muted-foreground">
          {l}
        </span>
      ))}
    </>
  );
}

export function Tile({
  label,
  value,
  caption,
  lines,
  className,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  /** Secondary lines under the value, one each (a Summary card's). */
  lines?: ReactNode[];
  className?: string;
  valueClassName?: string;
}) {
  return (
    <Card size="sm" className={cn('min-w-0 gap-0.5 px-3', className)}>
      <TileBody
        label={label}
        value={value}
        caption={caption}
        lines={lines}
        valueClassName={valueClassName}
      />
    </Card>
  );
}

/** Width of every header tile on desktop, toggle tiles and plain Tiles alike; shrinks to fit the row. */
export const TILE_WIDTH = 'lg:w-(--tile-width) lg:flex-initial';

/** A page's header row of tiles: wraps on phones, one line on desktop. */
export function TileRow({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2.5 lg:flex-nowrap', className)} {...props}>
      {children}
    </div>
  );
}

export interface TileOption {
  id: string;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
}

export function TileToggleGroup({
  options,
  selected,
  onSelect,
  label,
  className,
}: {
  options: TileOption[];
  selected: string;
  onSelect: (id: string) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
}) {
  return (
    <Card
      size="sm"
      className={cn('min-w-0 gap-0 bg-border py-0 lg:w-fit lg:flex-initial', className)}
    >
      <ToggleGroup
        type="single"
        spacing={0}
        value={selected}
        onValueChange={(v) => v && onSelect(v)}
        aria-label={label}
        className="grid w-full grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-px lg:flex lg:w-fit"
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o.id}
            value={o.id}
            aria-label={o.label}
            className="h-auto min-w-0 flex-col lg:w-(--tile-width) lg:shrink items-start justify-start gap-0.5 rounded-none! bg-card px-3 py-3 text-left font-normal data-[state=on]:bg-primary/5 data-[state=on]:shadow-[inset_0_-2px_0_var(--primary)]"
          >
            <TileBody label={o.label} value={o.value} caption={o.caption} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Card>
  );
}

/** A compact tile: a small caps label over one short value (a quote strip's IV, expiry and move). */
export function TileChip({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <Card size="sm" className="min-w-0 gap-0 px-2.5 py-1.5">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="num text-sm font-medium whitespace-nowrap">{value}</span>
    </Card>
  );
}
