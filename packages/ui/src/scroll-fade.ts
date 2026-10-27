// Fades a sideways-scrolling row at the edges with more beyond them.
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which edges of a sideways-scrolling row have more beyond them (`start`, `end`, `both`), for
 * theme.css (`data-fade`) to fade there: a cut-off tab or block reads as "scroll for more", not as a clipped label.
 */
export function useScrollFade(given?: RefObject<HTMLDivElement | null>) {
  const own = useRef<HTMLDivElement>(null);
  const ref = given ?? own;
  const [side, setSide] = useState<'start' | 'end' | 'both' | undefined>();
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setSide(start && end ? 'both' : start ? 'start' : end ? 'end' : undefined);
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const seen = new ResizeObserver(update);
    seen.observe(el);
    return () => seen.disconnect();
  }, [ref, update]);
  return { ref, side, update };
}
