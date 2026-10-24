// What LumenCoverageMap and LumenCoverageCalendarMap share: one state per cell, its look, the legend of the states on screen and the cell with its
// tooltip. A colour fix here reaches every coverage surface.
import { type ReactNode, memo, useRef, useState } from 'react';
import { cn } from './lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** A backfill's state on a block it touches; it wins over coverage while the job runs. */
/** `indexing`: the block's copy is done and a follow-up step (an index, a rollup) is still running on it. */
export type CoverageJobState = 'queued' | 'running' | 'indexing' | 'failed' | 'canceled';

/** One cell's state. Done is not its own state: a finished block simply turns `full`. */
export type CoverageLevel = 'full' | 'high' | 'low' | 'gap' | 'current' | 'none' | CoverageJobState;

export const COVERAGE_LEVELS: { level: CoverageLevel; label: string; className: string }[] = [
  { level: 'full', label: 'Complete', className: 'bg-cov-full' },
  { level: 'high', label: '95–99%', className: 'bg-cov-high' },
  { level: 'low', label: 'Under 95%', className: 'bg-cov-low' },
  { level: 'gap', label: 'Missing', className: 'bg-gap-hatch' },
  {
    level: 'current',
    label: 'This period',
    className:
      'bg-[linear-gradient(90deg,var(--cov-full)_0_45%,transparent_45%)] ring-1 ring-inset ring-cov-full',
  },
  { level: 'none', label: 'Not expected', className: 'ring-1 ring-inset ring-border' },
  {
    level: 'queued',
    label: 'Queued',
    className: 'outline-1 outline-dashed -outline-offset-1 outline-primary',
  },
  { level: 'running', label: 'Running', className: 'bg-cov-running' },
  { level: 'indexing', label: 'Indexing', className: 'bg-cov-indexing' },
  { level: 'failed', label: 'Failed', className: 'bg-destructive' },
  { level: 'canceled', label: 'Canceled', className: 'bg-cov-canceled' },
];

const BY_LEVEL = Object.fromEntries(COVERAGE_LEVELS.map((l) => [l.level, l])) as Record<
  CoverageLevel,
  (typeof COVERAGE_LEVELS)[number]
>;
export const coverageLabel = (l: CoverageLevel) => BY_LEVEL[l].label;
export const coverageClass = (l: CoverageLevel) => BY_LEVEL[l].className;

const JOB_ORDER: CoverageJobState[] = ['running', 'indexing', 'queued', 'failed', 'canceled'];

/** The state of a block from its sums: a job state first, then coverage. */
export function coverageLevel(
  have: number,
  expected: number,
  { current = false, state }: { current?: boolean; state?: CoverageJobState | null } = {},
): CoverageLevel {
  if (state) return state;
  if (expected <= 0) return have > 0 ? 'full' : 'none';
  if (have <= 0) return 'gap';
  if (have >= expected) return current ? 'current' : 'full';
  return have / expected >= 0.95 ? 'high' : 'low';
}

/** The job state that shows when a block holds several. */
export const firstJobState = (a: CoverageJobState | null, b: CoverageJobState | undefined) =>
  !b ? a : !a || JOB_ORDER.indexOf(b) < JOB_ORDER.indexOf(a) ? b : a;

/** The states on screen, in the legend's order, with a hint at the right. */
export function CoverageLegend({
  levels,
  hint,
  labels,
}: {
  levels: Set<CoverageLevel>;
  hint?: ReactNode;
  /** An app's own words for some states (`running`: `Copying`). */
  labels?: Partial<Record<CoverageLevel, string>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {COVERAGE_LEVELS.filter((l) => levels.has(l.level)).map((l) => (
        <span key={l.level} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('h-3 w-4 rounded-[3px]', l.className)} />
          {labels?.[l.level] ?? l.label}
        </span>
      ))}
      {hint && <span className="ml-auto hidden md:inline">{hint}</span>}
    </div>
  );
}

/**
 * One cell: a plain button. Its tooltip is the map's one shared `CoverageTip` (a Radix tooltip per
 * cell made a 100-row map 13,000 tooltips, seconds per render). `label` is the
 * accessible name and the tooltip's first line; `tip` marks the cell for the shared tooltip.
 */
export const CoverageCell = memo(function CoverageCell({
  level,
  label,
  tip,
  picked = false,
  disabled = false,
  pickable = false,
  onClick,
  className,
}: {
  level: CoverageLevel;
  label: string;
  /** What `CoverageTip` hands back to its `content` for this cell. */
  tip: string;
  picked?: boolean;
  disabled?: boolean;
  /** A click toggles it (shows pressed state); with no `onClick` the map handles the click. */
  pickable?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-cell={tip}
      aria-label={`${label}: ${coverageLabel(level)}`}
      aria-pressed={pickable && !disabled ? picked : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-w-0 rounded-[3px] p-0 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
        coverageClass(level),
        // outline-none would also hide the picked outline, so a picked cell must not carry it.
        picked
          ? 'outline-2 outline-offset-1 outline-foreground'
          : level === 'queued'
            ? ''
            : 'outline-none',
        pickable && !disabled && 'cursor-pointer',
        className,
      )}
    />
  );
});

/**
 * The one tooltip of a coverage map: it follows the cell under the pointer or keyboard focus inside
 * `children` (any element with `data-cell`) and shows `content` for it. Hovering re-renders only
 * this tooltip, never the grid.
 */
export function CoverageTip({
  content,
  children,
  className,
}: {
  /** The tooltip for a cell's `tip`; null shows none. */
  content: (tip: string) => { label: string; detail?: ReactNode } | null;
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ tip: string; x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const show = (target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-cell]') : null;
    const root = box.current;
    if (!el || !root || !root.contains(el)) return setAt(null);
    const r = el.getBoundingClientRect();
    const o = root.getBoundingClientRect();
    const tip = el.dataset.cell ?? '';
    setAt((prev) =>
      prev?.tip === tip
        ? prev
        : { tip, x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height },
    );
  };
  const body = at ? content(at.tip) : null;
  return (
    <div
      ref={box}
      className={cn('relative', className)}
      onPointerOver={(e) => e.pointerType !== 'touch' && show(e.target)}
      onPointerLeave={() => setAt(null)}
      onFocus={(e) => show(e.target)}
      onBlur={() => setAt(null)}
    >
      {children}
      {at && body && (
        <Tooltip key={at.tip} open>
          <TooltipTrigger asChild>
            <span
              aria-hidden
              className="pointer-events-none absolute"
              style={{ left: at.x, top: at.y, width: at.w, height: at.h }}
            />
          </TooltipTrigger>
          <TooltipContent className="num max-w-72">
            <div className="font-medium">{body.label}</div>
            {body.detail}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
