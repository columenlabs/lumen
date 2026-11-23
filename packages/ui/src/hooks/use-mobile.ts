import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
/** A phone held sideways: short and under a finger. Its panels dock at the right. */
const SIDEWAYS = '(max-height: 500px) and (pointer: coarse)';

/**
 * Follows one media query from the query's own answer. Never from `window.innerWidth`: iOS can still
 * report the old width when a rotation fires the change, which left the layout on the old orientation.
 */
function useMedia(query: string) {
  return React.useSyncExternalStore(
    (on) => {
      const q = window.matchMedia(query);
      q.addEventListener('change', on);
      // Belt and braces: a rotation or resize re-reads the query too.
      window.addEventListener('resize', on);
      window.addEventListener('orientationchange', on);
      return () => {
        q.removeEventListener('change', on);
        window.removeEventListener('resize', on);
        window.removeEventListener('orientationchange', on);
      };
    },
    () => window.matchMedia(query).matches,
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
