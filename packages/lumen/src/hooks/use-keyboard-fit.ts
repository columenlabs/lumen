import * as React from 'react';

/** The visual viewport while a phone's keyboard covers part of the layout viewport. */
export interface KeyboardFit {
  /** Top of what is visible, from the layout viewport's top (iOS pans the page to the focused field). */
  top: number;
  /** Height of what is visible above the keyboard. */
  height: number;
  /** Layout viewport below the visible part: the keyboard. */
  below: number;
}

/**
 * Where a fixed modal must sit while the keyboard is open. iOS shrinks the visual viewport but not
 * the layout viewport fixed elements use, so a modal centred or bottom-anchored there runs under the
 * keyboard or off the top. Undefined while no keyboard is up.
 */
export function useKeyboardFit(): KeyboardFit | undefined {
  const [fit, setFit] = React.useState<KeyboardFit>();
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // clientHeight is the layout viewport; on iOS innerHeight follows the visual one.
      const layout = document.documentElement.clientHeight;
      const below = Math.max(0, layout - vv.height - vv.offsetTop);
      const covered = layout - vv.height > 120;
      setFit(covered ? { top: vv.offsetTop, height: vv.height, below } : undefined);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return fit;
}
