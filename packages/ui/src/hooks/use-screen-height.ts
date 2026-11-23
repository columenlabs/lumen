import * as React from 'react';

/** The CSS variable on `<html>` that holds the part of the screen the browser shows, in px. */
export const SCREEN_HEIGHT_VAR = '--lumen-screen-h';

let users = 0;
let stop: (() => void) | undefined;
let current = 0;
const listeners = new Set<(h: number) => void>();

/**
 * The height the browser really shows. `100svh` is meant to be that, but iOS 26 Safari with its tabs
 * at the bottom (or top) counts the strip under its own controls too, so a full-screen app's bottom
 * row (a composer, a status bar) is drawn under them and hidden. The visual viewport follows what is
 * on screen (and the keyboard). A pinch zoom also shrinks it, so the last height holds while zoomed.
 */
function measure(): number {
  const vv = window.visualViewport;
  const layout = document.documentElement.clientHeight || window.innerHeight;
  if (!vv) return layout;
  if (vv.scale > 1.01) return current || layout;
  return Math.round(Math.min(vv.height, Math.max(layout, window.innerHeight)));
}

function start(): () => void {
  const root = document.documentElement;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const h = measure();
      if (h <= 0 || h === current) return;
      current = h;
      root.style.setProperty(SCREEN_HEIGHT_VAR, `${h}px`);
      for (const l of listeners) l(h);
    });
  };
  update();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  return () => {
    cancelAnimationFrame(frame);
    vv?.removeEventListener('resize', update);
    vv?.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    root.style.removeProperty(SCREEN_HEIGHT_VAR);
    current = 0;
  };
}

/**
 * Keeps `--lumen-screen-h` on `<html>` while mounted and returns it (0 before the first measure).
 * A full-screen page (a 3D view with a phone drawer, a chat) takes the `lumen-screen` class instead
 * of `h-svh`, so its bottom row stays above the browser's own controls and the keyboard.
 */
export function useScreenHeight(): number {
  const [h, setH] = React.useState(current);
  React.useEffect(() => {
    if (users++ === 0) stop = start();
    listeners.add(setH);
    if (current) setH(current);
    return () => {
      listeners.delete(setH);
      if (--users === 0) {
        stop?.();
        stop = undefined;
      }
    };
  }, []);
  return h;
}
