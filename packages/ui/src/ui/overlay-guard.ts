// Esc closes the topmost thing only. A Radix overlay (Dialog, Sheet, AlertDialog) hears Esc on the
// document before a base-ui picker open inside it (LumenSelector, Combobox), which isn't one of
// Radix's layers, so one Esc closed both. While such a picker is open the overlay leaves Esc to it.

const OPEN_PICKER = '[data-slot="lumen-selector"][data-open], [data-slot="combobox-content"][data-open]';

/** The overlay's `onEscapeKeyDown`: ignores Esc while a picker is open, else runs the caller's. */
export function escapeToPicker(own?: (e: KeyboardEvent) => void) {
  return (e: KeyboardEvent) => {
    if (document.querySelector(OPEN_PICKER)) {
      e.preventDefault();
      return;
    }
    own?.(e);
  };
}
