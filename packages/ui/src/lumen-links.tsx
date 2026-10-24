// Filter links (option E):
// every card of a LumenLayout page can carry a link colour, a small square before its title. Colour
// groups: a coloured card shares all of its chips and its tapped row with every
// card of that colour; an uncoloured one keeps them, and a widget's own fixed filter stays its own.
// Chips cross domains by key (symbol = underlying = ticker, account). Colours switch on the fly: a tap applies at once and
// lasts until the filter box's save icon saves it as the view's own; a code-built card's pick is kept by
// the browser for its page.
import type { JoinKey } from '@columenlabs/lumen-ui-types/domains';
import { type ViewLinkColor, viewLinkColors } from '@columenlabs/lumen-ui-types/views';
import { LinkIcon } from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { cn } from './lib/utils';
import type { FilterField, FilterToken } from './lumen-filter';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export type LinkColor = ViewLinkColor;
export const LINK_COLORS = viewLinkColors;
export const LINK_NAMES: Record<LinkColor, string> = {
  teal: 'Teal',
  amber: 'Amber',
  pink: 'Pink',
  lime: 'Lime',
  blue: 'Blue',
};
/** The colour as CSS (a theme token). */
export const linkVar = (c: LinkColor) => `var(--link-${c})`;

interface Links {
  colorOf: (id: string) => LinkColor | null;
  setColor: (id: string, color: LinkColor | null) => void;
  /** A card's shared chips (all of its filter's chips and its tapped row, while it has a colour). */
  publish: (id: string, tokens: FilterToken[]) => void;
  /** The linked chips of every other card of this card's colour. */
  follows: (id: string) => FilterToken[];
}

const LinksContext = createContext<Links | null>(null);
export const useLinks = () => useContext(LinksContext);

// Code-built cards ("yes, save it"): their colour picks have no saved view to
// live in, so each browser keeps them per page route, like folds. Nothing is stored server-side; a
// browser that refuses storage keeps the picks for the visit only.
const KEY = 'edgeshell:links';
type Remembered = Record<string, Record<string, LinkColor | null>>;
function readRemembered(): Remembered {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Remembered) : {};
  } catch {
    return {};
  }
}
function remember(page: string, id: string, color: LinkColor | null) {
  const all = readRemembered();
  all[page] = { ...all[page], [id]: color };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage refused: the pick still holds until reload.
  }
}
const isColor = (c: unknown): c is LinkColor | null =>
  c === null || (LINK_COLORS as readonly unknown[]).includes(c);

/**
 * Keeps the page's card colours and linked chips. `initial` are the saved colours by card id;
 * `kept` names the page and its code-built cards, whose picks this browser remembers.
 */
export function useLinkState(
  saved: Record<string, LinkColor | null>,
  kept?: { page: string; ids: string[] },
) {
  const page = kept?.page;
  const ids = kept?.ids.join('\n') ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the saved colours and ids.
  const initial = useMemo(() => {
    if (!page) return saved;
    const mine = readRemembered()[page] ?? {};
    const own = Object.entries(mine).filter(
      ([id, c]) => ids.split('\n').includes(id) && isColor(c),
    );
    return { ...saved, ...Object.fromEntries(own) };
  }, [JSON.stringify(saved), page, ids]);
  const [colors, setColors] = useState(initial);
  const [sources, setSources] = useState<Record<string, FilterToken[]>>({});
  // A saved layout that changes (another view, a save) starts from its colours again.
  const key = JSON.stringify(initial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the saved colours.
  useEffect(() => setColors(initial), [key]);
  // Stable, so a card's effects that publish never run again only because the page re-rendered.
  const setColor = useCallback(
    (id: string, color: LinkColor | null) => {
      if (page && ids.split('\n').includes(id)) remember(page, id, color);
      setColors((c) => ({ ...c, [id]: color }));
    },
    [page, ids],
  );
  const publish = useCallback(
    (id: string, tokens: FilterToken[]) =>
      setSources((s) =>
        JSON.stringify(s[id] ?? []) === JSON.stringify(tokens) ? s : { ...s, [id]: tokens },
      ),
    [],
  );
  const links = useMemo<Links>(
    () => ({
      colorOf: (id) => colors[id] ?? null,
      setColor,
      publish,
      follows: (id) => {
        const color = colors[id];
        if (!color) return [];
        return Object.entries(sources).flatMap(([src, ts]) =>
          src !== id && colors[src] === color ? ts : [],
        );
      },
    }),
    [colors, sources, setColor, publish],
  );
  return { links, colors };
}

/** The id of the card a part sits in, so a filter box in any card links without being told. */
const CardIdContext = createContext<string | null>(null);
export const useCardId = () => useContext(CardIdContext);
export function CardIdProvider({ id, children }: { id: string; children: ReactNode }) {
  return <CardIdContext.Provider value={id}>{children}</CardIdContext.Provider>;
}

export function LinksProvider({ links, children }: { links: Links; children: ReactNode }) {
  return <LinksContext.Provider value={links}>{children}</LinksContext.Provider>;
}

/** A filter box's link from the card it sits in, when its card passes none (*  the square is built into every card). Its linked chips are published as that card's. */
export function useAutoFilterLink(tokens: FilterToken[], given: FilterLink | null | undefined) {
  const links = useLinks();
  const id = useCardId();
  // `null`: a box that never shares (a widget's own fixed filter in Edit widget).
  const auto = given === undefined && !!links && !!id;
  usePublishLinks(auto ? (id as string) : '', auto ? tokens : NONE);
  if (given === null) return undefined;
  if (given || !auto || !links || !id) return given;
  return { color: links.colorOf(id), onPick: (c: LinkColor | null) => links.setColor(id, c) };
}
const NONE: FilterToken[] = [];

/** The fields that stand for a key on any domain, so a chip on one is followed by that key. */
export const KEY_FIELDS: Record<JoinKey, string[]> = {
  symbol: ['symbol', 'underlying', 'ticker'],
  account: ['account', 'account_id'],
  contract: ['contract'],
};
const keyOfField = (key: string) =>
  (Object.keys(KEY_FIELDS) as JoinKey[]).find((k) => KEY_FIELDS[k].includes(key));

/** A coloured card's chips as its group gets them: its colour, and the key a key field stands for. */
export function shared(tokens: FilterToken[], color: LinkColor | null): FilterToken[] {
  if (!color) return [];
  return tokens.map((t) => {
    const as = t.as ?? keyOfField(t.key);
    return { ...t, link: color, ...(as ? { as } : {}) };
  });
}

/** Publishes a coloured card's chips while it shows, and takes them back when it goes. */
export function usePublishLinks(id: string, tokens: FilterToken[]) {
  const links = useLinks();
  const color = links?.colorOf(id) ?? null;
  const linked = useMemo(() => shared(tokens, color), [color, tokens]);
  const publish = links?.publish;
  useEffect(() => publish?.(id, linked), [publish, id, linked]);
  useEffect(() => () => publish?.(id, []), [publish, id]);
}

/** A domain's keys as filter fields (`@symbol`, `@account`), so a followed chip reads by key. */
export function keyFilterFields<T>(
  keys: Partial<Record<JoinKey, (row: T) => string | string[] | null>> | undefined,
): FilterField<T>[] {
  return (Object.entries(keys ?? {}) as [JoinKey, (row: T) => string | string[] | null][]).map(
    ([k, read]) => ({
      key: `@${k}`,
      label: k === 'symbol' ? 'Symbol' : k === 'account' ? 'Account' : 'Option',
      icon: LinkIcon,
      values: (row: T) => {
        const v = read(row);
        return v === null ? [] : Array.isArray(v) ? v : [v];
      },
    }),
  );
}

/**
 * The followed chips a card can read: those on a field it has, then those on a key it carries
 * (read on `@<key>`, see `keyFilterFields`). A chip it can read neither way is skipped.
 */
export function followedBy<T>(
  tokens: FilterToken[],
  fields: FilterField<T>[],
  keys?: Partial<Record<JoinKey, unknown>>,
) {
  return tokens.flatMap((t) =>
    fields.some((f) => f.key === t.key)
      ? [t]
      : t.as && keys?.[t.as]
        ? [{ ...t, key: `@${t.as}` }]
        : [],
  );
}

/** What a card follows, as its title says it: `IRA, Roth`. */
export function followsText(tokens: FilterToken[]) {
  return tokens
    .map(
      (t) =>
        `${t.not ? 'not ' : ''}${t.op ? `${t.key} ${t.value.replace('..', '–')}` : (t.text ?? t.value)}`,
    )
    .join(', ');
}

/** The square itself: filled in its colour, or an outline for none. */
export function LinkDot({ color, className }: { color: LinkColor | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-[3px]',
        !color && 'ring-[1.5px] ring-muted-foreground/60 ring-inset',
        className,
      )}
      style={color ? { background: linkVar(color) } : undefined}
    />
  );
}

/** A card's square: a tap opens the colours and None; a pick applies at once. */
export function LinkPicker({
  color,
  onPick,
  label,
  className,
}: {
  color: LinkColor | null;
  onPick: (c: LinkColor | null) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (c: LinkColor | null) => {
    onPick(c);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn('size-5 shrink-0', className)}
          aria-label={`${label} link colour: ${color ? LINK_NAMES[color] : 'None'}`}
          title={color ? `Linked: ${LINK_NAMES[color]}` : 'Link colour'}
        >
          <LinkDot color={color} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto flex-col gap-2 p-2">
        <p className="text-xs text-muted-foreground">Link colour</p>
        <div className="flex items-center gap-1">
          {LINK_COLORS.map((c) => (
            <Button
              key={c}
              variant={c === color ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label={LINK_NAMES[c]}
              aria-pressed={c === color}
              title={LINK_NAMES[c]}
              onClick={() => pick(c)}
            >
              <LinkDot color={c} className="size-3.5" />
            </Button>
          ))}
          <Button
            variant={color === null ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-2 text-xs"
            aria-pressed={color === null}
            onClick={() => pick(null)}
          >
            None
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** What a filter box needs to show its chips' squares. */
export interface FilterLink {
  /** Its card's colour; a chip square carries it. */
  color: LinkColor | null;
  /** Picks the card's colour (a chip square on a card with none asks for one first). */
  onPick: (c: LinkColor | null) => void;
}

/**
 * Row-tap filtering (keyed): in a coloured card a row tap picks the
 * row's value as a temporary chip of the card's colour (published with its other chips); a second
 * tap on it, or the card losing its colour, lets go. The value is the domain's `rowLink` field, else
 * its first key (symbol, then account), so every domain with a key links rows (a basket's orders,
 * paper and live). `onTap` is undefined where it does not apply, so the row opens as usual.
 */
export function useRowPick<T>(
  domain: {
    rowLink?: string;
    fields: { key: string; value: (row: T) => unknown }[];
    keys?: Partial<Record<JoinKey, (row: T) => string | string[] | null>>;
  },
  color: LinkColor | null,
  /** The value tapped until a tap changes it (a page that opens on one row). */
  initial?: string,
) {
  const field = domain.rowLink ? domain.fields.find((f) => f.key === domain.rowLink) : undefined;
  const key = field ? undefined : (['symbol', 'account'] as const).find((k) => domain.keys?.[k]);
  const read = key ? domain.keys?.[key] : undefined;
  // Until the first tap the page's own start holds; a tap, or the card losing its colour, ends it.
  const [tap, setTap] = useState<{ value: string | null } | null>(null);
  const on = !!((field || read) && color);
  useEffect(() => {
    if (!on) setTap(null);
  }, [on]);
  const value = tap ? tap.value : (initial ?? null);
  const keyOf = useCallback(
    (row: T) => {
      const v = field ? field.value(row) : read?.(row);
      const one = Array.isArray(v) ? v[0] : v;
      return one === null || one === undefined ? null : String(one);
    },
    [field, read],
  );
  const token = useMemo<FilterToken[]>(() => {
    if (!on || !value) return [];
    if (field) return [{ key: field.key, value, link: color ?? undefined }];
    return key ? [{ key: `@${key}`, value, as: key, link: color ?? undefined }] : [];
  }, [on, value, field, key, color]);
  return {
    token,
    onTap: on ? (row: T) => setTap({ value: value === keyOf(row) ? null : keyOf(row) }) : undefined,
    tapped: on && value ? (row: T) => keyOf(row) === value : undefined,
  };
}
