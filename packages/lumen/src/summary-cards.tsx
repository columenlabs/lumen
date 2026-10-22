import {
  type CardStyle,
  MAX_TILE_LINES,
  type MeterKind,
  type ViewFormat,
  type ViewOwnTile,
  type ViewTile,
  type ViewTileLine,
  isCountAgg,
  isOwnTile,
  meterTone,
  viewAggs,
} from '@columenlabs/lumen-ui-types/views';
// The Summary widget's cards:
// each card is one main number and any secondary lines. A domain's own cards (Value, Day P&L) are
// drawn by the app; a card of the view's own rolls one field or formula column up over the rows
// the Summary shows, narrowed by its own filter, and its lines are other roll-ups, a percent of a
// roll-up over all the Summary's rows, or plain text. `SummaryTiles` draws them; `SummaryCardsEditor`
// is the cards part of the Summary's Edit widget. Everything is worked out here from the rows the
// view already loaded.
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { LumenConfirm } from './confirm';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import {
  type FilterField,
  LumenTokenizedFilter,
  filterByTokens,
  useLumenFilter,
} from './lumen-filter';
import { LumenSelector } from './lumen-selector';
import { ViewValueCell } from './lumen-view';
import { Tile } from './tile';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { type ChartConfig, ChartContainer } from './ui/chart';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Progress } from './ui/progress';
import { Skeleton } from './ui/skeleton';
import { Switch } from './ui/switch';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { AGG_LABELS, MAX_TILES, fieldOptions } from './view-formulas';
import {
  type ViewCellValue,
  type ViewDomain,
  type ViewField,
  computedOf,
  rollUp,
  takesFormulas,
} from './view-model';

/** One figure of a card: a value in its field's format, or plain text. */
type Figure =
  | { kind: 'value'; value: ViewCellValue; format: ViewFormat; amount: boolean; suffix?: string }
  | { kind: 'text'; text: string };

/** A card's main number and lines over `rows` (the Summary's rows); null when its field is gone. */
function figuresOf<T>(
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

function FigureText({ f }: { f: Figure }) {
  if (f.kind === 'text') return <>{f.text}</>;
  return (
    <>
      <ViewValueCell value={f.value} format={f.format} amount={f.amount} />
      {f.suffix ? ` ${f.suffix}` : null}
    </>
  );
}

/** A card of the view's own as the page shows it. */
function OwnTile<T>({
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
  const tone = meterTone(meter, share, bands);
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

/** A meter's tone on a bar's fill (theme tokens, no glow). */
const TONE_BAR = {
  success: '[&>[data-slot=progress-indicator]]:bg-success',
  warning: '[&>[data-slot=progress-indicator]]:bg-warning',
  destructive: '[&>[data-slot=progress-indicator]]:bg-destructive',
} as const;

/** A number's share of its target as a ring, its percent in the middle (Recharts); a meter's
 *  tone colours it, else the first chart colour. */
function ProgressRing({
  value,
  tone,
}: {
  value: number | null;
  tone: ReturnType<typeof meterTone>;
}) {
  const config: ChartConfig = {
    v: { label: 'Progress', color: tone ? `var(--${tone})` : 'var(--chart-1)' },
  };
  return (
    <ChartContainer config={config} className="aspect-square size-16 shrink-0">
      <RadialBarChart
        data={[{ v: value ?? 0 }]}
        startAngle={90}
        endAngle={-270}
        innerRadius={24}
        outerRadius={32}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar
          dataKey="v"
          fill="var(--color-v)"
          background={{ fill: 'var(--muted)' }}
          cornerRadius={8}
          isAnimationActive={false}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="num fill-foreground"
          fontSize={12}
          fontWeight={600}
        >
          {value === null ? '—' : `${value.toFixed(0)}%`}
        </text>
      </RadialBarChart>
    </ChartContainer>
  );
}

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
  const grid = 'grid grid-cols-2 gap-(--shell-section-gap) md:auto-cols-fr md:grid-flow-col';
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
        '[&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1',
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

// ── Edit ───────────────────────────────────────────────────────────────────────────────────────

const dragOptions = { activationConstraint: { distance: 4 } };

const isNumber = <T,>(f: ViewField<T>) => f.format !== 'text' && !f.render;

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

function FieldPick<T>({
  value,
  fields,
  domain,
  label,
  onChange,
}: {
  value: string;
  fields: ViewField<T>[];
  domain: ViewDomain<T>;
  label: string;
  onChange: (key: string) => void;
}) {
  return (
    <LumenSelector
      label={label}
      size="sm"
      className="w-full min-w-0"
      placeholder="Pick a field"
      options={fieldOptions(fields, domain)}
      value={value}
      onChange={onChange}
    />
  );
}

function AggPick({
  value,
  label,
  onChange,
}: {
  value: ViewOwnTile['agg'];
  label: string;
  onChange: (agg: ViewOwnTile['agg']) => void;
}) {
  return (
    <LumenSelector
      label={label}
      size="sm"
      className="w-full min-w-0"
      options={viewAggs.map((a) => ({ value: a, label: AGG_LABELS[a] }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** A card in the editor's grid: its label, its value now and where it comes from. */
function CardChip({
  id,
  selected,
  onSelect,
  label,
  value,
  how,
  problem,
  domId,
}: {
  id: string;
  /** The chip's DOM id, which Save takes the person to when this card needs fixing. */
  domId?: string;
  selected: boolean;
  onSelect: () => void;
  label: string;
  value: ReactNode;
  how: string;
  problem?: boolean;
}) {
  const s = useSortable({ id });
  return (
    <Button
      ref={s.setNodeRef}
      id={domId}
      variant="outline"
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cn(
        'h-auto min-h-16 min-w-0 flex-col items-start justify-start gap-0.5 rounded-lg px-2.5 py-2 text-left font-normal whitespace-normal',
        selected && 'border-primary ring-3 ring-primary/15',
        problem && 'border-destructive',
        s.isDragging && 'z-20 shadow-md',
      )}
      {...s.attributes}
      {...s.listeners}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="w-full truncate text-xs text-muted-foreground">{label}</span>
      <span className="num w-full truncate text-sm font-semibold">{value}</span>
      <span className="w-full truncate text-[0.7rem] text-muted-foreground">{how}</span>
    </Button>
  );
}

/** A card's own rows filter, kept in step with the card. */
function CardFilter<T>({
  rows,
  fields,
  tokens,
  onChange,
}: {
  rows: T[];
  fields: FilterField<T>[];
  tokens: ViewOwnTile['filter'];
  onChange: (tokens: ViewOwnTile['filter']) => void;
}) {
  const filter = useLumenFilter(rows, fields, { initial: tokens });
  const next = JSON.stringify(filter.tokens);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports the box's tokens when they change
  useEffect(() => {
    if (next !== JSON.stringify(tokens)) onChange(filter.tokens);
  }, [next]);
  return (
    <LumenTokenizedFilter
      filter={filter}
      label="Card filter"
      placeholder="All the Summary's rows"
    />
  );
}

const LINE_KINDS: { value: ViewTileLine['kind']; label: string }[] = [
  { value: 'value', label: 'Number' },
  { value: 'pct', label: '% of' },
  { value: 'text', label: 'Text' },
];

function LineRow<T>({
  line,
  nums,
  fields,
  domain,
  onChange,
  onRemove,
}: {
  line: ViewTileLine;
  nums: ViewField<T>[];
  fields: ViewField<T>[];
  domain: ViewDomain<T>;
  onChange: (l: ViewTileLine) => void;
  onRemove: () => void;
}) {
  const first = nums[0]?.key ?? '';
  const as = (kind: ViewTileLine['kind']): ViewTileLine =>
    kind === 'text'
      ? { kind, text: 'Note' }
      : kind === 'pct'
        ? { kind, field: line.kind !== 'text' ? line.field : first, agg: 'sum' }
        : {
            kind,
            field: line.kind !== 'text' ? line.field : first,
            agg: 'sum',
            filter: [],
            suffix: '',
          };
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2">
      <div className="flex items-center gap-1.5">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          value={line.kind}
          onValueChange={(v) => v && onChange(as(v as ViewTileLine['kind']))}
          aria-label="Line kind"
        >
          {LINE_KINDS.map((k) => (
            <ToggleGroupItem key={k.value} value={k.value} className="px-2 text-xs">
              {k.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <IconButton icon={XIcon} label="Remove line" className="ml-auto" onClick={onRemove} />
      </div>
      {line.kind === 'text' ? (
        <Input
          aria-label="Line text"
          value={line.text}
          maxLength={60}
          onChange={(e) => onChange({ ...line, text: e.target.value })}
        />
      ) : (
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
          <AggPick
            value={line.agg}
            label="Line roll-up"
            onChange={(agg) => onChange({ ...line, agg })}
          />
          <FieldPick
            value={line.field}
            fields={isCountAgg(line.agg) ? fields : nums}
            domain={domain}
            label="Line field"
            onChange={(field) => onChange({ ...line, field })}
          />
          {line.kind === 'value' && (
            <Input
              aria-label="Words after the number"
              className="col-span-2"
              placeholder="Words after the number (contracts)"
              value={line.suffix}
              maxLength={30}
              onChange={(e) => onChange({ ...line, suffix: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Summary's cards in Edit widget: a grid to pick and drag, the domain's own cards to add or
 * remove, and the picked card of the view's own: its main number (label, roll-up, field, rows,
 * colour by sign) and its secondary lines.
 */
export function SummaryCardsEditor<T>({
  domain,
  tiles,
  onChange,
  rows,
  fields,
  problems,
  one = false,
}: {
  domain: ViewDomain<T>;
  tiles: ViewTile[];
  onChange: (tiles: ViewTile[]) => void;
  /** One card only (LumenCard): a built-in replaces it and there is no Add card. */
  one?: boolean;
  /** The Summary's rows, for the previews. */
  rows: T[];
  fields: FilterField<T>[];
  problems: (string | null)[];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, dragOptions),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const builtIns = domain.tiles ?? [];
  const [current, setCurrent] = useState<string | null>(
    tiles.find(isOwnTile)?.key ?? tiles[0]?.key ?? null,
  );
  const nums = domain.fields.filter(isNumber);
  const pickable = domain.fields.filter((f) => !f.render);
  const fieldOf = (k: string) => domain.fields.find((f) => f.key === k);
  const i = tiles.findIndex((t) => t.key === current);
  const picked = tiles[i];
  const own = picked && isOwnTile(picked) ? picked : undefined;
  const set = (p: Partial<ViewOwnTile>) =>
    onChange(tiles.map((t, j) => (j === i && isOwnTile(t) ? { ...t, ...p } : t)));
  const add = () => {
    let n = tiles.length + 1;
    while (tiles.some((t) => t.key === `tile_${n}`) || builtIns.some((w) => w.key === `tile_${n}`))
      n++;
    const key = `tile_${n}`;
    const field = (nums.find((f) => f.amount) ?? nums[0])?.key ?? '';
    onChange([
      ...tiles,
      { key, label: `Card ${n}`, field, agg: 'sum', filter: [], sign: false, lines: [] },
    ]);
    setCurrent(key);
  };
  const ownCount = tiles.filter(isOwnTile).length;
  const off = builtIns.filter((w) => !tiles.some((t) => t.key === w.key));
  const preview = (t: ViewTile) => {
    if (!isOwnTile(t)) return { value: 'Built in', how: 'Built in' };
    const figs = figuresOf(domain, t, rows, fields);
    return {
      value: figs ? <FigureText f={figs.main} /> : '—',
      how: `${AGG_LABELS[t.agg]} of ${fieldOf(t.field)?.label ?? t.field}`,
    };
  };
  return (
    <div className="flex flex-col gap-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e: DragEndEvent) => {
          const keys = tiles.map((t) => t.key);
          const from = keys.indexOf(String(e.active.id));
          const to = e.over ? keys.indexOf(String(e.over.id)) : -1;
          if (from >= 0 && to >= 0 && from !== to) onChange(arrayMove(tiles, from, to));
        }}
      >
        <SortableContext items={tiles.map((t) => t.key)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-3 gap-1.5" data-testid="summary-cards">
            {tiles.map((t, j) => {
              const p = preview(t);
              const label = isOwnTile(t)
                ? t.label
                : (builtIns.find((w) => w.key === t.key)?.label ?? t.key);
              return (
                <CardChip
                  key={t.key}
                  id={t.key}
                  selected={current === t.key}
                  onSelect={() => setCurrent(t.key)}
                  label={label}
                  value={p.value}
                  how={p.how}
                  problem={!!problems[j]}
                  domId={`summary-card-${j}`}
                />
              );
            })}
            {takesFormulas(domain) && !(one && tiles.length) && (
              <Button
                variant="outline"
                className="h-auto min-h-16 border-dashed font-normal text-muted-foreground"
                disabled={ownCount >= MAX_TILES}
                onClick={add}
              >
                <PlusIcon /> Add card
              </Button>
            )}
          </div>
        </SortableContext>
      </DndContext>
      {off.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Built in:</span>
          {off.map((w) => (
            <Button
              key={w.key}
              variant="outline"
              size="sm"
              onClick={() => {
                onChange(one ? [{ key: w.key }] : [...tiles, { key: w.key }]);
                setCurrent(w.key);
              }}
            >
              <PlusIcon /> {w.label}
            </Button>
          ))}
        </div>
      )}
      {picked && !own && (
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <Badge variant="secondary" className="font-normal">
            Built in
          </Badge>
          <span className="flex-1 text-sm">
            {builtIns.find((w) => w.key === picked.key)?.label ?? picked.key} works out its own
            lines.
          </span>
          <IconButton
            icon={Trash2Icon}
            label="Remove card"
            onClick={() => {
              onChange(tiles.filter((_, j) => j !== i));
              setCurrent(null);
            }}
          />
        </div>
      )}
      {own && (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Main number
            </span>
            <LumenConfirm
              title={`Remove card ${own.label}?`}
              description="It leaves this Summary when you save."
              action="Remove"
              onConfirm={() => {
                onChange(tiles.filter((_, j) => j !== i));
                setCurrent(null);
              }}
            >
              <IconButton icon={Trash2Icon} label="Remove card" variant="destructive" />
            </LumenConfirm>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            <Label htmlFor="card-label">Label</Label>
            <Input
              id="card-label"
              value={own.label}
              maxLength={40}
              onChange={(e) => set({ label: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
            <AggPick value={own.agg} label="Roll-up" onChange={(agg) => set({ agg })} />
            <FieldPick
              value={own.field}
              fields={isCountAgg(own.agg) ? pickable : nums}
              domain={domain}
              label="Field"
              onChange={(field) => set({ field })}
            />
            <Input
              aria-label="Words after the number"
              className="col-span-2"
              placeholder="Words after the number (places)"
              value={own.suffix ?? ''}
              maxLength={30}
              onChange={(e) => set({ suffix: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            <Label>Only rows where</Label>
            <CardFilter
              key={own.key}
              rows={rows}
              fields={fields}
              tokens={own.filter}
              onChange={(filter) => set({ filter })}
            />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Switch checked={own.sign} onCheckedChange={(sign) => set({ sign })} />
            Green or red by sign
          </Label>
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Secondary lines
          </span>
          {own.lines.map((l, j) => (
            <LineRow
              // biome-ignore lint/suspicious/noArrayIndexKey: lines have no key of their own
              key={j}
              line={l}
              nums={nums}
              fields={pickable}
              domain={domain}
              onChange={(next) => set({ lines: own.lines.map((x, k) => (k === j ? next : x)) })}
              onRemove={() => set({ lines: own.lines.filter((_, k) => k !== j) })}
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={own.lines.length >= MAX_TILE_LINES}
            onClick={() =>
              set({
                lines: [
                  ...own.lines,
                  {
                    kind: 'pct',
                    field: (nums.find((f) => f.amount) ?? nums[0])?.key ?? '',
                    agg: 'sum',
                  },
                ],
              })
            }
          >
            <PlusIcon /> Add line
          </Button>
          <div className="rounded-lg bg-muted/50 p-2">
            <OwnTile domain={domain} tile={own} rows={rows} fields={fields} />
          </div>
          {problems[i] && (
            <p role="alert" className="text-xs text-destructive">
              {problems[i]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
