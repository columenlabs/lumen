import {
  CATALOG,
  FRAME_LINK,
  catalogKeys,
  linkColumns,
  readableDomain,
} from '@columenlabs/lumen-ui-types/catalog';
import type { FrameChoice } from '@columenlabs/lumen-ui-types/frames';
import {
  CONNECTED_COUNT,
  type CustomViewConfig,
  VIEW_CARD_KIND_NAMES,
  type ViewCard,
  type ViewChipPlacement,
  type ViewConnection,
  type ViewTableCard,
  type ViewTableWidth,
  type ViewTile,
  type ViewTotalAgg,
  type ViewWidget,
  WIDGET_STYLES,
  cardsOf,
  connectedKey,
  customViewConfigSchema,
  inferConnection,
  isOwnTile,
  isRowCard,
  isTableCard,
  mainTableOf,
  sourceConfigOf,
  tableConfigOf,
  tableLayoutOf,
  viewAggs,
  viewCardSchema,
  type viewNumberFormats,
  viewPageSizes,
  viewPaginationSchema,
  widgetStyleId,
} from '@columenlabs/lumen-ui-types/views';
// The Edit view dialog (mock 2b): two panes. Left, a tree of every field the
// view's rows reach, grouped by where it comes from (Holding, Symbol by topic, Account, Formulas),
// ticked to show. Right, what the view does with them: column order (drag), shape, group, filter,
// sort, header tiles, then the view id, Duplicate and Delete. Name, icon, Cancel and Save sit in
// the header. On a phone the panes are two tabs, Fields and Layout. Everything here is the view's
// config, which agents write the same way through MCP custom_view_write.
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  Columns3Icon,
  CopyIcon,
  DatabaseIcon,
  EllipsisIcon,
  FilterIcon,
  GripVerticalIcon,
  LayoutDashboardIcon,
  Link2Icon,
  type LucideIcon,
  MoveHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ReplaceIcon,
  SearchIcon,
  ShapesIcon,
  ShrinkIcon,
  SigmaIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  StarIcon,
  ToggleRightIcon,
  Trash2Icon,
  Unlink2Icon,
  UnlinkIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AddFormulaDialog } from './add-column';
import { useAssistant, useAssistantName } from './assistant-context';
import { LumenConfirm } from './confirm';
import {
  type ConnectedDomain,
  connectCandidates,
  connectionFields,
  connectionOn,
  linkGroupId,
} from './connections';
import { DrawerSection } from './drawer-section';
import { type FormIssue, SaveButton } from './form-issues';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { IconPicker } from './icon-picker';
import {
  asOf,
  frameGroupId,
  rowsDomain,
  useDomainReads,
  useDraftFrames,
  useFrameChoices,
} from './joins';
import { cn } from './lib/utils';
import {
  type FilterField,
  type FilterToken,
  LumenTokenizedFilter,
  filterByTokens,
  tokenText,
  useLumenFilter,
} from './lumen-filter';
import { LinkPicker } from './lumen-links';
import { type LumenOption, LumenSelector } from './lumen-selector';
import { lumenToast } from './lumen-toast';
import {
  CARD_COLUMNS,
  CARD_TITLE_MAX,
  cardFilterFields,
  cardTitle,
  draftOf,
  useOffered,
} from './lumen-widget';
import { useApp } from './shell';
import { summaryCardIssues } from './summary-cards';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  AGG_LABELS,
  FORMAT_LABELS,
  FormatChip,
  FormulaForm,
  MAX_FORMULAS,
  fieldOptions,
  formatOptions,
  formulaIssueTarget,
  formulaIssues,
  formulaOptions,
} from './view-formulas';
import { shapeIcon } from './view-icons';
import {
  FORMULAS_GROUP,
  type ViewDomain,
  type ViewField,
  type ViewFieldGroup,
  canFilter,
  chipsOf,
  formulaBlanks,
  formulasOf,
  groupOf,
  hiddenOf,
  subgroupLabel,
  subgroupOf,
  subgroupsOf,
  summaryCash,
  takesFormulas,
  tilesOf,
  totalAggOf,
  withViewFields,
} from './view-model';
import { WidgetControlsEditor } from './widget-controls';
import { PAGE_SOURCE, useWidgetDataOptions } from './widget-data';
import {
  EditorRow as Row,
  type WidgetDraft,
  WidgetFields,
  WidgetSettings,
  hasWidgetSettings,
  readsRows,
  slotKeys,
  widgetSlots,
} from './widget-settings';
import { widgetThumb } from './widget-thumbs';

/** The field's own group and Total rows: a formula over the rolled-up inputs, or a share. */
const OWN_TOTAL = '_own';
/** The order: None, then the common roll-ups. */
const TOTAL_AGGS = ['sum', 'mean', 'min', 'max', 'count', 'distinct', 'last', 'first'] as const;

/** An app's own section in the dialog (an explorer view's columns). */
export interface ViewEditorSection {
  title: string;
  icon: LucideIcon;
  description?: string;
  content: ReactNode;
}

export interface ViewEditDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: ViewDomain<T>;
  /** The view: its own table's layout, and the formulas every widget on it shares. */
  config: CustomViewConfig;
  /** The rows the page shows now (after its filters), for the previews. */
  rows: T[];
  /** The filter tokens on the page now, offered as the new defaults. */
  current: FilterToken[];
  /** Saves the view's own table (left out when `card` is edited). */
  onSave?: (config: CustomViewConfig) => void;
  /**
   * Any other widget on the page (one editor for every widget): a second
   * table, a number, a chart. Left out, the editor edits the view's own table.
   */
  card?: ViewWidget;
  /** Saves `card` as edited (its type may have changed) with the view's formulas and links. */
  onSaveCard?: (
    card: ViewWidget,
    view: Pick<CustomViewConfig, 'formulas' | 'connections' | 'frames'>,
  ) => void;
  /** What each linked or linkable domain read (the app's `useJoins`), for Link in the tree. */
  read?: Record<string, ConnectedDomain>;
  /** The fields a widget's own filter reads. */
  fields?: FilterField<T>[];
  /** The view's own Summary cards, which a Summary without its own starts from. */
  viewTiles?: ViewTile[];
  viewId?: string;
  editor?: ViewEditorSection;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

const SHAPES = [
  { value: 'table', label: 'Table' },
  { value: 'group', label: 'Group' },
  { value: 'pivot', label: 'Pivot' },
] as const;

const NONE = '_none';
/** The main data picker's value for the page's own rows. */
const NO_FRAMES: string[] = [];
/** A catalog domain of this app that + Data offers. */
interface DeskDomain {
  id: string;
  label: string;
  about: string;
  /** The keys both sides carry. */
  by: string[];
  /** How it links now; none when it cannot (`why`). */
  on?: ViewConnection['on'];
  why?: string;
}
/** A recipe's (a linked the assistant frame's) group id starts with this (`recipe:fr_…`). */
const FRAME_PREFIX = frameGroupId('');
/** A linked domain's group id starts with this (`link:holdings`). */
const LINK_PREFIX = linkGroupId('');
const CHIP_TEXT = 'text';
/** The colour of fields with no group colour (formulas, a domain without groups). */
const PLAIN = 'var(--color-muted-foreground)';
/** What a type switch keeps of a widget: its place, size, colour and controls. */
const KEPT = ['id', 'w', 'h', 'x', 'y', 'phone', 'link', 'controls'] as const;

/** `list` with `key` on or off; an empty list stands for `all`, kept in `order`. */
const toggleIn = (list: string[], all: string[], key: string, on: boolean, order = all) => {
  const base = list.length ? list : all;
  const next = on ? [...base, key] : base.filter((k) => k !== key);
  return order.filter((k) => next.includes(k));
};

/** A Summary card with a renamed formula key carried through its main number and lines. */
const renameTile = (t: ViewTile, rename: (k: string) => string): ViewTile =>
  isOwnTile(t)
    ? {
        ...t,
        field: rename(t.field),
        lines: t.lines.map((l) => (l.kind === 'text' ? l : { ...l, field: rename(l.field) })),
      }
    : t;

const sensorsOptions = { activationConstraint: { distance: 4 } };

function useDrag() {
  return useSensors(
    useSensor(PointerSensor, sensorsOptions),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Moves `active` to `over` in `keys` after a drag; the same list when nothing moved. */
const moved = (keys: string[], e: DragEndEvent) => {
  const from = keys.indexOf(String(e.active.id));
  const to = e.over ? keys.indexOf(String(e.over.id)) : -1;
  return from < 0 || to < 0 || from === to ? keys : arrayMove(keys, from, to);
};

/** A colour softened for a tree's guide line. */
const guide = (color: string) => `color-mix(in oklab, ${color} 45%, transparent)`;

/** The tree's groups: the domain's own, else one; then the view's formulas. */
function groupsOf<T>(domain: ViewDomain<T>): ViewFieldGroup[] {
  const own = domain.groups?.length ? domain.groups : [{ id: '', label: 'Fields' }];
  return takesFormulas(domain)
    ? [...own, { id: FORMULAS_GROUP, label: 'Formulas', color: PLAIN }]
    : own;
}

type Setter = (c: CustomViewConfig) => void;

type SectionId =
  | 'widget'
  | 'fields'
  | 'settings'
  | 'rows'
  | 'formulas'
  | 'controls'
  | 'desk'
  | 'more';
const OPEN_AT_START: SectionId[] = ['widget', 'fields'];

/** The table layout a widget's editor starts from: its own, else the view's. */
const tableDraftOf = (config: CustomViewConfig, card: ViewWidget): CustomViewConfig =>
  tableConfigOf(
    config,
    isTableCard(card)
      ? { ...card, table: card.table ?? tableLayoutOf(config) }
      : (viewCardSchema.parse({
          ...Object.fromEntries(KEPT.filter((k) => card[k] !== undefined).map((k) => [k, card[k]])),
          kind: 'table',
          style: 'table',
          title: card.title,
          filter: [],
          table: tableLayoutOf(config),
        }) as ViewTableCard),
  );

/**
 * Edit widget (one editor for every widget). The same two panes for every
 * widget: on the left Widget (type, name, width, link colour), Fields (a table's columns, any other
 * widget's slots), Settings (the type's own options), Rows, Formulas, Controls; on the right the
 * field tree, which ticks a table's columns or fills a widget's slot. Picking another type swaps
 * only Fields and Settings; a type tried and left comes back as it was. The view's own table stays
 * a table.
 */
export function ViewEditDialog<T>({
  open,
  onOpenChange,
  domain: pageDomain,
  config,
  rows: pageRows,
  current,
  onSave,
  card,
  onSaveCard,
  fields: pageFields = [],
  viewTiles,
  read,
  viewId,
  editor,
  onDuplicate,
  onDelete,
}: ViewEditDialogProps<T>) {
  const isMobile = useIsMobile();
  // A widget's main data (`source`): null is the page's rows, '' none yet (all cleared).
  const [source, setSource] = useState<string | null>(card?.source ?? null);
  const start = () =>
    card ? tableDraftOf(card.source ? sourceConfigOf(card, config.name) : config, card) : config;
  const [draft, setDraft] = useState(start);
  const srcIds = useMemo(() => (open && source ? [source] : NO_FRAMES), [open, source]);
  const srcRead = useDomainReads(srcIds, srcIds);
  const srcNow = source ? srcRead[source] : undefined;
  const joined = (
    source === null ? pageDomain : (srcNow?.domain ?? rowsDomain(source || 'none', [], []))
  ) as ViewDomain<T>;
  const rows = (source === null ? pageRows : (srcNow?.rows ?? [])) as T[];
  // Recipes: the assistant frames the draft attaches, their columns in the tree
  // before Save.
  const frameIds = draft.frames ?? NO_FRAMES;
  const base = useDraftFrames(joined, frameIds);
  const assistant = useAssistant();
  const choices = useFrameChoices(open);
  const app = useApp();
  // The widget being edited when it is not a table of the rows; null while it is one.
  const [widget, setWidget] = useState<WidgetDraft | null>(() =>
    card && !isTableCard(card) ? card : null,
  );
  // A widget's frame (place, width, colour, controls) and name, kept across type switches.
  const [frame, setFrame] = useState<ViewWidget | null>(card ?? null);
  const [title, setTitle] = useState(card?.title ?? '');
  const [tokens, setTokens] = useState<FilterToken[]>(card?.filter ?? []);
  const [tab, setTab] = useState<'view' | 'fields'>('view');
  const [sections, setSections] = useState<Set<SectionId>>(new Set(OPEN_AT_START));
  const [slotId, setSlotId] = useState<string | null>(null);
  // Each type's settings as last left here, so trying another and coming back restores them.
  const tried = useRef(new Map<string, WidgetDraft>());
  // The formula open in the Formulas section.
  const [editing, setEditing] = useState<string | null>(null);
  // The Add a formula column dialog, the same one the table header's + opens.
  const [addingFormula, setAddingFormula] = useState(false);
  // Each opening starts from the view as it is now (a column added from the
  // header's + was missing). The parent opens the dialog through `open`, which never calls
  // onOpenChange, so the reset runs when `open` turns true.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSource(card?.source ?? null);
      setDraft(start());
      setWidget(card && !isTableCard(card) ? card : null);
      setFrame(card ?? null);
      setTitle(card?.title ?? '');
      setTokens(card?.filter ?? []);
      tried.current.clear();
      setEditing(null);
      setTab('view');
      setSlotId(null);
      setSections(new Set(OPEN_AT_START));
    }
  }
  // Linked domains (design, part 3): each link is one more group in the tree,
  // and a domain this widget could link to shows below them as a dashed row with Link.
  const unlinked = useMemo(() => {
    const own = base.fields.filter((f) => !f.group?.startsWith(LINK_PREFIX));
    const groups = (base.groups ?? []).filter((g) => !g.id.startsWith(LINK_PREFIX));
    return { ...base, fields: own, groups: groups.length ? groups : [{ id: '', label: 'Fields' }] };
  }, [base]);
  const connections = draft.connections ?? [];
  // The draft's links read here as well, so one added before Save shows its fields: a pending one has nothing to read until it is linked, but its fields name the pairs.
  const connIdKey = connections.map((c) => c.to).join(',');
  const connIds = useMemo(
    () => (open && connIdKey ? connIdKey.split(',') : NO_FRAMES),
    [open, connIdKey],
  );
  const draftRead = useDomainReads(connIds, connIds);
  const allRead = useMemo(() => ({ ...(read ?? {}), ...draftRead }), [read, draftRead]);
  const linked = useMemo(
    () =>
      connectionFields(unlinked, connections, allRead, new Set(unlinked.fields.map((f) => f.key))),
    [unlinked, connections, allRead],
  );
  const withLinks = {
    ...unlinked,
    fields: [...unlinked.fields, ...linked.fields],
    groups: [...unlinked.groups, ...linked.groups],
  };
  const offers = connectCandidates(base.id, draft).flatMap((to) => {
    const other = allRead[to];
    const on = other?.state === 'ok' ? connectionOn(unlinked, other.domain, undefined) : null;
    return other && on ? [{ to, label: other.label, on }] : [];
  });
  // + Data's app group ("add any of the available data domains or recipes,
  // but they don't get activated unless a link is defined"): every live catalog domain of this
  // app; a shared key links it at once, else it waits Not linked for a field on each side.
  const cardKeys = Object.keys(base.keys ?? {});
  const deskDomains: DeskDomain[] = Object.entries(CATALOG)
    .filter(
      ([id, d]) =>
        d.desk === app?.id &&
        d.status === 'live' &&
        id !== base.id &&
        !connections.some((c) => c.to === id),
    )
    .map(([id, d]) => ({
      id,
      label: d.label,
      about: d.about,
      on: offers.find((o) => o.to === id)?.on ?? inferConnection(cardKeys, catalogKeys(id)) ?? [],
      by: catalogKeys(id).filter((k) => cardKeys.includes(k)),
      ...(readableDomain(id) ? {} : { why: 'No function reads its rows yet' }),
    }));
  const link = (to: string, on: ViewConnection['on']) =>
    setDraft({
      ...draft,
      connections: [...connections, { to, on }],
      // A table shows the domain's usual columns once linked; any other widget picks from the tree.
      columns:
        widget || !on.length
          ? draft.columns
          : [
              ...shownKeys,
              ...(linkColumns(to).length ? linkColumns(to) : [CONNECTED_COUNT]).map((k) =>
                connectedKey(to, k),
              ),
            ],
    });
  const unlink = (to: string) => {
    const gone = new Set(
      withLinks.fields.filter((f) => f.group === linkGroupId(to)).map((f) => f.key),
    );
    setDraft({
      ...draft,
      connections: connections.filter((c) => c.to !== to),
      columns: draft.columns.filter((k) => !gone.has(k)),
    });
  };
  // A link's field pairs, picked in its group of the tree.
  const setPairs = (to: string, on: ViewConnection['on']) =>
    setDraft({
      ...draft,
      connections: connections.map((c) => (c.to === to ? { ...c, on } : c)),
    });
  // + Data's recipes: every the assistant frame of the person's. One keyed like this card's rows attaches by
  // its key (`frames`); any other links by field pairs (`frame:<id>`).
  const byKey = (f: FrameChoice) => !!f.key && !!base.keys?.[f.key];
  const recipes = (choices.data ?? []).filter(
    (f) => !frameIds.includes(f.id) && !connections.some((c) => c.to === `${FRAME_LINK}${f.id}`),
  );
  const addRecipe = (f: FrameChoice) => (byKey(f) ? addFrame(f) : link(`${FRAME_LINK}${f.id}`, []));
  const addFrame = (f: FrameChoice) =>
    setDraft({
      ...draft,
      frames: [...frameIds, f.id],
      // A table shows the recipe's columns at once; any other widget picks from the tree.
      columns: widget ? draft.columns : [...shownKeys, ...f.columns.map((c) => c.key)],
    });
  const removeFrame = (id: string) => {
    const gone = new Set(
      withLinks.fields.filter((f) => f.group === frameGroupId(id)).map((f) => f.key),
    );
    setDraft({
      ...draft,
      frames: frameIds.filter((x) => x !== id),
      columns: draft.columns.filter((k) => !gone.has(k)),
    });
  };
  // New recipe: the person says what they want, the assistant writes it as a frame linked to this card. The
  // message waits in the composer for them to send (never sent on the tap), so
  // the edits so far are saved first.
  const cardRef = card ?? mainTableOf(cardsOf(config));
  const askRecipe =
    assistant?.ready && base.keys
      ? (wish: string) => {
          const by = Object.keys(base.keys ?? {}).join(' or ');
          const title = name.trim() || styleLabel(styleId);
          save();
          assistant.draft(
            `Make a recipe for the "${title}" card: ${wish.trim()} Keep it as a frame keyed by ${by} and link it to this card.`,
            [
              {
                kind: 'card',
                label: title,
                id: cardRef?.id ?? viewId ?? base.id,
                card: cardRef ? widgetStyleId(cardRef) : undefined,
                where: typeof document === 'undefined' ? undefined : document.title || undefined,
              },
            ],
          );
        }
      : undefined;
  const domain = withViewFields(withLinks, draft);
  // A widget's own filter reads the page's fields, or its own source's.
  const filterFields: FilterField<T>[] =
    source === null ? pageFields : cardFilterFields(domain.fields);
  const formulas = formulasOf(draft);
  // Each formula's blank rows on the page's rows now, and why.
  const formulaKey = JSON.stringify(formulas);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the formulas (by value) and rows decide it; domain is rebuilt each render.
  const blanks = useMemo(() => formulaBlanks(domain, rows), [formulaKey, rows]);
  const formulaProblems = formulaIssues(formulas, withLinks);
  const allKeys = domain.fields.map((f) => f.key);
  const shownKeys = draft.columns.length
    ? draft.columns.filter((k) => allKeys.includes(k))
    : allKeys;
  const hiddenKeys = hiddenOf(draft).filter((k) => allKeys.includes(k) && !shownKeys.includes(k));
  const section = (id: SectionId) => ({
    open: sections.has(id),
    onOpenChange: (o: boolean) => {
      const next = new Set(sections);
      if (o) next.add(id);
      else next.delete(id);
      setSections(next);
    },
  });

  // The frame the Widget section edits: the widget's own, or the view's table card.
  const tableCard = mainTableOf(cardsOf(draft));
  const shown: ViewWidget | null = widget ?? frame ?? tableCard ?? null;
  const setFramePart = (p: Partial<ViewWidget>) => {
    if (widget) setWidget({ ...widget, ...p } as WidgetDraft);
    if (frame) setFrame({ ...frame, ...p } as ViewWidget);
    if (!card && tableCard)
      setDraft({
        ...draft,
        cards: cardsOf(draft).map((c) => (c === tableCard ? ({ ...c, ...p } as ViewCard) : c)),
      });
  };
  const offered = useOffered(domain);
  const styleId = widget ? widgetStyleId(widget) : 'table:table';
  const pickStyle = (id: string) => {
    if (id === styleId) return;
    if (widget) tried.current.set(styleId, widget);
    if (id === 'table:table') {
      setWidget(null);
      return;
    }
    const keep = (w: WidgetDraft): WidgetDraft => {
      const from = widget ?? frame;
      const kept = from
        ? Object.fromEntries(KEPT.filter((k) => from[k] !== undefined).map((k) => [k, from[k]]))
        : {};
      return { ...w, ...kept } as WidgetDraft;
    };
    const back = tried.current.get(id);
    if (back) return setWidget(keep(back));
    const w = WIDGET_STYLES.find((x) => x.id === id);
    if (!w) return;
    const fresh = draftOf(id, domain, []) as WidgetDraft;
    // Another style that keeps the same settings (a number and its progress bar, one trend and
    // another) changes only its drawing; any other starts its fields afresh.
    if (widget && Object.keys(fresh).every((k) => k in widget || k === 'target'))
      return setWidget({ ...widget, kind: w.kind, style: w.style } as WidgetDraft);
    setWidget(keep(isRowCard(fresh) ? { ...fresh, tiles: viewTiles ?? [] } : fresh));
    setSlotId(null);
  };
  const styleOptions = WIDGET_STYLES.filter((w) => offered(w.id)).map((w) => ({
    value: w.id,
    label: w.name,
    group: VIEW_CARD_KIND_NAMES[w.kind],
    description: w.note,
    thumb: widgetThumb(w.id),
  }));

  // Main data (a widget only): change it, drop it (the next source moves
  // up and links re-infer against it), make a linked one the main, or clear all. Each has Undo.
  const keysOf = (id: string) => (id.startsWith(FRAME_LINK) ? [] : catalogKeys(id));
  const labelOf = (id: string) =>
    id.startsWith(FRAME_LINK)
      ? ((choices.data ?? []).find((f) => `${FRAME_LINK}${f.id}` === id)?.name ?? 'Recipe')
      : (allRead[id]?.label ?? CATALOG[id]?.label ?? id);
  const pageLabel = `${config.name} (this page)`;
  const mainLabel = source === null ? pageLabel : source ? (srcNow?.label ?? labelOf(source)) : '';
  // Everything the widget joins besides its main data: its links, and recipes attached by key.
  const others = () => [
    ...connections.map((c) => c.to),
    ...frameIds.map((id) => `${FRAME_LINK}${id}`),
  ];
  const relink = (main: string, ids: string[]): ViewConnection[] =>
    ids
      .filter((x) => x !== main)
      .slice(0, 4)
      .map((to) => ({ to, on: inferConnection(keysOf(main), keysOf(to)) ?? [] }));
  const rebuild = useRef(false);
  const changeMain = (next: string | null, conns: ViewConnection[], message: string) => {
    if (!card) return;
    const before = { source, draft, widget, tokens };
    setSource(next);
    setDraft(
      next === null
        ? tableDraftOf(config, card)
        : {
            ...customViewConfigSchema.parse({ connections: conns }),
            name: draft.name,
            cards: draft.cards,
          },
    );
    setTokens([]);
    rebuild.current = true;
    lumenToast.undo(message, () => {
      setSource(before.source);
      setDraft(before.draft);
      setWidget(before.widget);
      setTokens(before.tokens);
    });
  };
  const dropMain = () => {
    const rest = others();
    const next = rest[0];
    if (next)
      changeMain(
        next,
        relink(next, rest),
        `${mainLabel} dropped. ${labelOf(next)} is the main data now.`,
      );
    else changeMain('', [], `${mainLabel} dropped.`);
  };
  const makeMain = (to: string) => {
    const old = source ?? (readableDomain(pageDomain.id) ? pageDomain.id : null);
    const rest = [...others().filter((x) => x !== to), ...(old ? [old] : [])];
    changeMain(to, relink(to, rest), `${labelOf(to)} is the main data now.`);
  };
  const pickMain = (to: string) =>
    to === PAGE_SOURCE
      ? changeMain(null, [], `${pageLabel} is the main data now.`)
      : changeMain(to, relink(to, others()), `${labelOf(to)} is the main data now.`);
  const clearAll = () => changeMain('', [], 'All data cleared.');
  const dropLink = (to: string) => {
    const before = draft;
    unlink(to);
    lumenToast.undo(`${labelOf(to)} dropped.`, () => setDraft(before));
  };
  const dropRecipe = (id: string) => {
    const before = draft;
    removeFrame(id);
    lumenToast.undo(`${labelOf(`${FRAME_LINK}${id}`)} dropped.`, () => setDraft(before));
  };
  // The main data picker: this page's rows, the app's live domains, the person's recipes.
  const dataOptions = useWidgetDataOptions(open && !!card, pageLabel);
  const mainOptions = card ? dataOptions.filter((o) => o.value !== (source ?? PAGE_SOURCE)) : [];
  // A new main data's fields: a widget whose fields it lacks starts afresh once its fields load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the new main data's fields arrive.
  useEffect(() => {
    if (!rebuild.current) return;
    if (source && srcNow?.state !== 'ok') return;
    rebuild.current = false;
    if (!widget) return;
    const keys = new Set(domain.fields.map((f) => f.key));
    const fits = widgetSlots(widget, domain).every((sl) => sl.keys.every((k) => keys.has(k)));
    if (fits) return;
    const kept = Object.fromEntries(
      KEPT.filter((k) => widget[k] !== undefined).map((k) => [k, widget[k]]),
    );
    // A shape the new data cannot fill (a number with no number field) stays as it is, and Save
    // says which field is missing.
    try {
      setWidget({ ...draftOf(styleId, domain, []), ...kept } as WidgetDraft);
    } catch {}
  }, [source, srcNow?.state, domain.fields.length]);

  // A widget's rows: the view's, narrowed by its own filter, with or without cash.
  const widgetRows = tokens.length ? filterByTokens(rows, filterFields, tokens, domain.text) : rows;
  const cashRows =
    widget && isRowCard(widget) && domain.cash && !summaryCash(widget, tokens.length > 0)
      ? widgetRows.filter((r) => !domain.cash?.(r))
      : widgetRows;

  // The slot the tree fills: a table's columns, else the picked one of the widget's.
  const slots = widget ? widgetSlots(widget, domain) : [];
  const slot = slots.find((s) => s.id === slotId) ?? slots[0];
  const setShown = (key: string, on: boolean) =>
    setDraft({
      ...draft,
      columns: on ? [...shownKeys, key] : shownKeys.filter((k) => k !== key),
      hidden: hiddenOf(draft).filter((k) => k !== key),
    });
  const pick = widget
    ? slot && {
        on: (k: string) => slot.keys.includes(k),
        set: (k: string, on: boolean) => setWidget(slot.set(slotKeys(slot, k, on))),
        why: (f: ViewField<T>) => (slot.accepts(f) ? null : slot.why),
      }
    : { on: (k: string) => shownKeys.includes(k), set: setShown, why: () => null };

  // A widget on its own data keeps it and its links on the card; the page's stay as they were.
  const sourcePart = source
    ? { source, connections: draft.connections ?? [] }
    : { source: undefined, connections: undefined };
  const viewPart = (next: CustomViewConfig) =>
    source !== null
      ? {
          formulas: config.formulas,
          connections: config.connections,
          ...(config.frames ? { frames: config.frames } : {}),
        }
      : {
          formulas: next.formulas,
          connections: next.connections,
          ...(next.frames ? { frames: next.frames } : {}),
        };
  const parsed = widget
    ? viewCardSchema.safeParse({
        ...widget,
        ...sourcePart,
        title: title.trim() || null,
        // A widget's own filter is its own: it never shares with the colour group.
        filter: readsRows(widget) ? tokens.map(({ link: _, ...t }) => t) : [],
      })
    : null;
  const cardProblems =
    widget && isRowCard(widget)
      ? summaryCardIssues(
          widget.tiles ?? [],
          domain.fields.map((f) => f.key),
          (domain.tiles ?? []).map((w) => w.key),
        )
      : [];
  // What stops Save, each with the field it is about (form-issues.tsx).
  const open_ = (id: SectionId) => {
    setTab('view');
    setSections((s) => new Set(s).add(id));
  };
  const issues: FormIssue[] = [
    ...(source === ''
      ? [
          {
            where: 'Data',
            message: 'Pick the main data',
            target: 'view-editor-main-data',
            reveal: () => setTab('fields'),
          },
        ]
      : []),
    ...(!card && !draft.name.trim()
      ? [
          {
            where: 'Name',
            message: 'Give it a name',
            target: 'view-editor-name',
            reveal: () => open_('widget'),
          },
        ]
      : []),
    ...formulas.flatMap((f, fi) => {
      const message = formulaProblems[fi];
      if (!message) return [];
      return [
        {
          where: `Formula ${f.label || f.key}`,
          message,
          target: formulaIssueTarget(f.key, message),
          reveal: () => edit(f.key),
        },
      ];
    }),
    // A row of numbers with no card draws nothing (with its header off, not even a frame).
    ...(widget && isRowCard(widget) && !(widget.tiles ?? viewTiles ?? []).length
      ? [
          {
            where: 'Cards',
            message: 'Add at least one card',
            target: 'summary-card-add',
            reveal: () => open_('settings'),
          },
        ]
      : []),
    ...cardProblems.flatMap((message, j) =>
      message
        ? [
            {
              where: `Summary card ${j + 1}`,
              message,
              target: `summary-card-${j}`,
              reveal: () => open_('settings'),
            },
          ]
        : [],
    ),
    ...(parsed && !parsed.success
      ? parsed.error.issues.slice(0, 3).map((i) => ({
          where: i.path.join('.') || 'Widget',
          message: i.message,
          target: 'view-editor-check',
        }))
      : []),
  ];

  const edit = (key: string | null) => {
    setEditing(key);
    if (key) {
      setSections(new Set(sections).add('formulas'));
      setTab('view');
    }
  };
  const addFormula = formulas.length < MAX_FORMULAS ? () => setAddingFormula(true) : undefined;
  const removeFormula = (key: string) => {
    if (editing === key) setEditing(null);
    setDraft({
      ...draft,
      formulas: formulas.filter((f) => f.key !== key),
      columns: draft.columns.filter((k) => k !== key),
    });
  };
  const tableConfig = () => {
    const keys = new Set(domain.fields.map((f) => f.key));
    // A removed field leaves its chip and sort too.
    return {
      ...draft,
      name: draft.name.trim(),
      columns: draft.columns.filter((k) => keys.has(k)),
      hidden: hiddenOf(draft).filter((k) => keys.has(k) && !shownKeys.includes(k)),
      chips: chipsOf(draft).filter((c) => keys.has(c.key)),
      sort: draft.sort && keys.has(draft.sort.key) ? draft.sort : null,
    };
  };
  const save = () => {
    if (!card) {
      onSave?.(tableConfig());
      onOpenChange(false);
      return;
    }
    if (parsed) {
      if (parsed.success) onSaveCard?.(parsed.data as ViewWidget, viewPart(draft));
    } else if (frame) {
      // A table of its own: the frame, its name and its layout.
      const next = tableConfig();
      const own = mainTableOf(cardsOf(next));
      onSaveCard?.(
        viewCardSchema.parse({
          ...Object.fromEntries(
            KEPT.filter((k) => frame[k] !== undefined).map((k) => [k, frame[k]]),
          ),
          ...(own?.controls ? { controls: own.controls } : {}),
          ...sourcePart,
          kind: 'table',
          style: 'table',
          title: title.trim() || null,
          filter: [],
          table: tableLayoutOf(next),
        }) as ViewWidget,
        viewPart(next),
      );
    }
    onOpenChange(false);
  };

  const tree = pick ? (
    <FieldTree
      domain={domain}
      draft={draft}
      picked={pick.on}
      onPick={pick.set}
      why={pick.why}
      formulaProblems={formulaProblems}
      onEditFormula={edit}
      onRemoveFormula={removeFormula}
      onAddFormula={addFormula}
      deskDomains={deskDomains}
      onLink={link}
      onUnlink={card ? dropLink : unlink}
      main={
        card
          ? {
              label: mainLabel,
              empty: source === '',
              options: mainOptions,
              onPick: pickMain,
              onDrop: dropMain,
              onClear: clearAll,
              onMakeMain: makeMain,
            }
          : undefined
      }
      linkPairs={{
        cardFields: unlinked.fields.filter((f) => f.group !== FORMULAS_GROUP),
        fieldsOf: (to) => allRead[to]?.domain.fields ?? [],
        onOf: (to) => connections.find((c) => c.to === to)?.on ?? [],
        set: setPairs,
      }}
      deskLabel={app?.label ?? null}
      recipes={recipes}
      recipeNote={choices.isError ? `Recipes did not load: ${choices.error.message}` : null}
      onAddRecipe={addRecipe}
      recipeByKey={byKey}
      onRemoveRecipe={card ? dropRecipe : removeFrame}
      onNewRecipe={askRecipe}
    />
  ) : (
    <p className="px-1.5 text-sm text-muted-foreground">
      {widget?.kind === 'chart' && (widget.style === 'price' || widget.style === 'market')
        ? 'This chart reads its symbols, not fields.'
        : 'This widget takes no fields.'}
    </p>
  );
  const treeHint = widget ? (
    slot && (
      <div className="flex flex-col gap-2 px-1.5 pb-2">
        {slots.length > 1 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            className="justify-self-start"
            aria-label="Fill"
            value={slot.id}
            onValueChange={(v) => v && setSlotId(v)}
          >
            {slots.map((s) => (
              <ToggleGroupItem key={s.id} value={s.id} className="px-2.5">
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <p className="text-xs text-muted-foreground">
          {slot.max === 1
            ? `Tick a field to use it as ${slot.label}.`
            : `Tick fields to add them to ${slot.label}, up to ${slot.max}.`}
        </p>
      </div>
    )
  ) : (
    <p className="px-1.5 pb-2 text-xs text-muted-foreground">Tick a field to add it as a column.</p>
  );
  // More shows only what this view offers, and not at all when it offers nothing (an app view
  // or a page's shared layout).
  const more = [viewId && 'view id', onDuplicate && 'duplicate', onDelete && 'delete'].filter(
    (x): x is string => !!x,
  );
  const name = card ? title : draft.name;
  const main = (
    <div className="flex flex-col">
      <DrawerSection
        icon={ShapesIcon}
        title="Widget"
        hint={styleLabel(styleId)}
        {...section('widget')}
      >
        <WidgetSection
          styleId={styleId}
          options={styleOptions}
          onStyle={card ? pickStyle : undefined}
          name={name}
          placeholder={
            card ? cardTitle({ ...(widget ?? frame ?? card), title: null }, config.name) : ''
          }
          onName={(n) => (card ? setTitle(n) : setDraft({ ...draft, name: n }))}
          icon={card ? undefined : <ViewIconPicker draft={draft} setDraft={setDraft} />}
          frame={shown}
          onFrame={setFramePart}
        />
      </DrawerSection>
      {widget ? (
        <DrawerSection
          icon={Columns3Icon}
          title="Fields"
          hint={slots.map((s) => s.label).join(', ') || undefined}
          {...section('fields')}
        >
          <WidgetFields
            key={styleId}
            card={widget}
            set={setWidget}
            domain={domain}
            rows={cashRows}
            fields={filterFields}
          />
        </DrawerSection>
      ) : (
        <DrawerSection
          icon={Columns3Icon}
          title="Fields"
          count={shownKeys.length + hiddenKeys.length}
          hint={
            hiddenKeys.length
              ? `columns · ${shownKeys.length} shown · drag to reorder`
              : 'columns · drag to reorder'
          }
          {...section('fields')}
        >
          <ColumnList
            base={base}
            domain={domain}
            draft={draft}
            setDraft={setDraft}
            shownKeys={shownKeys}
            hiddenKeys={hiddenKeys}
            onEditFormula={edit}
          />
        </DrawerSection>
      )}
      {widget ? (
        hasWidgetSettings(widget) && (
          <DrawerSection icon={SlidersHorizontalIcon} title="Settings" {...section('settings')}>
            <WidgetSettings card={widget} set={setWidget} domain={domain} />
          </DrawerSection>
        )
      ) : (
        <DrawerSection
          icon={SlidersHorizontalIcon}
          title="Settings"
          hint="shape, sort, pages"
          {...section('settings')}
        >
          <DetailsSection domain={domain} draft={draft} setDraft={setDraft} shownKeys={shownKeys} />
        </DrawerSection>
      )}
      {(widget ? readsRows(widget) : !card) && (
        <DrawerSection
          icon={FilterIcon}
          title="Rows"
          hint={widget ? 'which rows it counts' : 'the filters it opens with'}
          {...section('rows')}
        >
          {widget ? (
            <WidgetRows
              rows={rows}
              fields={filterFields}
              tokens={tokens}
              onChange={setTokens}
              cash={
                isRowCard(widget) && domain.cash
                  ? {
                      on: summaryCash(widget, tokens.length > 0),
                      set: (on) => setWidget({ ...widget, cash: on }),
                    }
                  : undefined
              }
            />
          ) : (
            <OpensWith draft={draft} setDraft={setDraft} current={current} />
          )}
        </DrawerSection>
      )}
      {takesFormulas(domain) && (
        <DrawerSection
          icon={SigmaIcon}
          title="Formulas"
          count={formulas.length}
          hint="columns you compute"
          {...section('formulas')}
        >
          <FormulasSection
            base={withLinks}
            draft={draft}
            setDraft={setDraft}
            formulaProblems={formulaProblems}
            blanks={blanks}
            editing={editing}
            setEditing={setEditing}
            onAdd={addFormula}
          />
        </DrawerSection>
      )}
      {shown && (
        <DrawerSection
          icon={ToggleRightIcon}
          title="Controls"
          hint="what the widget's frame shows"
          {...section('controls')}
        >
          <WidgetControlsEditor
            key={styleId}
            kind={widget?.kind ?? 'table'}
            style={widget?.style ?? 'table'}
            controls={shown.controls}
            onChange={(controls) => setFramePart({ controls })}
          />
        </DrawerSection>
      )}
      {editor && !widget && (
        <DrawerSection icon={editor.icon} title={editor.title} {...section('desk')}>
          {editor.description && (
            <p className="mb-3 text-sm text-muted-foreground">{editor.description}</p>
          )}
          {editor.content}
        </DrawerSection>
      )}
      {more.length > 0 && !card && (
        <DrawerSection icon={EllipsisIcon} title="More" hint={more.join(', ')} {...section('more')}>
          <MoreSection
            name={config.name}
            viewId={viewId}
            onDuplicate={
              onDuplicate &&
              (() => {
                onOpenChange(false);
                onDuplicate();
              })
            }
            onDelete={
              onDelete &&
              (() => {
                onOpenChange(false);
                onDelete();
              })
            }
          />
        </DrawerSection>
      )}
      {parsed && !parsed.success && (
        <p id="view-editor-check" tabIndex={-1} className="px-3 text-xs text-destructive">
          {parsed.error.issues[0]?.path.join('.')}: {parsed.error.issues[0]?.message}
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="view-editor"
        showCloseButton={false}
        className="flex h-[min(780px,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 max-md:h-svh max-md:max-w-full max-md:rounded-none max-md:ring-0 max-md:[--dialog-pad:0px] sm:max-w-6xl"
      >
        <DialogDescription className="sr-only">
          This widget's type, fields, settings, rows and controls, and the fields it can use.
        </DialogDescription>
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 md:px-4">
          {isMobile && (
            <DialogClose asChild>
              <IconButton icon={XIcon} label="Close" />
            </DialogClose>
          )}
          <DialogTitle className="min-w-0 truncate text-sm font-semibold">
            Edit widget{' '}
            <span className="font-normal text-muted-foreground">
              · {name.trim() || styleLabel(styleId)}
            </span>
          </DialogTitle>
          <span className="flex-1" />
          {!isMobile && (
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                <XIcon />
                Cancel
              </Button>
            </DialogClose>
          )}
          <SaveButton issues={issues} onSave={save} />
        </header>
        {isMobile ? (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            className="min-h-0 flex-1 gap-0 pt-2"
          >
            <TabsList className="mx-3 w-[calc(100%-1.5rem)]">
              <TabsTrigger value="view">
                <LayoutDashboardIcon />
                Widget
              </TabsTrigger>
              <TabsTrigger value="fields">
                <DatabaseIcon />
                Data
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="view"
              className="end-fade min-h-0 overflow-y-auto px-2 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {main}
            </TabsContent>
            <TabsContent value="fields" className="end-fade min-h-0 overflow-y-auto px-3 pt-2 pb-4">
              {treeHint}
              {tree}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
            <section
              aria-label="Widget"
              className="end-fade min-h-0 overflow-y-auto px-3 pt-2 pb-4"
            >
              {main}
            </section>
            <aside
              aria-label="Data"
              className="end-fade flex min-h-0 flex-col overflow-y-auto border-l bg-sidebar px-2 pt-2 pb-4"
            >
              {treeHint}
              {tree}
              <p className="mt-auto px-2 pt-4 text-xs text-muted-foreground">
                Agents change the same settings with{' '}
                <code className="font-mono">
                  {card ? 'custom_view_widget_write' : 'custom_view_write'}
                </code>
                .
              </p>
            </aside>
          </div>
        )}
      </DialogContent>
      <AddFormulaDialog
        open={addingFormula}
        onOpenChange={setAddingFormula}
        domain={withLinks}
        formulas={formulas}
        onAdd={(f) => {
          setAddingFormula(false);
          setDraft({
            ...draft,
            formulas: [...formulas, f],
            columns: widget ? draft.columns : [...shownKeys, f.key],
          });
        }}
      />
    </Dialog>
  );
}

const styleLabel = (id: string) => WIDGET_STYLES.find((w) => w.id === id)?.name ?? 'Table';

/** Widget: its type, name, width and link colour, the same for every widget. */
function WidgetSection({
  styleId,
  options,
  onStyle,
  name,
  placeholder,
  onName,
  icon,
  frame,
  onFrame,
}: {
  styleId: string;
  options: LumenOption[];
  /** Left out for the view's own table, which stays a table. */
  onStyle?: (id: string) => void;
  name: string;
  placeholder: string;
  onName: (name: string) => void;
  /** The view's icon picker, beside the name of the view's own table. */
  icon?: ReactNode;
  frame: ViewWidget | null;
  onFrame: (p: Partial<ViewWidget>) => void;
}) {
  const picker = (
    <LumenSelector
      label="Widget type"
      size="sm"
      className="w-full min-w-0"
      options={options}
      value={styleId}
      onChange={(id) => onStyle?.(id)}
      disabled={!onStyle}
    />
  );
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Row label="Type">
        {onStyle ? (
          picker
        ) : (
          <WhyOff note="The view's own table stays a table">
            <span className="w-full">{picker}</span>
          </WhyOff>
        )}
      </Row>
      <Row label="Name">
        <InputGroup>
          {icon && <InputGroupAddon>{icon}</InputGroupAddon>}
          <InputGroupInput
            id="view-editor-name"
            aria-label="Name"
            value={name}
            maxLength={icon ? undefined : CARD_TITLE_MAX}
            placeholder={placeholder}
            onChange={(e) => onName(e.target.value)}
          />
        </InputGroup>
      </Row>
      {frame && (
        <>
          <Row label="Width">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              className="justify-self-start"
              value={String(frame.w)}
              onValueChange={(v) => v && onFrame({ w: Number(v) })}
              aria-label="Width in columns"
            >
              {CARD_COLUMNS.map((w) => (
                <ToggleGroupItem
                  key={w}
                  value={String(w)}
                  aria-label={`${w} of 6 columns`}
                  className="px-2.5"
                >
                  {w}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Row>
          <Row label="Link">
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <LinkPicker
                color={frame.link ?? null}
                label={name || placeholder}
                onPick={(c) => onFrame({ link: c ?? undefined })}
              />
              <span className="min-w-0 truncate">
                {frame.link ? 'Shares chips and tapped rows with its colour' : 'Not linked'}
              </span>
            </div>
          </Row>
        </>
      )}
    </div>
  );
}

/** Rows: the widget's own filter and, where the domain has cash rows, whether it counts them. */
function WidgetRows<T>({
  rows,
  fields,
  tokens,
  onChange,
  cash,
}: {
  rows: T[];
  fields: FilterField<T>[];
  tokens: FilterToken[];
  onChange: (tokens: FilterToken[]) => void;
  cash?: { on: boolean; set: (on: boolean) => void };
}) {
  const filter = useLumenFilter(rows, fields, { initial: tokens });
  const next = JSON.stringify(filter.tokens);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports the box's tokens when they change
  useEffect(() => {
    if (next !== JSON.stringify(tokens)) onChange(filter.tokens);
  }, [next]);
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Row label="Only where">
        <LumenTokenizedFilter
          filter={filter}
          label="Widget filter"
          placeholder="All of the view's rows"
          link={null}
        />
      </Row>
      {cash && (
        <Row label="Cash">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            className="justify-self-start"
            value={cash.on ? 'in' : 'out'}
            onValueChange={(v) => v && cash.set(v === 'in')}
            aria-label="Cash"
          >
            <ToggleGroupItem value="in" className="px-2.5">
              Include cash
            </ToggleGroupItem>
            <ToggleGroupItem value="out" className="px-2.5">
              Leave out
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
      )}
    </div>
  );
}

/** Rows of the view's own table: the filters it opens with. */
function OpensWith({
  draft,
  setDraft,
  current,
}: {
  draft: CustomViewConfig;
  setDraft: Setter;
  current: FilterToken[];
}) {
  return (
    <Row label="Opens with">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {draft.filters.default.map((t, i) => (
          <Badge key={tokenText(t)} variant="secondary" className="gap-1 pr-0.5 font-normal">
            {tokenText(t)}
            <IconButton
              icon={XIcon}
              size="icon-xs"
              className="size-5 rounded-full"
              label={`Remove filter ${tokenText(t)}`}
              onClick={() =>
                setDraft({
                  ...draft,
                  filters: {
                    ...draft.filters,
                    default: draft.filters.default.filter((_, j) => j !== i),
                  },
                })
              }
            />
          </Badge>
        ))}
        {!draft.filters.default.length && (
          <span className="text-sm text-muted-foreground">No filters</span>
        )}
        <IconButton
          icon={FilterIcon}
          size="icon-xs"
          label="Use the page's filters"
          className="text-muted-foreground"
          onClick={() => setDraft({ ...draft, filters: { ...draft.filters, default: current } })}
        />
      </div>
    </Row>
  );
}

interface LinkPairsProps<T> {
  cardFields: ViewField<T>[];
  fieldsOf: (to: string) => ViewField<unknown>[];
  onOf: (to: string) => ViewConnection['on'];
  set: (to: string, on: ViewConnection['on']) => void;
}
const MAX_PAIRS = 3;

/**
 * A link's field pairs: up to 3, this card's field = the source's, each
 * picked with LumenSelector. With none the link reads nothing; a shared key was filled in on add.
 */
function LinkPairs<T>({
  label,
  on,
  cardFields,
  fields,
  onChange,
}: {
  label: string;
  on: ViewConnection['on'];
  cardFields: ViewField<T>[];
  fields: ViewField<unknown>[];
  onChange: (on: ViewConnection['on']) => void;
}) {
  // The pair being picked: shown at once while there is none.
  const [part, setPart] = useState<{ from: string; to: string } | null>(null);
  const open = part ?? (on.length ? null : { from: '', to: '' });
  const opts = (list: { key: string; label: string; icon?: ViewField<unknown>['icon'] }[]) =>
    list.map((f) => ({ value: f.key, label: f.label, ...(f.icon ? { icon: f.icon } : {}) }));
  const mine = opts(cardFields);
  const theirs = opts(fields);
  const put = (p: { from: string; to: string }, i: number | null) => {
    if (!p.from || !p.to) return setPart(p);
    setPart(null);
    onChange(i === null ? [...on, p] : on.map((x, j) => (j === i ? p : x)));
  };
  const row = (p: { from: string; to: string }, i: number | null) => (
    <div key={i ?? 'new'} className="flex min-w-0 items-center gap-1">
      <LumenSelector
        label="This card's field"
        size="sm"
        className="min-w-0 flex-1"
        placeholder="This card"
        search
        value={p.from || null}
        options={mine}
        onChange={(v) => put({ ...p, from: v }, i)}
      />
      <span className="text-xs text-muted-foreground">=</span>
      <LumenSelector
        label={`${label}'s field`}
        size="sm"
        className="min-w-0 flex-1"
        placeholder={theirs.length ? label : 'Loading…'}
        search
        disabled={!theirs.length}
        value={p.to || null}
        options={theirs}
        onChange={(v) => put({ ...p, to: v }, i)}
      />
      {i !== null && (
        <IconButton
          icon={XIcon}
          size="icon-xs"
          label="Remove this pair"
          onClick={() => onChange(on.filter((_, j) => j !== i))}
        />
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-1 px-1 py-1">
      {on.map((p, i) => row(p, i))}
      {open && row(open, null)}
      {!open && on.length < MAX_PAIRS && (
        <Button
          size="xs"
          variant="ghost"
          className="self-start text-primary"
          onClick={() => setPart({ from: '', to: '' })}
        >
          <PlusIcon />
          Field pair
        </Button>
      )}
    </div>
  );
}

/** The right pane: every field by group and topic, ticked to show it as a column. */
/** A widget's main data in the Data tree: its name, whether it is cleared, and its changes. */
type MainData = {
  label: string;
  empty: boolean;
  options: LumenOption[];
  onPick: (value: string) => void;
  onDrop: () => void;
  onClear: () => void;
  onMakeMain: (to: string) => void;
};

function FieldTree<T>({
  domain,
  draft,
  picked,
  onPick,
  why,
  formulaProblems,
  onEditFormula,
  onRemoveFormula,
  onAddFormula,
  deskDomains = [],
  onLink,
  onUnlink,
  deskLabel,
  recipes = [],
  recipeNote,
  onAddRecipe,
  recipeByKey = () => false,
  onRemoveRecipe,
  onNewRecipe,
  linkPairs,
  main,
}: {
  domain: ViewDomain<T>;
  draft: CustomViewConfig;
  /** Whether a field is in what the tree fills: a table's columns or a widget's slot. */
  picked: (key: string) => boolean;
  onPick: (key: string, on: boolean) => void;
  /** Why a field cannot go in the slot, or null when it can. */
  why: (f: ViewField<T>) => string | null;
  formulaProblems: (string | null)[];
  onEditFormula: (key: string) => void;
  /** Removes a formula and its column (the leaf's ✕, after a confirm). */
  onRemoveFormula: (key: string) => void;
  onAddFormula?: () => void;
  /** The app's catalog domains sharing a key with the card; `on` when it can link one now. */
  deskDomains?: DeskDomain[];
  onLink?: (to: string, on: ViewConnection['on']) => void;
  onUnlink?: (to: string) => void;
  /** The app's name, for + Data's "an app data". */
  deskLabel?: string | null;
  /** The person's recipes (linked the assistant frames) this card could attach. */
  recipes?: FrameChoice[];
  /** Why the recipes are missing (they failed to load). */
  recipeNote?: string | null;
  onAddRecipe?: (f: FrameChoice) => void;
  /** Whether a recipe attaches by its key (else it links by field pairs). */
  recipeByKey?: (f: FrameChoice) => boolean;
  onRemoveRecipe?: (id: string) => void;
  /** Each link's field pairs: this card's fields, the linked source's, and a change. */
  linkPairs?: LinkPairsProps<T>;
  /** New recipe: what the person wants, for the assistant to write. */
  onNewRecipe?: (wish: string) => void;
  /** A widget's main data: change it, drop it, make a linked source the main, or clear all. */
  main?: MainData;
}) {
  const assistantName = useAssistantName();
  const [query, setQuery] = useState('');
  // New recipe's box, open while not null.
  const [wish, setWish] = useState<string | null>(null);
  // + Data: the
  // app's domains this card can link, the person's recipes, and New recipe.
  const dataGroup = `${deskLabel ?? 'This desk'} data`;
  const dataOptions: LumenOption[] = [
    ...(onLink
      ? deskDomains.map((d) => ({
          value: `link:${d.id}`,
          label: d.label,
          group: dataGroup,
          detail: (d.on ? d.on.map((p) => p.from) : d.by).length
            ? `by ${(d.on ? d.on.map((p) => p.from) : d.by).map(fieldName).join(' + ')}`
            : d.about,
          icon: Link2Icon,
          keywords: [d.about],
          ...(d.why ? { disabled: d.why } : {}),
        }))
      : []),
    ...(onAddRecipe
      ? recipes.map((f) => ({
          value: `frame:${f.id}`,
          label: f.name,
          group: 'Recipes',
          detail: `${recipeByKey(f) && f.key ? `by ${fieldName(f.key)}` : 'link by fields'} · ${asOf(f.at)}`,
          icon: SparklesIcon,
          keywords: f.columns.map((c) => c.label),
          ...(f.used && recipeByKey(f)
            ? { disabled: `Already enriches ${f.used}: a recipe joins one card` }
            : {}),
        }))
      : []),
    ...(onNewRecipe
      ? [
          {
            value: 'new',
            label: 'New recipe',
            group: 'Recipes',
            description: `Say what you want; ${assistantName} writes it`,
            icon: PlusIcon,
          },
        ]
      : []),
  ];
  const addData = (v: string) => {
    if (v === 'new') setWish('');
    else if (v.startsWith('link:')) {
      const d = deskDomains.find((x) => `link:${x.id}` === v);
      if (d && !d.why) onLink?.(d.id, d.on ?? []);
    } else if (v.startsWith('frame:')) {
      const f = recipes.find((x) => `frame:${x.id}` === v);
      if (f) onAddRecipe?.(f);
    }
  };
  const q = query.trim().toLowerCase();
  // Open groups and topics; a group or topic starts open when it has a shown field.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const formulas = formulasOf(draft);
  const match = (f: ViewField<T>) =>
    !q ||
    f.label.toLowerCase().includes(q) ||
    f.key.includes(q) ||
    !!f.topic?.toLowerCase().includes(q);
  const isOpen = (id: string, fields: ViewField<T>[]) =>
    !!q || (toggled.get(id) ?? fields.some((f) => picked(f.key)));
  const flip = (id: string, now: boolean) => setToggled(new Map(toggled).set(id, !now));

  const leaf = (f: ViewField<T>) => {
    const fi = formulas.findIndex((x) => x.key === f.key);
    const off = why(f);
    const box = (
      <Checkbox
        checked={picked(f.key)}
        disabled={!!off}
        onCheckedChange={(v) => onPick(f.key, v === true)}
        aria-label={`Use ${f.label}`}
      />
    );
    return (
      <div
        key={f.key}
        className={cn(
          'flex min-h-7 items-center gap-2 rounded-md px-1 hover:bg-accent/60',
          off && 'text-muted-foreground',
        )}
      >
        <Label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 text-[0.8125rem] font-normal">
          {off ? <WhyOff note={off}>{box}</WhyOff> : box}
          <span className="truncate">{f.label}</span>
          {f.note && (
            <Badge variant="secondary" className="font-normal">
              {f.note}
            </Badge>
          )}
          {fi >= 0 && formulaProblems[fi] && (
            <Badge variant="destructive" className="font-normal">
              fix
            </Badge>
          )}
        </Label>
        <span className="flex w-8 shrink-0 justify-end">
          <FormatChip format={f.format} icon={f.icon} />
        </span>
        <code
          className="w-28 shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground max-md:hidden"
          title={f.formula ?? f.key}
        >
          {fi >= 0 ? formulas[fi]?.expr || 'no expression yet' : f.key}
        </code>
        {fi >= 0 && (
          <>
            <IconButton
              icon={PencilIcon}
              size="icon-xs"
              label={`Edit formula ${f.label}`}
              onClick={() => onEditFormula(f.key)}
            />
            <LumenConfirm
              title={`Remove ${f.label}?`}
              description="The formula and its column leave this view when you save."
              action="Remove"
              onConfirm={() => onRemoveFormula(f.key)}
            >
              <IconButton icon={XIcon} size="icon-xs" label={`Remove formula ${f.label}`} />
            </LumenConfirm>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-px" data-testid="view-fields">
      <div className={cn('mb-1 flex items-center gap-1.5', main?.empty && 'hidden')}>
        <InputGroup className="min-w-0 flex-1 bg-background">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            className="[&::-webkit-search-cancel-button]:hidden"
            aria-label="Search fields"
            placeholder={`Search ${domain.fields.length} fields`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {dataOptions.length > 0 && !main?.empty && (
          <LumenSelector
            trigger="chip"
            icon={PlusIcon}
            placeholder="Data"
            label="Add data"
            align="end"
            search
            value={null}
            options={dataOptions}
            empty="Nothing else to add"
            onChange={addData}
          />
        )}
        {main && !main.empty && (
          <LumenConfirm
            title="Clear all data?"
            description="Every source leaves this widget. Pick its main data again, or Undo."
            action="Clear all"
            onConfirm={main.onClear}
          >
            <IconButton icon={Trash2Icon} size="icon-xs" label="Clear all data" />
          </LumenConfirm>
        )}
      </div>
      {recipeNote && <p className="px-1.5 pb-1 text-xs text-destructive">{recipeNote}</p>}
      {wish !== null && onNewRecipe && (
        <div className="mb-1 flex flex-col gap-1.5 rounded-md border bg-background p-2">
          <Label htmlFor="new-recipe" className="text-xs font-medium">
            New recipe
          </Label>
          <Textarea
            id="new-recipe"
            autoFocus
            rows={2}
            value={wish}
            placeholder="How far each symbol is off its 52-week high"
            onChange={(e) => setWish(e.target.value)}
            className="min-h-14 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Saves this widget, then opens {assistantName} with your words to send. Its columns join
            here by {Object.keys(domain.keys ?? {}).join(' or ')}.
          </p>
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setWish(null)}>
              Cancel
            </Button>
            <Button size="xs" disabled={!wish.trim()} onClick={() => onNewRecipe(wish)}>
              <SparklesIcon />
              Save and ask {assistantName}
            </Button>
          </div>
        </div>
      )}
      {main?.empty && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-6 text-center">
          <DatabaseIcon className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Pick the main data</p>
          <p className="text-xs text-muted-foreground">Its rows are what this widget shows.</p>
          <LumenSelector
            id="view-editor-main-data"
            trigger="chip"
            icon={DatabaseIcon}
            placeholder="Main data"
            label="Pick the main data"
            search
            value={null}
            options={main.options}
            empty="No data to pick"
            onChange={main.onPick}
          />
        </div>
      )}
      {!main?.empty &&
        groupsOf(domain).map((g, gi) => {
          const all = domain.fields.filter((f) => groupOf(domain, f) === g.id);
          const fields = all.filter(match);
          const formulasGroup = g.id === FORMULAS_GROUP;
          const linkTo = g.id.startsWith(LINK_PREFIX) ? g.id.slice(LINK_PREFIX.length) : null;
          const rowsGroup = gi === 0 && !linkTo && !formulasGroup;
          const recipe =
            !rowsGroup && g.id.startsWith(FRAME_PREFIX) ? g.id.slice(FRAME_PREFIX.length) : null;
          // Not linked: no field pairs yet, so it adds nothing; its fields wait greyed out.
          const unlinked = !!linkTo && !all.length && !(linkPairs?.onOf(linkTo).length ?? 0);
          if (q && !fields.length) return null;
          if (!all.length && !formulasGroup && !linkTo) return null;
          const color = g.color ?? PLAIN;
          // A link starts open, so its pairs and fields show where they are picked.
          const open = linkTo
            ? !!q || (toggled.get(`g:${g.id}`) ?? true)
            : isOpen(`g:${g.id}`, all) || (formulasGroup && !all.length);
          const topics = [...new Set(fields.map((f) => f.topic ?? ''))];
          return (
            <Collapsible key={g.id} open={open} onOpenChange={() => flip(`g:${g.id}`, open)}>
              <div className="flex items-center gap-1">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-7 min-w-0 flex-1 justify-start gap-2 px-1.5 text-[0.8125rem] font-semibold"
                  >
                    <ChevronRightIcon
                      className={cn(
                        'text-muted-foreground transition-transform',
                        open && 'rotate-90',
                      )}
                    />
                    <span
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{ background: color }}
                    />
                    {formulasGroup && <SigmaIcon className="text-muted-foreground" />}
                    {linkTo &&
                      (unlinked ? (
                        <UnlinkIcon className="text-destructive" />
                      ) : (
                        <Link2Icon className="text-muted-foreground" />
                      ))}
                    {recipe && <SparklesIcon className="text-muted-foreground" />}
                    <span className="truncate">{rowsGroup && main ? main.label : g.label}</span>
                    {rowsGroup && (
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-[0.6875rem] font-normal"
                      >
                        Rows
                      </Badge>
                    )}
                    <span className="num ml-auto text-xs font-normal text-muted-foreground">
                      {all.filter((f) => picked(f.key)).length}/{all.length}
                    </span>
                  </Button>
                </CollapsibleTrigger>
                {rowsGroup && main && (
                  <>
                    <LumenSelector
                      trigger="icon"
                      icon={ReplaceIcon}
                      label="Change the main data"
                      align="end"
                      search
                      value={null}
                      options={main.options}
                      empty="No other data"
                      onChange={main.onPick}
                    />
                    <IconButton
                      icon={XIcon}
                      size="icon-xs"
                      label={`Drop ${main.label}`}
                      onClick={main.onDrop}
                    />
                  </>
                )}
                {main && (linkTo || recipe) && (
                  <IconButton
                    icon={StarIcon}
                    size="icon-xs"
                    label={`Make ${g.label} the main data`}
                    onClick={() => main.onMakeMain(linkTo ?? `${FRAME_LINK}${recipe}`)}
                  />
                )}
                {main && linkTo && onUnlink && (
                  <IconButton
                    icon={XIcon}
                    size="icon-xs"
                    label={`Drop ${g.label}`}
                    onClick={() => onUnlink(linkTo)}
                  />
                )}
                {main && recipe && onRemoveRecipe && (
                  <IconButton
                    icon={XIcon}
                    size="icon-xs"
                    label={`Drop ${g.label}`}
                    onClick={() => onRemoveRecipe(recipe)}
                  />
                )}
                {!main && linkTo && onUnlink && (
                  <LumenConfirm
                    title={`Unlink ${g.label}?`}
                    description="Its columns leave this widget when you save."
                    action="Unlink"
                    onConfirm={() => onUnlink(linkTo)}
                  >
                    <IconButton icon={Unlink2Icon} size="icon-xs" label={`Unlink ${g.label}`} />
                  </LumenConfirm>
                )}
                {!main && recipe && onRemoveRecipe && (
                  <LumenConfirm
                    title={`Remove ${g.label}?`}
                    description={`Its columns leave this widget when you save. The recipe stays in ${assistantName}.`}
                    action="Remove"
                    onConfirm={() => onRemoveRecipe(recipe)}
                  >
                    <IconButton icon={XIcon} size="icon-xs" label={`Remove ${g.label}`} />
                  </LumenConfirm>
                )}
              </div>
              <CollapsibleContent
                className="ml-[0.9rem] flex flex-col gap-px border-l-2 pl-2"
                style={{ borderColor: guide(color) }}
              >
                {g.note && !q && (
                  <p className="px-1 py-1 text-xs text-muted-foreground">{g.note}</p>
                )}
                {linkTo && linkPairs && !q && (
                  <LinkPairs
                    label={g.label}
                    on={linkPairs.onOf(linkTo)}
                    cardFields={linkPairs.cardFields}
                    fields={linkPairs.fieldsOf(linkTo)}
                    onChange={(on) => linkPairs.set(linkTo, on)}
                  />
                )}
                {unlinked &&
                  linkPairs
                    ?.fieldsOf(linkTo)
                    .filter(match)
                    .map((f) => (
                      <div
                        key={f.key}
                        className="flex min-h-7 items-center gap-2 px-1 text-sm text-muted-foreground opacity-60"
                      >
                        <WhyOff note="Link it first">
                          <Checkbox checked={false} disabled aria-label={`Use ${f.label}`} />
                        </WhyOff>
                        <span className="truncate">{f.label}</span>
                      </div>
                    ))}
                {topics.map((t) => {
                  const inTopic = fields.filter((f) => (f.topic ?? '') === t);
                  if (!t) return inTopic.map(leaf);
                  const src = g.sources?.[t];
                  const id = `t:${g.id}:${t}`;
                  const topicOpen = isOpen(
                    id,
                    all.filter((f) => f.topic === t),
                  );
                  return (
                    <Collapsible key={t} open={topicOpen} onOpenChange={() => flip(id, topicOpen)}>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-7 w-full justify-start gap-1.5 px-1 text-[0.8125rem] font-semibold"
                        >
                          <ChevronRightIcon
                            className={cn(
                              'text-muted-foreground transition-transform',
                              topicOpen && 'rotate-90',
                            )}
                          />
                          <span className="truncate">{t}</span>
                          <span className="num text-xs font-normal text-muted-foreground">
                            {inTopic.filter((f) => picked(f.key)).length}/{inTopic.length}
                          </span>
                          {src && (
                            <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ background: src.color }}
                              />
                              <span className="font-medium" style={{ color: src.color }}>
                                {src.name}
                              </span>
                              {src.detail && (
                                <span className="truncate max-md:hidden">· {src.detail}</span>
                              )}
                            </span>
                          )}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent
                        className="ml-[0.7rem] flex flex-col gap-px border-l-2 pl-2"
                        style={{ borderColor: guide(src?.color ?? PLAIN) }}
                      >
                        {inTopic.map(leaf)}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
                {formulasGroup && onAddFormula && !q && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 justify-start gap-2 px-1 font-normal text-muted-foreground"
                    onClick={onAddFormula}
                  >
                    <PlusIcon />
                    Add formula
                  </Button>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
    </div>
  );
}

/** A key's name as a person reads it: `symbol` is Symbol. */
const fieldName = (k: string) => (k[0]?.toUpperCase() ?? '') + k.slice(1).replace(/_/g, ' ');

/** A table's Settings: shape, the default grouping and sort, pages and width. */
function DetailsSection<T>({
  domain,
  draft,
  setDraft,
  shownKeys,
}: {
  domain: ViewDomain<T>;
  draft: CustomViewConfig;
  setDraft: Setter;
  shownKeys: string[];
}) {
  const groupable = domain.fields.filter((f) => f.groupable);
  const groupKeys = groupable.map((f) => f.key);
  const numbers = domain.fields.filter((f) => f.format !== 'text');
  const groupChoices = draft.group.fields.length ? draft.group.fields : groupKeys;
  const offered = groupable.filter((f) => groupChoices.includes(f.key));
  const byKey = new Map(domain.fields.map((f) => [f.key, f]));
  const shown = shownKeys.map((k) => byKey.get(k)).filter((f): f is ViewField<T> => !!f);
  const pivot = draft.pivot;
  const pagination = draft.pagination ?? viewPaginationSchema.parse({});
  const fieldSelect = (
    label: string,
    value: string,
    fields: ViewField<T>[],
    onChange: (v: string) => void,
    none?: string,
  ) => (
    <LumenSelector
      label={label}
      size="sm"
      className="w-full min-w-0"
      placeholder="Pick a field"
      options={[...(none ? [{ value: NONE, label: none }] : []), ...fieldOptions(fields, domain)]}
      value={value || (none ? NONE : '')}
      onChange={onChange}
    />
  );

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Row label="Shape">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          className="justify-self-start"
          aria-label="Shape"
          value={draft.shape}
          onValueChange={(v) => {
            if (!v) return;
            const shape = v as CustomViewConfig['shape'];
            setDraft({
              ...draft,
              shape,
              group: {
                ...draft.group,
                default:
                  shape === 'table'
                    ? null
                    : shape === 'group'
                      ? (draft.group.default ?? offered[0]?.key ?? null)
                      : draft.group.default,
              },
              pivot:
                shape === 'pivot' && !draft.pivot
                  ? {
                      rows: groupable[0]?.key ?? '',
                      columns: groupable[1]?.key ?? groupable[0]?.key ?? '',
                      value: numbers[0]?.key ?? '',
                      agg: 'sum',
                    }
                  : draft.pivot,
            });
          }}
        >
          {SHAPES.map((s) => {
            const Icon = shapeIcon(s.value);
            const note =
              s.value === 'table'
                ? null
                : (domain.groupNote ?? (s.value === 'pivot' ? domain.pivotNote : null));
            const off = !!note && draft.shape !== s.value;
            const item = (
              <ToggleGroupItem key={s.value} value={s.value} aria-label={s.label} disabled={off}>
                <Icon />
                {s.label}
              </ToggleGroupItem>
            );
            return off ? (
              <WhyOff key={s.value} note={note}>
                {item}
              </WhyOff>
            ) : (
              item
            );
          })}
        </ToggleGroup>
      </Row>
      {draft.shape === 'group' && (
        <Row label="Group by">
          {fieldSelect(
            'Default grouping',
            draft.group.default ?? '',
            offered,
            (v) =>
              setDraft({ ...draft, group: { ...draft.group, default: v === NONE ? null : v } }),
            'No grouping',
          )}
        </Row>
      )}
      {subgroupsOf(domain).length ? (
        <Row label={subgroupLabel(domain)}>
          <LumenSelector
            label={subgroupLabel(domain)}
            size="sm"
            className="w-full min-w-0"
            options={[
              { value: NONE, label: 'None' },
              ...subgroupsOf(domain).map((sg) => ({
                value: sg.key,
                label: sg.label,
                icon: sg.icon,
              })),
            ]}
            value={subgroupOf(domain, draft.subgroup)?.key ?? NONE}
            onChange={(v) => setDraft({ ...draft, subgroup: v === NONE ? null : v })}
          />
        </Row>
      ) : null}
      {draft.shape === 'pivot' && pivot && (
        <>
          <Row label="Rows">
            {fieldSelect('Pivot rows', pivot.rows, groupable, (rows) =>
              setDraft({ ...draft, pivot: { ...pivot, rows } }),
            )}
          </Row>
          <Row label="Columns">
            {fieldSelect('Pivot columns', pivot.columns, groupable, (columns) =>
              setDraft({ ...draft, pivot: { ...pivot, columns } }),
            )}
          </Row>
          <Row label="Value">
            <div className="flex min-w-0 gap-2">
              {fieldSelect('Pivot value', pivot.value, numbers, (value) =>
                setDraft({ ...draft, pivot: { ...pivot, value } }),
              )}
              <LumenSelector
                label="Roll-up"
                size="sm"
                className="w-28 shrink-0"
                options={viewAggs.map((a) => ({ value: a, label: AGG_LABELS[a] }))}
                value={pivot.agg}
                onChange={(agg) => setDraft({ ...draft, pivot: { ...pivot, agg } })}
              />
            </div>
          </Row>
        </>
      )}
      <Row label="Sort">
        <div className="flex min-w-0 items-center gap-2">
          {fieldSelect(
            'Sort by',
            draft.sort?.key ?? '',
            shown,
            (v) =>
              setDraft({
                ...draft,
                sort: v === NONE ? null : { key: v, desc: draft.sort?.desc ?? true },
              }),
            'As loaded',
          )}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Sort direction"
            disabled={!draft.sort}
            value={draft.sort?.desc ? 'desc' : 'asc'}
            onValueChange={(v) =>
              v && draft.sort && setDraft({ ...draft, sort: { ...draft.sort, desc: v === 'desc' } })
            }
          >
            <ToggleGroupItem value="asc" aria-label="Ascending">
              <ArrowUpIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="desc" aria-label="Descending">
              <ArrowDownIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </Row>
      <Row label="Pages">
        <div className="flex min-w-0 items-center gap-2">
          <Switch
            aria-label="Pagination"
            checked={pagination.on}
            onCheckedChange={(on) => setDraft({ ...draft, pagination: { ...pagination, on } })}
          />
          <LumenSelector
            label="Rows per page"
            size="sm"
            className="num w-36"
            disabled={!pagination.on}
            options={viewPageSizes.map((n) => ({ value: String(n), label: `${n} per page` }))}
            value={String(pagination.size)}
            onChange={(v) =>
              setDraft({
                ...draft,
                pagination: { ...pagination, size: Number(v) as typeof pagination.size },
              })
            }
          />
        </div>
      </Row>
      <Row label="Page footer">
        <Switch
          aria-label="Page footer"
          checked={pagination.footer}
          disabled={!pagination.on}
          onCheckedChange={(footer) =>
            setDraft({ ...draft, pagination: { ...pagination, footer } })
          }
        />
      </Row>
      <Row label="Table width">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={draft.width ?? 'scroll'}
          onValueChange={(v) => v && setDraft({ ...draft, width: v as ViewTableWidth })}
          aria-label="Table width"
        >
          <ToggleGroupItem value="fit" aria-label="Fit to width">
            <ShrinkIcon /> Fit
          </ToggleGroupItem>
          <ToggleGroupItem value="scroll" aria-label="Scroll sideways">
            <MoveHorizontalIcon /> Scroll
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>
    </div>
  );
}

const CHIP_LABELS: Record<string, string> = { text: 'Text', column: 'Chip', inline: 'On first' };

/**
 * Why a box is greyed out, on hover or a tap (a disabled checkbox gets no pointer events, so its
 * wrapper carries the tip).
 */
function WhyOff({ note, children }: { note: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span className="flex justify-center" onPointerDown={() => setOpen(true)}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Columns: the fields the view lists, in order, dragged to reorder. Show puts one on screen; a
 * field not shown stays listed, dimmed, so it can still be ticked to filter or group by. Each is shown as text or a chip.
 */
function ColumnList<T>({
  base,
  domain,
  draft,
  setDraft,
  shownKeys,
  hiddenKeys,
  onEditFormula,
}: {
  base: ViewDomain<T>;
  domain: ViewDomain<T>;
  draft: CustomViewConfig;
  setDraft: Setter;
  shownKeys: string[];
  hiddenKeys: string[];
  onEditFormula: (key: string) => void;
}) {
  const sensors = useDrag();
  const baseByKey = new Map(base.fields.map((f) => [f.key, f]));
  // Total: what group and Total rows show for a number column. A formula's
  // pick is its own `agg`; a field's goes in `aggs`, and picking the field's own clears it.
  const totalCell = (f: ViewField<T>) => {
    const formula = formulasOf(draft).find((x) => x.key === f.key);
    const own = baseByKey.get(f.key);
    const ownPick = formula ? null : own ? totalAggOf(own) : 'none';
    const ownLabel = !formula && own?.share ? 'Share of total' : 'Same formula';
    const options = [
      ...(formula || ownPick === 'own' ? [{ value: OWN_TOTAL, label: ownLabel }] : []),
      { value: 'none', label: 'None' },
      ...TOTAL_AGGS.map((a) => ({ value: a, label: AGG_LABELS[a] })),
    ];
    const value = formula
      ? (formula.agg ?? OWN_TOTAL)
      : (draft.aggs?.[f.key] ?? (ownPick === 'own' ? OWN_TOTAL : ownPick));
    const set = (v: string) => {
      if (formula) {
        setDraft({
          ...draft,
          formulas: formulasOf(draft).map((x) =>
            x.key === f.key ? { ...x, agg: v === OWN_TOTAL ? null : (v as ViewTotalAgg) } : x,
          ),
        });
        return;
      }
      const { [f.key]: _, ...rest } = draft.aggs ?? {};
      const fieldOwn = ownPick === 'own' ? OWN_TOTAL : ownPick;
      setDraft({
        ...draft,
        aggs: v === fieldOwn ? rest : { ...rest, [f.key]: v as ViewTotalAgg },
      });
    };
    return (
      <LumenSelector
        label={`Total of ${f.label}`}
        size="sm"
        className="h-7 w-full"
        options={options}
        value={value ?? 'none'}
        onChange={set}
      />
    );
  };
  const byKey = new Map(domain.fields.map((f) => [f.key, f]));
  // Rows keep their place while Show is ticked on and off; a saved view lists the shown first.
  const [order, setOrder] = useState<string[]>(() => [...shownKeys, ...hiddenKeys]);
  const listedKeys = [...shownKeys, ...hiddenKeys];
  const rowKeys = [
    ...order.filter((k) => listedKeys.includes(k)),
    ...listedKeys.filter((k) => !order.includes(k)),
  ];
  const rows = rowKeys.map((k) => byKey.get(k)).filter((f): f is ViewField<T> => !!f);
  const chips = chipsOf(draft);
  const first = domain.fields.find((f) => f.key === shownKeys[0]);
  const groupKeys = domain.fields.filter((f) => f.groupable).map((f) => f.key);
  const filterKeys = domain.fields.filter((f) => f.filterable).map((f) => f.key);
  const canFilterKeys = domain.fields.filter(canFilter).map((f) => f.key);
  const groupChoices = draft.group.fields.length ? draft.group.fields : groupKeys;
  const filterChoices = draft.filters.fields.length ? draft.filters.fields : filterKeys;
  const groupInfo = (f: ViewField<T>) => {
    const id = groupOf(domain, f);
    if (id === FORMULAS_GROUP) return { color: PLAIN, label: 'Formula' };
    const g = domain.groups?.find((x) => x.id === id);
    // A column chip takes its source's colour like its header.
    const src = f.topic ? g?.sources?.[f.topic] : undefined;
    return { color: src?.color ?? g?.color ?? PLAIN, label: f.topic ?? g?.label ?? '' };
  };
  const chippable = (f: ViewField<T>) =>
    f.format === 'text' && (f.filterable || f.groupable) && f.key !== first?.key;
  const placement = (key: string) => chips.find((c) => c.key === key)?.placement ?? CHIP_TEXT;
  const setPlacement = (key: string, v: string) =>
    setDraft({
      ...draft,
      chips:
        v === CHIP_TEXT
          ? chips.filter((c) => c.key !== key)
          : chips.some((c) => c.key === key)
            ? chips.map((c) => (c.key === key ? { key, placement: v as ViewChipPlacement } : c))
            : [...chips, { key, placement: v as ViewChipPlacement }],
    });
  const isFormula = (key: string) => formulasOf(draft).some((x) => x.key === key);
  // Show on or off keeps the row where it is: columns follow the rows' order.
  const setShown = (key: string, on: boolean) => {
    setOrder(rowKeys);
    const shown = new Set(shownKeys);
    if (on) shown.add(key);
    else shown.delete(key);
    setDraft({
      ...draft,
      columns: rowKeys.filter((k) => shown.has(k)),
      hidden: rowKeys.filter((k) => !shown.has(k)),
    });
  };
  const groupNote = (f: ViewField<T>) =>
    domain.groupNote ??
    f.groupNote ??
    (f.format === 'text' ? 'Not offered for grouping.' : 'Numbers can’t be grouped.');
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">Tick fields on the right to show them.</p>;
  const grid =
    'grid grid-cols-[1.25rem_minmax(0,1fr)_2.5rem_2.5rem_2.5rem] items-center gap-x-2 md:grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem_8.5rem_7.5rem]';
  return (
    <div className="flex flex-col" data-testid="view-columns">
      <div className={cn(grid, 'pb-1 text-xs text-muted-foreground')}>
        <span />
        <span>Column</span>
        <span className="text-center">Show</span>
        <span className="text-center">Filter</span>
        <span className="text-center">Group</span>
        <span className="max-md:hidden">Format</span>
        <span className="max-md:hidden">Total</span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => {
          const next = moved(rowKeys, e);
          setOrder(next);
          setDraft({
            ...draft,
            columns: next.filter((k) => shownKeys.includes(k)),
            hidden: next.filter((k) => !shownKeys.includes(k)),
          });
        }}
      >
        <SortableContext items={rowKeys} strategy={verticalListSortingStrategy}>
          {rows.map((f) => {
            const g = groupInfo(f);
            const shown = shownKeys.includes(f.key);
            const canF = canFilterKeys.includes(f.key);
            const canG = !domain.groupNote && groupKeys.includes(f.key);
            return (
              <ColumnRow key={f.key} id={f.key} className={grid}>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn('h-4 w-1 shrink-0 rounded-full', !shown && 'opacity-40')}
                    style={{ background: g.color }}
                    aria-hidden
                  />
                  <span className={cn('truncate', !shown && 'text-muted-foreground')}>
                    {f.label}
                  </span>
                  <span className="truncate text-xs text-muted-foreground max-md:hidden">
                    {g.label}
                  </span>
                  {!shown && (
                    <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                      Not shown
                    </Badge>
                  )}
                  {isFormula(f.key) && (
                    <IconButton
                      icon={PencilIcon}
                      size="icon-xs"
                      className="text-muted-foreground"
                      label={`Edit formula ${f.label}`}
                      onClick={() => onEditFormula(f.key)}
                    />
                  )}
                </span>
                <span className="flex justify-center">
                  <Checkbox
                    aria-label={`Show ${f.label}`}
                    checked={shown}
                    onCheckedChange={(v) => setShown(f.key, v === true)}
                  />
                </span>
                {canF ? (
                  <span className="flex justify-center">
                    <Checkbox
                      aria-label={`Filter by ${f.label}`}
                      checked={filterChoices.includes(f.key)}
                      onCheckedChange={(v) =>
                        setDraft({
                          ...draft,
                          filters: {
                            ...draft.filters,
                            fields: toggleIn(
                              draft.filters.fields,
                              filterKeys,
                              f.key,
                              v === true,
                              canFilterKeys,
                            ),
                            default:
                              v === true
                                ? draft.filters.default
                                : draft.filters.default.filter((t) => t.key !== f.key),
                          },
                        })
                      }
                    />
                  </span>
                ) : (
                  <WhyOff note="Not offered as a filter.">
                    <Checkbox aria-label={`Filter by ${f.label}`} disabled checked={false} />
                  </WhyOff>
                )}
                {canG ? (
                  <span className="flex justify-center">
                    <Checkbox
                      aria-label={`Group by ${f.label}`}
                      checked={groupChoices.includes(f.key)}
                      onCheckedChange={(v) =>
                        setDraft({
                          ...draft,
                          group: {
                            ...draft.group,
                            fields: toggleIn(draft.group.fields, groupKeys, f.key, v === true),
                            default:
                              v !== true && draft.group.default === f.key
                                ? null
                                : draft.group.default,
                          },
                        })
                      }
                    />
                  </span>
                ) : (
                  <WhyOff note={groupNote(f)}>
                    <Checkbox aria-label={`Group by ${f.label}`} disabled checked={false} />
                  </WhyOff>
                )}
                <span className="max-md:hidden">
                  {chippable(f) ? (
                    <LumenSelector
                      label={`Show ${f.label} as`}
                      size="sm"
                      className="h-7 w-full"
                      options={Object.entries(CHIP_LABELS).map(([v, l]) => ({
                        value: v,
                        label: v === 'inline' ? `On ${first?.label ?? 'first'}` : l,
                      }))}
                      value={placement(f.key)}
                      onChange={(v) => setPlacement(f.key, v)}
                    />
                  ) : f.showAs && f.showAs.length > 1 ? (
                    <LumenSelector
                      label={`Show ${f.label} as`}
                      size="sm"
                      className="h-7 w-full"
                      options={f.showAs.map((o) => ({ value: o.id, label: o.label }))}
                      value={draft.shows?.[f.key] ?? f.showAs[0]?.id ?? ''}
                      onChange={(v) => {
                        const { [f.key]: _, ...rest } = draft.shows ?? {};
                        setDraft({
                          ...draft,
                          shows: v === f.showAs?.[0]?.id ? rest : { ...rest, [f.key]: v },
                        });
                      }}
                    />
                  ) : f.format !== 'text' ? (
                    <LumenSelector
                      label={`Format of ${f.label}`}
                      size="sm"
                      className="h-7 w-full"
                      options={formatOptions()}
                      value={f.format}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          formats: {
                            ...draft.formats,
                            [f.key]: v as (typeof viewNumberFormats)[number],
                          },
                        })
                      }
                    />
                  ) : (
                    <span className="pl-2 text-xs text-muted-foreground">
                      {FORMAT_LABELS[f.format]}
                    </span>
                  )}
                </span>
                <span className="max-md:hidden">{f.format !== 'text' && totalCell(f)}</span>
              </ColumnRow>
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function ColumnRow({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: ReactNode;
}) {
  const s = useSortable({ id });
  return (
    <div
      ref={s.setNodeRef}
      data-field={id}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cn(
        className,
        'min-h-9 rounded-md border-b border-border/50 bg-card text-sm last:border-b-0 hover:bg-accent/40',
        s.isDragging && 'relative z-20 shadow-md',
      )}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label={`Drag ${id}`}
        {...s.attributes}
        {...s.listeners}
      >
        <GripVerticalIcon />
      </Button>
      {children}
    </div>
  );
}

/** Formulas: each one a sub-item with its own editor, then New formula. */
function FormulasSection<T>({
  base,
  draft,
  setDraft,
  formulaProblems,
  blanks,
  editing,
  setEditing,
  onAdd,
}: {
  base: ViewDomain<T>;
  draft: CustomViewConfig;
  setDraft: Setter;
  formulaProblems: (string | null)[];
  /** Why a formula is blank on the page's rows, by key. */
  blanks: Map<string, string>;
  editing: string | null;
  setEditing: (key: string | null) => void;
  onAdd?: () => void;
}) {
  const formulas = formulasOf(draft);
  return (
    <div className="flex flex-col gap-1">
      {!formulas.length && (
        <p className="text-sm text-muted-foreground">
          A formula is a column you compute from other fields, like weight or upside.
        </p>
      )}
      {formulas.map((formula, fi) => {
        const open = editing === formula.key;
        const readable = formulaOptions(base, formulas, formula.key);
        return (
          <Collapsible
            // biome-ignore lint/suspicious/noArrayIndexKey: the key is edited in place; the index keeps the editor mounted.
            key={fi}
            open={open}
            onOpenChange={(o) => setEditing(o ? formula.key : null)}
            className="rounded-md border"
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-start gap-2 px-2">
                <ChevronRightIcon
                  className={cn('text-muted-foreground transition-transform', open && 'rotate-90')}
                />
                <SigmaIcon className="text-muted-foreground" />
                <span className="shrink-0">{formula.label || formula.key}</span>
                <code className="min-w-0 truncate font-mono text-xs font-normal text-muted-foreground">
                  {formula.expr || 'no expression yet'}
                </code>
                {formulaProblems[fi] && (
                  <Badge variant="destructive" className="ml-auto font-normal">
                    fix
                  </Badge>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="[&>div]:border-t [&>div]:bg-transparent [&>div]:md:pl-3">
              <FormulaForm
                formula={formula}
                issue={formulaProblems[fi] ?? null}
                blank={blanks.get(formula.key) ?? null}
                fields={readable}
                onChange={(p) => {
                  const next = formulas.map((x, j) => (j === fi ? { ...x, ...p } : x));
                  // A renamed key carries its column, chip, sort and tiles with it.
                  const was = formula.key;
                  const now = p.key ?? was;
                  const rename = (k: string) => (k === was ? now : k);
                  setDraft({
                    ...draft,
                    formulas: next,
                    columns: draft.columns.map(rename),
                    tiles: tilesOf(draft).map((t) => renameTile(t, rename)),
                    cards: draft.cards?.map((c) =>
                      isRowCard(c) && c.tiles
                        ? { ...c, tiles: c.tiles.map((t) => renameTile(t, rename)) }
                        : c,
                    ),
                    sort: draft.sort ? { ...draft.sort, key: rename(draft.sort.key) } : null,
                  });
                  if (now !== was) setEditing(now);
                }}
                onRemove={() => {
                  setEditing(null);
                  setDraft({
                    ...draft,
                    formulas: formulas.filter((_, j) => j !== fi),
                    columns: draft.columns.filter((k) => k !== formula.key),
                  });
                }}
                onDone={() => setEditing(null)}
              />
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {onAdd && (
        <IconButton
          icon={PlusIcon}
          label="New formula"
          className="self-start text-primary"
          onClick={onAdd}
        />
      )}
    </div>
  );
}

/** The sidebar icon: the shared picker over the draft's `icon`. */
function ViewIconPicker({ draft, setDraft }: { draft: CustomViewConfig; setDraft: Setter }) {
  return (
    <IconPicker
      value={draft.icon}
      onChange={(icon) => setDraft({ ...draft, icon })}
      fallback={shapeIcon(draft.shape)}
      label="Sidebar icon"
      resetLabel="Use the shape's icon"
    />
  );
}

function MoreSection({
  name,
  viewId,
  onDuplicate,
  onDelete,
}: {
  name: string;
  viewId?: string;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {viewId && (
        <Field label="View id">
          <p className="text-xs text-muted-foreground">
            Give it to an agent to read or change this view (custom_view_read, custom_view_write).
          </p>
          <InputGroup>
            <InputGroupInput
              aria-label="View id"
              readOnly
              value={viewId}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Copy view id"
                onClick={() =>
                  void navigator.clipboard.writeText(viewId).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                }
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      )}
      {onDuplicate && (
        <Field label="Duplicate">
          <IconButton
            icon={CopyIcon}
            label="Duplicate view"
            variant="outline"
            className="self-start"
            onClick={onDuplicate}
          />
        </Field>
      )}
      {onDelete && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/40 p-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">Delete view</span>
            <span className="text-sm text-muted-foreground">
              Removes it for you. You confirm first.
            </span>
          </div>
          <LumenConfirm title={`Delete view ${name}?`} onConfirm={onDelete}>
            <IconButton icon={Trash2Icon} label="Delete view" variant="destructive" />
          </LumenConfirm>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
