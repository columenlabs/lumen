// User preferences that hold on every app: theme, glass, time zone and
// Hide amounts, Observability details, font and font
// size.
// An app's pages may live on their own hosts, so the choice is kept in one cookie (on the parent
// domain the app names, `configureLumen`) rather than per-origin localStorage; nothing is stored
// server-side.
import { useSyncExternalStore } from 'react';
import { KIT, onConfigure } from './kit-config';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const TIME_ZONES = [
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'UTC', label: 'UTC' },
] as const;
export type TimeZoneId = (typeof TIME_ZONES)[number]['id'];

/** The text font; Manrope is the suite's own, the rest are for reading comfort. */
export const FONTS = [
  { id: 'manrope', label: 'Manrope' },
  { id: 'inter', label: 'Inter' },
  { id: 'plex', label: 'IBM Plex Sans' },
  { id: 'system', label: 'System' },
] as const;
export type FontId = (typeof FONTS)[number]['id'];

/** Text size: the root size every rem scales from, so spacing grows with the text. */
export const FONT_SIZES = [
  { id: 'small', label: 'Small', px: 15 },
  { id: 'default', label: 'Default', px: 16 },
  { id: 'large', label: 'Large', px: 17 },
] as const;
export type FontSizeId = (typeof FONT_SIZES)[number]['id'];

export interface Prefs {
  theme: Theme;
  glass: boolean;
  font: FontId;
  fontSize: FontSizeId;
  timeZone: TimeZoneId;
  /** Hide amounts: the header's eye masks holding dollars and quantities, e.g. for screen-sharing. */
  hideAmounts: boolean;
  /** Observability details: each card and view shows how long it took to load. */
  observability: boolean;
}

/** The assistant panel: never narrower than this, nor wider than this or half the window. */
export const ASSISTANT_WIDTH = { min: 320, max: 800 } as const;

/** Eastern by default, as an app's zone picker had it (the market's own zone). */
export const DEFAULT_PREFS: Prefs = {
  theme: 'light',
  glass: false,
  font: 'manrope',
  fontSize: 'default',
  timeZone: 'America/New_York',
  hideAmounts: false,
  observability: false,
};

const YEAR = 60 * 60 * 24 * 365;
const listeners = new Set<() => void>();

/** The app's shared cookie domain (`configureLumen`); host-only when it names none. */
function cookieDomain() {
  const domain = KIT.cookieDomain?.(location.hostname);
  return domain ? `; domain=${domain}` : '';
}

function read(): Prefs {
  try {
    const raw = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${KIT.prefsCookie}=`))
      ?.slice(KIT.prefsCookie.length + 1);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<Prefs>;
    return {
      theme: THEMES.includes(v.theme as Theme) ? (v.theme as Theme) : DEFAULT_PREFS.theme,
      glass: v.glass === true,
      font: FONTS.find((f) => f.id === v.font)?.id ?? DEFAULT_PREFS.font,
      fontSize: FONT_SIZES.find((f) => f.id === v.fontSize)?.id ?? DEFAULT_PREFS.fontSize,
      timeZone: TIME_ZONES.find((z) => z.id === v.timeZone)?.id ?? DEFAULT_PREFS.timeZone,
      hideAmounts: v.hideAmounts === true,
      observability: v.observability === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let state: Prefs = typeof document === 'undefined' ? DEFAULT_PREFS : read();

const systemDark = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The theme on screen: `system` follows the device. */
export const resolvedTheme = (p: Prefs = state): 'light' | 'dark' =>
  p.theme === 'system' ? (systemDark() ? 'dark' : 'light') : p.theme;

function apply() {
  const el = document.documentElement;
  el.classList.toggle('dark', resolvedTheme() === 'dark');
  el.dataset.glass = state.glass ? 'on' : 'off';
  el.dataset.font = state.font;
  el.dataset.fontSize = state.fontSize;
}

if (typeof document !== 'undefined') {
  apply();
  matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme !== 'system') return;
    apply();
    for (const l of listeners) l();
  });
  // The app named its own cookie: read the person's preferences from it.
  onConfigure(() => {
    state = read();
    apply();
    for (const l of listeners) l();
  });
  // Another app (or tab) changed a preference: pick it up when this tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const next = read();
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    apply();
    for (const l of listeners) l();
  });
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  state = { ...state, [key]: value };
  document.cookie = `${KIT.prefsCookie}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${YEAR}; samesite=lax; secure${cookieDomain()}`;
  apply();
  for (const l of listeners) l();
}

export const getPrefs = (): Prefs => state;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getPrefs,
    () => DEFAULT_PREFS,
  );
}

/** `Pacific`, `UTC`: the short name shown next to times. */
export const timeZoneLabel = (id: TimeZoneId) => TIME_ZONES.find((z) => z.id === id)?.label ?? id;
