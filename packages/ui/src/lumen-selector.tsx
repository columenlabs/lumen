// LumenSelector: the one
// picker for every "pick one or more things from a list", on the shell's base-ui Combobox.
//
//   - Groups with sticky headings, in the order given; a group over 6 rows shows 6 and "N more"
//     until searched. Same label twice: `detail` tells them apart (a dev warning when it can't).
//   - One aligned detail column on the right; the selected row has a muted fill. Only multiple
//     selection shows checks (a checkbox per row); a single pick never shows a checkmark.
//   - Search shows past 8 options (`search="auto"`); `create` turns a typed value into an option.
//   - Single or multiple (chips in the trigger, "+N" past four, Clear all, picked order kept).
//   - Triggers: `field` (a form select), `chip` (a compact header pill), `icon` (an icon button).
//     `LumenSelectorList` is the fourth, `none`: the list anchored to a text box (the assistant @ and /).
//   - Phone: a bottom sheet with the search on top and, for multiple, Done.
//   - Desktop, multiple: a footer with the count, Clear all and Done (picks save as they're made).
//   - An option with a `target` (a card or a sidebar page) lights it on the page while hovered.
import { Combobox as Base } from '@base-ui/react';
import { CheckIcon, ChevronDownIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import { spotlight } from './spotlight';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type Icon = ComponentType<{ className?: string }>;

export interface LumenOption<V extends string = string> {
  value: V;
  label: string;
  /** Section heading; rows with the same group sit together, groups in first-seen order. */
  group?: string;
  /** Second column on the right: "Screeners", "34d", "Fidelity · IRA". */
  detail?: string;
  icon?: Icon;
  /** Drawn in place of the label in the row and the trigger (a model's name with its badge). */
  content?: ReactNode;
  /** A second line under the label, in the list only: when to pick it (the
   *  Widget picker). A row with one is taller. */
  description?: string;
  /** A small picture before the label, in the list only (a widget style's thumbnail). */
  thumb?: ReactNode;
  /** Extra words search matches. */
  keywords?: string[];
  /** Not pickable; a string says why (tooltip). */
  disabled?: boolean | string;
  /** Sits one step in, under the row before it (a workspace's tabs). */
  indent?: boolean;
  /** What the option stands for on screen, lit while hovered: `card:<id>` or an app path. */
  target?: string;
  /** The name tag on the lit target; the label by default. */
  targetName?: string;
}

export interface LumenOptionGroup<V extends string = string> {
  label: string;
  options: readonly LumenOption<V>[];
}

interface Common<V extends string> {
  /** The options; or `groups` to fix the group order. */
  options?: readonly LumenOption<V>[];
  groups?: readonly LumenOptionGroup<V>[];
  /** `field` by default. */
  trigger?: 'field' | 'chip' | 'icon';
  /** The icon trigger's icon, or a leading icon in a field or chip. */
  icon?: Icon;
  /** `auto`: a search box past 8 options. */
  search?: 'auto' | boolean;
  /** Turns typed text into a new value (a ticker, "ema 13", a new sector); null refuses it. */
  create?: (query: string) => V | null;
  /** The create row's text; `Add "…"` by default. */
  createLabel?: (query: string) => string;
  placeholder?: string;
  /** Shown when nothing matches. */
  empty?: string;
  /** Accessible name; also the phone sheet's title. */
  label?: string;
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
  /** Above the list (a scope switch such as "for SPY / All"). */
  header?: ReactNode;
  align?: 'start' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A row was highlighted (hover or arrow keys): a caller reads it ahead (the assistant's Chats). */
  onHighlight?: (value: V) => void;
  id?: string;
}

export interface LumenSelectorSingle<V extends string> extends Common<V> {
  multiple?: false;
  value: V | null | undefined | '';
  onChange: (value: V) => void;
}

export interface LumenSelectorMulti<V extends string> extends Common<V> {
  multiple: true;
  value: readonly V[];
  onChange: (value: V[]) => void;
  /** At most this many picked; the rest of the list greys out. */
  max?: number;
}

export type LumenSelectorProps<V extends string = string> =
  | LumenSelectorSingle<V>
  | LumenSelectorMulti<V>;

const SHOWN = 6;
const SEARCH_PAST = 8;
const CHIPS = 4;
const CREATE = '\u0000create';

interface Shown<V extends string> {
  label: string;
  rows: LumenOption<V>[];
  more: number;
}

/** The options as groups, in order. */
function toGroups<V extends string>(
  options: readonly LumenOption<V>[] | undefined,
  groups: readonly LumenOptionGroup<V>[] | undefined,
): LumenOptionGroup<V>[] {
  if (groups) return groups.filter((g) => g.options.length);
  const byLabel = new Map<string, LumenOption<V>[]>();
  for (const o of options ?? []) {
    const g = o.group ?? '';
    byLabel.set(g, [...(byLabel.get(g) ?? []), o]);
  }
  return [...byLabel].map(([label, list]) => ({ label, options: list }));
}

const matches = (o: LumenOption, group: string, q: string) =>
  [o.label, o.detail, group, ...(o.keywords ?? [])].some((s) => s?.toLowerCase().includes(q));

/**
 * How well `q` matches `s` as a subsequence (`prc` finds Price), higher is better; null when it
 * doesn't. Letters in a row and at word starts score more, a prefix most.
 */
export function fuzzyScore(q: string, s: string): number | null {
  const t = s.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500 - t.length;
  let score = 0;
  let at = -1;
  let run = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, at + 1);
    if (i < 0) return null;
    run = i === at + 1 ? run + 1 : 0;
    const start = i === 0 || /[\s_.\-%(]/.test(t[i - 1] ?? '');
    score += 1 + run * 3 + (start ? 5 : 0) - Math.min(i - at - 1, 5) * 0.2;
    at = i;
  }
  return score - t.length * 0.05;
}

/** The best fuzzy score of an option over its label, value and keywords. */
const fuzzyOf = (o: LumenOption, q: string) =>
  [o.label, o.value, ...(o.keywords ?? [])].reduce<number | null>((best, s) => {
    const v = fuzzyScore(q, s);
    return v === null ? best : best === null ? v : Math.max(best, v);
  }, null);

/**
 * What the list shows: matching rows by group, a long group cut to 6 (plus any picked row) until
 * it is opened or searched. Shared by every trigger so rows behave the same.
 */
export function useSelectorRows<V extends string>(
  options: readonly LumenOption<V>[] | undefined,
  groups: readonly LumenOptionGroup<V>[] | undefined,
  query: string,
  picked: ReadonlySet<string>,
  /** Match letters in order, not a substring, and put the best matches first. */
  fuzzy = false,
) {
  const all = useMemo(() => toGroups(options, groups), [options, groups]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const q = query.trim().toLowerCase();
  const shown = useMemo<Shown<V>[]>(() => {
    if (fuzzy && q) {
      const scored = all.flatMap((g) => {
        const rows = g.options
          .map((o) => ({ o, v: fuzzyOf(o, q) }))
          .filter((r): r is { o: LumenOption<V>; v: number } => r.v !== null)
          .sort((a, b) => b.v - a.v);
        return rows.length ? [{ label: g.label, rows, best: rows[0]?.v ?? 0 }] : [];
      });
      return scored
        .sort((a, b) => b.best - a.best)
        .map((g) => ({ label: g.label, rows: g.rows.map((r) => r.o), more: 0 }));
    }
    return all.flatMap((g) => {
      const rows = q ? g.options.filter((o) => matches(o, g.label, q)) : [...g.options];
      if (!rows.length) return [];
      if (q || open.has(g.label) || rows.length <= SHOWN + 1)
        return [{ label: g.label, rows, more: 0 }];
      const keep = rows.filter((o, i) => i < SHOWN || picked.has(o.value));
      return [{ label: g.label, rows: keep, more: rows.length - keep.length }];
    });
  }, [all, q, open, picked, fuzzy]);
  const count = useMemo(() => all.reduce((n, g) => n + g.options.length, 0), [all]);
  useDuplicateWarning(all);
  return {
    all,
    shown,
    count,
    flat: shown.flatMap((g) => g.rows),
    expand: (label: string) => setOpen((s) => new Set([...s, label])),
  };
}

/** Two rows that read the same can't be told apart: say so while building (design rule 2). */
function useDuplicateWarning(all: LumenOptionGroup[]) {
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    for (const g of all) {
      const seen = new Set<string>();
      for (const o of g.options) {
        const k = `${o.label}\u0000${o.detail ?? ''}`;
        if (seen.has(k))
          console.warn(`LumenSelector: two "${o.label}" rows in "${g.label}" share their detail`);
        seen.add(k);
      }
    }
  }, [all]);
}

const ROW =
  'relative flex w-full cursor-default items-center gap-2 rounded-md px-2 text-sm outline-hidden select-none h-8 max-md:h-11 max-md:px-4 max-md:text-[15px] data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4';
/** A row with a description or thumbnail grows to fit it. */
const TALL = 'h-auto min-h-8 py-1.5 max-md:h-auto';
const GROUP_LABEL =
  'sticky top-0 z-10 bg-popover px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground max-md:px-4';
const MORE =
  'flex h-7 w-full items-center gap-1.5 rounded-md pr-2 pl-8 text-left text-xs text-muted-foreground hover:bg-accent max-md:pl-11';

/** One row's inside: box or icon, label, detail, and the check when picked. */
export function SelectorRowContent({
  option,
  selected,
  multiple,
  trailing,
}: {
  option: LumenOption;
  selected?: boolean;
  multiple?: boolean;
  trailing?: ReactNode;
}) {
  const Icon = option.icon;
  return (
    <>
      {option.indent && <span aria-hidden className="w-4 shrink-0" />}
      {multiple && (
        <span
          aria-hidden
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input',
            selected && 'border-primary bg-primary text-primary-foreground',
          )}
        >
          {selected && <CheckIcon className="size-3" />}
        </span>
      )}
      {option.thumb ? (
        <span aria-hidden className="shrink-0">
          {option.thumb}
        </span>
      ) : (
        Icon && <Icon className="text-muted-foreground" />
      )}
      {option.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{option.content ?? option.label}</span>
          <span className="truncate text-xs text-muted-foreground">{option.description}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{option.content ?? option.label}</span>
      )}
      {option.detail && (
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {option.detail}
        </span>
      )}
      {trailing}
    </>
  );
}

function Rows<V extends string>({
  shown,
  picked,
  multiple,
  full,
  expand,
}: {
  shown: Shown<V>[];
  picked: ReadonlySet<string>;
  multiple: boolean;
  full: boolean;
  expand: (label: string) => void;
}) {
  return shown.map((g) => (
    <Base.Group key={g.label || '\u0000'} items={g.rows.map((o) => o.value)}>
      {g.label && <Base.GroupLabel className={GROUP_LABEL}>{g.label}</Base.GroupLabel>}
      {g.rows.map((o) => {
        const row = (
          <Base.Item
            key={o.value}
            value={o.value}
            disabled={!!o.disabled || (full && !picked.has(o.value))}
            className={cn(ROW, (o.description || o.thumb) && TALL)}
          >
            <SelectorRowContent
              option={o}
              selected={picked.has(o.value)}
              multiple={multiple && o.value !== CREATE}
            />
          </Base.Item>
        );
        return typeof o.disabled === 'string' ? (
          <Tooltip key={o.value}>
            <TooltipTrigger asChild>
              <div>{row}</div>
            </TooltipTrigger>
            <TooltipContent>{o.disabled}</TooltipContent>
          </Tooltip>
        ) : (
          row
        );
      })}
      {g.more > 0 && (
        <button
          type="button"
          className={MORE}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => expand(g.label)}
        >
          <ChevronDownIcon className="size-3.5" />
          {g.more} more
        </button>
      )}
    </Base.Group>
  ));
}

const FIELD =
  "flex w-fit min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/** The one picker. See the file header for what every use gets. */
export function LumenSelector<V extends string = string>(props: LumenSelectorProps<V>) {
  const {
    options,
    groups,
    trigger = 'field',
    icon: LeadIcon,
    search = 'auto',
    create,
    createLabel = (q: string) => `Add “${q}”`,
    placeholder = 'Pick one',
    empty = 'Nothing matches',
    label,
    size = 'default',
    className,
    disabled,
    header,
    align = 'start',
    id,
  } = props;
  const multiple = props.multiple === true;
  const values: readonly string[] = multiple
    ? props.value
    : props.value
      ? [props.value as string]
      : [];
  const picked = useMemo(() => new Set(values), [values]);
  const [query, setQuery] = useState('');
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  // Inside a modal dialog or sheet, the list portals into it: a modal's focus trap would pull
  // focus back out of a list portalled to the body, so its search box could never be typed in.
  const markRef = useRef<HTMLSpanElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) setHost(markRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, [open]);
  const setOpen = (o: boolean) => {
    setOwnOpen(o);
    props.onOpenChange?.(o);
    if (!o) {
      setQuery('');
      spotlight(null);
    }
  };
  const phone = useIsMobile();
  const sheetTitle = useId();
  const { all, shown, count, flat, expand } = useSelectorRows(options, groups, query, picked);
  const searchable = search === true || (search === 'auto' && count > SEARCH_PAST) || !!create;
  const byValue = useMemo(() => {
    const m = new Map<string, LumenOption<V>>();
    for (const g of all) for (const o of g.options) m.set(o.value, o);
    return m;
  }, [all]);
  const q = query.trim();
  // The create row shows only for text `create` would take (a known ticker, a valid spec).
  const canCreate =
    !!create &&
    !!q &&
    !flat.some((o) => o.label.toLowerCase() === q.toLowerCase()) &&
    create(q) !== null;
  const rows: Shown<V>[] = canCreate
    ? [
        ...shown,
        {
          label: '',
          rows: [{ value: CREATE as V, label: createLabel(q), icon: PlusIcon }],
          more: 0,
        },
      ]
    : shown;
  // Multiple shows chips in the trigger, typed text after them searching; an icon trigger keeps
  // the search in the popup.
  const inChips = multiple && trigger !== 'icon';
  const max = multiple ? (props as LumenSelectorMulti<V>).max : undefined;
  const full = max !== undefined && values.length >= max;
  const labelOf = (v: string) => byValue.get(v)?.label ?? v;

  const pick = (next: string | string[] | null) => {
    const made = (v: string): V | null =>
      v === CREATE ? (create?.(q) ?? null) : (v as unknown as V);
    if (multiple) {
      const list = (Array.isArray(next) ? next : []).map(made).filter((v): v is V => v !== null);
      (props as LumenSelectorMulti<V>).onChange([...new Set(list)]);
      setQuery('');
    } else if (typeof next === 'string') {
      const v = made(next);
      if (v !== null) (props as LumenSelectorSingle<V>).onChange(v);
      setOpen(false);
    }
  };

  const selected = multiple ? null : (byValue.get(values[0] ?? '') ?? null);
  const Lead = selected?.icon ?? LeadIcon;
  const fieldInside = (
    <>
      {Lead && <Lead className="text-muted-foreground" />}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left',
          !selected && !values.length && 'text-muted-foreground',
        )}
      >
        {selected ? (selected.content ?? selected.label) : values[0] ? values[0] : placeholder}
      </span>
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
    </>
  );

  const list = (
    <>
      {header}
      <Base.List
        className={cn(
          'overscroll-contain p-1 data-empty:p-0',
          phone
            ? 'min-h-0 flex-1 overflow-y-auto pb-4'
            : 'max-h-[min(22rem,calc(var(--available-height)-3rem))] scroll-pt-8 overflow-y-auto',
        )}
      >
        <Rows shown={rows} picked={picked} multiple={multiple} full={full} expand={expand} />
      </Base.List>
      <Base.Empty className="hidden px-2 py-3 text-center text-sm text-muted-foreground group-data-empty/selector:block">
        {empty}
      </Base.Empty>
    </>
  );

  const clearAll = multiple && values.length > 0 && (
    <button
      type="button"
      className="text-xs text-muted-foreground hover:text-foreground"
      onClick={() => (props as LumenSelectorMulti<V>).onChange([])}
    >
      Clear all
    </button>
  );

  const searchBox = (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-2',
        phone ? 'mx-4 h-11 rounded-md border' : 'h-9',
        !searchable && 'sr-only',
      )}
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <Base.Input
        readOnly={!searchable}
        placeholder={create ? 'Search or type a new one' : `Search ${count}`}
        aria-label={label ? `Search ${label}` : 'Search'}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground max-md:text-[15px]"
      />
    </div>
  );

  const rootProps = {
    items: rows.map((g) => ({ value: g.label, items: g.rows.map((o) => o.value) })),
    filteredItems: rows.map((g) => ({ value: g.label, items: g.rows.map((o) => o.value) })),
    itemToStringLabel: labelOf,
    inputValue: query,
    onInputValueChange: (v: string) => setQuery(v),
    open,
    onOpenChange: setOpen,
    disabled,
    autoHighlight: true,
    onItemHighlighted: (v: string | undefined) => {
      const o = v ? byValue.get(v) : undefined;
      spotlight(o?.target, o?.targetName ?? o?.label);
      if (o && o.value !== CREATE) props.onHighlight?.(o.value);
    },
  };

  // Multiple: chips in the trigger, typed text after them searches.
  const chips = multiple && (
    <>
      {values.slice(0, CHIPS).map((v) => (
        <Base.Chip
          key={v}
          className="flex h-[calc(--spacing(5.25))] items-center gap-1 rounded-sm bg-muted px-1.5 text-xs font-medium whitespace-nowrap"
        >
          {labelOf(v)}
          <Base.ChipRemove
            aria-label={`Remove ${labelOf(v)}`}
            className="-mr-0.5 rounded-sm opacity-50 hover:opacity-100"
          >
            <XIcon className="size-3" />
          </Base.ChipRemove>
        </Base.Chip>
      ))}
      {values.length > CHIPS && (
        <span className="rounded-sm bg-muted px-1.5 text-xs leading-[calc(--spacing(5.25))] font-medium">
          +{values.length - CHIPS}
        </span>
      )}
    </>
  );

  if (phone) {
    // The trigger opens a bottom sheet; the list is the combobox inline in it.
    const opener =
      trigger === 'icon' ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          className={className}
          onClick={() => setOpen(true)}
        >
          {LeadIcon && <LeadIcon />}
        </Button>
      ) : (
        <button
          type="button"
          id={id}
          data-size={size}
          aria-label={label}
          disabled={disabled}
          className={cn(
            FIELD,
            multiple && 'h-auto min-h-8 flex-wrap justify-start py-1',
            trigger === 'chip' && 'rounded-full',
            className,
          )}
          onClick={() => setOpen(true)}
        >
          {multiple ? (
            values.length ? (
              <span className="flex flex-1 flex-wrap gap-1">
                {values.slice(0, CHIPS).map((v) => (
                  <span
                    key={v}
                    className="rounded-sm bg-muted px-1.5 text-xs leading-[calc(--spacing(5.25))] font-medium"
                  >
                    {labelOf(v)}
                  </span>
                ))}
                {values.length > CHIPS && (
                  <span className="rounded-sm bg-muted px-1.5 text-xs leading-[calc(--spacing(5.25))]">
                    +{values.length - CHIPS}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex-1 text-left text-muted-foreground">{placeholder}</span>
            )
          ) : (
            fieldInside
          )}
        </button>
      );
    return (
      <>
        {opener}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            aria-labelledby={sheetTitle}
            // No ring on the first button: the person taps what they want.
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="group/selector flex max-h-[85dvh] flex-col gap-2 rounded-t-xl pt-2"
          >
            <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-4">
              <SheetTitle id={sheetTitle}>{label ?? placeholder}</SheetTitle>
              {multiple && (
                <Button size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              )}
            </div>
            <SheetDescription className="sr-only">
              {multiple ? 'Pick any, then Done' : 'Pick one'}
            </SheetDescription>
            <Base.Root
              {...rootProps}
              inline
              open
              onOpenChange={() => undefined}
              multiple={multiple}
              value={multiple ? [...values] : (values[0] ?? null)}
              onValueChange={(v: string | string[] | null) => pick(v)}
            >
              {multiple && values.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-4">
                  {values.map((v) => (
                    <span key={v} className="rounded-sm bg-muted px-2 py-1 text-[13px]">
                      {labelOf(v)}
                    </span>
                  ))}
                </div>
              )}
              {searchable && searchBox}
              {list}
            </Base.Root>
            {multiple && (
              <div className="flex items-center justify-between border-t px-4 pt-3 pb-5">
                <span className="text-xs text-muted-foreground">{values.length} picked</span>
                {clearAll}
              </div>
            )}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  const popup = (
    <Base.Portal container={host ?? undefined}>
      <Base.Positioner
        side="bottom"
        sideOffset={4}
        align={align}
        anchor={inChips ? chipsRef : undefined}
        className="pointer-events-auto isolate z-[60]"
      >
        <Base.Popup
          data-slot="lumen-selector"
          className="group/selector max-w-(--available-width) min-w-[max(var(--anchor-width),14rem)] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
        >
          {!inChips && searchBox}
          {list}
          {multiple && (
            <div className="flex items-center gap-3 border-t px-2 py-1.5">
              <span className="text-xs text-muted-foreground">
                {values.length} picked{max !== undefined ? ` of ${max}` : ''}
              </span>
              {clearAll}
              <Button size="xs" className="ml-auto" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          )}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );

  return (
    <Base.Root
      {...rootProps}
      multiple={multiple}
      value={multiple ? [...values] : (values[0] ?? null)}
      onValueChange={(v: string | string[] | null) => pick(v)}
    >
      {inChips ? (
        <Base.Chips
          ref={chipsRef}
          className={cn(
            'flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
            className,
          )}
        >
          {chips}
          <Base.Input
            id={id}
            aria-label={label}
            disabled={disabled}
            readOnly={!searchable}
            placeholder={values.length ? '' : placeholder}
            className="min-w-16 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
          />
        </Base.Chips>
      ) : trigger === 'icon' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Base.Trigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={label} className={className} />
              }
            >
              {LeadIcon && <LeadIcon />}
            </Base.Trigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        <Base.Trigger
          id={id}
          data-size={size}
          aria-label={label}
          className={cn(FIELD, trigger === 'chip' && 'rounded-full', className)}
        >
          {fieldInside}
        </Base.Trigger>
      )}
      <span ref={markRef} hidden />
      {popup}
    </Base.Root>
  );
}

/** What a text box calls on keys while an `LumenSelectorList` shows. */
export interface LumenSelectorListHandle {
  /** Handles arrows, Enter, Tab and Esc; true when the key was the list's. */
  key: (e: { key: string; shiftKey?: boolean; preventDefault: () => void }) => boolean;
}

/**
 * `trigger="none"`: the list anchored to a text box the page owns (the assistant @ and /). The text box
 * passes the query and its keys (`handle.key`); Tab or Enter takes the highlighted row, the first
 * by default.
 */
export function LumenSelectorList<V extends string = string>({
  options,
  groups,
  query,
  onPick,
  onClose,
  empty,
  header,
  className,
  handle,
  label,
  fuzzy,
}: {
  options?: readonly LumenOption<V>[];
  groups?: readonly LumenOptionGroup<V>[];
  query: string;
  onPick: (option: LumenOption<V>) => void;
  onClose?: () => void;
  empty?: string;
  header?: ReactNode;
  className?: string;
  handle?: Ref<LumenSelectorListHandle>;
  label?: string;
  /** Letters in order match (`prc` finds Price), best first: autocomplete in a text box. */
  fuzzy?: boolean;
}) {
  const none = useMemo(() => new Set<string>(), []);
  const { shown, flat, expand } = useSelectorRows(options, groups, query, none, fuzzy);
  const [at, setAt] = useState(0);
  const listId = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts at the first row.
  useEffect(() => setAt(0), [query]);
  const index = Math.min(at, flat.length - 1);
  const active = flat[index];
  useEffect(() => {
    spotlight(active?.target, active?.targetName ?? active?.label);
  }, [active]);
  useEffect(() => () => spotlight(null), []);
  useImperativeHandle(
    handle,
    () => ({
      key: (e) => {
        if (!flat.length) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          setAt((i) => (Math.min(i, flat.length - 1) + step + flat.length) % flat.length);
          return true;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          if (!active || active.disabled) return false;
          e.preventDefault();
          onPick(active);
          return true;
        }
        if (e.key === 'Escape' && onClose) {
          e.preventDefault();
          onClose();
          return true;
        }
        return false;
      },
    }),
    [flat, active, onPick, onClose],
  );
  return (
    <div
      data-slot="lumen-selector-list"
      className={cn(
        'flex max-h-80 flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10',
        className,
      )}
    >
      {header}
      <div
        id={listId}
        aria-label={label}
        className="min-h-0 overflow-y-auto overscroll-contain p-1"
      >
        {!flat.length && (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">
            {empty ?? 'Nothing matches'}
          </p>
        )}
        {shown.map((g) => (
          <section key={g.label || '\u0000'} aria-label={g.label || undefined}>
            {g.label && <div className={GROUP_LABEL}>{g.label}</div>}
            {g.rows.map((o) => {
              const i = flat.indexOf(o);
              return (
                <button
                  type="button"
                  tabIndex={-1}
                  key={o.value}
                  aria-current={i === index || undefined}
                  disabled={!!o.disabled}
                  data-highlighted={i === index ? '' : undefined}
                  className={cn(ROW, 'text-left')}
                  onMouseMove={() => i !== index && setAt(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => !o.disabled && onPick(o)}
                >
                  <SelectorRowContent
                    option={o}
                    trailing={
                      i === 0 ? (
                        <kbd className="rounded border px-1 font-mono text-[11px] text-muted-foreground">
                          Tab
                        </kbd>
                      ) : undefined
                    }
                  />
                </button>
              );
            })}
            {g.more > 0 && (
              <button
                type="button"
                className={MORE}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => expand(g.label)}
              >
                <ChevronDownIcon className="size-3.5" />
                {g.more} more {g.label.toLowerCase()}
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
