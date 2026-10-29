import { EMPTY_VALUE } from '@columenlabs/lumen-ui-types/views';
// The filter box laid out as a panel: every field a section of values with counts, ticked in
// place. It reads and writes the same tokens as `LumenTokenizedFilter` (one `useLumenFilter`
// state), so a tick here is a chip in the box and a chip's × unticks it here. Counts come from
// `useFacetCounts`, the box's own: over the rows loaded, or the server's `facets` when the rows
// are one page of a server's. On a desktop it is a side panel that hides to a filter icon; on a
// phone the same body opens in a bottom sheet.
import { BanIcon, FilterIcon, PanelLeftCloseIcon, RotateCcwIcon, SearchIcon } from 'lucide-react';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { InfoTip } from './info-tip';
import { cn } from './lib/utils';
import {
  type FilterField,
  type FilterToken,
  type LumenFilterState,
  countsShown,
  useFacetCounts,
} from './lumen-filter';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';

/** Values a section shows before its "more" opens the rest (and its search). */
const SHOWN = 6;
/** Past this many values a section offers a search over them. */
const SEARCH_FROM = 10;

export interface LumenFilterPanelProps<T> {
  /** The filter's state, the same one the page's filter box draws. */
  filter: LumenFilterState<T>;
  /** Open (desktop: shown beside the page; phone: the sheet is up). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A field's details, behind an (i) beside its name. Most fields need none. */
  tips?: Record<string, ReactNode>;
  /** The fields in the order shown (default: the filter's own order). Fields left out are not
   *  shown here, but still filter from the box. */
  order?: string[];
  /** Its heading (default `Filters`). */
  title?: string;
  className?: string;
}

const keyOf = (v: string) => v.toLowerCase();
const isEmpty = (t: FilterToken) => t.op === 'empty';
const fmt = (n: number) => n.toLocaleString();

/**
 * Remembers whether the panel is open on this device, per page (`id`). Desktop starts open,
 * a phone closed (its sheet opens from the filter icon).
 */
export function useFilterPanel(id: string) {
  const mobile = useIsMobile();
  const storeKey = `lumen:filter-panel:${id}`;
  const [kept, setKept] = useState<boolean | null>(() => {
    try {
      const v = localStorage.getItem(storeKey);
      return v === null ? null : v === '1';
    } catch {
      return null;
    }
  });
  const [phoneOpen, setPhoneOpen] = useState(false);
  const open = mobile ? phoneOpen : (kept ?? true);
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (mobile) return setPhoneOpen(next);
      setKept(next);
      try {
        localStorage.setItem(storeKey, next ? '1' : '0');
      } catch {
        // Kept for the visit only.
      }
    },
    [mobile, storeKey],
  );
  return { open, onOpenChange };
}

/** The filter icon that shows the panel (or opens its sheet on a phone), with how many fields
 *  filter now. On a desktop it shows only while the panel is hidden. */
export function LumenFilterPanelButton<T>({
  filter,
  open,
  onOpenChange,
}: Pick<LumenFilterPanelProps<T>, 'filter' | 'open' | 'onOpenChange'>) {
  const mobile = useIsMobile();
  const on = new Set(filter.tokens.map((t) => t.key)).size;
  if (open && !mobile) return null;
  return (
    <span className="relative inline-flex">
      <IconButton
        icon={FilterIcon}
        label={on ? `Show filters (${on} on)` : 'Show filters'}
        variant="outline"
        onClick={() => onOpenChange(true)}
      />
      {on > 0 && (
        <span
          aria-hidden
          className="num pointer-events-none absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-xs leading-4 text-primary-foreground"
        >
          {on}
        </span>
      )}
    </span>
  );
}

/** The filter panel: a side panel on a desktop, a bottom sheet on a phone. */
export function LumenFilterPanel<T>({
  filter,
  open,
  onOpenChange,
  tips,
  order,
  title = 'Filters',
  className,
}: LumenFilterPanelProps<T>) {
  const mobile = useIsMobile();
  const fields = useMemo(() => {
    if (!order) return filter.fields;
    return order
      .map((k) => filter.fields.find((f) => f.key === k))
      .filter((f): f is FilterField<T> => !!f);
  }, [filter.fields, order]);
  const on = new Set(filter.tokens.map((t) => t.key)).size;
  // Counted once for every section, the same counts the filter box shows.
  const facets = useFacetCounts(filter);
  const head = (
    <div className="flex items-center gap-1">
      {!mobile && <span className="text-sm font-semibold">{title}</span>}
      {!mobile && on > 0 && (
        <span className="num rounded-full bg-primary px-1.5 text-xs leading-4 text-primary-foreground">
          {on}
        </span>
      )}
      <span className="flex-1" />
      <IconButton
        icon={RotateCcwIcon}
        label="Clear filters"
        disabled={!filter.tokens.length && !filter.text}
        onClick={filter.clear}
      />
      {!mobile && (
        <IconButton
          icon={PanelLeftCloseIcon}
          label="Hide filters"
          onClick={() => onOpenChange(false)}
        />
      )}
    </div>
  );
  const body = (
    <div className="flex flex-col">
      {fields.map((f) => (
        <Section key={f.key} field={f} filter={filter} facets={facets} tip={tips?.[f.key]} />
      ))}
    </div>
  );
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 overflow-hidden"
          // The first thing in the sheet is a field's (i): focusing it would open its tip.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="pr-12">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">Pick what the list shows</SheetDescription>
          </SheetHeader>
          <div className="flex items-center px-4">
            <span className="text-sm text-muted-foreground tabular-nums">
              {on ? `${on} on` : 'None on'}
            </span>
            <span className="flex-1" />
            {head}
          </div>
          <div className="min-h-0 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {body}
          </div>
        </SheetContent>
      </Sheet>
    );
  if (!open) return null;
  return (
    <aside
      aria-label={title}
      data-slot="filter-panel"
      className={cn('flex w-64 shrink-0 flex-col gap-1 rounded-xl border bg-card p-3', className)}
    >
      {head}
      {body}
    </aside>
  );
}

/** One field: its values ticked in place, or a number field's range. */
function Section<T>({
  field,
  filter,
  facets: { counts, empties },
  tip,
}: {
  field: FilterField<T>;
  filter: LumenFilterState<T>;
  facets: ReturnType<typeof useFacetCounts>;
  tip?: ReactNode;
}) {
  const { tokens, setTokens } = filter;
  const shown = countsShown(filter, field.key);
  const mine = tokens.filter((t) => t.key === field.key);
  const not = mine.some((t) => t.not);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const header = (
    <div className="flex h-7 items-center gap-1.5">
      <span className="truncate text-xs font-semibold">{field.label}</span>
      {tip && <InfoTip label={`About ${field.label}`}>{tip}</InfoTip>}
      <span className="flex-1" />
      {!field.number && mine.length > 0 && (
        <IconButton
          icon={BanIcon}
          size="icon-xs"
          pressed={not}
          label={not ? 'Keep these values instead' : 'Leave these values out'}
          onClick={() => setTokens(tokens.map((t) => (t.key === field.key ? flip(t, !not) : t)))}
        />
      )}
    </div>
  );
  if (field.number) return <NumberSection field={field} filter={filter} header={header} />;

  const counted = counts.get(field.key) ?? new Map<string, number>();
  const picked = new Set(mine.filter((t) => !isEmpty(t)).map((t) => keyOf(t.value)));
  const all = new Map(counted);
  for (const t of mine) if (!isEmpty(t) && !all.has(t.value)) all.set(t.value, 0);
  const needle = q.trim().toLowerCase();
  const values = [...all]
    .filter(([v]) => !needle || v.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        Number(picked.has(keyOf(b[0]))) - Number(picked.has(keyOf(a[0]))) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    );
  const list = more || needle ? values : values.slice(0, SHOWN);
  const none = empties.get(field.key) ?? 0;
  const noneOn = mine.some(isEmpty);
  const tick = (value: string) => {
    if (picked.has(keyOf(value)))
      setTokens(
        tokens.filter(
          (t) => !(t.key === field.key && !isEmpty(t) && keyOf(t.value) === keyOf(value)),
        ),
      );
    else setTokens([...tokens, not ? { key: field.key, value, not } : { key: field.key, value }]);
  };
  const tickNone = () =>
    setTokens(
      noneOn
        ? tokens.filter((t) => !(t.key === field.key && isEmpty(t)))
        : [...tokens, { key: field.key, value: EMPTY_VALUE, op: 'empty', ...(not ? { not } : {}) }],
    );
  if (!all.size && !none && !mine.length) return null;
  return (
    <section className="border-t py-2 first:border-t-0" aria-label={field.label}>
      {header}
      {all.size > SEARCH_FROM && (more || needle) && (
        <div className="relative mb-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Find ${field.label.toLowerCase()}`}
            aria-label={`Find ${field.label.toLowerCase()}`}
            className="h-7 pl-7 text-xs"
          />
        </div>
      )}
      <ul className="flex flex-col">
        {none > 0 || noneOn ? (
          <Value
            label={`No ${field.label.toLowerCase()}`}
            n={shown ? none : null}
            checked={noneOn}
            onToggle={tickNone}
            muted
          />
        ) : null}
        {list.map(([v, n]) => (
          <Value
            key={v}
            label={v}
            n={shown ? n : null}
            checked={picked.has(keyOf(v))}
            onToggle={() => tick(v)}
          />
        ))}
      </ul>
      {!needle && values.length > SHOWN && (
        <button
          type="button"
          className="mt-0.5 rounded-sm text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => setMore(!more)}
        >
          {more ? 'Fewer' : `${fmt(values.length - SHOWN)} more`}
        </button>
      )}
    </section>
  );
}

const flip = (t: FilterToken, not: boolean): FilterToken => {
  const { not: _, ...rest } = t;
  return not ? { ...rest, not } : rest;
};

function Value({
  label,
  n,
  checked,
  onToggle,
  muted,
}: {
  label: string;
  n: number | null;
  checked: boolean;
  onToggle: () => void;
  muted?: boolean;
}) {
  const id = useId();
  return (
    <li className="flex h-7 items-center gap-2 rounded-md px-1 text-sm hover:bg-muted/60">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <label
        htmlFor={id}
        className={cn('min-w-0 flex-1 cursor-pointer truncate', muted && 'text-muted-foreground')}
        title={label}
      >
        {label}
      </label>
      {n !== null && <span className="num text-xs text-muted-foreground">{fmt(n)}</span>}
    </li>
  );
}

/** A number field: from and to, kept as one condition (`> a`, `< b` or `a..b`). */
function NumberSection<T>({
  field,
  filter,
  header,
}: {
  field: FilterField<T>;
  filter: LumenFilterState<T>;
  header: ReactNode;
}) {
  const { tokens, setTokens } = filter;
  const t = tokens.find((x) => x.key === field.key);
  const [from0, to0] =
    t?.op === 'between'
      ? t.value.split('..')
      : t?.op === 'gt'
        ? [t.value, '']
        : t?.op === 'lt'
          ? ['', t.value]
          : t?.op === 'eq'
            ? [t.value, t.value]
            : ['', ''];
  const [from, setFrom] = useState(from0 ?? '');
  const [to, setTo] = useState(to0 ?? '');
  const apply = () => {
    const a = from.trim();
    const b = to.trim();
    const rest = tokens.filter((x) => x.key !== field.key);
    const num = (s: string) => s !== '' && Number.isFinite(Number(s));
    if (num(a) && num(b))
      setTokens([...rest, { key: field.key, op: 'between', value: `${a}..${b}` }]);
    else if (num(a)) setTokens([...rest, { key: field.key, op: 'gt', value: a }]);
    else if (num(b)) setTokens([...rest, { key: field.key, op: 'lt', value: b }]);
    else setTokens(rest);
  };
  const box = (value: string, set: (v: string) => void, label: string) => (
    <Input
      inputMode="decimal"
      value={value}
      onChange={(e) => set(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => e.key === 'Enter' && apply()}
      placeholder={label}
      aria-label={`${field.label} ${label.toLowerCase()}`}
      className="h-7 text-xs tabular-nums"
    />
  );
  return (
    <section className="border-t py-2 first:border-t-0" aria-label={field.label}>
      {header}
      <div className="flex items-center gap-2">
        {box(from, setFrom, 'From')}
        <span className="text-xs text-muted-foreground">–</span>
        {box(to, setTo, 'To')}
      </div>
    </section>
  );
}
