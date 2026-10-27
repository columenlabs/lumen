// A small labelled number with optional lines under it (lines): a view's widgets and tiles, and an app's stat tiles.
// TileToggleGroup is the clickable kind: one joined strip of tiles that picks what a page shows,
// set beside plain Tiles in a page's header row (an app coverage pages, 2026-10-09). On desktop
// every tile in the row is one fixed width (`TILE_WIDTH`), the row does not stretch, and it never
// wraps: `TileRow` keeps it on one line and narrow screens shrink the tiles instead.
// A tile with `spark` is a metric card: its daily history as a small line under the number.
import type { ReactNode } from 'react';
import { cn } from './lib/utils';
import { Card } from './ui/card';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** A number's history as a small line and area, scaled to its own range; `color` is a theme
 *  token (SVG reads CSS variables, so it follows the theme). Fewer than two points draw nothing. */
export function TileSpark({
  values,
  color = 'var(--chart-1)',
  className,
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts = values.map(
    (v, i) =>
      `${((i / (values.length - 1)) * 100).toFixed(2)},${(22 - ((v - min) / span) * 20).toFixed(2)}`,
  );
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden="true"
      // Inline size: a parent's `[&_svg]:size-4` (toggle items, buttons) must not shrink it.
      style={{ width: '100%', height: '1.5rem' }}
      className={cn('overflow-visible', className)}
    >
      <polygon points={`0,24 ${pts.join(' ')} 100,24`} fill={color} fillOpacity={0.15} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TileBody({
  label,
  value,
  caption,
  lines,
  valueClassName,
  spark,
  sparkColor,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  lines?: ReactNode[];
  valueClassName?: string;
  spark?: number[];
  sparkColor?: string;
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
      {spark ? <TileSpark values={spark} color={sparkColor} className="mt-1 self-stretch" /> : null}
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
  spark,
  sparkColor,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  /** Secondary lines under the value, one each (a Summary card's). */
  lines?: ReactNode[];
  className?: string;
  valueClassName?: string;
  /** The number's history (oldest first), drawn as a small line under it: a metric card. */
  spark?: number[];
  /** The line's colour, a theme token; left out, `var(--chart-1)`. */
  sparkColor?: string;
}) {
  return (
    // One width for every tile in a row: fixed from lg up, two to a row (growing) below it.
    <Card
      size="sm"
      className={cn('min-w-0 flex-1 basis-2/5 gap-0.5 px-3 lg:basis-auto', TILE_WIDTH, className)}
    >
      <TileBody
        label={label}
        value={value}
        caption={caption}
        lines={lines}
        valueClassName={valueClassName}
        spark={spark}
        sparkColor={sparkColor}
      />
    </Card>
  );
}

/** Width of every header tile on desktop, toggle tiles and plain Tiles alike; shrinks to fit the row. */
export const TILE_WIDTH = 'lg:w-(--tile-width) lg:flex-initial';

/** A page's header row of tiles: wraps on phones, one line on desktop. `fill` shares the row's
 *  width between its tiles (a row of metric cards) instead of the fixed tile width. */
export function TileRow({
  children,
  className,
  fill,
  ...props
}: { children: ReactNode; className?: string; fill?: boolean; 'aria-label'?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap gap-2.5 lg:flex-nowrap',
        fill && 'lg:*:w-auto lg:*:flex-1',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TileOption {
  id: string;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  /** The option's history, a small line under its number (see `Tile`). */
  spark?: number[];
  sparkColor?: string;
}

export function TileToggleGroup({
  options,
  selected,
  onSelect,
  label,
  className,
  fill,
}: {
  options: TileOption[];
  selected: string;
  onSelect: (id: string) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
  /** Spans the row, its tiles sharing the width (see `TileRow`). */
  fill?: boolean;
}) {
  return (
    <Card
      size="sm"
      className={cn(
        'min-w-0 gap-0 bg-border py-0 lg:w-fit lg:flex-initial',
        fill &&
          'lg:w-full lg:*:data-[slot=toggle-group]:w-full lg:**:data-[slot=toggle-group-item]:flex-1',
        className,
      )}
    >
      <ToggleGroup
        type="single"
        spacing={0}
        value={selected}
        onValueChange={(v) => v && onSelect(v)}
        aria-label={label}
        className="grid w-full grid-cols-2 gap-px max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] lg:flex lg:w-fit"
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o.id}
            value={o.id}
            aria-label={o.label}
            className="h-auto min-w-0 flex-col lg:w-(--tile-width) lg:shrink items-start justify-start gap-0.5 rounded-none! bg-card px-3 py-3 text-left font-normal data-[state=on]:bg-primary/5 data-[state=on]:shadow-[inset_0_-2px_0_var(--primary)]"
          >
            <TileBody
              label={o.label}
              value={o.value}
              caption={o.caption}
              spark={o.spark}
              sparkColor={o.sparkColor}
            />
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
