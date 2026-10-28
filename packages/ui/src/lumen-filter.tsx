import type { JoinKey } from '@columenlabs/lumen-ui-types/domains';
import {
  CONTAINS_KEY,
  EMPTY_VALUE,
  type ViewTokenOp,
  meetsNumber,
} from '@columenlabs/lumen-ui-types/views';
// The one filter box every view uses, redone after p2e's:
// one chip per field in the sans face, `Account IRA, Roth ×`, included or excluded as a whole
// (`Symbol not AAPL`). A chip's tap opens its field: Include / Exclude, then its values ticked,
// with Only and the rows each keeps; unticking one leaves every other filter alone. The box's
// empty part (or +N) opens every filter on, each with ×, then the fields to add. Different
// fields: all must match (AND). Free text matches the row's text and any field value; picking
// "Text contains" keeps it as a chip. It filters the rows already loaded, on the client. The box
// is one row that never grows and always keeps room to type; crowded chips fold to `Sector: 3`,
// then behind +N. Phones get a bottom sheet. A text field where some rows have no value pins
// "No <field>" above its values: Include keeps the rows without one, Exclude the rows with any
// (an `empty` token); typing "no" or "empty" offers it too.
import { Command as CommandPrimitive } from 'cmdk';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  type LucideIcon,
  SaveIcon,
  SearchIcon,
  TextSearchIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import {
  type FilterLink,
  LINK_NAMES,
  type LinkColor,
  LinkDot,
  LinkPicker,
  linkVar,
  useAutoFilterLink,
} from './lumen-links';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './ui/command';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton } from './ui/input-group';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export interface FilterField<T> {
  key: string;
  label: string;
  icon: LucideIcon;
  /** The row's values for this field (a row can carry several, like symbols). */
  values: (row: T) => string[];
  /**
   * A number field: filtered by one condition, `> 100`, `< 0`, `= 5` or
   * between, instead of by values.
   */
  number?: (row: T) => number | null;
}

export interface FilterToken {
  key: string;
  value: string;
  /** Excluded: rows with this value are dropped ("not in"). */
  not?: boolean;
  /** A number condition; `value` is a number, or `a..b` for between. */
  op?: ViewTokenOp;
  /** Shared: its card's colour, set on the chips a coloured card publishes to
   *  its colour group. A filter box's own tokens no longer carry it. */
  link?: LinkColor;
  /** The key it stands for across domains (symbol = underlying = ticker; account), so a card on
   *  another domain follows it by that key. */
  as?: JoinKey;
  /** How it reads where its value is an id (a tapped account): shown in Following. */
  text?: string;
}

const OP_SIGN: Record<ViewTokenOp, string> = { gt: '>', lt: '<', eq: '=', between: '', empty: '' };
/** The rows with no value on a field (`not`: with any). */
const isEmptyToken = (t: FilterToken) => t.op === 'empty';
const emptyToken = (key: string, not: boolean): FilterToken =>
  not ? { key, value: EMPTY_VALUE, op: 'empty', not } : { key, value: EMPTY_VALUE, op: 'empty' };
/** "No label": the empty row's words for a field. */
const noneOf = (label: string) => `No ${label.toLowerCase()}`;
export const tokenText = (t: FilterToken) =>
  `${t.not ? '-' : ''}${t.key}:${t.op ? OP_SIGN[t.op] : ''}${t.value}`;
/** A number condition as people read it: `> 100`, `0 – 500`. */
const conditionText = (t: FilterToken) =>
  t.op === 'between' ? t.value.replace('..', ' – ') : `${OP_SIGN[t.op ?? 'eq']} ${t.value}`;
/** `field:>100`, `field:<0`, `field:=5`, `field:0..500` typed out for a number field. */
const NUMBER_TYPED = /^(\w+):(>|<|=)?(-?\d+(?:\.\d+)?)(?:\.\.(-?\d+(?:\.\d+)?))?$/;
/** Same field and value, included or not: a value sits in one chip only. */
const same = (a: FilterToken, b: FilterToken) =>
  a.key === b.key &&
  isEmptyToken(a) === isEmptyToken(b) &&
  a.value.toLowerCase() === b.value.toLowerCase();
const token = (key: string, value: string, not: boolean): FilterToken =>
  not ? { key, value, not } : { key, value };

/** The `contains` chip's field: free text over the row's own text. */
const CONTAINS: FilterField<never> = {
  key: CONTAINS_KEY,
  label: 'Text',
  icon: TextSearchIcon,
  values: () => [],
};
/** How long a `contains` value may be (the token's limit). */
const CONTAINS_MAX = 40;

/** Keeps the rows whose values pass every field's tokens, skipping the field `except`.
 * `values[CONTAINS_KEY]` holds the row's text, which `contains` tokens read. */
function passes(
  values: Record<string, string[]>,
  nums: Record<string, number | null>,
  tokens: FilterToken[],
  fields: { key: string; number?: unknown }[],
  except?: string,
) {
  for (const f of fields) {
    if (f.key === except) continue;
    const of = tokens.filter((t) => t.key === f.key);
    if (f.number) {
      if (!of.every((t) => meetsNumber(t.op, t.value, nums[f.key] ?? null))) return false;
      continue;
    }
    const have = values[f.key] ?? [];
    // `empty`: no value (included, alongside any values: none or one of these) or any value (excluded).
    const none = of.find((t) => isEmptyToken(t) && !t.not);
    if (of.some((t) => isEmptyToken(t) && t.not) && !have.length) return false;
    const plain = of.filter((t) => !isEmptyToken(t));
    const inc = plain.filter((t) => !t.not).map((t) => t.value.toLowerCase());
    const exc = plain.filter((t) => t.not).map((t) => t.value.toLowerCase());
    if ((inc.length || none) && !(none && !have.length) && !have.some((v) => inc.includes(v)))
      return false;
    if (exc.length && have.some((v) => exc.includes(v))) return false;
  }
  if (except === CONTAINS_KEY) return true;
  const hay = values[CONTAINS_KEY] ?? [];
  const holds = (w: string) => hay.some((v) => v.includes(w));
  const words = tokens.filter((t) => t.key === CONTAINS_KEY);
  const inc = words.filter((t) => !t.not).map((t) => t.value.toLowerCase());
  const exc = words.filter((t) => t.not).map((t) => t.value.toLowerCase());
  if (inc.length && !inc.some(holds)) return false;
  if (exc.length && exc.some(holds)) return false;
  return true;
}
/** A row value as filter text; a value that came back as a number or object (bad data) never throws. */
const lower = (v: unknown) => String(v ?? '').toLowerCase();
/** The rows that pass `tokens` (a widget's own filter), by the same rules as the filter box. */
export function filterByTokens<T>(
  rows: T[],
  fields: FilterField<T>[],
  tokens: FilterToken[],
  /** The row's text, for `contains` tokens. */
  text?: (row: T) => string[],
) {
  if (!tokens.length) return rows;
  const used = fields.filter((f) => tokens.some((t) => t.key === f.key));
  return rows.filter((row) =>
    passes(
      Object.fromEntries([
        ...used.map((f) => [f.key, f.number ? [] : f.values(row).map(lower)]),
        [CONTAINS_KEY, (text?.(row) ?? []).map(lower)],
      ]),
      Object.fromEntries(used.filter((f) => f.number).map((f) => [f.key, f.number?.(row) ?? null])),
      tokens,
      used,
    ),
  );
}
/** A field is included or excluded as a whole: where a field holds both, as
 * filters saved before that do, its included values stay. */
function onePerField(tokens: FilterToken[]) {
  const inc = new Set(tokens.filter((t) => !t.not && (!t.op || isEmptyToken(t))).map((t) => t.key));
  return tokens.some((t) => t.not && inc.has(t.key))
    ? tokens.filter((t) => !(t.not && inc.has(t.key)))
    : tokens;
}
/** How many values a field lists in the menu before typing narrows it. */
const PER_FIELD = 8;

/** A server's counts per field: each value's rows, and the rows with no value (`none`), over the
 *  rows every other field's tokens keep. */
export type FacetCounts = Record<string, { values: Record<string, number>; none?: number }>;

/**
 * Each field's values with their counts, shared by the filter box and the filter panel. A field
 * counts the rows the other fields' tokens keep, so picking one value never hides its siblings.
 * Over a server's page the counts come from the server (`facets`), never from the page.
 */
export function useFacetCounts<T>(filter: LumenFilterState<T>) {
  const { fields, indexed, tokens, facets } = filter;
  return useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    const empties = new Map<string, number>();
    for (const f of fields) {
      if (f.number) continue;
      if (facets) {
        const got = facets[f.key];
        counts.set(f.key, new Map(Object.entries(got?.values ?? {})));
        empties.set(f.key, got?.none ?? 0);
        continue;
      }
      const m = new Map<string, number>();
      let none = 0;
      for (const { row, values, nums } of indexed) {
        if (!passes(values, nums, tokens, fields, f.key)) continue;
        const vs = new Set(f.values(row));
        if (!vs.size) none++;
        for (const v of vs) m.set(v, (m.get(v) ?? 0) + 1);
      }
      counts.set(f.key, m);
      empties.set(f.key, none);
    }
    return { counts, empties };
  }, [fields, indexed, tokens, facets]);
}

/** Whether a count means something: over a server's page only when the server counted. */
export const countsShown = (filter: { partial: boolean; facets: FacetCounts | null }) =>
  !filter.partial || !!filter.facets;

/** Keeps the tokens and text, and filters `rows` by them. */
export function useLumenFilter<T>(
  rows: T[],
  fields: FilterField<T>[],
  {
    text: textOf,
    initial = [],
    partial = false,
    facets,
  }: {
    /** Free-text haystack per row (a name, an id), besides the field values. */
    text?: (row: T) => string[];
    /** Tokens applied when the view opens (a view's default filters). */
    initial?: FilterToken[];
    /** `rows` are one page of a server's rows: a count over them is not the real count, so the
     *  menu shows none (unless the server sends its own `facets`). */
    partial?: boolean;
    /** The server's counts for each field's values, taken over every row the other fields'
     *  tokens keep (one query where the rows live). Given, the box and the panel show these. */
    facets?: FacetCounts | null;
  } = {},
) {
  const [tokens, setRaw] = useState<FilterToken[]>(() => onePerField(initial));
  const setTokens = useCallback((next: FilterToken[]) => setRaw(onePerField(next)), []);
  const [text, setText] = useState('');
  const indexed = useMemo(
    () =>
      rows.map((row) => ({
        row,
        values: Object.fromEntries([
          ...fields.map((f) => [f.key, f.number ? [] : f.values(row).map(lower)]),
          [CONTAINS_KEY, (textOf?.(row) ?? []).map(lower)],
        ]) as Record<string, string[]>,
        nums: Object.fromEntries(
          fields.filter((f) => f.number).map((f) => [f.key, f.number?.(row) ?? null]),
        ) as Record<string, number | null>,
      })),
    [rows, fields, textOf],
  );
  const results = useMemo(() => {
    const q = text.trim().toLowerCase();
    // A half-typed token ("sym", "symbol:", "-") narrows the menu, not the rows.
    const free =
      q && !q.startsWith('-') && !q.includes(':') && !fields.some((f) => f.key.startsWith(q))
        ? q
        : '';
    return indexed
      .filter(({ values, nums }) => {
        if (!passes(values, nums, tokens, fields)) return false;
        if (!free) return true;
        return Object.values(values)
          .flat()
          .some((v) => v.includes(free));
      })
      .map(({ row }) => row);
  }, [indexed, fields, tokens, text]);
  /** Whether rows have text of their own, so the box offers "Text contains". */
  const hasText = !!textOf;
  /** Takes every token and the typed text off. */
  const clear = useCallback(() => {
    setRaw([]);
    setText('');
  }, []);
  return {
    fields,
    rows,
    indexed,
    tokens,
    setTokens,
    text,
    setText,
    results,
    hasText,
    partial,
    facets: facets ?? null,
    clear,
  };
}

export type LumenFilterState<T> = ReturnType<typeof useLumenFilter<T>>;

/** One chip per field (after p2e's filter): every value of a field sits in one
 * chip, included or excluded as a whole. */
type Chip = { key: string; not: boolean; tokens: FilterToken[] };
/** How a chip shows its values: all of them, or `Field: 2` once it has 2+ and the row is tight. */
type ChipForm = 'full' | 'count';
/** A chip's widest (max-w-60), and the gap between chips (gap-1). */
const CHIP_MAX = 240;
const GAP = 4;
/** Room the box always keeps for typing (desktop) or for the tap target (phone). */
const TYPE_ROOM = 112;
const TAP_ROOM = 64;

/** Which chips fit one row of `avail` px (after p2e's filter): a chip with 2+
 * values folds to a count when its values pass the chip's cap or the row is tight (biggest saving
 * first); then chips from the end move behind "+N". */
function planChips(avail: number, full: number[], short: number[], more: number) {
  const width = full.map((w) => Math.min(w, CHIP_MAX));
  const count = full.map(() => false);
  full.forEach((w, i) => {
    if (w > CHIP_MAX && (short[i] ?? 0) < CHIP_MAX) {
      count[i] = true;
      width[i] = short[i] ?? 0;
    }
  });
  const total = (n: number) => width.slice(0, n).reduce((s, w) => s + w + GAP, 0);
  const order = full
    .map((_, i) => i)
    .filter((i) => !count[i] && (short[i] ?? 0) < (width[i] ?? 0))
    .sort((a, b) => (width[b] ?? 0) - (short[b] ?? 0) - ((width[a] ?? 0) - (short[a] ?? 0)));
  for (const i of order) {
    if (total(width.length) <= avail) break;
    count[i] = true;
    width[i] = short[i] ?? 0;
  }
  let shown = width.length;
  if (total(shown) > avail) {
    shown = 0;
    while (shown < width.length && total(shown + 1) + more <= avail) shown++;
  }
  return { shown, count };
}

/** A chip's words: `Account IRA, Roth`, `Symbol not AAPL`, `Sector: 3`, `Symbol not in: 2`,
 * `Unrealized > 0`, `Text “div”`. */
function chipWords(chip: Chip, field: FilterField<never> | undefined, form: ChipForm) {
  const name = field?.label ?? chip.key;
  const condition = field?.number && chip.tokens[0];
  if (condition) return { name, verb: '', shown: conditionText(condition), all: '' };
  const quote = chip.key === CONTAINS_KEY;
  // An excluded `empty` reads "Label any"; an included one "none" among the values.
  if (chip.not && chip.tokens.length === 1 && chip.tokens[0] && isEmptyToken(chip.tokens[0]))
    return { name, verb: '', shown: 'any', all: 'any' };
  const all = chip.tokens
    .map((t) => (isEmptyToken(t) ? 'none' : quote ? `“${t.value}”` : t.value))
    .join(', ');
  const counted = form === 'count' && chip.tokens.length > 1;
  const verb = chip.not ? (counted ? 'not in:' : 'not') : counted ? ':' : '';
  return { name, verb, shown: counted ? String(chip.tokens.length) : all, all };
}
const chipTitle = (w: ReturnType<typeof chipWords>) =>
  `${w.name} ${w.verb === ':' ? '' : `${w.verb} `}${w.all || w.shown}`.replace(/\s+/g, ' ');

/** One field's chip: its name, values and ×, in the sans face. A tap opens the field's values. */
function FilterChip({
  chip,
  field,
  form,
  linkColor,
  className,
  onEdit,
  onRemove,
}: {
  chip: Chip;
  field?: FilterField<never>;
  form: ChipForm;
  /** The card's colour: a coloured card shares every chip with its colour group, so each chip carries the tint. */
  linkColor?: LinkColor | null;
  className?: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const words = chipWords(chip, field, form);
  const title = chipTitle(words);
  const tint = linkColor ?? null;
  return (
    <span
      data-slot="lumen-filter-chip"
      title={title}
      className={cn(
        'inline-flex h-6 max-w-60 shrink-0 items-center overflow-hidden rounded-md border border-border bg-muted text-sm',
        chip.not && 'border-destructive/35 bg-destructive/10',
        className,
      )}
      style={
        tint
          ? {
              background: `color-mix(in srgb, ${linkVar(tint)} 14%, transparent)`,
              borderColor: `color-mix(in srgb, ${linkVar(tint)} 35%, transparent)`,
            }
          : undefined
      }
    >
      <Button
        variant="ghost"
        size="xs"
        className="h-full min-w-0 shrink gap-1 rounded-none pr-0.5 pl-1.5 font-normal hover:bg-transparent"
        aria-label={`Edit ${title}`}
        onClick={onEdit}
      >
        {tint && <LinkDot color={tint} className="size-2" />}
        <span className="shrink-0 text-muted-foreground">
          {words.name}
          {words.verb === ':' && ':'}
        </span>
        {words.verb && words.verb !== ':' && (
          <span className="shrink-0 text-destructive">{words.verb}</span>
        )}
        <span className="min-w-0 truncate tabular-nums">{words.shown}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
        aria-label={`Remove ${title}`}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </span>
  );
}

const OPS: { op: ViewTokenOp; label: string }[] = [
  { op: 'lt', label: 'Less' },
  { op: 'gt', label: 'Greater' },
  { op: 'between', label: 'Between' },
];
const isNumber = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim());

/** A number field's condition in the menu, two lines: Less than, Greater
 * than or Between, then the number (0 by default). Each change filters at once. */
function NumberCondition({
  label,
  current,
  tall,
  count,
  onSet,
}: {
  label: string;
  current?: FilterToken;
  /** Phone: taller controls, and 16px text so the page doesn't zoom. */
  tall: boolean;
  /** How many rows a condition keeps; left out when that is not known. */
  count?: (op: ViewTokenOp, value: string) => number;
  onSet: (op: ViewTokenOp, value: string) => void;
}) {
  const [from = '0', to = '0'] = current?.value.split('..') ?? [];
  const [op, setOp] = useState<ViewTokenOp>(current?.op === 'eq' ? 'gt' : (current?.op ?? 'gt'));
  const [a, setA] = useState(from);
  const [b, setB] = useState(current?.op === 'between' ? to : '0');
  const value = (o: ViewTokenOp, x: string, y: string) =>
    o === 'between' ? `${x.trim()}..${y.trim()}` : x.trim();
  const set = (o: ViewTokenOp, x: string, y: string) => {
    if (isNumber(x) && (o !== 'between' || isNumber(y))) onSet(o, value(o, x, y));
  };
  const box = cn(
    'min-w-0 flex-1 px-2 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none',
    tall ? 'h-10 text-base' : 'h-8 text-sm',
  );
  const ok = isNumber(a) && (op !== 'between' || isNumber(b));
  return (
    // Keys stay here: the menu would take Enter and the arrows.
    <div
      className="flex flex-col gap-1.5 px-2 py-1"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.preventDefault();
      }}
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={current ? op : ''}
        onValueChange={(v) => {
          if (!v) return;
          setOp(v as ViewTokenOp);
          set(v as ViewTokenOp, a, b);
        }}
        aria-label={`${label} condition`}
        className="w-full"
      >
        {OPS.map((o) => (
          <ToggleGroupItem
            key={o.op}
            value={o.op}
            className={cn('flex-1 font-normal', tall ? 'h-10 text-base' : 'h-8 text-sm')}
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          className={box}
          aria-label={`${label} ${op === 'between' ? 'from' : 'value'}`}
          value={a}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setA(e.target.value);
            set(op, e.target.value, b);
          }}
        />
        {op === 'between' && (
          <>
            <span className="text-muted-foreground text-sm">and</span>
            <Input
              type="number"
              inputMode="decimal"
              className={box}
              aria-label={`${label} to`}
              value={b}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setB(e.target.value);
                set(op, a, e.target.value);
              }}
            />
          </>
        )}
        <span className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {current && ok && count ? `${count(op, value(op, a, b))} rows` : ''}
        </span>
      </div>
    </div>
  );
}

export function LumenTokenizedFilter<T>({
  filter,
  placeholder = 'Filter…',
  label = 'Filter',
  className,
  saved,
  onSave,
  changed,
  link: given,
}: {
  filter: LumenFilterState<T>;
  placeholder?: string;
  /** The input's accessible name. */
  label?: string;
  className?: string;
  /** The view's saved filters; the save button shows when the box differs from them. */
  saved?: FilterToken[];
  /** Saves the box's filters as the view's own. */
  onSave?: (tokens: FilterToken[]) => void;
  /** Other unsaved changes the save icon also saves (the page's link colours). */
  changed?: boolean;
  /** Its card's link colour; a coloured card shares every chip. `null`: it
   *  never shares (a widget's own fixed filter). */
  link?: FilterLink | null;
}) {
  const { fields, indexed, tokens, setTokens, text, setText, hasText } = filter;
  // Over one page of a server's rows a count is not the real one: show none, unless the server counted.
  const tally = (n: number) => (countsShown(filter) ? n : '');
  // Text counts are over the rows loaded: none over a server's page.
  const pageTally = (n: number) => (filter.partial ? '' : n);
  // A box its card passes no link takes the card's own (every card carries a square).
  const link = useAutoFilterLink(tokens, given);
  // Phone: the box is one tappable row and the menu is a bottom sheet.
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // The field the menu is in (a chip's tap opens its field), with its own search text.
  const [field, setField] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Include or Exclude picked for a field before it has a value.
  const [pendingNot, setPendingNot] = useState(false);
  // The values picked when a field opened stay first while it is open, so ticking one never moves the list.
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);

  const fieldOf = (key: string) =>
    (key === CONTAINS_KEY ? CONTAINS : fields.find((f) => f.key === key)) as
      | FilterField<never>
      | undefined;
  // One chip per field, in the order they were added.
  const chips = useMemo(() => {
    const out: Chip[] = [];
    for (const t of tokens) {
      const chip = out.find((c) => c.key === t.key);
      if (chip) chip.tokens.push(t);
      else out.push({ key: t.key, not: !!t.not, tokens: [t] });
    }
    return out;
  }, [tokens]);
  const chipOf = (key: string) => chips.find((c) => c.key === key);

  // A leading `-` excludes what is picked next (a field with values keeps its own Include/Exclude).
  const typed = (field ? search : text).trim().toLowerCase();
  const negate = typed.startsWith('-');
  const q = negate ? typed.slice(1) : typed;
  // `field:value` typed out opens that field, searching its values.
  const [qKey, qValue] = !field && q.includes(':') ? q.split(':', 2) : [null, q];
  const typedField = qKey ? fields.find((f) => f.key === qKey || f.key.startsWith(qKey)) : null;
  const active = field ?? typedField?.key ?? null;
  const needle = field ? q : (qValue ?? '');

  const notFor = (key: string) => {
    const chip = chipOf(key);
    return chip ? chip.not : key === field ? pendingNot : negate;
  };
  const toggle = (key: string, value: string) => {
    const t = { key, value };
    if (tokens.some((x) => same(x, t))) {
      setTokens(tokens.filter((x) => !same(x, t)));
      return;
    }
    setTokens([...tokens, token(key, value, notFor(key))]);
    if (!field) setText('');
    else setSearch('');
  };
  const only = (key: string, value: string) => {
    setTokens([...tokens.filter((x) => x.key !== key), token(key, value, notFor(key))]);
  };
  const hasEmpty = (key: string) => tokens.some((t) => t.key === key && isEmptyToken(t));
  const toggleEmpty = (key: string, not = notFor(key)) => {
    if (hasEmpty(key)) setTokens(tokens.filter((t) => !(t.key === key && isEmptyToken(t))));
    else setTokens([...tokens, emptyToken(key, not)]);
    if (!field) setText('');
    else setSearch('');
  };
  const setNot = (key: string, not: boolean) => {
    setPendingNot(not);
    setTokens(
      tokens.map((t) =>
        t.key !== key ? t : isEmptyToken(t) ? emptyToken(key, not) : token(key, t.value, not),
      ),
    );
  };
  // A number field holds one condition: a new one replaces it.
  const setCondition = (key: string, op: ViewTokenOp, value: string) =>
    setTokens([...tokens.filter((x) => x.key !== key), { key, value, op }]);
  // Rows a number condition keeps, given the other fields' tokens.
  const numberCount = (key: string, op: ViewTokenOp, value: string) =>
    indexed.filter(
      (r) =>
        passes(r.values, r.nums, tokens, fields, key) &&
        meetsNumber(op, value, r.nums[key] ?? null),
    ).length;
  const removeChip = (key: string) => {
    setTokens(tokens.filter((t) => t.key !== key));
    if (field === key) setField(null);
  };
  const focus = () => {
    if (!mobile) input.current?.focus();
  };
  // A chip's tap opens its field; the box's empty part, or +N, opens every filter.
  const openField = (key: string | null) => {
    setField(key);
    setPinned(new Set(tokens.filter((t) => t.key === key).map((t) => t.value)));
    setSearch('');
    setPendingNot(false);
    if (key) setText('');
    setOpen(true);
    focus();
  };
  const clear = () => {
    setTokens([]);
    setText('');
    setField(null);
  };
  const sameTokens = (a: FilterToken[], b: FilterToken[]) => {
    const keyOf = (ts: FilterToken[]) => ts.map(tokenText).sort().join('\n');
    return keyOf(a) === keyOf(b);
  };
  const dirty = !!onSave && (!!changed || !sameTokens(tokens, saved ?? []));

  // Each field's values with counts (the same counts the filter panel shows).
  const { counts, empties } = useFacetCounts(filter);
  const picked = (key: string, value: string) => tokens.some((t) => same(t, { key, value }));
  /** A field's values matching `n`: picked ones first, then the most common. In the open field
   * "picked" means picked when it opened, so the order holds still while values are ticked. */
  const valuesOf = (key: string, n: string, limit: number) => {
    const first = (v: string) => (key === field ? pinned.has(v) : picked(key, v));
    const m = new Map(counts.get(key) ?? []);
    for (const t of tokens)
      if (t.key === key && !isEmptyToken(t) && !m.has(t.value)) m.set(t.value, 0);
    return [...m]
      .filter(([v]) => !n || v.toLowerCase().includes(n))
      .sort(
        (a, b) =>
          Number(first(b[0])) - Number(first(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]),
      )
      .slice(0, limit);
  };

  // Free text (no `field:`) can stay as a "Text contains" chip.
  const word = hasText && q && !active && !q.includes(':') ? q.slice(0, CONTAINS_MAX).trim() : '';
  const containsWord =
    hasText && active === CONTAINS_KEY && needle ? needle.slice(0, CONTAINS_MAX).trim() : '';
  const wordOf = (w: string, not: boolean) =>
    w
      ? indexed.filter(
          (r) =>
            passes(r.values, r.nums, tokens, fields, CONTAINS_KEY) &&
            (r.values[CONTAINS_KEY] ?? []).some((v) => v.includes(w)) !== not,
        ).length
      : 0;

  // One row: the chips that fit show, the rest wait behind "+N".
  const [fit, setFit] = useState<{ shown: number; count: boolean[] }>({
    shown: chips.length,
    count: [],
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measures when the chips change.
  useLayoutEffect(() => {
    const row = box.current;
    const sizes = measure.current;
    if (!row || !sizes) return;
    const run = () => {
      const reserved = [...row.querySelectorAll<HTMLElement>('[data-reserved]')].reduce(
        (s, el) => s + el.offsetWidth,
        0,
      );
      // The typing room never goes.
      const avail = row.clientWidth - reserved - (mobile ? TAP_ROOM : TYPE_ROOM) - GAP * 2;
      const widths = (form: ChipForm) =>
        [...sizes.querySelectorAll<HTMLElement>(`[data-form=${form}]`)].map((el) => el.offsetWidth);
      const more = sizes.querySelector<HTMLElement>('[data-more]')?.offsetWidth ?? 32;
      setFit(planChips(avail, widths('full'), widths('count'), more));
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(row);
    return () => ro.disconnect();
  }, [chips, mobile]);
  const shownChips = chips.slice(0, fit.shown);
  const hiddenChips = chips.slice(fit.shown);
  const chipProps = (c: Chip) => ({
    chip: c,
    field: fieldOf(c.key),
    linkColor: link?.color,
    onEdit: () => openField(c.key),
    onRemove: () => removeChip(c.key),
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const empty = !(field ? search : text);
    if (e.key === 'Backspace' && empty) {
      // In a field, Backspace goes back to every filter; else it drops the last chip.
      if (field) setField(null);
      else if (tokens.length) setTokens(tokens.slice(0, -1));
    } else if (e.key === 'Escape') {
      if (field) {
        e.preventDefault();
        setField(null);
      } else if (!mobile) setOpen(false);
    } else if (e.key === 'Enter') {
      const raw = (field ? `${field}:${search}` : text).trim();
      // `field:>100`, `field:0..500` typed out on a number field sets its condition.
      const n = NUMBER_TYPED.exec(raw);
      const nf = n && fields.find((x) => x.number && x.key === n[1]?.toLowerCase());
      if (n?.[3] && nf) {
        e.preventDefault();
        const op = n[4] ? 'between' : n[2] === '>' ? 'gt' : n[2] === '<' ? 'lt' : 'eq';
        setCondition(nf.key, op, n[4] ? `${n[3]}..${n[4]}` : n[3]);
        setText('');
        setSearch('');
        return;
      }
      // `field:value` (or `-field:value`) typed out in full adds the token even when no row has it.
      const m = /^(-?)(\w+):(\S+)$/.exec(raw);
      const f = m && fields.find((x) => !x.number && x.key === m[2]?.toLowerCase());
      if (m?.[3] && f && !valuesOf(f.key, m[3].toLowerCase(), 1).length) {
        e.preventDefault();
        toggle(f.key, m[3]);
      }
    } else {
      setOpen(true);
    }
  };

  // The shell's item keeps a tick at its end for pickers; the filter shows its own.
  const tall = cn('[&>svg:last-child]:hidden', mobile && 'min-h-11');
  const shortcut = 'tracking-normal tabular-nums';
  // A value row: its tick, the value, Only and the rows it keeps.
  const valueRow = (key: string, value: string, count: number, prefix?: string) => {
    const on = picked(key, value);
    return (
      <CommandItem
        key={`${key}:${value}`}
        value={`${key}:${value}`}
        onSelect={() => toggle(key, value)}
        className={tall}
      >
        <Checkbox checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />
        {prefix && <span className="shrink-0 text-muted-foreground">{prefix}</span>}
        <span className="min-w-0 truncate">{value}</span>
        <Button
          variant="ghost"
          size="xs"
          className="-my-1 ml-auto h-6 px-1.5 font-normal text-muted-foreground opacity-0 group-data-selected/command-item:opacity-100 max-md:opacity-100"
          aria-label={`Only ${value}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            only(key, value);
          }}
        >
          Only
        </Button>
        <CommandShortcut className={cn('ml-0 w-8 text-right', shortcut)}>
          {tally(count)}
        </CommandShortcut>
      </CommandItem>
    );
  };
  // A field's "No <field>" row, pinned above its values: the rows with no value (Exclude: any).
  const emptyRow = (f: FilterField<never>, include?: boolean) => {
    const n = empties.get(f.key) ?? 0;
    if (!n && !hasEmpty(f.key)) return null;
    return (
      <CommandItem
        key={`${f.key}:${EMPTY_VALUE}`}
        value={`${f.key}:${EMPTY_VALUE}`}
        onSelect={() => toggleEmpty(f.key, include ? false : undefined)}
        className={tall}
      >
        <Checkbox
          checked={hasEmpty(f.key)}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none"
        />
        <span className="min-w-0 truncate text-muted-foreground italic">{noneOf(f.label)}</span>
        <CommandShortcut className={cn('ml-auto w-8 text-right', shortcut)}>
          {tally(n)}
        </CommandShortcut>
      </CommandItem>
    );
  };
  const summary = (c: Chip) => {
    const w = chipWords(c, fieldOf(c.key), 'full');
    return (
      <span className="ml-auto min-w-0 truncate pl-3 text-right">
        {c.not && <span className="text-destructive">not </span>}
        <span className="tabular-nums">{w.shown}</span>
      </span>
    );
  };

  const activeField = active ? fieldOf(active) : undefined;
  const activeChip = active ? chipOf(active) : undefined;
  const menu = activeField ? (
    // One field: Include or Exclude, then its values ticked.
    <>
      <CommandGroup className="px-1 py-0.5">
        <div className="flex items-center gap-1 px-1 py-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="All filters"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setField(null);
              setText('');
              focus();
            }}
          >
            <ChevronLeftIcon />
          </Button>
          <activeField.icon className="size-4 text-muted-foreground" />
          <span className="font-medium">{activeField.label}</span>
          {!activeField.number && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              className="ml-auto"
              value={notFor(activeField.key) ? 'exclude' : 'include'}
              onValueChange={(v) => v && setNot(activeField.key, v === 'exclude')}
              aria-label={`${activeField.label}: include or exclude`}
            >
              <ToggleGroupItem value="include" className="h-7 px-2 text-xs font-normal">
                Include
              </ToggleGroupItem>
              <ToggleGroupItem value="exclude" className="h-7 px-2 text-xs font-normal">
                Exclude
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        {activeField.number && (
          <NumberCondition
            key={activeField.key}
            label={activeField.label}
            current={tokens.find((t) => t.key === activeField.key)}
            tall={mobile}
            count={
              filter.partial ? undefined : (op, value) => numberCount(activeField.key, op, value)
            }
            onSet={(op, value) => setCondition(activeField.key, op, value)}
          />
        )}
      </CommandGroup>
      {active === CONTAINS_KEY ? (
        <CommandGroup className="px-1 py-0.5">
          {containsWord && !picked(CONTAINS_KEY, containsWord) && (
            <CommandItem
              value={`${CONTAINS_KEY}:${containsWord}`}
              onSelect={() => toggle(CONTAINS_KEY, containsWord)}
              className={tall}
            >
              <TextSearchIcon className="text-muted-foreground" />
              <span className="min-w-0 truncate">“{containsWord}”</span>
              <CommandShortcut className={shortcut}>
                {pageTally(wordOf(containsWord, notFor(CONTAINS_KEY)))}
              </CommandShortcut>
            </CommandItem>
          )}
          {tokens
            .filter((t) => t.key === CONTAINS_KEY)
            .map((t) => valueRow(CONTAINS_KEY, t.value, wordOf(t.value, !!t.not)))}
        </CommandGroup>
      ) : (
        !activeField.number && (
          <CommandGroup className="px-1 py-0.5">
            {(!needle || noneOf(activeField.label).toLowerCase().includes(needle)) &&
              emptyRow(activeField)}
            {valuesOf(activeField.key, needle, 200).map(([v, n]) =>
              valueRow(activeField.key, v, n),
            )}
          </CommandGroup>
        )
      )}
      <CommandEmpty>No matching values.</CommandEmpty>
    </>
  ) : q ? (
    // Typing: free text, the fields it names, and values from every field.
    <>
      <CommandEmpty>No matching values.</CommandEmpty>
      {word && (
        <CommandGroup className="px-1 py-0.5">
          <CommandItem
            value={`${CONTAINS_KEY}:${word}`}
            onSelect={() => {
              setTokens([
                ...tokens.filter((t) => !same(t, { key: CONTAINS_KEY, value: word })),
                token(CONTAINS_KEY, word, chipOf(CONTAINS_KEY)?.not ?? negate),
              ]);
              setText('');
            }}
            className={tall}
          >
            <TextSearchIcon className="text-muted-foreground" />
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">
                Text {negate ? 'not contains' : 'contains'}{' '}
              </span>
              “{word}”
            </span>
            <CommandShortcut className={shortcut}>
              {pageTally(wordOf(word, negate))}
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
      )}
      {fields.some((f) => f.label.toLowerCase().startsWith(q) || f.key.startsWith(q)) && (
        <CommandGroup heading="Fields" className="px-1 py-0.5">
          {fields
            .filter((f) => f.label.toLowerCase().startsWith(q) || f.key.startsWith(q))
            .map((f) => (
              <CommandItem
                key={f.key}
                value={`field:${f.key}`}
                onSelect={() => openField(f.key)}
                className={tall}
              >
                <f.icon className="text-muted-foreground" />
                {f.label}
                <ChevronRightIcon className="ml-auto text-muted-foreground" />
              </CommandItem>
            ))}
        </CommandGroup>
      )}
      {(q.startsWith('no') || (q.length > 1 && 'empty'.startsWith(q))) &&
        fields.some(
          (f) =>
            !f.number &&
            (empties.get(f.key) ?? 0) > 0 &&
            (q.startsWith('no') ? noneOf(f.label).toLowerCase().startsWith(q) : true),
        ) && (
          <CommandGroup heading="Quick filters" className="px-1 py-0.5">
            {fields
              .filter(
                (f) =>
                  !f.number &&
                  (empties.get(f.key) ?? 0) > 0 &&
                  (q.startsWith('no') ? noneOf(f.label).toLowerCase().startsWith(q) : true),
              )
              .map((f) => emptyRow(f as FilterField<never>, true))}
          </CommandGroup>
        )}
      {fields
        .filter((f) => !f.number)
        .map((f) => {
          const vs = valuesOf(f.key, q, PER_FIELD);
          return (
            vs.length > 0 && (
              <CommandGroup key={f.key} heading={f.label} className="px-1 py-0.5">
                {vs.map(([v, n]) => valueRow(f.key, v, n))}
              </CommandGroup>
            )
          );
        })}
    </>
  ) : (
    // At rest: every filter on, then the fields to add.
    <>
      {chips.length > 0 && (
        <CommandGroup heading="Filters" className="px-1 py-0.5">
          {chips.map((c) => {
            const f = fieldOf(c.key);
            return (
              <CommandItem
                key={c.key}
                value={`chip:${c.key}`}
                onSelect={() => openField(c.key)}
                className={tall}
              >
                {link?.color ? (
                  <LinkDot color={link.color} />
                ) : (
                  f && <f.icon className="text-muted-foreground" />
                )}
                <span className="shrink-0">{f?.label ?? c.key}</span>
                {summary(c)}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="-my-1 shrink-0 text-muted-foreground"
                  aria-label={`Remove ${f?.label ?? c.key} filter`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChip(c.key);
                  }}
                >
                  <XIcon />
                </Button>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}
      <CommandGroup heading={chips.length ? 'Add' : undefined} className="px-1 py-0.5">
        {fields
          .filter((f) => !chipOf(f.key))
          .map((f) => (
            <CommandItem
              key={f.key}
              value={`field:${f.key}`}
              onSelect={() => openField(f.key)}
              className={tall}
            >
              <f.icon className="text-muted-foreground" />
              {f.label}
              <CommandShortcut className={shortcut}>
                {f.number ? '' : tally(counts.get(f.key)?.size ?? 0)}
              </CommandShortcut>
            </CommandItem>
          ))}
      </CommandGroup>
    </>
  );

  // A field's last row: the card's colour (every chip of a coloured card is shared) and Remove.
  const footer = activeChip && (
    <div className="flex items-center gap-1 border-t px-2 py-1.5">
      {link && (
        <span className="flex items-center gap-1 text-muted-foreground text-xs">
          <LinkPicker
            color={link.color}
            label={activeField?.label ?? activeChip.key}
            onPick={link.onPick}
          />
          {link.color
            ? `Shared with ${LINK_NAMES[link.color].toLowerCase()} cards`
            : 'Share with cards'}
        </span>
      )}
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto font-normal text-muted-foreground hover:text-destructive"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => removeChip(activeChip.key)}
      >
        Remove filter
      </Button>
    </div>
  );

  const clearButton = (dirty || tokens.length > 0 || text) && (
    <InputGroupAddon align="inline-end" data-reserved className="gap-0.5">
      {dirty && (
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton
              size="icon-xs"
              aria-label="Save filters to view"
              onClick={() => onSave?.(tokens)}
            >
              <SaveIcon />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>Save filters to view</TooltipContent>
        </Tooltip>
      )}
      {(tokens.length > 0 || text) && (
        <InputGroupButton size="icon-xs" aria-label="Clear filter" onClick={clear}>
          <XIcon />
        </InputGroupButton>
      )}
    </InputGroupAddon>
  );
  // Off-screen copies of every chip, to measure what fits.
  const sizes = (
    <div
      ref={measure}
      aria-hidden
      inert
      className="pointer-events-none invisible absolute top-0 left-0 flex h-0 gap-1 overflow-hidden"
    >
      {chips.flatMap((c) =>
        (['full', 'count'] as const).map((form) => (
          <span key={`${c.key}:${form}`} data-form={form} className="flex shrink-0">
            <FilterChip {...chipProps(c)} form={form} className="max-w-none" />
          </span>
        )),
      )}
      <Button data-more variant="outline" size="xs" className="h-6 shrink-0 px-2">
        +{chips.length}
      </Button>
    </div>
  );
  const chipRow = (
    <>
      {shownChips.map((c, i) => (
        <FilterChip
          key={c.key}
          {...chipProps(c)}
          form={fit.count[i] ? 'count' : 'full'}
          className={cn(i === 0 && '-ml-1')}
        />
      ))}
      {hiddenChips.length > 0 && (
        <Button
          variant="outline"
          size="xs"
          className="h-6 shrink-0 px-2 font-normal tabular-nums"
          aria-label={`${hiddenChips.length} more filters`}
          onClick={() => openField(null)}
        >
          +{hiddenChips.length}
        </Button>
      )}
    </>
  );
  const hint = tokens.length ? 'Type to filter…' : placeholder;
  const searchHint = activeField
    ? `Search ${activeField.label.toLowerCase()}…`
    : hasText
      ? 'Search text or values…'
      : 'Search values…';

  if (mobile) {
    return (
      <div className={cn('relative w-full', className)}>
        {sizes}
        <InputGroup
          ref={box}
          data-slot="lumen-filter"
          className="flex-nowrap gap-1 overflow-hidden bg-background"
        >
          <InputGroupAddon data-reserved>
            <InputGroupButton size="icon-xs" aria-label={label} onClick={() => openField(null)}>
              <SearchIcon />
            </InputGroupButton>
          </InputGroupAddon>
          {chipRow}
          <Button
            variant="ghost"
            className="h-full min-w-16 flex-1 justify-start px-1 font-normal text-muted-foreground hover:bg-transparent"
            aria-label={label}
            onClick={() => openField(null)}
          >
            {hint}
          </Button>
          {clearButton}
        </InputGroup>
        <Sheet
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setField(null);
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[85svh] gap-0 rounded-t-xl"
            // The keyboard would cover the menu: search waits for a tap.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader className="flex-row items-center pb-2">
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription className="sr-only">
                Pick values to filter the rows.
              </SheetDescription>
              {tokens.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto font-normal text-muted-foreground"
                  onClick={clear}
                >
                  Clear all
                </Button>
              )}
            </SheetHeader>
            <CommandPrimitive
              shouldFilter={false}
              loop
              className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <CommandInput
                value={field ? search : text}
                onValueChange={field ? setSearch : setText}
                onKeyDown={onKeyDown}
                placeholder={searchHint}
                aria-label={label}
                className="text-base"
              />
              <CommandList className="max-h-none min-h-0 flex-1" aria-label="Filter suggestions">
                {menu}
              </CommandList>
              {footer}
            </CommandPrimitive>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <CommandPrimitive shouldFilter={false} className={cn('relative w-full', className)} loop>
      {sizes}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setField(null);
        }}
      >
        <PopoverAnchor asChild>
          <InputGroup
            ref={box}
            data-slot="lumen-filter"
            className="flex-nowrap gap-1 overflow-hidden bg-background"
          >
            <InputGroupAddon data-reserved>
              <SearchIcon />
            </InputGroupAddon>
            {chipRow}
            <CommandPrimitive.Input
              ref={input}
              data-slot="input-group-control"
              className="h-full min-w-16 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
              placeholder={activeField ? searchHint : hint}
              aria-label={label}
              value={field ? search : text}
              onValueChange={(v) => {
                if (field) setSearch(v);
                else setText(v);
                setOpen(true);
              }}
              onKeyDown={onKeyDown}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              // Focus moving into the menu's number row keeps the menu open.
              onBlur={(e) => {
                if (!menuBox.current?.contains(e.relatedTarget as Node)) {
                  setOpen(false);
                  setField(null);
                }
              }}
            />
            {clearButton}
          </InputGroup>
        </PopoverAnchor>
        <PopoverContent
          ref={menuBox}
          align="start"
          className="w-80 max-w-[calc(100vw-2rem)] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // The click that opens the menu lands on the box: it must not count as "outside".
          onInteractOutside={(e) => {
            if (box.current?.contains(e.target as Node)) e.preventDefault();
          }}
          // Clicks in the menu must not blur the input first (number inputs still take focus).
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
          }}
        >
          <CommandList aria-label="Filter suggestions">{menu}</CommandList>
          {footer}
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  );
}
