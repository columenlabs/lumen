import {
  type CardStyle,
  type MeterKind,
  type ViewAgg,
  type ViewFormat,
  type ViewOwnTile,
  type ViewTile,
  isCountAgg,
  isOwnTile,
  meterTone,
} from '@columenlabs/lumen-ui-types/views';
import { type ReactNode, useMemo } from 'react';
import { KIT } from './kit-config';
import { lazyPart } from './lazy-part';
import { cn } from './lib/utils';
import { type FilterField, filterByTokens } from './lumen-filter';
import { ViewValueCell } from './lumen-view';
import { Tile } from './tile';
import { Progress } from './ui/progress';
import { Skeleton } from './ui/skeleton';
import {
  type ViewCellValue,
  type ViewDomain,
  type ViewField,
  computedOf,
  rollUp,
} from './view-model';

/** One figure of a card: a value in its field's format, or plain text. */
export type Figure =
  | { kind: 'value'; value: ViewCellValue; format: ViewFormat; amount: boolean; suffix?: string }
  | { kind: 'text'; text: string };

/** A card's main number and lines over `rows` (the Summary's rows); null when its field is gone. */
export function figuresOf<T>(
  domain: ViewDomain<T>,
  t: ViewOwnTile,
  rows: T[],
  fields: FilterField<T>[],
): { main: Figure & { kind: 'value' }; lines: Figure[] } | null {
  const computed = computedOf(domain, rows, null);
  const field = (k: string) => domain.fields.find((f) => f.key === k);
  const roll = (f: ViewField<T>, agg: ViewOwnTile['agg'], rs: T[]) =>
    rollUp(
      rs.map((r) => computed.value(f, r)),
      agg,
    );
  const f = field(t.field);
  if (!f) return null;
  const count = isCountAgg(t.agg);
  const value = roll(f, t.agg, filterByTokens(rows, fields, t.filter));
  const main = {
    kind: 'value' as const,
    value,
    format: (count ? 'rounded' : f.format) as ViewFormat,
    amount: !count && !!f.amount,
    suffix: t.suffix || undefined,
  };
  const lines = t.lines.flatMap((l): Figure[] => {
    if (l.kind === 'text') return [{ kind: 'text', text: l.text }];
    const lf = field(l.field);
    if (!lf) return [];
    if (l.kind === 'pct') {
      const of = roll(lf, l.agg, rows);
      const pct =
        typeof value === 'number' && typeof of === 'number' && of !== 0 ? (value / of) * 100 : null;
      return [
        { kind: 'value', value: pct, format: 'weight', amount: false, suffix: `of ${lf.label}` },
      ];
    }
    const c = isCountAgg(l.agg);
    return [
      {
        kind: 'value',
        value: roll(lf, l.agg, filterByTokens(rows, fields, l.filter)),
        format: c ? 'rounded' : lf.format,
        amount: !c && !!lf.amount,
        suffix: l.suffix || undefined,
      },
    ];
  });
  return { main, lines };
}

export function FigureText({ f }: { f: Figure }) {
  if (f.kind === 'text') return <>{f.text}</>;
  return (
    <>
      <ViewValueCell value={f.value} format={f.format} amount={f.amount} />
      {f.suffix ? ` ${f.suffix}` : null}
    </>
  );
}

/** A card of the view's own as the page shows it. */
export function OwnTile<T>({
  domain,
  tile: t,
  rows,
  fields,
}: {
  domain: ViewDomain<T>;
  tile: ViewOwnTile;
  rows: T[];
  fields: FilterField<T>[];
}) {
  const figs = useMemo(() => figuresOf(domain, t, rows, fields), [domain, t, rows, fields]);
  if (!figs) return null;
  const v = figs.main.value;
  return (
    <Tile
      label={t.label}
      value={<FigureText f={figs.main} />}
      valueClassName={cn(
        t.sign && typeof v === 'number' && (v > 0 ? 'text-gain' : v < 0 ? 'text-loss' : ''),
      )}
      lines={figs.lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a card's lines in their saved order
        <FigureText key={i} f={l} />
      ))}
    />
  );
}

/**
 * A LumenCard's number and lines: its frame shows the label, so the body is
 * the main number and its lines; a domain's own card keeps the app's drawing without its frame.
 */
export function LumenCard<T>({
  domain,
  tile: t,
  rows,
  fields,
  drawn,
  loading,
  style = 'number',
  target,
  meter,
  bands,
}: {
  domain: ViewDomain<T>;
  tile: ViewTile;
  rows: T[];
  fields: FilterField<T>[];
  /** Draws one of the domain's own cards over `rows`. */
  drawn?: (key: string, rows: T[]) => ReactNode;
  loading?: boolean;
  /** Its number, or that number against `target` as a bar or a ring. */
  style?: CardStyle;
  target?: number;
  /** What the share of `target` means, which colours the bar or ring. */
  meter?: MeterKind;
  bands?: { warn: number; bad: number };
}) {
  const figs = useMemo(
    () => (isOwnTile(t) ? figuresOf(domain, t, rows, fields) : null),
    [domain, t, rows, fields],
  );
  if (loading) return <Skeleton className="h-7 w-24" />;
  if (!isOwnTile(t))
    return (
      <div className="[&>[data-slot=card]]:bg-transparent [&>[data-slot=card]]:px-0 [&>[data-slot=card]]:py-0 [&>[data-slot=card]]:ring-0 [&>[data-slot=card]>span:first-child]:hidden">
        {drawn?.(t.key, rows)}
      </div>
    );
  if (!figs) return <span className="text-xs text-muted-foreground">Its field is gone.</span>;
  const v = figs.main.value;
  const share =
    style !== 'number' && target && typeof v === 'number'
      ? Math.max(0, Math.min(100, (v / target) * 100))
      : null;
  const tone = meterTone(meter, share, bands ?? (meter === 'usage' ? usageBands() : undefined));
  const of = target ? (
    <ViewValueCell value={target} format={figs.main.format} amount={figs.main.amount} />
  ) : null;
  if (style === 'progress_circle')
    return (
      <div className="flex min-w-0 items-center gap-3">
        <ProgressRing value={share} tone={tone} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="num truncate text-xl leading-7 font-semibold">
            <FigureText f={figs.main} />
          </span>
          <span className="num truncate text-xs text-muted-foreground">
            {of ? <>of {of}</> : 'Set a target in Edit widget'}
          </span>
        </div>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span
        className={cn(
          'num truncate text-2xl leading-8 font-semibold',
          t.sign && typeof v === 'number' && (v > 0 ? 'text-gain' : v < 0 ? 'text-loss' : ''),
        )}
      >
        <FigureText f={figs.main} />
      </span>
      {style === 'progress_bar' && (
        <div className="flex flex-col gap-1 pt-1">
          <Progress
            value={share ?? 0}
            className={cn('h-2', tone && TONE_BAR[tone])}
            aria-label="Progress to target"
          />
          <span className="num text-xs text-muted-foreground">
            {of ? (
              <>
                {share === null ? '—' : `${share.toFixed(0)}%`} of {of}
              </>
            ) : (
              'Set a target in Edit widget'
            )}
          </span>
        </div>
      )}
      {figs.lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a card's lines in their saved order
        <span key={i} className="num line-clamp-2 text-xs text-muted-foreground">
          <FigureText f={l} />
        </span>
      ))}
    </div>
  );
}

/** A usage meter's bands from the app's `meterLevels`, in %. */
const usageBands = () => ({
  warn: KIT.meterLevels.watch * 100,
  bad: KIT.meterLevels.alert * 100,
});

// The ring draws with the charts library, so it loads only when a card shows one.
const ProgressRing = lazyPart(
  () => import('./progress-ring').then((m) => m.ProgressRing),
  <Skeleton className="size-16 shrink-0 rounded-full" />,
);

/** A meter's tone on a bar's fill (theme tokens, no glow). */
const TONE_BAR = {
  success: '[&>[data-slot=progress-indicator]]:bg-success',
  warning: '[&>[data-slot=progress-indicator]]:bg-warning',
  destructive: '[&>[data-slot=progress-indicator]]:bg-destructive',
} as const;

/** A Summary's cards over its rows; null when it has none to show. */
export function SummaryTiles<T>({
  domain,
  tiles,
  rows,
  fields,
  tile,
  loading,
}: {
  domain: ViewDomain<T>;
  tiles: ViewTile[];
  /** The rows the Summary shows: the view's, narrowed by the Summary's own filter. */
  rows: T[];
  fields: FilterField<T>[];
  /** Draws one of the domain's own cards over `rows`. */
  tile?: (key: string, rows: T[]) => ReactNode;
  /** While the view's rows load, each card holds its place. */
  loading?: boolean;
}) {
  const shown = tiles.filter((t) => isOwnTile(t) || tile);
  if (!shown.length) return null;
  // Each card fills its column, as a header's metric cards do (`TileRow fill`), not the fixed tile width.
  const grid =
    'grid grid-cols-2 gap-(--shell-section-gap) md:auto-cols-fr md:grid-flow-col lg:*:*:w-auto';
  if (loading)
    return (
      <div data-slot="view-tiles" aria-busy="true" className={grid}>
        {shown.map((t) => (
          <Skeleton key={t.key} className="h-[4.5rem] w-full rounded-xl" />
        ))}
      </div>
    );
  return (
    <div
      data-slot="view-tiles"
      className={cn(
        grid,
        // Each tile sits in a `contents` holder, so the odd last one's span goes on what it holds.
        '[&>*:last-child:nth-child(odd)>*]:col-span-2 md:[&>*:last-child:nth-child(odd)>*]:col-span-1',
      )}
    >
      {shown.map((t) => (
        <div key={t.key} className="contents">
          {isOwnTile(t) ? (
            <OwnTile domain={domain} tile={t} rows={rows} fields={fields} />
          ) : (
            tile?.(t.key, rows)
          )}
        </div>
      ))}
    </div>
  );
}
// ── Card rules (the editor lives in summary-cards-editor.tsx) ─────────────────────────────────

// A number the page draws its own way (a meter, a unit) still reads its raw value, so it rolls up.
export const isNumber = <T,>(f: ViewField<T>) => f.format !== 'text';

/**
 * The roll-up a card over `f` starts with, so any field makes a sensible number: text counts its
 * different values, a percent or weight takes its highest (shares never add up), the rest sum.
 * Given the card's `agg`, keeps it when it still fits the field.
 */
export function cardAgg<T>(f: ViewField<T> | undefined, agg?: ViewAgg): ViewAgg {
  const share = f?.format === 'percent' || f?.format === 'weight';
  if (agg && (isCountAgg(agg) || (f && isNumber(f) && !(share && agg === 'sum')))) return agg;
  if (!f || !isNumber(f)) return 'distinct';
  return share ? 'max' : 'sum';
}

/** What is wrong with each of the cards: a key, a label or a field; null where nothing. */
export function summaryCardIssues(tiles: ViewTile[], fields: string[], domainTiles: string[]) {
  return tiles.map((t, i) => {
    if (!isOwnTile(t)) return null;
    if (domainTiles.includes(t.key) || tiles.slice(0, i).some((x) => x.key === t.key))
      return `Key ${t.key} is taken`;
    if (!t.label.trim()) return 'Give it a label';
    if (!fields.includes(t.field)) return `Pick a field (${t.field || 'none'} is not one)`;
    const line = t.lines.find((l) => l.kind !== 'text' && !fields.includes(l.field));
    if (line) return 'Pick a field for each line';
    return null;
  });
}
