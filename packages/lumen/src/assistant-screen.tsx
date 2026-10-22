// The assistant moves the screen (step 1).
// The assistant's `screen` tool sends a short list of moves; this runs them in the browser:
//
//   go        a page of this app (TanStack Router), then waits for the new page (up to 3 s)
//   settings  opens Settings at a section and pulses the row named; it never flips anything
//   chart     the shell's chart dialog for a symbol, or up to 8 to compare
//   open      a row's details drawer in the view on screen (first row whose title matches)
//   point     scrolls to a card and pulses it for 2 s
//
// Parts of the screen take moves with `useAssistantMoves(slot, handlers)`: the Settings dialog, the
// chart dialog and every LumenLayout view. Each also says how to snapshot and restore itself, so
// every call has Undo (the page through browser history, the rest from the snapshot). While the
// person is mid-edit (a layout or view being edited, a confirm open) moves don't run: the chip says
// Tap to go. The nav registers its pages (`useAssistantPages`) for the page map the assistant reads.
import type { IndicatorSpec } from '@columenlabs/lumen-types/chart-formula';
import { useRouter } from '@tanstack/react-router';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';
import { type CardOnScreen, cardsOnScreen } from './spotlight';

/** What one part of the screen does for the assistant; every handler is optional. */
export interface AssistantMoveHandlers {
  /** Opens a row's drawer by its title; returns why not when no row matches. */
  open?: (title: string) => string | null;
  /** Opens a symbol's chart, or several to compare, with the indicators the assistant asked for. */
  chart?: (symbols: string | string[], indicators?: IndicatorSpec[]) => void;
  /** Opens Settings at a section. */
  settings?: (section: string) => void;
  /** The Settings sections, for the page map. */
  sections?: { id: string; title: string }[];
  /** Rows that `open` can find, by title (the first few), for the page note. */
  rows?: () => string[];
  /**
   * What the part shows now, in a line, told to the assistant after a call that ends on it (a view: rows
   * shown, columns empty everywhere, each source's state), so it reports what is there, not what
   * it asked for.
   */
  read?: () => string;
  /** True while the person is editing here: moves wait for their tap. */
  editing?: () => boolean;
  snapshot?: () => unknown;
  restore?: (snap: unknown) => void;
}

/** One move, as the server checked it. */
export type AssistantMove =
  | { go: string }
  | { settings: string; row?: string }
  | { chart: string | string[]; indicators?: IndicatorSpec[] }
  | { open: string }
  | { point: string };

export type ScreenStatus = 'done' | 'failed' | 'waiting' | 'undone';
export interface ScreenOutcome {
  status: ScreenStatus;
  text?: string;
}

/**
 * What a sidebar page stands for (a symbol, a saved view, a basket): a nav section says it for its
 * items (`pageType`), the @ picker groups by it and LumenFinder looks up its group in `pageTypes`.
 */
export type AssistantPageType = string;

/** One page the nav names: its sidebar section and what it stands for. */
export interface AssistantPage {
  path: string;
  title: string;
  section?: string;
  type?: AssistantPageType;
  /** The item it sits under (a screener's symbol). */
  parent?: string;
}

/**
 * The workspace on screen, by id:
 * The assistant addresses workspaces and tabs by these ids, so a rename never loses them.
 */
export interface WorkspaceOnScreen {
  id: string;
  name: string;
  tabs: { id: string; name: string; source: string }[];
  /** The tab open now. */
  open: string | null;
}

/** What the browser can do now, sent with each message while Screen is on. */
export interface ScreenMap {
  routes: string[];
  pages: AssistantPage[];
  settings: { id: string; title: string }[];
  cards: CardOnScreen[];
  workspace?: WorkspaceOnScreen;
}

interface Snapshot {
  href: string;
  slots: [string, unknown][];
}

interface ScreenApi {
  register: (slot: string, h: AssistantMoveHandlers | null) => void;
  pages: (key: string, items: AssistantPage[] | null) => void;
  /** The workspace page says which workspace and tabs are on screen while it shows. */
  workspace: (w: WorkspaceOnScreen | null) => void;
  /** Runs a call's moves (one call at a time, in order); `force` runs them even mid-edit. */
  run: (id: string, moves: AssistantMove[], force?: boolean) => Promise<ScreenOutcome>;
  undo: (id: string) => Promise<ScreenOutcome>;
  canUndo: (id: string) => boolean;
  map: () => ScreenMap;
  /** What the page note says the assistant can open and point at. */
  can: () => { cards: string[]; rows: string[] } | null;
}

/** How long one screen move may take before it fails. */
const MOVE_MS = 10_000;

const ScreenCtx = createContext<ScreenApi | null>(null);
export const useAssistantScreen = () => useContext(ScreenCtx);

/** The workspace page tells the assistant which workspace and tab are on screen, by id. */
export function useAssistantWorkspace(w: WorkspaceOnScreen | null) {
  const set = useContext(ScreenCtx)?.workspace;
  const key = w ? JSON.stringify(w) : '';
  useEffect(() => {
    if (!set || !key) return;
    set(JSON.parse(key) as WorkspaceOnScreen);
    return () => set(null);
  }, [set, key]);
}

/** A part of the screen takes moves while it is mounted. */
export function useAssistantMoves(slot: string, handlers: AssistantMoveHandlers) {
  const s = useContext(ScreenCtx);
  // The latest handlers, read when a move runs: no re-register on every render.
  const ref = useRef(handlers);
  ref.current = handlers;
  const register = s?.register;
  const sections = JSON.stringify(handlers.sections ?? null);
  useEffect(() => {
    if (!register) return;
    const live = ref.current;
    const proxy: AssistantMoveHandlers = {
      open:
        live.open &&
        ((t) => (ref.current.open ? ref.current.open(t) : 'This page has no rows to open')),
      chart: live.chart && ((x, i) => ref.current.chart?.(x, i)),
      settings: live.settings && ((x) => ref.current.settings?.(x)),
      sections: JSON.parse(sections) ?? undefined,
      rows: live.rows && (() => ref.current.rows?.() ?? []),
      read: live.read && (() => ref.current.read?.() ?? ''),
      editing: () => ref.current.editing?.() ?? false,
      snapshot: live.snapshot && (() => ref.current.snapshot?.()),
      restore: live.restore && ((x) => ref.current.restore?.(x)),
    };
    register(slot, proxy);
    return () => register(slot, null);
  }, [register, slot, sections]);
}

/**
 * The nav's pages, for the page map the assistant reads and the @ picker: each keeps its sidebar section
 * and what it stands for, so two "SPY" pages read as Trades ▸ SPY and Screeners ▸ SPY.
 */
export function useAssistantPages(
  items: { title: string; to: string; type?: AssistantPageType; parent?: string }[],
  section?: string,
  type?: AssistantPageType,
) {
  const s = useContext(ScreenCtx);
  const key = useId();
  const pages = JSON.stringify(
    items.map(
      (i): AssistantPage => ({
        path: i.to,
        title: i.title,
        section,
        type: i.type ?? type,
        parent: i.parent,
      }),
    ),
  );
  const set = s?.pages;
  useEffect(() => {
    if (!set) return;
    set(key, JSON.parse(pages));
    return () => set(key, null);
  }, [set, key, pages]);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** Polls until `cond` holds, up to `ms`. */
async function waitFor<T>(cond: () => T | null | undefined | false, ms = 3000): Promise<T | null> {
  for (let t = 0; t <= ms; t += 100) {
    const v = cond();
    if (v) return v;
    await sleep(100);
  }
  return null;
}

/** Scrolls to an element and pulses it for 2 s. */
function pulse(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  el.dataset.assistantPoint = '';
  setTimeout(() => delete el.dataset.assistantPoint, 2000);
}

const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const cardOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-slot="lumen-card"][data-card="${CSS.escape(id)}"]`);

/** Holds what each part of the screen takes, and runs the assistant's moves over them. */
export function AssistantScreenProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const slots = useRef(new Map<string, AssistantMoveHandlers>());
  const navPages = useRef(new Map<string, AssistantPage[]>());
  const shownWorkspace = useRef<WorkspaceOnScreen | null>(null);
  const snaps = useRef(new Map<string, Snapshot>());
  // One call at a time, in the order they came.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const register = useCallback((slot: string, h: AssistantMoveHandlers | null) => {
    if (h) slots.current.set(slot, h);
    else slots.current.delete(slot);
  }, []);
  const pages = useCallback((key: string, items: AssistantPage[] | null) => {
    if (items) navPages.current.set(key, items);
    else navPages.current.delete(key);
  }, []);

  const editing = useCallback(
    () =>
      [...slots.current.values()].some((h) => h.editing?.()) ||
      !!document.querySelector('[role="alertdialog"]'),
    [],
  );

  const settled = useCallback(
    () => waitFor(() => router.state.status === 'idle' && !router.state.isLoading, 3000),
    [router],
  );

  const snapshot = useCallback(
    (): Snapshot => ({
      href: here(),
      slots: [...slots.current].flatMap(([slot, h]) =>
        h.snapshot ? [[slot, h.snapshot()] as [string, unknown]] : [],
      ),
    }),
    [],
  );

  /** One move; returns why it failed, or null. */
  const one = useCallback(
    async (m: AssistantMove): Promise<string | null> => {
      if ('go' in m) {
        const [path] = m.go.split(/[?#]/);
        // A search (Try screener's inputs) goes as an href, which the router parses like a link.
        await router.navigate((/[?#]/.test(m.go) ? { href: m.go } : { to: m.go }) as never);
        await settled();
        const last = router.state.matches[router.state.matches.length - 1];
        if (!last || last.routeId === '__root__' || last.status === 'notFound')
          return `no page ${path} on this desk`;
        // The new page registers its views; give it a moment to mount.
        await sleep(150);
        return null;
      }
      if ('settings' in m) {
        const h = slots.current.get('settings');
        if (!h?.settings) return 'Settings is not on this desk';
        h.settings(m.settings);
        if (!m.row) return null;
        const want = m.row.toLowerCase();
        const row = await waitFor(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '[data-slot="settings"] [data-slot="setting-row"]',
            ),
          ].find((el) =>
            el.querySelector('label')?.textContent?.trim().toLowerCase().includes(want),
          ),
        );
        if (!row) return `no row "${m.row}" in that section`;
        pulse(row);
        return null;
      }
      if ('chart' in m) {
        const h = slots.current.get('chart');
        if (!h?.chart) return 'this desk has no chart';
        h.chart(m.chart, m.indicators);
        return null;
      }
      if ('open' in m) {
        const h = await waitFor(() => [...slots.current.values()].find((x) => x.open));
        if (!h?.open) return 'no view with rows on this page';
        return h.open(m.open);
      }
      const id = m.point.replace(/^card:/, '');
      const el = await waitFor(() => cardOf(id));
      if (!el) return `no card "${id}" on this page`;
      pulse(el);
      return null;
    },
    [router, settled],
  );

  const run = useCallback(
    (id: string, moves: AssistantMove[], force = false) => {
      const go = async (): Promise<ScreenOutcome> => {
        if (!force && editing()) return { status: 'waiting' };
        snaps.current.set(id, snapshot());
        for (const m of moves) {
          // A move that never settles (a navigation that hangs) fails on its own, so it can't
          // hold every later move and Undo behind it.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<string>((done) => {
            timer = setTimeout(() => done(`the move took over ${MOVE_MS / 1000} s`), MOVE_MS);
          });
          const wrong = await Promise.race([one(m).catch((e: Error) => e.message), late]);
          clearTimeout(timer);
          if (wrong) return { status: 'failed', text: wrong.slice(0, 200) };
        }
        // What the page shows after the moves: the view that took them reads itself once its rows
        // are in (up to 3 s), so the assistant hears rows and sources, not only "done".
        const view = await waitFor(() => [...slots.current.values()].find((h) => h.read));
        const text = view?.read ? await waitFor(() => view.read?.() || null, 3000) : null;
        return text ? { status: 'done', text: text.slice(0, 1200) } : { status: 'done' };
      };
      const next = chain.current.then(go, go);
      chain.current = next.catch(() => undefined);
      return next;
    },
    [editing, snapshot, one],
  );

  const undo = useCallback(
    (id: string) => {
      const go = async (): Promise<ScreenOutcome> => {
        const snap = snaps.current.get(id);
        if (!snap) return { status: 'failed', text: 'nothing to undo' };
        snaps.current.delete(id);
        if (here() !== snap.href) {
          router.history.push(snap.href);
          await settled();
          await sleep(150);
        }
        for (const [slot, value] of snap.slots) {
          const h = await waitFor(() => slots.current.get(slot), 1000);
          h?.restore?.(value);
        }
        return { status: 'undone' };
      };
      const next = chain.current.then(go, go);
      chain.current = next.catch(() => undefined);
      return next;
    },
    [router, settled],
  );

  const api = useMemo<ScreenApi>(
    () => ({
      register,
      pages,
      workspace: (w) => {
        shownWorkspace.current = w;
      },
      run,
      undo,
      canUndo: (id) => snaps.current.has(id),
      map: () => {
        const routes = [
          ...new Set(
            Object.values(router.routesById as Record<string, { fullPath?: string }>)
              .map((r) => (r.fullPath ?? '').replace(/(.)\/$/, '$1'))
              .filter((p) => p.startsWith('/')),
          ),
        ];
        const seen = new Set<string>();
        const named = [...navPages.current.values()].flat().filter((p) => {
          if (seen.has(p.path)) return false;
          seen.add(p.path);
          return true;
        });
        return {
          routes,
          pages: named.slice(0, 300),
          settings: slots.current.get('settings')?.sections ?? [],
          cards: cardsOnScreen().slice(0, 60),
          ...(shownWorkspace.current ? { workspace: shownWorkspace.current } : {}),
        };
      },
      can: () => {
        const cards = cardsOnScreen().map((c) => `${c.id} (${c.title})`);
        const rows = [...slots.current.values()].flatMap((h) => h.rows?.() ?? []).slice(0, 30);
        return { cards, rows };
      },
    }),
    [register, pages, run, undo, router],
  );
  return <ScreenCtx.Provider value={api}>{children}</ScreenCtx.Provider>;
}
