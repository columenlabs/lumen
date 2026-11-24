import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
/** A phone held sideways: short and under a finger. Its panels dock at the right. */
const SIDEWAYS = '(max-height: 500px) and (pointer: coarse)';

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

function useMedia(query: string) {
  const sub = React.useCallback((on: () => void) => subscribe(query, on), [query]);
  return React.useSyncExternalStore(
    sub,
    () => watchOf(query).mql.matches,
    () => false,
  );
}

/** Narrower than a tablet. */
export function useIsMobile() {
  return useMedia(MOBILE);
}

/**
 * How a phone lays a page out: `phone` for a phone either way up, `sideways` for one held on its side
 * (wide enough for the desktop width but short, so panels dock at the right instead of rising from the
 * bottom, as `LumenPhoneDrawer sideways` does). Both come from media queries alone, so they follow every turn.
 */
export function usePhoneLayout() {
  const narrow = useMedia(MOBILE);
  const sideways = useMedia(SIDEWAYS) && !narrow;
  return { phone: narrow || sideways, sideways };
}
