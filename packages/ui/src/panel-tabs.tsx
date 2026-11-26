// Panel tabs: a page's own tabs beside the assistant in its docked panel (a file's Details, a
// selection's properties), as a CAD or video editor keeps them in one right panel. The page
// renders `<LumenPanelTab>` with the tab's content; the panel draws a tab row (the assistant
// first) while any is mounted, and the content is portalled into the panel while its tab is
// picked. No tab mounted, no row: the panel is the assistant alone, as before.
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { NavIcon } from './nav';

export interface PanelTabInfo {
  value: string;
  label: string;
  icon: NavIcon;
}

let tabs: PanelTabInfo[] = [];
let picked: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
let snapshot: { tabs: PanelTabInfo[]; picked: string | null } = { tabs, picked };
const read = () => snapshot;
const update = () => {
  // The picked tab falls back to the assistant when its page goes.
  if (picked && !tabs.some((t) => t.value === picked)) picked = null;
  snapshot = { tabs, picked };
  emit();
};

/** The panel's tabs and which is picked (null: the assistant). */
export function usePanelTabs() {
  return useSyncExternalStore(subscribe, read, read);
}

/** Pick a tab (null: the assistant). The caller opens the panel. */
export function pickPanelTab(value: string | null) {
  picked = value;
  update();
}

const slots = new Set<(el: HTMLElement | null) => void>();
let slotEl: HTMLElement | null = null;
/** The panel's body for page tabs; set by the panel while it shows one. */
export function setPanelTabSlot(el: HTMLElement | null) {
  slotEl = el;
  for (const s of slots) s(el);
}

/**
 * A tab beside the assistant while this is mounted; `children` show in the panel while it is
 * picked. Open it with `pickPanelTab(value)` and the assistant's `setOpen(true)`.
 */
export function LumenPanelTab({
  value,
  label,
  icon,
  children,
}: PanelTabInfo & { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(slotEl);
  useEffect(() => {
    slots.add(setEl);
    setEl(slotEl);
    return () => {
      slots.delete(setEl);
    };
  }, []);
  useEffect(() => {
    tabs = [...tabs.filter((t) => t.value !== value), { value, label, icon }];
    update();
    return () => {
      tabs = tabs.filter((t) => t.value !== value);
      update();
    };
  }, [value, label, icon]);
  const { picked: now } = usePanelTabs();
  return now === value && el ? createPortal(children, el) : null;
}
