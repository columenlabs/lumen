import * as React from 'react';
import { useIsMobile } from './use-mobile';

const KEY = '__lumenOverlay';

/**
 * Phone back closes the open overlay (a Sheet, Dialog or AlertDialog), never the page under it.
 * Opening pushes one history entry on the same URL; back pops it and closes. Closed any other way
 * (X, a tap outside, a swipe, Esc, a pick) the entry is popped again, but only while it is still
 * the current one, so a link followed from inside the overlay keeps its navigation.
 */
export function useBackClose(open: boolean, close: () => void) {
  const phone = useIsMobile();
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    if (!phone || !open || typeof window === 'undefined') return;
    const id = Math.random().toString(36).slice(2);
    let pushed = false;
    let popped = false;
    const onPop = () => {
      if (window.history.state?.[KEY] === id) return;
      popped = true;
      closeRef.current();
    };
    // Pushed a tick later, so a mount that is undone at once (React's strict mode) pushes nothing.
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...window.history.state, [KEY]: id }, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
      if (pushed && !popped && window.history.state?.[KEY] === id) window.history.back();
    };
  }, [phone, open]);
}

/**
 * An overlay root's open state, controlled or not, with `close()` for its parts (the grab handle)
 * and phone back wired in (useBackClose).
 */
export function useOverlayOpen({
  open: given,
  defaultOpen,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = React.useState(defaultOpen ?? false);
  const open = given ?? inner;
  const change = React.useCallback(
    (o: boolean) => {
      setInner(o);
      onOpenChange?.(o);
    },
    [onOpenChange],
  );
  useBackClose(open, () => change(false));
  return { open, onOpenChange: change };
}
