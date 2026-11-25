// LumenExplorer: the one row and tree for every explorer-style list (parts, parameters, steps,
// dimensions, folders, a selection). Built on react-arborist: virtualized, keyboard, multi-select,
// rename in place, drag into a folder.
//
// The row's slots are fixed, left to right: indent · chevron · icon (+ status dot) · name · marks ·
// meta · field · toggles. Nothing in a slot changes width on hover, focus, select or an open menu:
// hover-only things change opacity, never display, so nothing beside them moves. The row's ⋯ has
// no slot: on hover it floats just left of the field and toggles, on a fade of the row's own colour,
// over the end of the name or meta, and never over a value. Touch has no hover, so there the ⋯ gets
// a slot of its own and rows are 36px. Right-click opens the same menu as the ⋯.
import {
  ChevronRightIcon,
  CircleAlertIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  PencilIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import {
  type ComponentType,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { type NodeApi, type NodeRendererProps, Tree, type TreeApi } from 'react-arborist';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { Input } from './ui/input';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type Icon = ComponentType<{ className?: string }>;

export type ExplorerStatusTone = 'error' | 'warn' | 'edit' | 'busy';
export interface ExplorerStatus {
  tone: ExplorerStatusTone;
  /** What is wrong or going on, in plain words: the mark's hover. */
  label: string;
}

/** A value in the row (a parameter's size). `hint` is the usual range: outside it the field turns amber
 *  and says so, but the value is still allowed. Only `limit` refuses a value. */
export interface ExplorerField {
  kind: 'number' | 'text' | 'switch';
  value: number | string | boolean;
  unit?: string;
  hint?: { min?: number; max?: number; step?: number };
  limit?: { min?: number; max?: number };
  /** Called once a value is committed: Enter, leaving the field, or a switch flipped. */
  onChange?: (value: number | string | boolean) => void;
  disabled?: boolean;
}

export interface ExplorerItem<D = unknown> {
  id: string;
  /** The full name: the rename box, the hover and the accessible name. */
  name: string;
  /** A shorter text to show in the row (a part under its file's folder); the full `name` is its hover. */
  display?: string;
  /** The type icon, or the app's own small control in the icon slot (a colour swatch). */
  icon?: Icon | ReactNode;
  /** The icon's colour (a folder's amber, a part's swatch). */
  tint?: string;
  /** A small control right after the icon (a part's colour or material swatch, 12px). Rows without one
   *  keep its room when any row in the list has one, so names line up. */
  swatch?: ReactNode;
  /** Shown on the icon as a dot (or at the row's end, `statusAt="end"`), its words in the hover. */
  status?: ExplorerStatus;
  /** Grey detail before the field: a count, a material, ×3. One line, short. */
  meta?: ReactNode;
  /** Small marks right after the name (a progress spinner with its time, a retry). Fixed width. */
  marks?: ReactNode;
  field?: ExplorerField;
  /** The app's own control in the field slot, when the kit's field can't hold the value (a list, a
   *  vector, a value in the app's units with limits of its own). `fieldWidth` wide; clicks and keys in
   *  it stay with it. Ignored when `field` is set. */
  control?: ReactNode;
  /** A card on the name's hover: what it does and what it touches. Never a second line. */
  info?: { text?: string; tags?: string[]; tagsLabel?: string };
  /** Dimmed: hidden, turned off, past the rollback bar. */
  dim?: boolean;
  /** Each toggle's state, by toggle id. A missing state is the toggle's `rest`. */
  on?: Record<string, boolean>;
  /** A folder: has a chevron and takes drops. */
  folder?: boolean;
  /** No rename, and nothing is dropped into it (a group the app builds itself). */
  locked?: boolean;
  children?: ExplorerItem<D>[];
  /** A folder's first state, open or folded, over `openByDefault` (a loop's passes start folded). */
  open?: boolean;
  /** The app's own record, handed back in every callback. */
  data?: D;
}

/** An on/off every row can have (visibility, pin). */
export interface ExplorerToggle<D = unknown> {
  id: string;
  icon: Icon;
  /** The icon when off (EyeOff). Absent: the same icon, filled when on. */
  offIcon?: Icon;
  /** The button's name, by state: "Hide Bracket", "Pin Width". */
  label: (item: ExplorerItem<D>, on: boolean) => string;
  /** The state that needs no attention (visible: true, pinned: false). */
  rest: boolean;
  /** At rest, shown only on hover (pin). Otherwise shown faint at rest (visibility). */
  quiet?: boolean;
  onToggle: (item: ExplorerItem<D>, next: boolean) => void;
  /** Rows this toggle belongs on (no pin on a group). Its slot stays reserved on the others. */
  when?: (item: ExplorerItem<D>) => boolean;
  /** Where it sits: its own slot at the row's end (`rail`, default); the icon's slot (`icon`: no extra
   *  column, the icon turns into the toggle on hover and shows it while on); or only in the ⋯ menu
   *  (`menu`: a small mark after the name while it is on). */
  slot?: 'rail' | 'icon' | 'menu';
  /** Data attributes for the toggle's button or menu item (an app's own action registry or tests). */
  attrs?: Record<`data-${string}`, string>;
}

/**
 * A rollback bar (a CAD history's marker): drawn under the row it sits after; drag it, click the gap under
 * another row, or move it with ↑ ↓ Home End. Rows after it in `rows` dim. Hidden while searching.
 */
export interface ExplorerBar {
  /** The rows it can sit after, in order (one part's steps). */
  rows: string[];
  /** The row it sits after. */
  at: string;
  /** The person moved it: the row it now sits after. */
  onMove: (row: string) => void;
  /** Its name, before the row's: "Rollback bar" → "Rollback bar, after Fillet". */
  label?: string;
  /** Data attributes for the bar and the gaps under rows (an app's own action registry or tests). */
  attrs?: Record<`data-${string}`, string>;
}
/** The tree's handle: open, select, scroll to or rename a row from the app (keyboard shortcuts). */
export type ExplorerApi<D = unknown> = TreeApi<ExplorerItem<D>>;

export interface LumenExplorerProps<D = unknown> {
  data: ExplorerItem<D>[];
  /** The tree's accessible name. */
  label: string;
  toggles?: ExplorerToggle<D>[];
  /** The ⋯ and right-click menu (the selection toolbar's list for this row): `DropdownMenuItem`s.
   *  Return nothing for a row with no menu (a group of parameters): it then has no ⋯. */
  menu?: (item: ExplorerItem<D>) => ReactNode;
  /** The menu opens (⋯ or right-click): pick the row first if the menu acts on the selection. */
  onMenuOpen?: (item: ExplorerItem<D>) => void;
  /** Adds Rename to every unlocked row's menu (needs `onRename`). */
  renameInMenu?: boolean;
  /** Data attributes for the parts the explorer draws itself: the ⋯ button and the menu's Rename. */
  attrs?: { menu?: Record<`data-${string}`, string>; rename?: Record<`data-${string}`, string> };
  /** Where the status shows: a dot on the icon (default) or a mark at the row's end. */
  statusAt?: 'icon' | 'end';
  /** Width of the field column, so values line up down the list. */
  fieldWidth?: number;
  /** Which side a row's info card opens on: away from the fields, toward the canvas. */
  infoSide?: 'left' | 'right';
  /** Touch rows: 36px, bigger targets, the ⋯ always shown in a slot of its own. */
  touch?: boolean;
  rowHeight?: number;
  /** The tree's height. Absent: it fills its parent (give the parent a height, `min-h-0 flex-1`). */
  height?: number;
  /** Filters rows by name (case-insensitive); matching rows show inside their folders. */
  search?: string;
  /** What a folder shows as its meta: the `count` of items under it (default), `none`, or the app's words. */
  groupMeta?: 'count' | 'none' | ((item: ExplorerItem<D>) => ReactNode);
  /** The selected row ids, kept in step with the tree (the canvas's selection). */
  selection?: string[];
  /** The person changed the selection in the tree (a click, ⇧ or ⌘ click, the keyboard). */
  onSelect?: (ids: string[]) => void;
  /** Enter or a double click on a row the app does not rename (a step opens, a folder opens a model). */
  onActivate?: (item: ExplorerItem<D>) => void;
  /** Rename in place (double click, F2 or the menu's Rename). Absent: no rename. */
  onRename?: (id: string, name: string) => void;
  /** Rows were dragged into a folder or between rows. Absent: no drag. */
  onMove?: (ids: string[], parentId: string | null, index: number) => void;
  /** Whether rows may be dropped into this parent (default: only folders, never a locked one). */
  canDrop?: (ids: string[], parent: ExplorerItem<D> | null) => boolean;
  /** Folded rows reopened after a fold or open (to count the visible rows). */
  onToggleOpen?: (id: string) => void;
  openByDefault?: boolean;
  /** The app's own handlers on a row (a long press on a phone). */
  rowProps?: (
    item: ExplorerItem<D>,
    node: NodeApi<ExplorerItem<D>>,
  ) => HTMLAttributes<HTMLDivElement>;
  /** Rollback bars, one per list of rows (each part's steps). */
  bars?: ExplorerBar[];
  apiRef?: Ref<ExplorerApi<D> | null>;
  className?: string;
}

/** How long a finger rests on a row before its full name shows (touch). */
const LONG_PRESS_MS = 500;

const DOT: Record<ExplorerStatusTone, string> = {
  error: 'bg-destructive',
  warn: 'bg-amber-500',
  edit: 'bg-violet-500',
  busy: 'bg-primary',
};

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function StatusMark({ s, size }: { s: ExplorerStatus; size: string }) {
  const I =
    s.tone === 'error'
      ? CircleAlertIcon
      : s.tone === 'warn'
        ? TriangleAlertIcon
        : s.tone === 'busy'
          ? LoaderCircleIcon
          : null;
  return (
    <Tip label={s.label}>
      <span
        role="img"
        aria-label={s.label}
        className={cn('grid flex-none place-items-center', size)}
      >
        {I ? (
          <I
            className={cn(
              'size-3.5',
              s.tone === 'error'
                ? 'text-destructive'
                : s.tone === 'warn'
                  ? 'text-amber-500'
                  : 'animate-spin text-primary',
            )}
          />
        ) : (
          <span className={cn('size-1.5 rounded-full', DOT[s.tone])} />
        )}
      </span>
    </Tip>
  );
}

function isIcon(x: unknown): x is Icon {
  return (
    typeof x === 'function' ||
    (typeof x === 'object' && x !== null && !isValidElement(x) && '$$typeof' in x)
  );
}

function LeadIcon({
  item,
  statusAt,
  box,
}: { item: ExplorerItem<unknown>; statusAt: 'icon' | 'end'; box: string }) {
  const s = statusAt === 'icon' ? item.status : undefined;
  if (s?.tone === 'busy') return <StatusMark s={s} size={box} />;
  const I = item.icon;
  const glyph = isIcon(I) ? <I className="size-3.5" /> : I ? I : <span className="size-3.5" />;
  const body = (
    <span
      className={cn(
        'relative grid flex-none place-items-center',
        box,
        !item.tint && 'text-muted-foreground',
        item.dim && 'opacity-60',
      )}
      style={item.tint ? { color: item.tint } : undefined}
    >
      {glyph}
      {s && (
        <span
          aria-hidden
          className={cn(
            'absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background',
            DOT[s.tone],
          )}
        />
      )}
    </span>
  );
  return s ? (
    <Tip label={s.label}>
      <span role="img" aria-label={s.label} className="flex-none">
        {body}
      </span>
    </Tip>
  ) : (
    body
  );
}

function Name({
  item,
  side,
  editing,
  open,
  onClose,
}: {
  item: ExplorerItem<unknown>;
  side: 'left' | 'right';
  editing: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const cls = cn(
    'min-w-0 truncate',
    item.dim && 'text-muted-foreground opacity-60',
    item.folder && 'font-medium',
  );
  const text = item.display ?? item.name;
  if (editing) return null;
  if (open)
    // Touch: the long press's full name, in a popover at the name.
    return (
      <Popover open onOpenChange={(o) => !o && onClose()}>
        <PopoverAnchor asChild>
          <span className={cls}>{text}</span>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-auto max-w-[calc(100vw-2rem)] px-3 py-2 text-sm break-words"
        >
          {item.name}
        </PopoverContent>
      </Popover>
    );
  if (!item.info)
    return (
      <span title={item.name} className={cls}>
        {text}
      </span>
    );
  const { text: what, tags, tagsLabel = 'Rebuilds' } = item.info;
  const hint = item.field?.hint;
  return (
    <HoverCard openDelay={350} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span className={cls}>{text}</span>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align="start"
        sideOffset={12}
        className="w-64 space-y-1.5 p-3 text-xs"
      >
        <div className="break-words font-medium text-sm">{item.name}</div>
        {what && <div className="text-muted-foreground">{what}</div>}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <span className="text-muted-foreground">{tagsLabel}</span>
            {tags.map((t) => (
              <span key={t} className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5">
                {t}
              </span>
            ))}
          </div>
        )}
        {hint && (hint.min !== undefined || hint.max !== undefined) && (
          <div className="text-muted-foreground">{rangeText(hint, item.field?.unit)}</div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function rangeText(r: { min?: number; max?: number }, unit?: string) {
  return `Usual range ${r.min ?? '…'} to ${r.max ?? '…'}${unit ? ` ${unit}` : ''}`;
}

function FieldCell({ f, width, name }: { f: ExplorerField; width: number; name: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  // Typed since the last commit: Enter then the blur it causes commit once.
  const pending = useRef(false);
  if (f.kind === 'switch')
    return (
      <span className="flex flex-none justify-end" style={{ width }}>
        <Switch
          aria-label={name}
          checked={!!f.value}
          disabled={f.disabled}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(c) => f.onChange?.(c)}
        />
      </span>
    );
  const shown = draft ?? String(f.value);
  const n = Number(shown);
  const isNum = f.kind === 'number';
  const bad = isNum && (shown.trim() === '' || Number.isNaN(n));
  const blocked =
    isNum &&
    !bad &&
    !!f.limit &&
    ((f.limit.min !== undefined && n < f.limit.min) ||
      (f.limit.max !== undefined && n > f.limit.max));
  const out =
    isNum &&
    !bad &&
    !blocked &&
    !!f.hint &&
    ((f.hint.min !== undefined && n < f.hint.min) || (f.hint.max !== undefined && n > f.hint.max));
  const commit = () => {
    if (draft === null || !pending.current) return;
    pending.current = false;
    setDraft(null);
    if (bad || blocked) return; // refused: the field goes back to the last value
    const v = isNum ? n : draft;
    if (v !== f.value) f.onChange?.(v);
  };
  const tip = blocked
    ? `Must be ${f.limit?.min ?? '…'} to ${f.limit?.max ?? '…'}${f.unit ? ` ${f.unit}` : ''}`
    : f.hint && (f.hint.min !== undefined || f.hint.max !== undefined)
      ? `${rangeText(f.hint, f.unit)}${out ? '. Still allowed.' : ''}`
      : undefined;
  const input = (
    <span className="relative flex flex-none items-center" style={{ width }}>
      <Input
        aria-label={name}
        aria-invalid={blocked || bad || undefined}
        value={shown}
        disabled={f.disabled}
        inputMode={isNum ? 'decimal' : undefined}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            pending.current = false;
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          pending.current = true;
          setDraft(e.target.value);
        }}
        onBlur={commit}
        className={cn(
          'num h-6 text-right text-xs',
          f.unit ? 'pr-7' : 'pr-2',
          out && 'border-amber-500 focus-visible:ring-amber-500/40',
        )}
      />
      {f.unit && (
        <span className="pointer-events-none absolute right-2 text-row-meta text-muted-foreground">
          {f.unit}
        </span>
      )}
    </span>
  );
  return tip ? <Tip label={tip}>{input}</Tip> : input;
}

interface RowContext<D> {
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  renameNext: { current: string | null };
  touch: boolean;
  box: string;
  slot: string;
  glyph: string;
  railToggles: ExplorerToggle<D>[];
  iconToggle: ExplorerToggle<D> | undefined;
  menuToggles: ExplorerToggle<D>[];
  isOn: (it: ExplorerItem<D>, t: ExplorerToggle<D>) => boolean;
  flip: (it: ExplorerItem<D>, t: ExplorerToggle<D>) => void;
  metaOf: (x: ExplorerItem<D>) => ReactNode;
  statusAt: 'icon' | 'end';
  menu?: (item: ExplorerItem<D>) => ReactNode;
  onMenuOpen?: (item: ExplorerItem<D>) => void;
  onRename?: (id: string, name: string) => void;
  renameInMenu?: boolean;
  attrs?: LumenExplorerProps<D>['attrs'];
  onActivate?: (item: ExplorerItem<D>) => void;
  fieldWidth: number;
  infoSide: 'left' | 'right';
  hasSwatch: boolean;
  flat: boolean;
  onSelect?: (ids: string[]) => void;
  nameFor: string | null;
  setNameFor: (id: string | null) => void;
  rowProps?: (
    item: ExplorerItem<D>,
    node: NodeApi<ExplorerItem<D>>,
  ) => HTMLAttributes<HTMLDivElement>;
  /** Each bar row's bar and place in it, while the bars show (not while searching). */
  barOf: Map<string, { bar: number; at: number }>;
  bars: ExplorerBar[];
  barAt: (bar: number) => number;
  setDrag: (d: { bar: number; at: number } | null) => void;
  moveBar: (bar: number, at: number) => void;
  barKeyed: { current: number | null };
}

// Rows read the tree's settings from here, so the row component keeps one identity: a field being typed
// in keeps its focus and draft when the app re-renders.
// biome-ignore lint/suspicious/noExplicitAny: one context serves every item type
const RowCtx = createContext<RowContext<any> | null>(null);

function ExplorerRow<D>({ node, style, dragHandle }: NodeRendererProps<ExplorerItem<D>>) {
  const {
    menuFor,
    setMenuFor,
    renameNext,
    touch,
    box,
    slot,
    glyph,
    railToggles,
    iconToggle,
    menuToggles,
    isOn,
    flip,
    metaOf,
    statusAt,
    menu,
    onMenuOpen,
    onRename,
    renameInMenu,
    attrs,
    onActivate,
    fieldWidth,
    infoSide,
    rowProps,
    hasSwatch,
    flat,
    onSelect,
    nameFor,
    setNameFor,
    barOf,
    bars,
    barAt,
    setDrag,
    moveBar,
    barKeyed,
  } = useContext(RowCtx) as RowContext<D>;
  // Touch: a long press shows the full name (the tap that ends it does nothing else); a tap on a picked row
  // unpicks it.
  const hold = useRef<{ timer?: number; fired: boolean }>({ fired: false });
  useEffect(() => () => window.clearTimeout(hold.current.timer), []);
  const it0 = node.data;
  // The rollback bar: this row's place in a bar, the bar under it or the gap that moves it here.
  const inBar = barOf.get(it0.id);
  const barHere = inBar ? barAt(inBar.bar) : -1;
  const it = inBar && inBar.at > barHere && !it0.dim ? { ...it0, dim: true } : it0;
  const menuOpen = menuFor === it.id;
  // Selected rows too show the ⋯ only on hover, so the meta stays readable.
  const showAll = touch || menuOpen;
  const hoverOnly = showAll
    ? 'opacity-100'
    : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100';
  const toggleBtns = railToggles.map((t) => {
    if (t.when && !t.when(it))
      return <span key={t.id} aria-hidden className={cn(slot, 'flex-none')} />;
    const on = isOn(it, t);
    const atRest = on === t.rest;
    const vis = !atRest
      ? 'opacity-100'
      : t.quiet
        ? hoverOnly
        : 'opacity-60 group-hover/row:opacity-100';
    return (
      <IconButton
        key={t.id}
        {...t.attrs}
        icon={!on && t.offIcon ? t.offIcon : t.icon}
        label={t.label(it, on)}
        size="icon-xs"
        pressed={!t.offIcon ? on : undefined}
        className={cn(
          slot,
          'flex-none text-muted-foreground hover:text-foreground',
          glyph,
          vis,
          !atRest && t.offIcon && 'text-foreground',
        )}
        onClick={(e) => {
          e.stopPropagation();
          flip(it, t);
        }}
      />
    );
  });
  const menuMarks = menuToggles.filter((t) => (!t.when || t.when(it)) && isOn(it, t) !== t.rest);
  const iconT = iconToggle && (!iconToggle.when || iconToggle.when(it)) ? iconToggle : undefined;
  const iconOn = iconT ? isOn(it, iconT) !== iconT.rest : false;
  const lead = iconT ? (
    <Tip label={iconT.label(it, isOn(it, iconT))}>
      <button
        type="button"
        {...iconT.attrs}
        aria-label={iconT.label(it, isOn(it, iconT))}
        aria-pressed={iconOn}
        className={cn(
          'relative grid flex-none place-items-center rounded-sm text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring',
          box,
        )}
        onClick={(e) => {
          e.stopPropagation();
          flip(it, iconT);
        }}
      >
        {iconOn ? (
          <iconT.icon className="size-3.5 fill-primary text-primary" />
        ) : (
          <>
            <span className="col-start-1 row-start-1 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0">
              <LeadIcon item={it as ExplorerItem<unknown>} statusAt={statusAt} box={box} />
            </span>
            <iconT.icon className="col-start-1 row-start-1 size-3.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100" />
          </>
        )}
      </button>
    </Tip>
  ) : (
    <LeadIcon item={it as ExplorerItem<unknown>} statusAt={statusAt} box={box} />
  );
  const items = menu?.(it);
  const canRename = !!onRename && renameInMenu && !it.locked;
  const hasMenu = !!items || menuToggles.some((t) => !t.when || t.when(it)) || canRename;
  const dots = hasMenu ? (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(o) => {
        if (o) {
          if (!node.isSelected) node.select();
          onMenuOpen?.(it);
        }
        setMenuFor(o ? it.id : null);
      }}
    >
      <Tip label="More">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`More for ${it.name}`}
            data-explorer-menu-button
            {...attrs?.menu}
            className={cn(slot, 'flex-none', glyph, hoverOnly)}
            onClick={(e) => e.stopPropagation()}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="w-60 max-w-[calc(100vw-1rem)]"
        data-explorer-menu
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          // Rename types in place: the name box keeps the focus the menu would hand back to ⋯.
          if (renameNext.current !== it.id) return;
          renameNext.current = null;
          e.preventDefault();
          node.edit();
        }}
      >
        {menuToggles
          .filter((t) => !t.when || t.when(it))
          .map((t) => {
            const on = isOn(it, t);
            return (
              <DropdownMenuItem key={t.id} {...t.attrs} onSelect={() => flip(it, t)}>
                {!on && t.offIcon ? <t.offIcon /> : <t.icon />}
                {t.label(it, on)}
              </DropdownMenuItem>
            );
          })}
        {menuToggles.length > 0 && (items || canRename) && <DropdownMenuSeparator />}
        {items}
        {canRename && (
          <>
            {items && <DropdownMenuSeparator />}
            <DropdownMenuItem
              {...attrs?.rename}
              onSelect={() => {
                renameNext.current = it.id;
              }}
            >
              <PencilIcon />
              Rename
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  const meta = metaOf(it);
  const metaEl =
    meta !== undefined && meta !== null && meta !== '' ? (
      <span
        className={cn(
          'max-w-28 min-w-0 flex-none truncate text-row-meta text-muted-foreground',
          it.dim && 'opacity-60',
        )}
      >
        {meta}
      </span>
    ) : null;
  const endStatus =
    statusAt === 'end' && it.status ? <StatusMark s={it.status} size={slot} /> : null;
  const field = it.field ? (
    <FieldCell f={it.field} width={fieldWidth} name={it.name} />
  ) : it.control ? (
    <fieldset
      aria-label={it.name}
      className="m-0 flex min-w-0 flex-none items-center justify-end border-0 p-0"
      style={{ width: fieldWidth }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {it.control}
    </fieldset>
  ) : null;
  const own = rowProps?.(it, node) ?? {};
  const barEl = inBar
    ? (() => {
        const b = bars[inBar.bar] as ExplorerBar;
        const name = b.label ?? 'Rollback bar';
        if (inBar.at !== barHere)
          return (
            // The gap under a row: a click there puts the bar after it.
            <button
              type="button"
              {...b.attrs}
              aria-label={`${name}: move after ${it.name}`}
              tabIndex={-1}
              className="absolute inset-x-6 -bottom-1 z-[5] h-2 cursor-pointer rounded-sm hover:bg-primary/40 pointer-coarse:-bottom-2 pointer-coarse:h-4"
              onClick={(e) => {
                e.stopPropagation();
                moveBar(inBar.bar, inBar.at);
              }}
            />
          );
        const last = b.rows.length - 1;
        return (
          <button
            type="button"
            {...b.attrs}
            data-explorer-bar
            aria-label={`${name}, after ${it.name}`}
            ref={(el) => {
              if (el && barKeyed.current === inBar.bar) {
                barKeyed.current = null;
                el.focus();
              }
            }}
            className="absolute inset-x-1 -bottom-1.5 z-10 flex h-3 cursor-ns-resize touch-none items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:-bottom-3 pointer-coarse:h-6"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // The bar redraws under each row it passes, so the drag follows the window, not this button.
              let to = inBar.at;
              setDrag({ bar: inBar.bar, at: to });
              const move = (m: globalThis.PointerEvent) => {
                const el = document
                  .elementFromPoint(m.clientX, m.clientY)
                  ?.closest<HTMLElement>('[data-explorer-bar-at]');
                if (!el || Number(el.dataset.explorerBarOf) !== inBar.bar) return;
                const at = Number(el.dataset.explorerBarAt);
                if (at !== to) {
                  to = at;
                  setDrag({ bar: inBar.bar, at });
                }
              };
              const done = (u: globalThis.PointerEvent) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', done);
                window.removeEventListener('pointercancel', done);
                setDrag(null);
                if (u.type === 'pointerup' && to !== inBar.at) moveBar(inBar.bar, to);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', done);
              window.addEventListener('pointercancel', done);
            }}
            onKeyDown={(e) => {
              const to =
                e.key === 'ArrowUp'
                  ? inBar.at - 1
                  : e.key === 'ArrowDown'
                    ? inBar.at + 1
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End' || e.key === 'Escape'
                        ? last
                        : null;
              e.stopPropagation();
              if (to === null) return;
              e.preventDefault();
              barKeyed.current = inBar.bar;
              moveBar(inBar.bar, to);
            }}
          >
            <span className="h-0.5 flex-1 rounded-full bg-primary" aria-hidden />
            <span
              className="ml-1 size-2.5 flex-none rounded-full border-2 border-primary bg-background"
              aria-hidden
            />
          </button>
        );
      })()
    : null;

  return (
    <div
      {...own}
      ref={dragHandle}
      style={{
        ...style,
        ['--row-bg' as string]: node.isSelected
          ? 'color-mix(in oklab, var(--primary) 15%, var(--background))'
          : 'color-mix(in oklab, var(--foreground) 6%, var(--background))',
      }}
      data-row={it.id}
      {...(inBar && { 'data-explorer-bar-of': inBar.bar, 'data-explorer-bar-at': inBar.at })}
      className={cn(
        'group/row relative flex h-full items-center gap-1.5 rounded-md pr-1 whitespace-nowrap',
        node.isSelected ? 'bg-primary/15' : 'hover:bg-foreground/[.06]',
        node.willReceiveDrop &&
          'bg-primary/10 outline-1 -outline-offset-1 outline-primary outline-dashed',
        node.isDragging && 'opacity-40',
        own.className,
      )}
      onDoubleClick={(e) => {
        own.onDoubleClick?.(e);
        if (e.defaultPrevented || node.isEditing) return;
        if (onRename && !it.locked) node.edit();
        else onActivate?.(it);
      }}
      onContextMenu={(e) => {
        own.onContextMenu?.(e);
        if (!dots || e.defaultPrevented) return;
        e.preventDefault();
        if (!node.isSelected) node.select();
        onMenuOpen?.(it);
        setMenuFor(it.id);
      }}
      {...(touch && {
        onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
          own.onPointerDown?.(e);
          window.clearTimeout(hold.current.timer);
          hold.current.fired = false;
          hold.current.timer = window.setTimeout(() => {
            hold.current.fired = true;
            setNameFor(it.id);
          }, LONG_PRESS_MS);
        },
        onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
          own.onPointerUp?.(e);
          window.clearTimeout(hold.current.timer);
        },
        onPointerLeave: (e: PointerEvent<HTMLDivElement>) => {
          own.onPointerLeave?.(e);
          window.clearTimeout(hold.current.timer);
        },
        onPointerCancel: (e: PointerEvent<HTMLDivElement>) => {
          own.onPointerCancel?.(e);
          window.clearTimeout(hold.current.timer);
        },
        onClickCapture: (e: MouseEvent<HTMLDivElement>) => {
          own.onClickCapture?.(e);
          if (hold.current.fired) {
            hold.current.fired = false;
            e.stopPropagation();
            return;
          }
          if (node.isSelected && !(e.target as HTMLElement).closest('button, input')) {
            e.stopPropagation();
            node.deselect();
            onSelect?.([...node.tree.selectedIds]);
          }
        },
      })}
    >
      {it.folder || it.children?.length ? (
        <button
          type="button"
          className={cn('grid flex-none place-items-center text-muted-foreground', box)}
          aria-label={`${node.isOpen ? 'Fold' : 'Open'} ${it.name}`}
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
          }}
        >
          <ChevronRightIcon
            className={cn('size-3 transition-transform', node.isOpen && 'rotate-90')}
          />
        </button>
      ) : flat ? null : (
        <span className={cn('flex-none', touch ? 'w-6' : 'w-4')} />
      )}
      {lead}
      {it.swatch ? (
        <span className="flex size-3 flex-none items-center justify-center">{it.swatch}</span>
      ) : (
        hasSwatch && <span aria-hidden className="size-3 flex-none" />
      )}
      {node.isEditing && (
        <Input
          autoFocus
          aria-label={it.folder ? 'Folder name' : 'Name'}
          defaultValue={it.name}
          className={cn('min-w-0 flex-1 px-1', touch ? 'h-8 text-sm' : 'h-5 text-xs')}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => node.submit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') node.submit(e.currentTarget.value);
            if (e.key === 'Escape') node.reset();
          }}
        />
      )}
      <Name
        item={it as ExplorerItem<unknown>}
        side={infoSide}
        editing={node.isEditing}
        open={nameFor === it.id}
        onClose={() => setNameFor(null)}
      />
      {menuMarks.map((t) => (
        <t.icon
          key={t.id}
          aria-label={t.label(it, isOn(it, t))}
          className="size-3 flex-none fill-primary text-primary"
        />
      ))}
      {it.marks}
      {!node.isEditing && <span className="flex-1" />}
      {metaEl}
      {endStatus}
      {touch ? (
        <>
          {field}
          {toggleBtns}
          {dots}
        </>
      ) : (
        <span className="relative flex flex-none items-center gap-1.5 self-stretch">
          {dots && (
            <span
              className={cn(
                'pointer-events-none absolute inset-y-0 right-full flex items-center bg-gradient-to-l from-[var(--row-bg)] from-55% to-transparent pl-5 [&>*]:pointer-events-auto',
                hoverOnly,
              )}
            >
              {dots}
            </span>
          )}
          {field}
          {toggleBtns}
        </span>
      )}
      {barEl}
    </div>
  );
}

/**
 * The one explorer row and tree. Parts, parameters, steps, dimensions, folders and a selection are
 * all this part; an app passes items and the toggles and menu each row has, and draws nothing in a row.
 * docs/parts/explorer.md.
 */
export function LumenExplorer<D = unknown>({
  data,
  label,
  toggles = [],
  menu,
  onMenuOpen,
  renameInMenu,
  attrs,
  statusAt = 'icon',
  fieldWidth = 92,
  infoSide = 'right',
  touch = false,
  rowHeight,
  height,
  search,
  groupMeta = 'count',
  selection,
  onSelect,
  onActivate,
  onRename,
  onMove,
  canDrop,
  onToggleOpen,
  openByDefault = true,
  rowProps,
  bars = [],
  apiRef,
  className,
}: LumenExplorerProps<D>) {
  const tree = useRef<ExplorerApi<D> | null>(null);
  useImperativeHandle(apiRef, () => tree.current as ExplorerApi<D>, []);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [nameFor, setNameFor] = useState<string | null>(null);
  const anySwatch = (xs: ExplorerItem<D>[]): boolean =>
    xs.some((x) => !!x.swatch || anySwatch(x.children ?? []));
  const hasSwatch = anySwatch(data);
  // A flat list (no folder or children anywhere at the top) keeps no chevron room.
  const flat = !data.some((d) => d.folder || !!d.children?.length);
  const renameNext = useRef<string | null>(null);

  // Fill the parent when no height is given.
  const [room, setRoom] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect();
    if (!el) return;
    obs.current = new ResizeObserver(() => setRoom(el.clientHeight));
    obs.current.observe(el);
  }, []);

  // The app's selection shows in the tree. A tree that mounts clears its selection first (react-arborist's
  // provider): that clear is not the person's, so it is not reported, and the app's selection is copied in.
  const syncing = useRef(false);
  const settling = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => {
      settling.current = false;
    });
    return () => clearTimeout(t);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: copies in only when the app's selection or rows change
  useEffect(() => {
    const t = tree.current;
    if (!t || !selection) return;
    const now = [...t.selectedIds];
    if (now.length === selection.length && now.every((id) => selection.includes(id))) return;
    syncing.current = true;
    try {
      t.setSelection({
        ids: selection,
        anchor: selection[0] ?? null,
        mostRecent: selection.at(-1) ?? null,
      });
    } finally {
      syncing.current = false;
    }
  }, [selection, data]);

  const h = rowHeight ?? (touch ? 36 : 26);
  const box = touch ? 'size-6' : 'size-4';
  const slot = touch ? 'size-7' : 'size-5';
  const glyph = touch ? '[&_svg]:size-4.5' : '[&_svg]:size-3.5';
  const railToggles = toggles.filter((t) => (t.slot ?? 'rail') === 'rail');
  const iconToggle = toggles.find((t) => t.slot === 'icon');
  const menuToggles = toggles.filter((t) => t.slot === 'menu');
  const isOn = (it: ExplorerItem<D>, t: ExplorerToggle<D>) => it.on?.[t.id] ?? t.rest;
  const flip = (it: ExplorerItem<D>, t: ExplorerToggle<D>) => t.onToggle(it, !isOn(it, t));
  const leaves = (x: ExplorerItem<D>): number =>
    (x.children ?? []).reduce((a, c) => a + (c.folder ? leaves(c) : 1), 0);
  const metaOf = (x: ExplorerItem<D>): ReactNode =>
    !x.folder || x.meta !== undefined
      ? x.meta
      : groupMeta === 'none'
        ? undefined
        : groupMeta === 'count'
          ? String(leaves(x))
          : groupMeta(x);

  // Rollback bars: each row's place in its bar, where a drag would drop it, a key move's focus.
  const searching = !!search?.trim();
  const barOf = new Map<string, { bar: number; at: number }>();
  if (!searching) bars.forEach((b, bar) => b.rows.forEach((id, at) => barOf.set(id, { bar, at })));
  const [drag, setDrag] = useState<{ bar: number; at: number } | null>(null);
  const barKeyed = useRef<number | null>(null);
  const barAt = (bar: number) =>
    drag?.bar === bar ? drag.at : Math.max(0, bars[bar]?.rows.indexOf(bars[bar]?.at ?? '') ?? 0);
  const moveBar = (bar: number, at: number) => {
    const b = bars[bar];
    if (!b) return;
    const to = b.rows[Math.max(0, Math.min(b.rows.length - 1, at))];
    if (to !== undefined && to !== b.at) b.onMove(to);
  };
  const initialOpen: Record<string, boolean> = {};
  const opens = (xs: ExplorerItem<D>[]) => {
    for (const x of xs) {
      if (x.open !== undefined) initialOpen[x.id] = x.open;
      opens(x.children ?? []);
    }
  };
  opens(data);

  const ctx: RowContext<D> = {
    menuFor,
    setMenuFor,
    renameNext,
    touch,
    box,
    slot,
    glyph,
    railToggles,
    iconToggle,
    menuToggles,
    isOn,
    flip,
    metaOf,
    statusAt,
    menu,
    onMenuOpen,
    onRename,
    renameInMenu,
    attrs,
    onActivate,
    fieldWidth,
    infoSide,
    rowProps,
    hasSwatch,
    flat,
    onSelect,
    nameFor,
    setNameFor,
    barOf,
    bars,
    barAt,
    setDrag,
    moveBar,
    barKeyed,
  };

  const fill = height === undefined;
  const t = (
    <Tree<ExplorerItem<D>>
      ref={tree}
      data={data}
      width="100%"
      height={fill ? Math.max(room, h) : height}
      rowHeight={h}
      indent={touch ? 18 : 14}
      openByDefault={openByDefault}
      initialOpenState={initialOpen}
      searchTerm={search ?? ''}
      searchMatch={(n, s) =>
        (n.data.display ?? n.data.name).toLowerCase().includes(s.toLowerCase())
      }
      aria-label={label}
      rowClassName="!min-w-0 outline-none"
      disableEdit={(d) => !onRename || !!d.locked}
      disableDrag={!onMove}
      disableDrop={({ parentNode, dragNodes }) => {
        if (!onMove) return true;
        const parent = parentNode && !parentNode.isRoot ? parentNode.data : null;
        const ids = dragNodes.map((n) => n.id);
        if (canDrop) return !canDrop(ids, parent);
        return !!parent && (!parent.folder || !!parent.locked);
      }}
      onRename={({ id, name }) => {
        const v = name.trim();
        const cur = tree.current?.get(id)?.data.name;
        if (v && v !== cur) onRename?.(id, v);
      }}
      onMove={({ dragIds, parentId, index }) => onMove?.(dragIds, parentId, index)}
      onSelect={(ns) => {
        if (syncing.current || settling.current) return;
        onSelect?.(ns.map((n) => n.id));
      }}
      onActivate={(n) => {
        if (!onRename || n.data.locked) onActivate?.(n.data);
      }}
      onToggle={(id) => onToggleOpen?.(id)}
    >
      {ExplorerRow<D>}
    </Tree>
  );
  const wrapped = <RowCtx.Provider value={ctx}>{t}</RowCtx.Provider>;
  return fill ? (
    <div
      ref={measure}
      data-slot="lumen-explorer"
      className={cn('min-h-0 flex-1 text-row select-none', className)}
    >
      {wrapped}
    </div>
  ) : (
    <div data-slot="lumen-explorer" className={cn('text-row select-none', className)}>
      {wrapped}
    </div>
  );
}
