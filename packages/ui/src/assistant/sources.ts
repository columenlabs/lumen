// What the person can point the assistant at with `#` in the composer: each source is a group in
// the list (On this page, Stories), its items what it holds now. An app passes its standing sources
// to the assistant (`sources`); a page adds its own while it is shown (`useAssistantSource`).
import type { AssistantRefNote } from '@columenlabs/lumen-ui-types/assistant';
import { type ComponentType, useEffect, useRef, useSyncExternalStore } from 'react';

/** One thing a source holds: a row in the `#` list, sent with the message as `ref`. */
export interface AssistantSourceItem {
  /** Unique within its source. */
  id: string;
  label: string;
  /** The list's right column: a date, a count, where it lives. */
  detail?: string;
  /** Extra words search matches. */
  keywords?: string[];
  /** What it stands for on screen, lit while hovered in the list (`card:<id>` or an app path). */
  target?: string;
  /** What goes to the model: its kind, its label and whatever finds it (an id, a path). */
  ref: AssistantRefNote;
}

/** A group of things in the `#` list. */
export interface AssistantSource {
  /** Unique: a page's source replaces an app source of the same id. */
  id: string;
  /** The group heading: "On this page", "Stories". */
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** What it holds now; `query` is what follows the `#`, for a source that searches. */
  items: (query: string) => readonly AssistantSourceItem[];
}

const shown = new Map<string, AssistantSource>();
const listeners = new Set<() => void>();
let snapshot: readonly AssistantSource[] = [];
const changed = () => {
  snapshot = [...shown.values()];
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Adds a source to the `#` list while the calling page is shown. */
export function useAssistantSource(source: AssistantSource | null | undefined) {
  const latest = useRef(source);
  latest.current = source;
  const id = source?.id;
  useEffect(() => {
    if (!id) return;
    // The list reads the newest items, so a source registered once follows the page's data.
    shown.set(id, {
      get id() {
        return id;
      },
      get label() {
        return latest.current?.label ?? id;
      },
      get icon() {
        return latest.current?.icon;
      },
      items: (q) => latest.current?.items(q) ?? [],
    });
    changed();
    return () => {
      shown.delete(id);
      changed();
    };
  }, [id]);
}

/** The sources pages have added, newest page last. */
export function useShownAssistantSources() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

// ---------------------------------------------------------------- compose from the page

/** What an app puts in the composer: text, chips to point at, a tier for the message. */
export interface ComposeRequest {
  text?: string;
  refs?: AssistantRefNote[];
  tier?: string;
}

let composing: ComposeRequest | null = null;
const composeListeners = new Set<() => void>();

/**
 * Opens the assistant with `refs` as chips in its composer and `text` typed, focused for the person
 * to finish: an Ask button beside a highlighted part of the page calls it.
 */
export function composeAssistant(request: ComposeRequest) {
  composing = request;
  for (const l of composeListeners) l();
}

/** The newest compose request and a way to mark it taken. */
export function useComposeRequest() {
  const request = useSyncExternalStore(
    (l) => {
      composeListeners.add(l);
      return () => composeListeners.delete(l);
    },
    () => composing,
    () => composing,
  );
  const take = () => {
    composing = null;
    for (const l of composeListeners) l();
  };
  return [request, take] as const;
}

// ---------------------------------------------------------------- the page's selected text

/** Text the person highlighted on the page, and where it sits (`data-assistant-where`). */
export interface PageSelection {
  text: string;
  where?: string;
}

let selected: PageSelection | null = null;
const selectionListeners = new Set<() => void>();
let watching = 0;

// The last highlight outside the assistant, kept while the person moves into the composer.
const onSelection = () => {
  const sel = document.getSelection();
  const node = sel?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || el.closest('[data-assistant], input, textarea, [contenteditable="true"]')) return;
  const text = sel?.toString().trim() ?? '';
  const next = text
    ? {
        text: text.slice(0, 4000),
        ...(el.closest<HTMLElement>('[data-assistant-where]')?.dataset.assistantWhere
          ? { where: el.closest<HTMLElement>('[data-assistant-where]')?.dataset.assistantWhere }
          : {}),
      }
    : null;
  if (next?.text === selected?.text && next?.where === selected?.where) return;
  selected = next as PageSelection | null;
  for (const l of selectionListeners) l();
};

/** What the person last highlighted on the page outside the assistant, or null. */
export function usePageSelection() {
  return useSyncExternalStore(
    (l) => {
      selectionListeners.add(l);
      if (watching++ === 0) document.addEventListener('selectionchange', onSelection);
      return () => {
        selectionListeners.delete(l);
        if (--watching === 0) document.removeEventListener('selectionchange', onSelection);
      };
    },
    () => selected,
    () => null,
  );
}

/** A highlight as a `#` chip: its first words, the whole text and where it sits go to the model. */
export const selectionRef = (s: PageSelection): AssistantRefNote => ({
  kind: 'selection',
  label: `“${s.text.length > 40 ? `${s.text.slice(0, 40)}…` : s.text}”`,
  text: s.text,
  ...(s.where ? { where: s.where } : {}),
});
