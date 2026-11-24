import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
/** A phone held sideways: short and under a finger. Its panels dock at the right. */
const SIDEWAYS = '(max-height: 500px) and (pointer: coarse)';

/** One shared watcher per query: every component reading it adds to one set, never listeners of its own. */
interface MediaWatch {
  list: MediaQueryList;
  subs: Set<() => void>;
  fire: () => void;
}
const watches = new Map<string, MediaWatch>();

function watchOf(query: string): MediaWatch {
  let w = watches.get(query);
  if (!w) {
    const subs = new Set<() => void>();
    w = {
      list: window.matchMedia(query),
      subs,
      fire: () => {
        for (const on of subs) on();
      },
    };
    watches.set(query, w);
  }
  return w;
}

/**
 * Follows one media query from the query's own answer. Never from `window.innerWidth`: iOS can still
 * report the old width when a rotation fires the change, which left the layout on the old orientation.
 * Every reader of a query shares one `MediaQueryList` and one set of window listeners, so a page with
 * hundreds of readers (a table's cells) holds three listeners per query, not three per reader.
 */
function useMedia(query: string) {
  return React.useSyncExternalStore(
    (on) => {
      const w = watchOf(query);
      if (!w.subs.size) {
        w.list.addEventListener('change', w.fire);
        // Belt and braces: a rotation or resize re-reads the query too.
        window.addEventListener('resize', w.fire);
        window.addEventListener('orientationchange', w.fire);
      }
      w.subs.add(on);
      return () => {
        w.subs.delete(on);
        if (w.subs.size) return;
        w.list.removeEventListener('change', w.fire);
        window.removeEventListener('resize', w.fire);
        window.removeEventListener('orientationchange', w.fire);
      };
    },
    () => watchOf(query).list.matches,
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
