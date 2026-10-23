import * as React from 'react';
import { useIsMobile } from './use-mobile';

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
 * Where a fixed overlay must sit while the keyboard is open. iOS shrinks the visual viewport but not
 * the layout viewport fixed elements use, so an overlay sized to the layout viewport runs under the
 * keyboard. Undefined while no keyboard is up.
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

/**
 * The one phone rule for every overlay (Dialog, AlertDialog, a bottom Sheet): a full screen pinned to
 * the top, its actions in a bar at the top, so the fields a person types in already sit high and the
 * keyboard covers only what is below them. With the keyboard up the screen ends at the keyboard.
 * The classes are `phoneScreen`; this gives the style.
 */
export function usePhoneScreen(style?: React.CSSProperties): React.CSSProperties | undefined {
  const phone = useIsMobile();
  const kb = useKeyboardFit();
  return phone && kb ? { ...style, top: kb.top, height: kb.height, maxHeight: kb.height } : style;
}
