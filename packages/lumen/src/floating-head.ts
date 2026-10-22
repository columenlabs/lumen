// A table that scrolls sideways in its own box (a card narrower than the page, or a view outside
// a LumenLayout) can't pin its header with sticky: CSS makes any sideways scroller a scroller up and
// down too, so sticky pins to that box, which never scrolls up and down. This slides the header
// down with the page's scroller instead, under the page's sticky tabs (--pin-top), until the
// table's bottom ("table headers are not sticky like they were").
import { type RefObject, useEffect } from 'react';

/** The nearest ancestor that scrolls up and down; null for the window. A sideways scroller around
 *  the table (overflow-x makes overflow-y auto too) whose rows all fit is passed over: taking it
 *  slid the header over the first row (the Tune card, 2026-10-15). */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const y = getComputedStyle(e).overflowY;
    if ((y === 'auto' || y === 'scroll') && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

export function useFloatingHead(box: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = box.current;
    if (!on || !el) return;
    const scroller = scrollParentOf(el);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const place = () => {
      frame = 0;
      const head = el.querySelector<HTMLElement>(':scope table > thead');
      const table = head?.parentElement;
      if (!head || !table) return;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      // The scroller's own --pin-top: the table's box sets its own to 0 for its sticky cells.
      const pin =
        Number.parseFloat(
          getComputedStyle(scroller ?? document.documentElement).getPropertyValue('--pin-top'),
        ) || 0;
      const rect = table.getBoundingClientRect();
      const y = Math.max(0, Math.min(top + pin - rect.top, rect.height - head.offsetHeight));
      head.style.position = 'relative';
      head.style.zIndex = '20';
      head.style.transform = y > 0 ? `translateY(${y}px)` : '';
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    target.addEventListener('scroll', queue, { passive: true });
    const seen = new ResizeObserver(queue);
    seen.observe(el);
    if (scroller) seen.observe(scroller);
    return () => {
      target.removeEventListener('scroll', queue);
      seen.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [box, on]);
}
