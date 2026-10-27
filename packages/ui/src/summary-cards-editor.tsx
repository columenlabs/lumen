// The cards part of the Summary's Edit widget (cards reorder by drag), in a file of its own so the
// drag library loads with the editor, not with every page that draws a Summary.
import {
  MAX_TILE_LINES,
  type ViewOwnTile,
  type ViewTile,
  type ViewTileLine,
  isCountAgg,
  isOwnTile,
  viewAggs,
} from '@columenlabs/lumen-ui-types/views';
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
import { type ReactNode, useEffect, useState } from 'react';
import { LumenConfirm } from './confirm';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { type FilterField, LumenTokenizedFilter, useLumenFilter } from './lumen-filter';
import { LumenSelector } from './lumen-selector';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { AGG_LABELS, MAX_TILES, fieldOptions } from './view-formulas';
import { type ViewDomain, type ViewField, takesFormulas } from './view-model';

import { FigureText, OwnTile, figuresOf, isNumber } from './summary-cards';

const dragOptions = { activationConstraint: { distance: 4 } };

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
  const pickable = domain.fields;
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
                id="summary-card-add"
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
