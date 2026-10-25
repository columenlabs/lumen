// LumenLayout: the page
// every app shows. Crumbs and actions in the header, then the filter and Group by switch every
// card on the page shares, then an ordered list of cards, each a third, half, two thirds or the full width:
// widgets (LumenSavedWidget: tiles, charts, top N, market, price chart) and views (LumenView, the domain's
// table). A saved view's `cards` say which and in what order, and Edit layout changes them; a page
// can add cards of its own in code (`cards`), views of other data among them. The frame paints at
// once and each card loads its own data (lumen-source.tsx).
import { linkColumns } from '@columenlabs/lumen-ui-types/catalog';
import { sourceLine } from '@columenlabs/lumen-ui-types/domains';
import {
  CONNECTED_COUNT,
  type CustomViewConfig,
  GRID_COLS,
  type ViewCard,
  type ViewConnection,
  type ViewRowCard,
  type ViewTableCard,
  type ViewTableLayout,
  type ViewWidget,
  type WidgetControl,
  cardsOf,
  connectedKey,
  controlOn,
  isOwnTile,
  isRowCard,
  isTableCard,
  mainTableOf,
  tableConfigOf,
  tableLayoutOf,
  tilesOfCard,
} from '@columenlabs/lumen-ui-types/views';
import type { RowData } from '@tanstack/react-table';
import {
  LayoutDashboardIcon,
  type LucideIcon,
  PlusIcon,
  SaveIcon,
  TableIcon,
  Undo2Icon,
} from 'lucide-react';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AddFormulaDialog, YourDataDialog } from './add-column';
import { useAssistant } from './assistant-context';
import { useAssistantNote } from './assistant-context';
import { useAssistantMoves } from './assistant-screen';
import { ConnectOffer } from './connections';
import { usePageKey } from './fold';
import { useGroup } from './group-button';
import { useIsMobile } from './hooks/use-mobile';
import { SourceStatusItems, useJoins } from './joins';
import { useYourData } from './joins';
import { cn } from './lib/utils';
import { LumenDrawer } from './lumen-drawer';
import {
  type FilterField,
  type FilterToken,
  LumenTokenizedFilter,
  filterByTokens,
  useLumenFilter,
} from './lumen-filter';
import { type GridCard, type GridPlace, LumenGrid } from './lumen-grid';
import {
  KEY_FIELDS,
  type LinkColor,
  LinksProvider,
  followedBy,
  followsText,
  keyFilterFields,
  shared,
  useLinkState,
  useLinks,
  usePublishLinks,
  useRowPick,
} from './lumen-links';
import { type LumenLoad, LumenStates, useCardLoads } from './lumen-source';
import {
  DetailsBody,
  LumenView,
  type LumenViewProps,
  type ServerPaging,
  VIEW_PAGE,
  VIEW_SCROLL,
  mergeRows,
} from './lumen-view';
import { LumenViewCard } from './lumen-view-card';
import {
  AddWidgetDialog,
  type CardAction,
  type CardControls,
  type CardLink,
  LayoutActions,
  LayoutChip,
  LumenSavedWidget,
  LumenWidget,
  cardFilterFields,
  cardTitle,
  cardsAfter,
} from './lumen-widget';
import { OriginLegend } from './origin-legend';
import { type Crumb, IconButton, Page } from './page';
import { SourcedCard } from './sourced-card';
import { LumenCard, SummaryTiles } from './summary-cards';
import { Button } from './ui/button';
import { ViewEditDialog, type ViewEditorSection } from './view-editor';
import {
  type ViewDomain,
  computedOf,
  filterFieldsOf,
  formulaBlanks,
  pick,
  subgroupOf,
  summaryCash,
  takesFormulas,
  withSavedFilters,
  withViewFields,
} from './view-model';

/** Rows of a view the assistant sees with each message. */
const ASSISTANT_ROWS = 10;

/** A card a page builds in code, after the saved view's cards: a view of other data, a list. */
export interface LumenLayoutCard {
  id: string;
  title: string;
  icon?: LucideIcon;
  /** Tables (and grids) take the full width and show a progress bar; widgets a skeleton.
   *  `own`: a body that draws its own frame (LumenCoverageMap, LumenCoverageCalendarMap). */
  kind?: 'table' | 'widget' | 'own';
  /** Columns of 6 it spans (left out: all 6), and rows of 8px it is tall (left out: as it draws). */
  w?: number;
  h?: number;
  /** Its source's loading state: its ↻, states and load time. */
  load?: LumenLoad;
  rows?: number;
  /** Buttons or links in the card's header, before its ↻ ("All jobs"). */
  tools?: ReactNode;
  /** ⓘ How to read: a few lines on what the card shows and what to look for. */
  help?: ReactNode;
  /** What ✦ Ask the assistant adds to its question (the record to read); false: no ✦ on this card. */
  assistant?: string | false;
  /** Every card carries the link square: left out, the page keeps its colour;
   *  false for a form (setup, what-if), which has no data to link; a CardLink to drive it by hand. */
  link?: CardLink | false;
  /** Its colour when the page opens (left out: none). */
  color?: LinkColor;
  /** Chips it shares with the cards of its colour: what a control in its header or a tap in its
   *  body picked (`{key: 'book', value: 'Live'}`). */
  publishes?: FilterToken[];
  /** The keys it narrows on: of its colour's chips it follows these, says them after its title
   *  and hands them to `children` when that is a function. */
  reads?: string[];
  /** Shown while the first load runs (a row of tile placeholders). */
  skeleton?: ReactNode;
  children?: ReactNode | ((follows: FilterToken[]) => ReactNode);
  /** An `own` card that takes its place in a saved view's layout (LumenViewCard): drawn with the
   *  layout's controls and the width the layout keeps for it. Its id must be a field-style key
   *  (lowercase, digits, _) that no card of the view uses. */
  frame?: (f: { controls?: CardControls }) => ReactNode;
}

interface PageProps {
  crumbs: Crumb[];
  actions?: ReactNode;
  /** A short status line beside the breadcrumb ("Updated 18:22", a warnings badge). */
  meta?: ReactNode;
  status?: ReactNode;
  /** Above the cards: tabs or a lead the app shows with this page. */
  intro?: ReactNode;
  /** The page's own cards, after the saved view's. One with a `frame` joins the saved layout as a
   *  `page` card: moved and sized like the rest, last until it is placed. */
  cards?: LumenLayoutCard[];
  /** The page's own cards before the saved view's (a chart over the list it draws from). */
  lead?: LumenLayoutCard[];
  /** Cards take the page's width and wide ones scroll inside themselves (coverage pages). */
  fit?: boolean;
}

/** A saved view on the page: its domain, config and rows. */
export interface LumenLayoutViewProps<T> {
  domain: ViewDomain<T>;
  config: CustomViewConfig;
  rows: T[];
  /** Saves an edited view; without it the page has no Edit button. */
  onConfigChange?: (config: CustomViewConfig) => void;
  /**
   * Whether the page's layout can be edited (every page is a saved view, with
   * this flag set in code for now). False locks it: no Edit, no ＋ Widget, no column changes, even
   * with `onConfigChange` given. Left out: editable where `onConfigChange` is.
   */
  editable?: boolean;
  /** An app's own section in the Edit dialog (an explorer view's columns). */
  editor?: ViewEditorSection;
  /** Duplicate and Delete, offered in the Edit dialog's More section. */
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** A built-in page the person changed (`useAppView`): Edit layout offers Reset to default. */
  onReset?: () => void;
  /** The rows' loading state (`useLumenLoad` over the queries the rows come from): every view and
   *  widget shows its ↻, skeleton, error and load time from it, so it is required. */
  load: LumenLoad;
  /** Shown in place of the table instead of the rows, e.g. an empty state ("No accounts yet"). */
  state?: ReactNode;
  /** Draws one of the domain's tiles over the view's rows (not the table's filter); the
   *  view's `tiles` pick which, in order. */
  tile?: (key: string, rows: T[]) => ReactNode;
  /** The details drawer title for a row. */
  rowTitle?: (row: T) => string;
  /** The saved view's id, shown in the Edit dialog to copy for an MCP call. */
  viewId?: string;
  /** Told the rows the view shows after its filters, every page, whenever they change, so an app
   *  loads live data for those rows only. */
  onShownRows?: (rows: T[]) => void;
  /** Told every row the page's Summaries draw, so an app loads live data for those too
   * : a Summary not linked to the table covers rows the table hides. */
  onSummaryRows?: (rows: T[]) => void;
  selection?: LumenViewProps<T>['selection'];
  /** A row click opens it (a page of its own) instead of the details drawer. */
  onOpen?: (row: T) => void;
  /** The `rowLink` value tapped when the page opens, so linked cards start narrowed to one row
   *  (a playbook's Results open on its Default variant). */
  rowPick?: string;
  groupActions?: LumenViewProps<T>['groupActions'];
  /** Told the filter's tokens whenever they change, so an app can load rows for what they pick
   *  (the Symbols view's `in` filter). */
  onTokens?: (tokens: FilterToken[]) => void;
  /** The rows are one page of a server's, already filtered by `onTokens`' chips: the table
   *  shows them as given and its pager pages through the server. */
  paging?: ServerPaging;
  /** Buttons in the view card's header ("+ Add time"). */
  viewTools?: ReactNode;
  /** False leaves Field out of the header's + Add column (a table whose columns are fixed, a
   *  Tune's tries); otherwise every editable view offers the Columns picker there. */
  columnPicker?: boolean;
  /** No filter box (a short list, e.g. a playbook's variants). */
  hideFilter?: boolean;
  /**
   * How the person's chips, sort and grouping save (rule C, by surface):
   * `document` (a saved view, the default) holds them for the visit and shows Changed with Save
   * view and Revert; `sheet` (a workspace tab) saves every change at once through
   * `onConfigChange`, like a cell in a sheet.
   */
  save?: 'sheet' | 'document';
}

export type LumenLayoutProps<T> = PageProps &
  (LumenLayoutViewProps<T> | { domain?: undefined; config?: undefined; rows?: undefined });

/** A page of cards: a saved view's (its filter, tiles, view and widgets) and the page's own. */
export function LumenLayout<T extends RowData>(
  props: PageProps & LumenLayoutViewProps<T>,
): ReactElement;
/** A page of cards built in code only. */
export function LumenLayout(props: PageProps): ReactElement;
export function LumenLayout<T extends RowData>(props: LumenLayoutProps<T>): ReactElement {
  if (props.domain) return <ViewLayout {...(props as PageProps & LumenLayoutViewProps<T>)} />;
  return <CardsLayout {...props} />;
}

/** One code-built card in its frame, with its own states, its square and what it follows. */
function CodeCard({
  card,
  inScroll,
  controls,
}: {
  card: LumenLayoutCard;
  inScroll: boolean;
  controls?: CardControls;
}) {
  const links = useLinks();
  const color = links?.colorOf(card.id) ?? null;
  const follows = useCardFollows(card);
  const sharedKey = JSON.stringify(card.publishes ?? []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on what it shares.
  const publishes = useMemo(() => card.publishes ?? [], [sharedKey]);
  usePublishLinks(card.id, publishes);
  const link: CardLink | false | undefined =
    card.link ??
    (links
      ? {
          color,
          onPick: (c) => links.setColor(card.id, c),
          follows: follows.length ? followsText(follows) : undefined,
        }
      : undefined);
  const children = typeof card.children === 'function' ? card.children(follows) : card.children;
  return (
    <LumenWidget
      id={card.id}
      kind={null}
      style={card.kind === 'table' ? 'table' : undefined}
      icon={card.icon ?? (card.kind === 'table' ? TableIcon : undefined)}
      title={card.title}
      controls={controls}
      load={card.load}
      rows={card.rows}
      tools={card.tools}
      help={card.help}
      assistant={card.assistant}
      link={link}
      pad={card.kind !== 'table'}
      pinned={inScroll && card.kind === 'table'}
    >
      {card.load ? (
        <LumenStates
          load={card.load}
          kind={card.kind === 'table' ? 'table' : 'widget'}
          skeleton={card.skeleton}
        >
          {children}
        </LumenStates>
      ) : (
        children
      )}
    </LumenWidget>
  );
}

/** The chips of its colour a code card follows: those on the keys it `reads`. */
function useCardFollows(card: LumenLayoutCard) {
  const links = useLinks();
  const all = links?.follows(card.id) ?? NO_TOKENS;
  const key = JSON.stringify(all);
  const reads = (card.reads ?? []).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the chips and keys.
  return useMemo(() => {
    const keys = reads.split(',');
    // A chip on another domain's key field (underlying, ticker) reaches it by key.
    return all.filter(
      (t) => keys.includes(t.key) || (t.as && KEY_FIELDS[t.as].some((k) => keys.includes(k))),
    );
  }, [key, reads]);
}
const NO_TOKENS: FilterToken[] = [];

/** The keys a code card over a domain's rows reads (its `reads`). */
export const domainKeys = (domain: { fields: { key: string }[] }) =>
  domain.fields.map((f) => f.key);

/** A code card's rows narrowed by the chips it follows, read on the domain's fields. */
export function followRows<T>(domain: ViewDomain<T>, rows: T[], follows: FilterToken[]): T[] {
  if (!follows.length) return rows;
  const fields = [...cardFilterFields(domain.fields), ...keyFilterFields(domain.keys)];
  return filterByTokens(rows, fields, followedBy(follows, fields, domain.keys), domain.text);
}

/** The page's colours when it opens: its saved cards' and its code cards' own. */
const codeColors = (cards: (LumenLayoutCard[] | undefined)[]) =>
  Object.fromEntries(
    cards.flatMap((cs) => (cs ?? []).filter((c) => c.color).map((c) => [c.id, c.color ?? null])),
  );
/** The page's code-built cards, whose colour picks the browser remembers for this route. */
function useKeptColors(cards: (LumenLayoutCard[] | undefined)[]) {
  const page = usePageKey();
  const ids = cards.flatMap((cs) => (cs ?? []).map((c) => c.id));
  return { page, ids };
}

// A page's intro row. When it holds tabs it sticks to the top as the page scrolls, under the header,
// on every app ("the tab should be sticky to the top"). It also covers the
// gutters on both sides with shadows, so neither a card border nor a wide table scrolled under it
// peeks out beside it; shadows, unlike a wider box, never make the page scroll sideways.
const INTRO =
  'sticky left-0 flex w-(--view-w) flex-col gap-(--shell-section-gap) has-[[data-slot=tabs-list]]:top-0 has-[[data-slot=tabs-list]]:z-30 has-[[data-slot=tabs-list]]:bg-background has-[[data-slot=tabs-list]]:shadow-[var(--shell-gutter)_0_0_0_var(--color-background),calc(-1*var(--shell-gutter))_0_0_0_var(--color-background)]';

/** The page's one scroller: cards, filter and table scroll together. */
function Scroller({ fit, children }: { fit?: boolean; children: ReactNode }) {
  // Tables' pinned headers stop under a sticky tab row (--pin-top), not behind it. The intro can
  // mount after the scroller (a page that loads first), so each render checks which one it is.
  // A theme that keeps the tab row looking clear (glass sets --intro-fade) paints the page behind
  // it (theme.css): this lines that paint up with the fixed wash and stops pinned headers below its
  // fade. Nothing here runs on scroll: the row is sticky, so it never moves on screen.
  const ref = useRef<HTMLDivElement>(null);
  const watched = useRef<{ intro: HTMLElement; off: () => void } | null>(null);
  useEffect(() => {
    const el = ref.current;
    const intro = el?.querySelector<HTMLElement>('[data-slot=page-intro]') ?? null;
    if (!el || watched.current?.intro === intro) return;
    watched.current?.off();
    watched.current = null;
    if (!intro) return el.style.setProperty('--pin-top', '0px');
    const set = () => {
      const css = getComputedStyle(el);
      const fade = Number.parseFloat(css.getPropertyValue('--intro-fade')) || 0;
      const gutter = Number.parseFloat(css.getPropertyValue('--shell-gutter')) || 0;
      const box = intro.getBoundingClientRect();
      const root = document.documentElement;
      // Rounded down, so a pinned header tucks under the row's last fraction of a pixel instead
      // of leaving a sliver between them that rows show through.
      const row = intro.querySelector('[data-slot=tabs-list]') ? Math.floor(box.height) : 0;
      el.style.setProperty('--pin-top', `${row ? row + fade : 0}px`);
      intro.style.setProperty('--wash-x', `${box.left - gutter}px`);
      intro.style.setProperty('--wash-y', `${box.top}px`);
      intro.style.setProperty('--wash-w', `${root.clientWidth}px`);
      intro.style.setProperty('--wash-h', `${root.clientHeight}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(intro);
    ro.observe(el);
    window.addEventListener('resize', set);
    // The theme can change while the page is open (Settings ▸ glass).
    const mo = new MutationObserver(set);
    mo.observe(document.documentElement, { attributes: true });
    const off = () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', set);
    };
    watched.current = { intro, off };
  });
  useEffect(() => () => watched.current?.off(), []);
  // The vertical scrollbar's width (0 where bars overlay), so pinned rows fit beside it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => el.style.setProperty('--view-sb', `${el.offsetWidth - el.clientWidth}px`);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    if (el.firstElementChild) seen.observe(el.firstElementChild);
    return () => seen.disconnect();
  }, []);
  return (
    <div ref={ref} data-slot="view-scroll" className={VIEW_SCROLL}>
      <div
        className={cn(
          'flex flex-col gap-(--shell-section-gap)',
          fit ? 'w-full' : 'w-max min-w-full',
        )}
      >
        {children}
      </div>
    </div>
  );
}

const codeSlots = (cards: LumenLayoutCard[] | undefined, scope: CardLoads): GridCard[] =>
  (cards ?? []).map((c) => ({
    id: c.id,
    w: c.w ?? GRID_COLS,
    h: c.h,
    wide: (c.kind === 'table' || c.kind === 'own') && (c.w ?? GRID_COLS) === GRID_COLS && !c.h,
    locked: true,
    node:
      c.kind === 'own' ? (
        c.frame ? (
          c.frame({})
        ) : (
          <OwnCard card={c} />
        )
      ) : (
        <CodeCard card={{ ...c, load: scope(c.id, c.load) }} inScroll />
      ),
  }));

/** The saved cards at the places they were moved and sized to, in reading order on a desktop. */
function placeCards(cards: ViewCard[], places: GridPlace[], phone: boolean): ViewCard[] {
  const at = new Map(places.map((p) => [p.id, p]));
  const next = cards.map((c): ViewCard => {
    const p = at.get(c.id);
    if (!p) return c;
    const h = p.h === undefined ? {} : { h: p.h };
    if (phone) return { ...c, phone: { x: p.x, y: p.y, w: p.w, ...h } };
    const { h: _, ...rest } = c;
    return { ...rest, x: p.x, y: p.y, w: p.w, ...h } as ViewCard;
  });
  return phone
    ? next
    : [...next].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
}

/** A card that draws its own frame (a coverage map): it still follows its colour's chips. */
function OwnCard({ card }: { card: LumenLayoutCard }) {
  const follows = useCardFollows(card);
  return <>{typeof card.children === 'function' ? card.children(follows) : card.children}</>;
}

type CardLoads = ReturnType<typeof useCardLoads>;

/** A page of code-built cards only (no saved view). */
function CardsLayout({ crumbs, actions, meta, status, intro, cards, lead, fit }: PageProps) {
  const scope = useCardLoads();
  // Its cards link among themselves, from the colours they open with or the ones picked here.
  const start = useMemo(() => codeColors([lead, cards]), [lead, cards]);
  const { links } = useLinkState(start, useKeptColors([lead, cards]));
  return (
    <Page className={VIEW_PAGE} crumbs={crumbs} actions={actions} meta={meta} status={status}>
      <LinksProvider links={links}>
        <Scroller fit={fit}>
          {intro && (
            <div data-slot="page-intro" className={INTRO}>
              {intro}
            </div>
          )}
          <LumenGrid
            lead={codeSlots(lead, scope)}
            cards={codeSlots(cards, scope)}
            editing={false}
          />
        </Scroller>
      </LinksProvider>
    </Page>
  );
}

/** A saved view's page: its filter, Group button and cards, Edit view and Edit layout. */
/**
 * A second table on a saved page (several tables on a layout): its own
 * columns, sort and grouping over the view's rows (and formulas), its own chips and tapped row,
 * shared with the cards of its colour like any card. A Columns change saves into its layout.
 */
function LayoutTable<T extends RowData>({
  card,
  base,
  config,
  rows,
  load,
  state,
  onDetails,
  controls,
  onLayout,
}: {
  card: ViewTableCard;
  base: ViewDomain<T>;
  config: CustomViewConfig;
  rows: T[];
  load?: LumenLoad;
  state?: ReactNode;
  onDetails?: (row: T) => void;
  controls?: CardControls;
  onLayout?: (table: ViewTableLayout) => void;
}) {
  const own = useMemo(
    () => tableConfigOf(config, { ...card, table: card.table ?? tableLayoutOf(config) }),
    [config, card],
  );
  const domain = useMemo(() => withViewFields(base, own), [base, own]);
  return (
    <LumenViewCard
      id={card.id}
      domain={domain}
      config={own}
      rows={rows}
      load={load}
      state={state}
      title={card.title ?? config.name}
      onDetails={onDetails}
      controls={controls}
      shown={card.controls}
      onColumns={onLayout && ((columns) => onLayout(tableLayoutOf({ ...own, columns })))}
    />
  );
}

function ViewLayout<T extends RowData>({
  crumbs,
  actions,
  meta,
  status,
  intro,
  cards: extra,
  lead,
  domain: base,
  config,
  rows,
  onConfigChange: saveConfig,
  editable: canEdit,
  editor,
  onDuplicate,
  onDelete,
  onReset,
  load,
  state,
  tile,
  rowTitle,
  viewId,
  onShownRows,
  onSummaryRows,
  selection,
  onOpen,
  rowPick: initialPick,
  groupActions,
  onTokens,
  paging,
  viewTools,
  columnPicker,
  hideFilter,
  save: saveMode = 'document',
}: PageProps & LumenLayoutViewProps<T>) {
  const onConfigChange = canEdit === false ? undefined : saveConfig;
  // The registry's join fields for the keys the rows carry (Symbol, Account), then the view's own
  // formulas and formats.
  const joins = useJoins(base, rows, config);
  const domain = useMemo(() => withViewFields(joins.domain, config), [joins.domain, config]);
  const scope = useCardLoads();
  const columns = pick(domain.fields, config.columns);
  const filterFields = useMemo<FilterField<T>[]>(
    () => cardFilterFields(filterFieldsOf(domain.fields, config.filters.fields)),
    [domain.fields, config.filters.fields],
  );
  const filter = useLumenFilter(rows, filterFields, {
    text: domain.text,
    initial: config.filters.default,
  });
  // A view patched while open (the assistant's card move, a save from another tab) applies its new saved
  // filters at once; the person's own unsaved tokens stay while the saved ones
  // do not change.
  const savedFilters = JSON.stringify(config.filters.default);
  const savedFiltersRef = useRef(savedFilters);
  const { setTokens } = filter;
  useEffect(() => {
    if (savedFiltersRef.current === savedFilters) return;
    savedFiltersRef.current = savedFilters;
    setTokens(config.filters.default);
  }, [savedFilters, config.filters.default, setTokens]);
  useEffect(() => onTokens?.(filter.tokens), [onTokens, filter.tokens]);
  const group = useGroup(domain, config);
  // The sort the person set by a header click, held like the chips and grouping (rule C).
  const [heldSort, setHeldSort] = useState(config.sort);
  const savedSort = JSON.stringify(config.sort ?? null);
  const savedSortRef = useRef(savedSort);
  useEffect(() => {
    if (savedSortRef.current === savedSort) return;
    savedSortRef.current = savedSort;
    setHeldSort(config.sort);
  }, [savedSort, config.sort]);
  // A server's page sorts on the server: it hears each sort held.
  const onServerSort = paging?.onSort;
  useEffect(() => onServerSort?.(heldSort ?? null), [onServerSort, heldSort]);
  const [details, setDetails] = useState<T | null>(null);
  const onDetails = onOpen ?? (domain.details?.length ? setDetails : undefined);
  // The assistant sees the view, its data domain, its filter, how many rows show, the first of them and the
  // row open in the drawer (it saw only a row count and could not answer).
  useAssistantNote('view', {
    label: details && rowTitle ? `${rowTitle(details)} selected` : '',
    data: {
      view: config.name,
      domain: domain.id,
      filter: filter.tokens.map((t) => `${t.not ? 'not ' : ''}${t.key}${t.op ?? ':'}${t.value}`),
      rows: filter.results.length,
      sources: joins.sources.map(sourceLine),
      first_rows: filter.results
        .slice(0, ASSISTANT_ROWS)
        .map((r) => Object.fromEntries(columns.map((f) => [f.label, f.value(r)]))),
      selected: details
        ? Object.fromEntries(columns.map((f) => [f.label, f.value(details)]))
        : undefined,
    },
  });

  const [editing, setEditing] = useState(false);
  // While the layout is edited, changes go to a draft saved on Done; otherwise a card's ⋯ menu
  // saves at once.
  const [layout, setLayout] = useState(false);
  const [draft, setDraft] = useState<ViewCard[]>([]);
  // What Edit widget changes on the view itself (formulas, links, frames) while the layout is
  // edited: held with the draft and saved with it, never on its own. A save mid-edit made pages
  // that key on the view's save time remount, which dropped the draft and its new widget.
  const [draftView, setDraftView] = useState<Partial<CustomViewConfig>>({});
  const [adding, setAdding] = useState(false);
  // Any card but the view's own table, edited in the same editor.
  const [editingWidget, setEditingWidget] = useState<ViewWidget | null>(null);
  // The page's own framed cards join the layout: where the saved layout
  // places one, it keeps its place and width; one it lacks goes last, full width; one the page no
  // longer draws is skipped.
  const placed = useMemo(() => (extra ?? []).filter((c) => c.frame), [extra]);
  const saved = useMemo(() => {
    const kept = cardsOf(config).filter(
      (c) => c.kind !== 'page' || placed.some((p) => p.id === c.id),
    );
    const added = placed
      .filter((p) => !kept.some((c) => c.id === p.id))
      .map(
        (p): ViewCard => ({
          id: p.id,
          kind: 'page',
          title: null,
          w: p.w ?? GRID_COLS,
          filter: [],
        }),
      );
    return [...kept, ...added];
  }, [config, placed]);
  const cards = layout ? draft : saved;

  // Filter links: each card's colour for the visit, and the linked chips of
  // the view's filter and of each widget's own filter (a page's second tables publish theirs).
  const savedLinks = useMemo(
    () => ({
      ...codeColors([lead, extra]),
      ...Object.fromEntries(saved.map((c) => [c.id, c.link ?? null])),
    }),
    [saved, lead, extra],
  );
  const { links, colors } = useLinkState(savedLinks, useKeptColors([lead, extra]));
  // The page's main table draws the view's own layout and holds its chips, sort and grouping;
  // every other table draws its own (several tables on a layout).
  const mainTable = mainTableOf(saved);
  const viewCardId = mainTable?.id ?? 'view';
  const viewColor = colors[viewCardId] ?? null;
  const { publish } = links;
  // A row tap in the linked table narrows the cards of its colour.
  const rowPick = useRowPick(domain, viewColor, initialPick);
  useEffect(() => {
    publish(viewCardId, shared([...filter.tokens, ...rowPick.token], viewColor));
  }, [publish, viewCardId, viewColor, filter.tokens, rowPick.token]);
  // A widget's own filter is its own: only the table's chips and tapped row
  // (and a page's second tables, which publish theirs) are shared with the colour group.
  const widgetFields = useMemo(
    () => [...cardFilterFields(domain.fields), ...keyFilterFields(domain.keys)],
    [domain.fields, domain.keys],
  );
  const followed = (id: string) => followedBy(links.follows(id), widgetFields, domain.keys);
  const narrow = (rs: T[], ts: FilterToken[]) =>
    ts.length ? filterByTokens(rs, widgetFields, ts, domain.text) : rs;
  const viewFollows = followed(viewCardId);
  const viewFollowKey = JSON.stringify(viewFollows);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on what the table follows.
  const viewRows = useMemo(
    // A server's page is filtered there: its chips do not narrow it again here.
    () => narrow(paging ? rows : filter.results, viewFollows),
    [filter.results, viewFollowKey, widgetFields, paging ? rows : null],
  );
  useEffect(() => onShownRows?.(viewRows), [onShownRows, viewRows]);
  const linksChanged = saved.some((c) => (colors[c.id] ?? null) !== (c.link ?? null));
  const cardLink = (id: string, follows: FilterToken[], linked?: number) => ({
    color: colors[id] ?? null,
    onPick: (color: LinkColor | null) => links.setColor(id, color),
    follows: followsText(follows),
    linked,
  });
  const commit = (next: ViewCard[]) =>
    layout ? setDraft(next) : onConfigChange?.({ ...config, cards: next });
  const putCard = (c: ViewCard) => {
    const i = cards.findIndex((x) => x.id === c.id);
    commit(i < 0 ? [...cards, c] : cards.map((x, j) => (j === i ? c : x)));
  };
  const act = (i: number, a: CardAction) => {
    const c = cards[i];
    if (!c) return;
    if (a === 'edit')
      return isTableCard(c) && c.id === viewCardId
        ? setEditing(true)
        : c.kind !== 'page' && setEditingWidget(c);
    // A copy of the page's first Summary takes its own copy of the view's cards, and a copy of
    // the main table its own copy of the view's layout.
    if (a === 'duplicate' && ((isRowCard(c) && !c.tiles) || (isTableCard(c) && !c.table))) {
      const next = cardsAfter(cards, i, a);
      const copy = next?.[i + 1];
      if (next && copy)
        commit(
          next.map((x, j) =>
            j !== i + 1
              ? x
              : isRowCard(c)
                ? { ...copy, tiles: tilesOfCard(config, c) }
                : { ...copy, table: tableLayoutOf(config) },
          ) as ViewCard[],
        );
      return;
    }
    const next = cardsAfter(cards, i, a);
    if (next) commit(next);
  };
  const mergeFlat = useCallback((rs: T[]) => mergeRows(domain, rs, null), [domain]);
  const { pivot } = group;
  const mobile = useIsMobile();
  // A phone has no width to fit to: the table scrolls sideways there.
  const fit = config.width === 'fit' && !pivot && !mobile;

  // Each Summary's cards: the domain's, drawn by the app, and the view's
  // own, worked out over the rows the Summary shows (every row, narrowed by its own filter; the
  // table's filter is the table's).
  // Each Summary counts the domain's cash rows only when it says so.
  const summaryRows = (c: ViewRowCard) => {
    const follows = followed(c.id);
    return {
      rows: narrow(c.filter.length ? filterByTokens(rows, widgetFields, c.filter) : rows, follows),
      narrowed: c.filter.length > 0 || follows.length > 0,
    };
  };
  const summaryAll = cards.flatMap((c) => (isRowCard(c) ? summaryRows(c).rows : []));
  const summaryKey = [...new Set(summaryAll.map(domain.rowKey))].sort().join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on which rows the Summaries draw.
  useEffect(() => {
    if (onSummaryRows) onSummaryRows([...new Set(summaryAll)]);
  }, [onSummaryRows, summaryKey]);
  const summaryOf = (c: ViewRowCard) => {
    const list = tilesOfCard(config, c);
    const { rows: drawn, narrowed } = summaryRows(c);
    const cash = domain.cash;
    const own = cash && !summaryCash(c, narrowed) ? drawn.filter((r) => !cash(r)) : drawn;
    return state ? null : (
      <SummaryTiles
        domain={domain}
        tiles={list}
        rows={own}
        fields={widgetFields}
        tile={tile}
        loading={!!load?.loading}
      />
    );
  };
  // A LumenCard: one number over the rows narrowed by its filter and colour.
  const cardOf = (c: Extract<ViewCard, { tile: unknown }>) => {
    const follows = followed(c.id);
    const own = narrow(
      c.filter.length ? filterByTokens(rows, widgetFields, c.filter) : rows,
      follows,
    );
    const cash = domain.cash;
    const drawn =
      cash && !summaryCash({}, c.filter.length > 0 || follows.length > 0)
        ? own.filter((r) => !cash(r))
        : own;
    return state ? null : (
      <LumenCard
        domain={domain}
        tile={c.tile}
        rows={drawn}
        fields={widgetFields}
        drawn={tile}
        loading={!!load?.loading}
        style={c.style}
        target={c.target}
        meter={c.meter}
        bands={c.bands}
      />
    );
  };
  const hasCards = (c: ViewRowCard) => tilesOfCard(config, c).some((t) => isOwnTile(t) || tile);

  // The filter and Group sit in the view's card. A chip narrows that table
  // only, unless it carries the card's colour square: then every card of that colour follows it.
  // Its save icon also saves the page's colours.
  // What the person holds now against what is saved (rule C): their chips
  // (with the page's colours), sort and grouping as one config. A sheet (workspace tab) saves it
  // on every change; a document (saved view) shows it as Changed with Save view and Revert.
  const heldTokens = filter.tokens;
  const heldConfig = useMemo<CustomViewConfig>(() => {
    const tokKey = (ts: Pick<FilterToken, 'key' | 'value' | 'not' | 'op' | 'link'>[]) =>
      ts
        .map((t) => JSON.stringify([t.key, t.op ?? null, t.value, !!t.not, !!t.link]))
        .sort()
        .join('\n');
    const sameChips = tokKey(heldTokens) === tokKey(config.filters.default);
    const filters = sameChips
      ? config.filters
      : withSavedFilters(
          domain.fields,
          config.filters,
          heldTokens.map(({ link, ...t }) => (link && viewColor ? { ...t, link: viewColor } : t)),
        );
    const savedSub = subgroupOf(domain, config.subgroup)?.key ?? null;
    const { pivot: heldPivot, group: heldGroup, subgroup: heldSub } = group.held;
    const shape = heldPivot ? 'pivot' : config.shape === 'pivot' ? 'table' : config.shape;
    return {
      ...config,
      filters,
      sort: heldSort,
      shape,
      group: heldPivot ? config.group : { ...config.group, default: heldGroup },
      ...(heldSub !== savedSub ? { subgroup: heldSub ?? undefined } : {}),
      ...(linksChanged
        ? {
            cards: saved.map((c) => {
              const { link: _, ...rest } = c;
              const color = colors[c.id];
              return (color ? { ...rest, link: color } : rest) as ViewCard;
            }),
          }
        : {}),
    };
  }, [config, heldTokens, heldSort, group.held, domain, viewColor, linksChanged, saved, colors]);
  const heldJson = JSON.stringify(heldConfig);
  const configJson = JSON.stringify(config);
  const changed = !!onConfigChange && heldJson !== configJson;
  // A sheet saves what changed as it changes; each config once, so a save that comes back the
  // same never loops. When the saved config changes from outside (the assistant patch, another tab),
  // the held chips, sort and grouping still show the old one for a render: that render saves
  // nothing, or it would write the old layout back over the new one.
  const sentRef = useRef<string | null>(null);
  const seenRef = useRef(configJson);
  useEffect(() => {
    if (seenRef.current !== configJson) {
      seenRef.current = configJson;
      return;
    }
    if (saveMode !== 'sheet' || !changed || sentRef.current === heldJson) return;
    sentRef.current = heldJson;
    onConfigChange?.(heldConfig);
  }, [saveMode, changed, heldJson, heldConfig, onConfigChange, configJson]);
  const revert = () => {
    setTokens(config.filters.default);
    setHeldSort(config.sort);
    group.reset();
  };

  // + Add column: Field is the Columns picker at the +, Formula opens the
  // formula editor here, Your data makes the person's own column (a linked frame of theirs,
  // attached to this card). Ask the assistant is the card's ⋯ menu, on every card.
  const assistant = useAssistant();
  const yours = useYourData(assistant?.api ?? null);
  const [addingFormula, setAddingFormula] = useState(false);
  const [addingYours, setAddingYours] = useState(false);
  const yoursKey = domain.keys?.symbol ? 'symbol' : domain.keys?.account ? 'account' : null;
  const addColumn = onConfigChange
    ? {
        formula: takesFormulas(base)
          ? () => setAddingFormula(true)
          : { disabled: 'This card’s data takes no formula columns' },
        yours: !assistant
          ? { disabled: 'Your data needs an assistant on this app' }
          : !yoursKey
            ? { disabled: 'This card’s rows carry no symbol or account to key your column by' }
            : () => setAddingYours(true),
      }
    : undefined;
  // The table's controls (Edit widget ▸ Controls): its Filter box and Group.
  const viewCard = mainTableOf(cards);
  const viewOn = (k: WidgetControl) => !viewCard || controlOn(viewCard, k);
  const showBox = !hideFilter && viewOn('filter');
  // A server's page cannot be grouped (a group would bucket the one page only), unless the
  // server groups it.
  const groupButton = viewOn('group') && (!paging || paging.groups) ? group.button : null;
  const viewFilter =
    !showBox && !groupButton ? undefined : (
      <>
        {showBox && (
          <LumenTokenizedFilter
            filter={filter}
            label={`Filter ${config.name}`}
            className="min-w-0 flex-1"
            saved={config.filters.default}
            link={{
              color: viewColor,
              onPick: (color) => links.setColor(viewCardId, color),
            }}
          />
        )}
        {groupButton}
      </>
    );

  // Link (connections): the offer adds the connection and a few of its fields.
  const connect = (c: ViewConnection) =>
    onConfigChange?.({
      ...config,
      connections: [...(config.connections ?? []), c],
      columns: [
        ...(config.columns.length ? config.columns : columns.map((f) => f.key)),
        ...(linkColumns(c.to).length ? linkColumns(c.to) : [CONNECTED_COUNT]).map((k) =>
          connectedKey(c.to, k),
        ),
      ],
    });
  const editable = !!onConfigChange;
  // A Summary with no cards shows nothing until the layout is edited.
  const shown = layout ? cards : cards.filter((c) => !isRowCard(c) || (!state && hasCards(c)));
  const gridCards: GridCard[] = shown.map((c): GridCard => {
    const i = cards.indexOf(c);
    const place = { id: c.id, w: c.w, h: c.h, x: c.x, y: c.y, phone: c.phone };
    const controls: CardControls | undefined = editable
      ? {
          layout,
          editable,
          first: i === 0,
          last: i === cards.length - 1,
          onFit:
            c.h !== undefined || c.phone?.h !== undefined
              ? () => {
                  const { h: _, ...rest } = c;
                  const { h: _p, ...phone } = c.phone ?? { x: 0, y: 0, w: 1 };
                  putCard({ ...rest, ...(c.phone ? { phone } : {}) } as ViewCard);
                }
              : undefined,
          onAction: (a) => act(i, a),
          fixed: c.kind === 'page',
        }
      : undefined;
    if (c.kind === 'page') {
      const p = placed.find((x) => x.id === c.id);
      return {
        ...place,
        wide: c.w === GRID_COLS && c.h === undefined,
        node: p?.frame?.({ controls }) ?? null,
      };
    }
    return {
      ...place,
      wide: isTableCard(c) && c.w === GRID_COLS && c.h === undefined,
      node: c.source ? (
        <SourcedCard
          card={c as ViewWidget & { source: string }}
          name={config.name}
          controls={controls}
        />
      ) : isTableCard(c) && c.id !== viewCardId ? (
        <LayoutTable
          card={c}
          base={joins.domain}
          config={config}
          rows={c.filter.length ? filterByTokens(rows, widgetFields, c.filter) : rows}
          load={scope(c.id, load)}
          state={state}
          onDetails={onDetails}
          controls={controls}
          onLayout={onConfigChange ? (table) => putCard({ ...c, table }) : undefined}
        />
      ) : isTableCard(c) ? (
        <LumenView
          domain={domain}
          config={config}
          rows={viewRows}
          total={rows.length}
          paging={paging}
          groupBy={group.groupField}
          pivot={pivot}
          subgroup={group.sub}
          load={scope(c.id, load)}
          state={state}
          title={c.title ?? config.name}
          selection={selection}
          onDetails={rowPick.onTap ?? onDetails}
          tapped={rowPick.tapped}
          groupActions={groupActions}
          controls={controls}
          inLayout
          tools={viewTools}
          filter={viewFilter}
          filterCount={filter.tokens.length}
          strip={
            <ConnectOffer
              domain={domain}
              rows={rows}
              config={config}
              read={joins.read}
              cardKey={viewId ?? config.name}
              onConnect={onConfigChange ? connect : undefined}
            />
          }
          link={cardLink(c.id, viewFollows, viewColor ? filter.tokens.length : 0)}
          shown={c.controls}
          onColumns={
            onConfigChange && columnPicker !== false
              ? (columns) => onConfigChange({ ...config, columns })
              : undefined
          }
          onAddColumn={addColumn}
          sort={heldSort}
          onSort={setHeldSort}
        />
      ) : (
        <LumenSavedWidget
          widget={c as ViewWidget}
          title={cardTitle(c, config.name)}
          domain={domain}
          rows={narrow(rows, followed(c.id))}
          link={cardLink(c.id, followed(c.id))}
          fields={widgetFields}
          merge={mergeFlat}
          onDetails={onDetails}
          load={scope(c.id, load)}
          tiles={
            'tile' in c
              ? cardOf(c)
              : isRowCard(c)
                ? (summaryOf(c) ?? (
                    <p className="text-sm text-muted-foreground">
                      No cards yet: add them in Edit widget.
                    </p>
                  ))
                : null
          }
          controls={controls}
        />
      ),
    };
  });

  // The assistant opens a row's drawer by its title (the first that matches: whole, then start, then
  // part); Undo puts back the row that was open. Mid-edit, its moves wait for the person's tap.
  const titleOf = (r: T) => rowTitle?.(r) ?? domain.rowKey(r);
  useAssistantMoves('view', {
    open: (q) => {
      if (!onDetails) return 'Rows here have no details to open';
      const want = q.trim().toLowerCase();
      const pool = [...filter.results, ...rows];
      const t = (r: T) => titleOf(r).toLowerCase();
      const row =
        pool.find((r) => t(r) === want) ??
        pool.find((r) => t(r).startsWith(want)) ??
        pool.find((r) => t(r).includes(want));
      if (!row) return `no row "${q}" in ${config.name}`;
      onDetails(row);
      return null;
    },
    rows: () => filter.results.slice(0, 30).map(titleOf),
    // The read-back after a card move: rows shown, columns empty on every shown row, the sources.
    read: () => {
      if (load?.loading) return '';
      const shown = filter.results;
      // Values as the table works them out: a formula's own `value` is always null (every formula column read back to the assistant as empty, whatever the page showed).
      const computed = computedOf(domain, shown, null);
      const blanks = formulaBlanks(domain, shown);
      const empty = columns
        .filter(
          (f) =>
            !blanks.has(f.key) &&
            shown.length &&
            shown.every((r) => {
              const v = computed.value(f, r);
              return v === null || v === undefined || v === '';
            }),
        )
        .map((f) => f.key);
      const failing = columns
        .filter((f) => blanks.has(f.key))
        .map((f) => `${f.key} ${blanks.get(f.key)}`);
      return `${config.name}: ${shown.length} rows${rows.length !== shown.length ? ` of ${rows.length}` : ''}; columns ${columns.map((f) => f.key).join(', ')}${empty.length ? `; empty in every row: ${empty.join(', ')}` : ''}${failing.length ? `; formulas blank: ${failing.join('; ')}` : ''}${joins.sources.length ? `; sources ${joins.sources.map(sourceLine).join(', ')}` : ''}`;
    },
    editing: () => layout || editing || adding || editingWidget !== null,
    snapshot: () => (details === null ? null : domain.rowKey(details)),
    restore: (k) =>
      setDetails(k === null ? null : (rows.find((r) => domain.rowKey(r) === k) ?? null)),
  });

  // The open row as the rows are now, so an edit made in the drawer shows in it.
  const key = details === null ? null : domain.rowKey(details);
  const open = key === null ? null : (rows.find((r) => domain.rowKey(r) === key) ?? details);
  const openTitle = open === null ? '' : (rowTitle?.(open) ?? domain.rowKey(open));
  const body = (
    <>
      {intro && (
        <div data-slot="page-intro" className={INTRO}>
          {intro}
        </div>
      )}
      <LumenGrid
        lead={codeSlots(lead, scope)}
        cards={gridCards}
        tail={codeSlots(
          extra?.filter((c) => !c.frame),
          scope,
        )}
        editing={layout}
        onPlace={(places, phone) => setDraft((d) => placeCards(d, places, phone))}
      />
      {layout && (
        <IconButton
          icon={PlusIcon}
          label="Add widget"
          variant="outline"
          size="icon"
          className="sticky left-0 h-16 w-(--view-w) border-2 border-dashed text-muted-foreground"
          onClick={() => setAdding(true)}
        />
      )}
    </>
  );

  return (
    <Page
      className={VIEW_PAGE}
      crumbs={crumbs}
      meta={layout ? <LayoutChip /> : meta}
      status={
        <>
          {status}
          <OriginLegend domain={domain} columns={columns} />
          <SourceStatusItems sources={joins.sources} actions={joins.actions} />
        </>
      }
      actions={actions}
      layout={
        layout ? (
          <LayoutActions
            onCancel={() => {
              setDraft(saved);
              setDraftView({});
              setLayout(false);
            }}
            onAdd={() => setAdding(true)}
            onReset={
              onConfigChange &&
              onReset &&
              (() => {
                setLayout(false);
                onReset();
              })
            }
            onSave={() => {
              setLayout(false);
              setDraftView({});
              if (
                JSON.stringify(draft) !== JSON.stringify(saved) ||
                Object.keys(draftView).length > 0
              )
                onConfigChange?.({ ...config, ...draftView, cards: draft });
            }}
          />
        ) : (
          onConfigChange && (
            <>
              {changed && saveMode === 'document' && (
                <>
                  <IconButton icon={Undo2Icon} label="Revert view" onClick={revert} />
                  <IconButton
                    icon={SaveIcon}
                    label="Save view (chips, sort, group)"
                    variant="default"
                    onClick={() => onConfigChange?.(heldConfig)}
                  />
                </>
              )}
              {/* Every page edits through one layout icon (the pencil became the layout
                grid), straight into Edit layout (no menu; Add sits in edit
                mode and each widget has its own Edit widget). */}
              <IconButton
                icon={LayoutDashboardIcon}
                label="Edit layout"
                onClick={() => {
                  setDraft(saved);
                  setDraftView({});
                  setLayout(true);
                }}
              />
            </>
          )
        )
      }
    >
      <LinksProvider links={links}>
        <Scroller fit={fit}>{body}</Scroller>
      </LinksProvider>
      <LumenDrawer open={open !== null} title={openTitle} onClose={() => setDetails(null)}>
        {open !== null && (
          <DetailsBody domain={domain} row={open} columns={columns} chips={config.chips ?? []} />
        )}
      </LumenDrawer>
      {onConfigChange && (
        <>
          <AddWidgetDialog
            open={adding}
            onOpenChange={setAdding}
            domain={domain}
            cards={cards}
            name={config.name}
            onAdd={(c) => {
              setAdding(false);
              // A second table starts as a copy of the view's layout, then goes its own way.
              putCard(
                isTableCard(c) && mainTable && !c.source
                  ? { ...c, table: tableLayoutOf(config) }
                  : c,
              );
            }}
            onBuild={(c) => {
              setAdding(false);
              if (c.kind !== 'page') setEditingWidget(c);
            }}
          />
          {editingWidget && (
            <ViewEditDialog
              open
              onOpenChange={(o) => !o && setEditingWidget(null)}
              domain={joins.domain}
              config={layout ? { ...config, ...draftView } : config}
              rows={rows}
              current={[]}
              card={editingWidget}
              fields={widgetFields}
              viewTiles={config.tiles}
              read={joins.read}
              onSaveCard={(c, view) => {
                setEditingWidget(null);
                const i = cards.findIndex((x) => x.id === c.id);
                const next = i < 0 ? [...cards, c] : cards.map((x, j) => (j === i ? c : x));
                if (layout) {
                  setDraft(next);
                  setDraftView((d) => ({ ...d, ...view }));
                } else onConfigChange({ ...config, ...view, cards: next });
              }}
              editor={editor}
            />
          )}
          <AddFormulaDialog
            open={addingFormula}
            onOpenChange={setAddingFormula}
            domain={joins.domain}
            formulas={config.formulas}
            onAdd={(f) => {
              setAddingFormula(false);
              onConfigChange({
                ...config,
                formulas: [...config.formulas, f],
                // A view still on its default columns keeps them beside the new one.
                columns: [
                  ...(config.columns.length ? config.columns : columns.map((c) => c.key)),
                  f.key,
                ],
              });
            }}
          />
          <YourDataDialog
            open={addingYours}
            onOpenChange={(o) => {
              setAddingYours(o);
              if (!o) yours.reset();
            }}
            keyLabel={yoursKey ?? 'row'}
            busy={yours.isPending}
            error={yours.error?.message ?? null}
            onAdd={(column) => {
              if (!yoursKey) return;
              yours.mutate(
                { key: yoursKey, column },
                {
                  onSuccess: (meta) => {
                    setAddingYours(false);
                    const added = meta.columns.find((c) => c.label === column.label)?.key;
                    onConfigChange({
                      ...config,
                      frames: [...(config.frames ?? []).filter((id) => id !== meta.id), meta.id],
                      columns: added ? [...config.columns, added] : config.columns,
                    });
                  },
                },
              );
            }}
          />
          <ViewEditDialog
            open={editing}
            onOpenChange={setEditing}
            domain={joins.domain}
            config={config}
            rows={filter.results}
            current={filter.tokens}
            onSave={onConfigChange}
            read={joins.read}
            viewId={viewId}
            editor={editor}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        </>
      )}
    </Page>
  );
}
