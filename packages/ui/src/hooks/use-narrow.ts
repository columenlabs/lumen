import { type RefObject, useLayoutEffect, useState } from 'react';

/** Under this width (px) a part lays itself out for a phone. */
export const NARROW = 640;

/**
 * Whether a part's own box is narrower than `below` px: a phone, or a narrow drawer on a desktop.
 * Before the box is measured it reads the window, so the first paint already fits.
 */
export function useNarrow(ref: RefObject<HTMLElement | null>, below = NARROW): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < below,
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setNarrow(w < below);
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [ref, below]);
  return narrow;
}
