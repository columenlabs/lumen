// LumenFinder (any app): one box that finds a page, a setting or anything an app adds, opened with ⌘K (Ctrl K)
// or the header's search button. A dialog on desktop, a bottom sheet on phone, around
// LumenSelectorList. The shell lists what it knows itself (the nav's pages grouped by the app's
// `pageTypes`, Settings, Recent, and Ask where an assistant is docked); an app adds its own rows from
// anywhere below the shell with `useLumenFinderRows`, reading what was typed with `useLumenFinder`
// (one app's symbols, another's accounts). Its chips are the app's
// (`LumenFinderConfig`, LumenShell's `finder` prop).
import { useRouter } from '@tanstack/react-router';
import {
  ClockIcon,
  FileTextIcon,
  LayersIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAssistant } from './assistant-context';
import { useAssistantScreen } from './assistant-screen';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import {
  type LumenOption,
  type LumenOptionGroup,
  LumenSelectorList,
  type LumenSelectorListHandle,
  fuzzyScore,
} from './lumen-selector';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Kbd } from './ui/kbd';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';

/** A chip under the box (Pages, Banks, Symbols); `All` is always first. */
export type LumenFinderScope = string;

/** What one kind of nav page (the nav's `pageType`) shows as: its group, its chip and its icon. */
export interface LumenFinderPageType {
  group: string;
  scope: LumenFinderScope;
  icon: Icon;
}

/**
 * How Find reads in an app: its chips, how each kind of nav page groups, where
 * Settings sections sit and the box's placeholder. Every field has a default for a plain app.
 */
export interface LumenFinderConfig {
  /** The chips after All; Pages and Settings by default. */
  scopes?: LumenFinderScope[];
  /** Nav pages by `pageType`; a type not listed (or none) is a page. */
  pageTypes?: Record<string, LumenFinderPageType>;
  /** The chip Settings sections show under; `Settings` by default. */
  settingsScope?: LumenFinderScope;
  placeholder?: string;
}

/** A row shown under every chip (the assistant's Ask row). */
const EVERY_SCOPE = '*';
const DEFAULT_SCOPES = ['Pages', 'Settings'];
const PAGE: LumenFinderPageType = { group: 'Pages', scope: 'Pages', icon: FileTextIcon };
const WORKSPACE: LumenFinderPageType = { group: 'Workspaces', scope: 'Pages', icon: LayersIcon };

/** One row of Find: a LumenSelector option that goes somewhere or does something. */
export interface LumenFinderRow extends LumenOption {
  group: string;
  /** The chip it shows under (Pages, Symbols, Banks); a scope with no chip shows under All only. */
  scope: LumenFinderScope;
  /** Where it goes: a path on this app, or another app's address. ⌘↵ opens it in a new tab. */
  href?: string;
  /** What it does instead (opens a sheet or a chart). */
  run?: () => void;
  /** Made for what was typed (a ticker's chains): shown first, whatever the query. */
  pinned?: boolean;
}

interface FinderState {
  open: boolean;
  query: string;
}
interface FinderApi {
  setOpen: (open: boolean) => void;
  register: (key: string, rows: LumenFinderRow[] | null) => void;
}
const StateCtx = createContext<FinderState | null>(null);
const ApiCtx = createContext<FinderApi | null>(null);

/** Whether Find is open and what is typed in it; null outside the shell. */
export const useLumenFinder = () => useContext(StateCtx);

/** Opens Find; null outside the shell. */
export const useOpenLumenFinder = () => useContext(ApiCtx)?.setOpen ?? null;

/** Adds rows to Find while the caller is mounted. Pass a memoized list (or null for none). */
export function useLumenFinderRows(rows: LumenFinderRow[] | null) {
  const register = useContext(ApiCtx)?.register;
  const key = useId();
  useEffect(() => {
    if (!register) return;
    register(key, rows);
    return () => register(key, null);
  }, [register, key, rows]);
}

type Icon = ComponentType<{ className?: string }>;
const NO_TYPES: Record<string, LumenFinderPageType> = {};

/** The groups with nothing typed: Recent, Pages, Workspaces, the page types' groups, then the rest. */
function groupOrder(pageTypes: Record<string, LumenFinderPageType>): string[] {
  return [
    ...new Set(['Recent', 'Pages', 'Workspaces', ...Object.values(pageTypes).map((t) => t.group)]),
  ];
}

/** Recent picks that go somewhere, kept per app in this browser. */
type Recent = Pick<LumenFinderRow, 'label' | 'detail' | 'scope' | 'href'>;
const recentKey = (app: string) => `lumen-finder-recent:${app}`;
function readRecent(app: string): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(app)) ?? '[]');
    return Array.isArray(v) ? (v as Recent[]) : [];
  } catch {
    return [];
  }
}
function remember(app: string, r: LumenFinderRow) {
  if (!r.href) return;
  const next = [
    { label: r.label, detail: r.detail, scope: r.scope, href: r.href },
    ...readRecent(app).filter((x) => x.href !== r.href),
  ].slice(0, 5);
  try {
    localStorage.setItem(recentKey(app), JSON.stringify(next));
  } catch {
    // A private window refuses storage; Recent stays empty.
  }
}

const scoreOf = (r: LumenFinderRow, q: string) =>
  [r.label, r.detail ?? '', ...(r.keywords ?? [])].reduce<number | null>((best, s) => {
    const v = fuzzyScore(q, s);
    return v === null ? best : best === null ? v : Math.max(best, v);
  }, null);

/** What shows: rows in the scope, matched and ranked against the query, Settings then Ask last. */
function arrange(
  rows: LumenFinderRow[],
  q: string,
  scope: LumenFinderScope | 'All',
  order: string[],
  lastGroup: string | null,
): LumenOptionGroup[] {
  const query = q.trim().toLowerCase();
  const groups = new Map<string, { rows: { r: LumenFinderRow; v: number }[]; best: number }>();
  for (const r of rows) {
    if (scope !== 'All' && r.scope !== scope && r.scope !== EVERY_SCOPE) continue;
    if (query && r.group === 'Recent') continue;
    const v = r.pinned ? 2000 : query ? scoreOf(r, query) : 0;
    if (v === null) continue;
    const g = groups.get(r.group) ?? { rows: [], best: Number.NEGATIVE_INFINITY };
    g.rows.push({ r, v });
    g.best = Math.max(g.best, v);
    groups.set(r.group, g);
  }
  const last = (label: string) =>
    label === lastGroup ? 2 : label === 'Settings' && !query ? 1 : 0;
  const rank = (label: string) => {
    const i = order.indexOf(label);
    return i < 0 ? order.length : i;
  };
  return [...groups]
    .sort(
      ([a, ga], [b, gb]) => last(a) - last(b) || (query ? gb.best - ga.best : rank(a) - rank(b)),
    )
    .map(([label, g]) => ({
      label,
      options: (query ? g.rows.sort((x, y) => y.v - x.v) : g.rows).map((x) => x.r),
    }));
}

/** The shell's own rows: Recent, the nav's pages, Settings sections and Ask the assistant. */
function useShellRows(
  open: boolean,
  query: string,
  settings: { id: string; title: string }[],
  openSettings: (id: string) => void,
  app: string,
  pageTypes: Record<string, LumenFinderPageType>,
  settingsScope: LumenFinderScope,
): LumenFinderRow[] {
  const screen = useAssistantScreen();
  const assistant = useAssistant();
  // The nav registers its pages with the screen map; Find reads it, and Recent, each time it opens.
  const pages = useMemo(() => (open ? (screen?.map().pages ?? []) : []), [open, screen]);
  const recent = useMemo(() => (open ? readRecent(app) : []), [open, app]);
  const base = useMemo<LumenFinderRow[]>(() => {
    const rows: LumenFinderRow[] = recent.map((r) => ({
      ...r,
      value: `recent:${r.href}`,
      group: 'Recent',
      icon: ClockIcon,
    }));
    for (const p of pages) {
      // A workspace page is its own kind, whatever the nav calls it.
      const type = p.path.startsWith('/workspaces/') ? 'workspace' : p.type;
      const t = (type && pageTypes[type]) || (type === 'workspace' ? WORKSPACE : PAGE);
      const where = p.parent ?? p.section;
      rows.push({
        value: `page:${p.path}`,
        label: p.title,
        group: t.group,
        scope: t.scope,
        icon: t.icon,
        detail: where === t.group ? undefined : where,
        href: p.path,
      });
    }
    for (const s of settings)
      rows.push({
        value: `setting:${s.id}`,
        label: `Settings ▸ ${s.title}`,
        group: 'Settings',
        scope: settingsScope,
        icon: SettingsIcon,
        keywords: [s.title],
        run: () => openSettings(s.id),
      });
    return rows;
  }, [pages, recent, settings, openSettings, pageTypes, settingsScope]);
  const q = query.trim();
  return useMemo(
    () =>
      assistant?.ready && q
        ? [
            ...base,
            {
              value: 'assistant',
              label: `Ask ${assistant.name} “${q}”`,
              group: assistant.name,
              scope: EVERY_SCOPE,
              icon: SparklesIcon,
              pinned: true,
              run: () => assistant.draft(q, []),
            },
          ]
        : base,
    [base, assistant, q],
  );
}

/** Find for the shell: ⌘K, the rows apps add and the dialog. LumenShell mounts it. */
export function LumenFinder({
  app,
  settings,
  openSettings,
  config,
  children,
}: {
  app: string;
  settings: { id: string; title: string }[];
  openSettings: (id: string) => void;
  config?: LumenFinderConfig;
  children: ReactNode;
}) {
  const pageTypes = config?.pageTypes ?? NO_TYPES;
  const settingsScope = config?.settingsScope ?? 'Settings';
  const scopes = config?.scopes ?? DEFAULT_SCOPES;
  const order = useMemo(() => groupOrder(pageTypes), [pageTypes]);
  const lastGroup = useAssistant()?.name ?? null;
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<LumenFinderScope | 'All'>('All');
  const [sources, setSources] = useState<ReadonlyMap<string, LumenFinderRow[]>>(new Map());
  const setOpen = useCallback((o: boolean) => {
    if (o) {
      setQuery('');
      setScope('All');
    }
    setOpenState(o);
  }, []);
  const register = useCallback((key: string, rows: LumenFinderRow[] | null) => {
    setSources((m) => {
      if (m.get(key) === rows || (!rows && !m.has(key))) return m;
      const next = new Map(m);
      if (rows) next.set(key, rows);
      else next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpenState((o) => {
          if (!o) {
            setQuery('');
            setScope('All');
          }
          return !o;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const api = useMemo(() => ({ setOpen, register }), [setOpen, register]);
  const state = useMemo(() => ({ open, query }), [open, query]);
  const own = useShellRows(open, query, settings, openSettings, app, pageTypes, settingsScope);
  const groups = useMemo(
    () =>
      open
        ? arrange([...own, ...[...sources.values()].flat()], query, scope, order, lastGroup)
        : [],
    [open, own, sources, query, scope, order, lastGroup],
  );
  return (
    <ApiCtx.Provider value={api}>
      <StateCtx.Provider value={state}>
        {children}
        <FinderDialog
          app={app}
          open={open}
          onOpenChange={setOpen}
          query={query}
          onQuery={setQuery}
          scope={scope}
          onScope={setScope}
          scopes={scopes}
          placeholder={config?.placeholder ?? 'Find a page or setting'}
          groups={groups}
        />
      </StateCtx.Provider>
    </ApiCtx.Provider>
  );
}

function FinderDialog({
  app,
  open,
  onOpenChange,
  query,
  onQuery,
  scope,
  onScope,
  scopes,
  placeholder,
  groups,
}: {
  app: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQuery: (q: string) => void;
  scope: LumenFinderScope | 'All';
  onScope: (s: LumenFinderScope | 'All') => void;
  scopes: LumenFinderScope[];
  placeholder: string;
  groups: LumenOptionGroup[];
}) {
  const mobile = useIsMobile();
  const router = useRouter();
  const list = useRef<LumenSelectorListHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  // Focus without scrolling: on a phone iOS pans the page to a focused field as the keyboard opens,
  // which carried Find's input off the top of the screen.
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  // ⌘↵ (Ctrl ↵) or a ⌘-click opens the pick in a new tab.
  const newTab = useRef(false);
  const pick = (o: LumenOption) => {
    const r = o as LumenFinderRow;
    const tab = newTab.current;
    newTab.current = false;
    remember(app, r);
    onOpenChange(false);
    if (r.run) return r.run();
    if (!r.href) return;
    const outside = /^https?:/.test(r.href);
    if (tab) window.open(outside ? r.href : router.history.createHref(r.href), '_blank');
    else if (outside) window.location.assign(r.href);
    else void router.navigate({ href: r.href });
  };
  const body = (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onMouseDownCapture={(e) => {
        newTab.current = e.metaKey || e.ctrlKey;
      }}
      // A swipe through the list on a phone drops the keyboard, so the rows it hid show.
      onTouchMove={(e) => {
        const typing = document.activeElement;
        if (typing instanceof HTMLInputElement && !typing.contains(e.target as Node)) typing.blur();
      }}
    >
      <div className="flex items-center gap-2 border-b px-3 max-md:px-4">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return;
            newTab.current = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
            list.current?.key(e);
          }}
          aria-label="Find"
          placeholder={placeholder}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground max-md:text-base"
        />
        {mobile ? (
          <IconButton icon={XIcon} label="Close" onClick={() => onOpenChange(false)} />
        ) : (
          <Kbd>esc</Kbd>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 max-md:px-3">
        {['All', ...scopes].map((s) => (
          <Button
            key={s}
            size="xs"
            variant="ghost"
            aria-pressed={s === scope}
            className={cn('text-muted-foreground', s === scope && 'bg-muted text-foreground')}
            onClick={() => onScope(s)}
          >
            {s}
          </Button>
        ))}
      </div>
      <LumenSelectorList
        groups={groups}
        query=""
        onPick={pick}
        handle={list}
        label="Find"
        empty={query.trim() ? 'Nothing here by that name' : 'Nothing to find yet'}
        className="max-h-none min-h-0 flex-1 rounded-none bg-transparent shadow-none ring-0"
      />
      {!mobile && (
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⌘↵</Kbd> new tab
          </span>
        </div>
      )}
    </div>
  );
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* A full screen pinned to the top, its input first: the field the keyboard opens for is
            already in view, so iOS never pans it away, and the sheet ends at the keyboard. */}
        <SheetContent
          side="top"
          showCloseButton={false}
          className="flex h-dvh flex-col gap-0 p-0 pt-[env(safe-area-inset-top)]"
        >
          <SheetTitle className="sr-only">Find</SheetTitle>
          {open && body}
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] flex h-[76vh] max-h-140 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">Find</DialogTitle>
        {open && body}
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

/** The header's Find button. */
export function LumenFinderButton() {
  const open = useOpenLumenFinder();
  if (!open) return null;
  return <IconButton icon={SearchIcon} label={`Find (${SHORTCUT})`} onClick={() => open(true)} />;
}
