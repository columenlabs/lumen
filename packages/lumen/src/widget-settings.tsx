// Edit widget's own parts (one editor for every widget). Every widget opens the
// same editor (view-editor.tsx): Widget (type, name, width, link colour), Fields, Settings, Rows,
// Formulas, Controls, with the field tree beside it. A table's Fields are its columns; any other
// widget's are its slots (By and Value, Date and Values, a card's number), which the tree fills the
// same way it ticks a column. Settings are the picked style's own options. Switching the type
// swaps only these two parts.
import {
  type MarketWindow,
  OUTLOOK_INDEXES,
  marketWindows,
} from '@columenlabs/lumen-ui-types/market';
import {
  ALLOCATION_MAX,
  type ViewTile,
  type ViewWidget,
  isOwnTile,
  isRowCard,
  isTableCard,
  trendBuckets,
  widgetStyleId,
} from '@columenlabs/lumen-ui-types/views';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { FilterField } from './lumen-filter';
import { LumenSelector } from './lumen-selector';
import { SummaryCardsEditor, summaryCardIssues } from './summary-cards';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { MAX_TILES, fieldOptions } from './view-formulas';
import type { ViewDomain, ViewField } from './view-model';

/** A widget the editor draws its own parts for: anything but a table of the rows. */
export type WidgetDraft = Exclude<ViewWidget, { kind: 'table'; style: 'table' }>;

/** A label beside its control, the same in every section of Edit widget. */
export function EditorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const isTextField = <T,>(f: ViewField<T>) => f.format === 'text' && !f.render;
export const isNumberField = <T,>(f: ViewField<T>) => f.format !== 'text' && !f.render;
const DATE_LIKE = /(^|_)(date|day|at|time|month|week|year)($|_)/i;
/** A trend's date candidates: text fields, the date-like ones first. */
export const dateFields = <T,>(domain: ViewDomain<T>) => {
  // A rendered text field still reads its raw value (a report date drawn as Tue, Oct 20).
  const texts = domain.fields.filter((f) => f.format === 'text');
  return [
    ...texts.filter((f) => DATE_LIKE.test(f.key)),
    ...texts.filter((f) => !DATE_LIKE.test(f.key)),
  ];
};

/**
 * One place a widget takes fields: what it takes (`accepts`, `why` when a field does not fit),
 * how many (`max`), the keys in it now and the widget with other keys. A table's one slot is its
 * columns, kept in the view editor itself.
 */
export interface WidgetSlot<T> {
  id: string;
  label: string;
  max: number;
  accepts: (f: ViewField<T>) => boolean;
  why: string;
  keys: string[];
  set: (keys: string[]) => WidgetDraft;
}

/** The most columns a Top N shows. */
const TOP_N_COLUMNS = 8;
/** How many values a trend draws, a spark or tracker one. */
const TREND_VALUES = 4;

/** A free Summary card key. */
const freeTileKey = (tiles: ViewTile[], taken: string[]) => {
  let n = tiles.length + 1;
  while (tiles.some((t) => t.key === `tile_${n}`) || taken.includes(`tile_${n}`)) n++;
  return `tile_${n}`;
};

/** A widget's slots, in the order the editor lists them; none for a chart of symbols. */
export function widgetSlots<T>(card: WidgetDraft, domain: ViewDomain<T>): WidgetSlot<T>[] {
  const label = (k: string) => domain.fields.find((f) => f.key === k)?.label ?? k;
  const text = { accepts: isTextField<T>, why: 'Takes a text field' };
  const number = { accepts: isNumberField<T>, why: 'Takes a number' };
  if ('by' in card)
    return [
      {
        id: 'by',
        label: 'By',
        max: 1,
        ...text,
        keys: [card.by],
        set: ([by]) => ({ ...card, by: by ?? card.by }),
      },
      {
        id: 'value',
        label: 'Value',
        max: 1,
        ...number,
        keys: [card.value],
        set: ([value]) => ({ ...card, value: value ?? card.value }),
      },
    ];
  if (card.kind === 'table')
    return [
      {
        id: 'columns',
        label: 'Columns',
        max: TOP_N_COLUMNS,
        accepts: (f) => !f.render,
        why: 'Drawn by the page only',
        keys: card.columns,
        set: (columns) => (columns.length ? { ...card, columns } : card),
      },
      {
        id: 'sort',
        label: 'Sort by',
        max: 1,
        accepts: (f) => !f.render,
        why: 'Drawn by the page only',
        keys: [card.sort],
        set: ([sort]) => ({ ...card, sort: sort ?? card.sort }),
      },
    ];
  if ('date' in card) {
    const one = card.style === 'spark' || card.style === 'tracker';
    const dates = new Set(dateFields(domain).map((f) => f.key));
    return [
      {
        id: 'date',
        label: 'Date',
        max: 1,
        accepts: (f) => dates.has(f.key),
        why: 'Takes a date',
        keys: [card.date],
        set: ([date]) => ({ ...card, date: date ?? card.date }),
      },
      {
        id: 'values',
        label: 'Values',
        max: one ? 1 : TREND_VALUES,
        ...number,
        keys: card.values,
        set: (values) => (values.length ? { ...card, values } : card),
      },
    ];
  }
  if ('tile' in card) {
    const t = card.tile;
    return [
      {
        id: 'number',
        label: 'Number',
        max: 1,
        ...number,
        keys: isOwnTile(t) ? [t.field] : [],
        set: ([field]) =>
          field
            ? {
                ...card,
                tile: isOwnTile(t)
                  ? { ...t, field }
                  : {
                      key: t.key,
                      label: label(field),
                      field,
                      agg: 'sum',
                      filter: [],
                      sign: false,
                      lines: [],
                    },
              }
            : card,
      },
    ];
  }
  if (isRowCard(card)) {
    const tiles = card.tiles ?? [];
    const builtIns = (domain.tiles ?? []).map((w) => w.key);
    return [
      {
        id: 'cards',
        label: 'Cards',
        max: MAX_TILES,
        ...number,
        keys: tiles.filter(isOwnTile).map((t) => t.field),
        // A field ticked adds a card of its sum; one unticked takes its cards out.
        set: (keys) => {
          const kept = tiles.filter((t) => !isOwnTile(t) || keys.includes(t.field));
          const next = [...kept];
          for (const field of keys) {
            if (next.some((t) => isOwnTile(t) && t.field === field)) continue;
            next.push({
              key: freeTileKey(next, builtIns),
              label: label(field),
              field,
              agg: 'sum',
              filter: [],
              sign: false,
              lines: [],
            });
          }
          return { ...card, tiles: next };
        },
      },
    ];
  }
  return [];
}

/** A slot's keys after the tree ticks or unticks `key`: one replaces, a list adds up to its max. */
export function slotKeys<T>(slot: WidgetSlot<T>, key: string, on: boolean) {
  if (slot.max === 1) return on ? [key] : slot.keys;
  if (!on) return slot.keys.filter((k) => k !== key);
  return slot.keys.length < slot.max ? [...slot.keys, key] : slot.keys;
}

/**
 * Fields: each slot as a picker (the tree beside fills the same ones), a number card's or a
 * Summary's cards, or a chart's symbols.
 */
export function WidgetFields<T>({
  card,
  set,
  domain,
  rows,
  fields,
}: {
  card: WidgetDraft;
  set: (c: WidgetDraft) => void;
  domain: ViewDomain<T>;
  /** The widget's rows (after its own filter), for the card previews. */
  rows: T[];
  fields: FilterField<T>[];
}) {
  const [symbols, setSymbols] = useState(
    card.kind === 'chart' && card.style === 'market' ? card.symbols.join(', ') : '',
  );
  const keys = domain.fields.map((f) => f.key);
  const domainTiles = (domain.tiles ?? []).map((w) => w.key);
  if ('tile' in card)
    return (
      <SummaryCardsEditor
        one
        domain={domain}
        tiles={[card.tile]}
        onChange={(tiles) => {
          const tile = tiles[tiles.length - 1];
          if (tile) set({ ...card, tile });
        }}
        rows={rows}
        fields={fields}
        problems={summaryCardIssues([card.tile], keys, domainTiles)}
      />
    );
  if (isRowCard(card))
    return (
      <SummaryCardsEditor
        domain={domain}
        tiles={card.tiles ?? []}
        onChange={(tiles) => set({ ...card, tiles })}
        rows={rows}
        fields={fields}
        problems={summaryCardIssues(card.tiles ?? [], keys, domainTiles)}
      />
    );
  if (card.kind === 'chart' && card.style === 'market')
    return (
      <EditorRow label="Symbols">
        <Input
          aria-label="Symbols, comma separated"
          value={symbols}
          placeholder={OUTLOOK_INDEXES.join(', ')}
          onChange={(e) => {
            setSymbols(e.target.value);
            const list = [
              ...new Set(
                e.target.value
                  .toUpperCase()
                  .split(/[\s,]+/)
                  .filter(Boolean),
              ),
            ];
            if (list.length) set({ ...card, symbols: list });
          }}
        />
      </EditorRow>
    );
  if (card.kind === 'chart' && card.style === 'price')
    return (
      <EditorRow label="Symbol">
        <Input
          aria-label="Symbol"
          value={card.symbol}
          placeholder="SPX"
          onChange={(e) => set({ ...card, symbol: e.target.value.trim().toUpperCase() })}
        />
      </EditorRow>
    );
  const slots = widgetSlots(card, domain);
  if (!slots.length)
    return <p className="text-sm text-muted-foreground">It draws each shown row's own curve.</p>;
  return (
    <div className="flex max-w-xl flex-col gap-3">
      {slots.map((s) => (
        <EditorRow key={s.id} label={s.label}>
          <LumenSelector
            label={s.label}
            size="sm"
            className="w-full min-w-0"
            placeholder="Pick a field"
            options={fieldOptions(domain.fields.filter(s.accepts), domain)}
            {...(s.max === 1
              ? {
                  value: s.keys[0] ?? '',
                  onChange: (k: string) => set(s.set([k])),
                }
              : {
                  multiple: true as const,
                  max: s.max,
                  value: s.keys,
                  onChange: (ks: string[]) => set(s.set(ks)),
                })}
          />
        </EditorRow>
      ))}
    </div>
  );
}

const NO_SPLIT = '__none';
const BUCKET_NAMES: Record<(typeof trendBuckets)[number], string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};
const TREND_AGGS = [
  ['sum', 'Sum'],
  ['mean', 'Average'],
  ['last', 'Last'],
  ['count', 'Count'],
] as const;
/** The most slices a donut or a bar shows on their own; the most rows a list ranks. */
const MAX_SLICES = { donut: 12, bar: 50 } as const;
const MAX_RANKED = { bar_list: 30, top_n: 50 } as const;

function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly (readonly [V, ReactNode])[];
  onChange: (v: V) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={value}
      onValueChange={(v) => v && onChange(v as V)}
      aria-label={label}
      className="flex-wrap justify-self-start"
    >
      {options.map(([v, l]) => (
        <ToggleGroupItem key={v} value={v} className="px-2.5">
          {l}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const ORDERS = [
  [
    'desc',
    <span key="desc" className="contents">
      <ArrowDownIcon /> Largest
    </span>,
  ],
  [
    'asc',
    <span key="asc" className="contents">
      <ArrowUpIcon /> Smallest
    </span>,
  ],
] as const;

/** Whether a widget has Settings of its own. */
export const hasWidgetSettings = (card: WidgetDraft) =>
  !(card.kind === 'metric' && (card.style === 'number' || card.style === 'row'));

/** Settings: the picked style's own options. */
export function WidgetSettings<T>({
  card,
  set,
  domain,
}: {
  card: WidgetDraft;
  set: (c: WidgetDraft) => void;
  domain: ViewDomain<T>;
}) {
  const sid = widgetStyleId(card);
  const texts = domain.fields.filter(isTextField);
  return (
    <div className="flex max-w-xl flex-col gap-3">
      {card.kind === 'allocation' && card.style !== 'bar_list' && (
        <EditorRow label="Slices">
          <Input
            aria-label="Slices (the rest are Other)"
            type="number"
            className="w-24"
            min={2}
            max={MAX_SLICES[card.style]}
            value={card.max ?? ALLOCATION_MAX}
            onChange={(e) => set({ ...card, max: Number(e.target.value) })}
          />
        </EditorRow>
      )}
      {(sid === 'allocation:bar_list' || sid === 'table:top_n') && 'n' in card && (
        <>
          <EditorRow label="Order">
            <Choice
              label="Order"
              value={card.desc ? 'desc' : 'asc'}
              options={ORDERS}
              onChange={(v) => set({ ...card, desc: v === 'desc' })}
            />
          </EditorRow>
          <EditorRow label={sid === 'allocation:bar_list' ? 'Bars' : 'Rows'}>
            <Input
              aria-label="How many"
              type="number"
              className="w-24"
              min={1}
              max={sid === 'allocation:bar_list' ? MAX_RANKED.bar_list : MAX_RANKED.top_n}
              value={card.n}
              onChange={(e) => set({ ...card, n: Number(e.target.value) })}
            />
          </EditorRow>
        </>
      )}
      {card.kind === 'allocation' && card.style === 'bar_list' && (
        <>
          <EditorRow label="Colour">
            <Label className="flex items-center gap-2 font-normal">
              <Switch
                checked={card.signed}
                onCheckedChange={(signed) =>
                  set({ ...card, signed, ...(signed ? { stack: undefined } : {}) })
                }
              />
              Gains green, losses red
            </Label>
          </EditorRow>
          {!card.signed && (
            <EditorRow label="Split by">
              <LumenSelector
                label="Split each bar by"
                size="sm"
                className="w-full min-w-0"
                options={[
                  { value: NO_SPLIT, label: 'No split' },
                  ...fieldOptions(
                    texts.filter((f) => f.key !== card.by),
                    domain,
                  ),
                ]}
                value={card.stack ?? NO_SPLIT}
                onChange={(v) => set({ ...card, stack: v === NO_SPLIT ? undefined : v })}
              />
            </EditorRow>
          )}
        </>
      )}
      {card.kind === 'chart' && card.style === 'market' && (
        <EditorRow label="Style">
          <Choice
            label="Style"
            value={card.layout}
            options={[
              ['lines', 'One chart'],
              ['tiles', 'A widget each'],
              ['today', 'Up or down today'],
            ]}
            onChange={(layout) => set({ ...card, layout })}
          />
        </EditorRow>
      )}
      {card.kind === 'chart' && card.style === 'price' && (
        <>
          <EditorRow label="Window">
            <Choice
              label="Window"
              value={card.window}
              options={marketWindows.map((w) => [w, w] as const)}
              onChange={(window: MarketWindow) => set({ ...card, window })}
            />
          </EditorRow>
          <EditorRow label="Type">
            <Choice
              label="Chart type"
              value={card.type}
              options={[
                ['line', 'Line'],
                ['candles', 'Candles'],
              ]}
              onChange={(type) => set({ ...card, type })}
            />
          </EditorRow>
        </>
      )}
      {card.kind === 'chart' && card.style === 'growth' && (
        <EditorRow label="Scale">
          <Choice
            label="Scale"
            value={card.scale}
            options={[
              ['log', 'Log'],
              ['linear', 'Linear'],
            ]}
            onChange={(scale) => set({ ...card, scale })}
          />
        </EditorRow>
      )}
      {'date' in card && (
        <>
          <EditorRow label="Each">
            <Choice
              label="Each"
              value={card.bucket}
              options={trendBuckets.map((b) => [b, BUCKET_NAMES[b]] as const)}
              onChange={(bucket) => set({ ...card, bucket })}
            />
          </EditorRow>
          <EditorRow label="Roll up">
            <Choice
              label="Roll up"
              value={card.agg}
              options={TREND_AGGS}
              onChange={(agg) => set({ ...card, agg })}
            />
          </EditorRow>
        </>
      )}
      {'tile' in card && card.style !== 'number' && (
        <EditorRow label="Target">
          <Input
            aria-label="Target (the bar's 100%)"
            type="number"
            min={0}
            value={card.target ?? ''}
            placeholder="The bar's 100%"
            onChange={(e) => {
              const n = Number(e.target.value);
              set({ ...card, target: e.target.value && n > 0 ? n : undefined });
            }}
          />
        </EditorRow>
      )}
      {'tile' in card && card.style !== 'number' && (
        <EditorRow label="Colour">
          <Choice
            label="Colour by meaning"
            value={card.meter ?? 'none'}
            options={METER_CHOICES}
            onChange={(m) => set({ ...card, meter: m === 'none' ? undefined : m })}
          />
        </EditorRow>
      )}
    </div>
  );
}

/** A progress card's colour: plain, health (better high) or usage (better low). */
const METER_CHOICES = [
  ['none', 'Plain'],
  ['health', 'Health: 100% green'],
  ['usage', 'Usage: 75% orange, 90% red'],
] as const;

/** Whether a widget reads the view's rows (a chart of symbols reads its own data). */
export const readsRows = (card: ViewWidget) =>
  isTableCard(card) ||
  !(card.kind === 'chart' && (card.style === 'market' || card.style === 'price'));
