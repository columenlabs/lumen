import * as React from 'react';

/**
 * The one answer to "what device is this" for the kit and every app (one test, never a width check of
 * an app's own). It says what the device is; what a person can do stays the same on every device, and
 * only how a part looks and where it sits may follow these.
 *
 * - `narrow`: narrower than a tablet (under 768 px), a phone held upright.
 * - `sideways`: a phone on its side, short (500 px or less) and under a finger, and not narrow.
 * - `phone`: lays out as a phone, either way up (`narrow` or `sideways`).
 * - `touch`: the main pointer is a finger (no hover, no fine pointer).
 * - `handheld`: a phone or tablet, `touch` with a screen whose short side is under 1100 px. Its
 *   memory and battery are short, so heavy work is shared out or kept small.
 */
export interface Device {
  narrow: boolean;
  sideways: boolean;
  phone: boolean;
  touch: boolean;
  handheld: boolean;
}

const NARROW = '(max-width: 767px)';
const SIDEWAYS = '(max-height: 500px) and (pointer: coarse)';
const TOUCH = '(pointer: coarse)';
/** A handheld's screen: its short side, in CSS px, is under this. */
const HANDHELD_SIDE = 1100;

/** One shared watch per query: every hook on it hears the same three listeners. */
const watches = new Map<
  string,
  { mql: MediaQueryList; subs: Set<() => void>; stop?: () => void }
>();

function watchOf(query: string) {
  let w = watches.get(query);
  if (!w) {
    w = { mql: window.matchMedia(query), subs: new Set() };
    watches.set(query, w);
  }
  return w;
}

/**
 * Follows one media query from the query's own answer. Never from `window.innerWidth`: iOS can still
 * report the old width when a rotation fires the change, which left the layout on the old orientation.
 * Every component on one query shares one set of listeners, so a table of many rows adds none per row.
 */
function subscribe(query: string, on: () => void) {
  const w = watchOf(query);
  w.subs.add(on);
  if (!w.stop) {
    const fire = () => {
      for (const s of [...w.subs]) s();
    };
    w.mql.addEventListener('change', fire);
    // Belt and braces: a rotation or resize re-reads the query too.
    window.addEventListener('resize', fire);
    window.addEventListener('orientationchange', fire);
    w.stop = () => {
      w.mql.removeEventListener('change', fire);
      window.removeEventListener('resize', fire);
      window.removeEventListener('orientationchange', fire);
    };
  }
  return () => {
    w.subs.delete(on);
    if (!w.subs.size) {
      w.stop?.();
      w.stop = undefined;
    }
  };
}

/** One media query's answer, kept current. */
export function useMedia(query: string) {
  const sub = React.useCallback((on: () => void) => subscribe(query, on), [query]);
  return React.useSyncExternalStore(
    sub,
    () => watchOf(query).mql.matches,
    () => false,
  );
}

const shortSide = () =>
  typeof screen === 'undefined' ? Number.POSITIVE_INFINITY : Math.min(screen.width, screen.height);

function deviceOf(narrow: boolean, short: boolean, touch: boolean): Device {
  const sideways = short && !narrow;
  return {
    narrow,
    sideways,
    phone: narrow || sideways,
    touch,
    handheld: touch && shortSide() < HANDHELD_SIDE,
  };
}

/**
 * The device right now, for code outside React (an event handler, a store, a worker bridge). In a
 * component use `useDevice()`, which follows every turn and resize.
 */
export function deviceNow(): Device {
  if (typeof window === 'undefined' || !window.matchMedia) return deviceOf(false, false, false);
  return deviceOf(
    watchOf(NARROW).mql.matches,
    watchOf(SIDEWAYS).mql.matches,
    watchOf(TOUCH).mql.matches,
  );
}

/** The device, kept current from media queries alone (see `Device`). The same object while nothing changes. */
export function useDevice(): Device {
  const narrow = useMedia(NARROW);
  const short = useMedia(SIDEWAYS);
  const touch = useMedia(TOUCH);
  return React.useMemo(() => deviceOf(narrow, short, touch), [narrow, short, touch]);
}
