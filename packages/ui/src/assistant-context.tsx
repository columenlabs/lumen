// The assistant's place in Lumen: the contract pages and cards use to talk to an
// assistant, with nothing of the assistant itself. A product that docks one (the product's assistant panel)
// provides `AssistantContext`; without it every hook here is a no-op and cards hide Ask the assistant.
import { createContext, useContext, useEffect } from 'react';
import type { AssistantPageType } from './assistant-screen';

/** What one part of the screen tells the assistant: a short label for the chip and data for the model. */
export interface AssistantNote {
  label: string;
  data?: Record<string, unknown>;
}

/**
 * What the person points at with @: the page, a card on it, a page of the app (a symbol, a
 * screener, a saved view...), a workspace or one of its tabs, or a Settings section. The assistant reads
 * what each is and how to reach its data.
 */
export type AssistantRef =
  | { kind: 'page'; label: string; path: string }
  | { kind: 'card'; label: string; id: string; card?: string; where?: string }
  | { kind: 'view'; label: string; path: string; type?: AssistantPageType; where?: string }
  | { kind: 'workspace'; label: string; workspace: string }
  | { kind: 'tab'; label: string; workspace: string; tab: string; where?: string }
  | { kind: 'setting'; label: string; section: string };

/** Where a note comes from: the page, or the view on it. */
export type AssistantSlot = 'page' | 'view';

/** What pages may call: the same functions for the life of the shell, so pages never redraw. */
export interface AssistantActions {
  /** The assistant's name, as people see it: `Atlas`. */
  name: string;
  /** The assistant's API base on this app (workspaces and frames live under it). */
  api: string;
  note: (slot: AssistantSlot, note: AssistantNote | null) => void;
  loadChat: (id: string) => void;
  setOpen: (open: boolean) => void;
  /** The assistant answers on this app (its status loaded): cards show ✦ Ask the assistant only then. */
  ready: boolean;
  /**
   * Opens the panel with the card's @ chips and a suggested message in the composer, for the person
   * to edit and send (a card's ⋯ ▸ Ask the assistant; never sent on the tap).
   */
  draft: (text: string, refs: AssistantRef[]) => void;
}

export const AssistantContext = createContext<AssistantActions | null>(null);

/** The assistant's stable actions for pages (open a chat, open the panel); null where the app has no assistant. */
export function useAssistant(): AssistantActions | null {
  return useContext(AssistantContext);
}

/** A page (or one part of it) tells the assistant what the person sees; cleared when it unmounts. */
export function useAssistantNote(slot: AssistantSlot, note: AssistantNote | null) {
  const set = useContext(AssistantContext)?.note;
  const key = note ? JSON.stringify(note) : '';
  useEffect(() => {
    if (!set) return;
    set(slot, key ? (JSON.parse(key) as AssistantNote) : null);
    return () => set(slot, null);
  }, [set, slot, key]);
}

/** The docked assistant's name, or `fallback` where the app has none. */
export function useAssistantName(fallback = 'the assistant'): string {
  return useContext(AssistantContext)?.name ?? fallback;
}

/** True while the app is still finding out whether its assistant answers: a page that needs it
 *  waits instead of saying it is missing. */
export const AssistantPendingContext = createContext(false);
export function useAssistantPending(): boolean {
  return useContext(AssistantPendingContext);
}
