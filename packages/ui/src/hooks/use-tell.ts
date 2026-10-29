import * as React from 'react';

/**
 * Tells `tell` a value each time the value itself changes, never because `tell` is a new function.
 * The view hears its sort, chips and grouping through these: an app's inline callback (a new
 * function every render) used to re-run the effect, set the app's state, render, and so on without
 * end, asking the server for the same page each time. The value is compared by its JSON, so an
 * equal value in a new object is not a change either. A `tell` that appears later hears the value.
 */
export function useTell<V>(value: V, tell: ((value: V) => void) | undefined) {
  const tellRef = React.useRef(tell);
  tellRef.current = tell;
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const sent = React.useRef<string | null>(null);
  const key = JSON.stringify(value ?? null);
  const has = !!tell;
  React.useEffect(() => {
    const mark = has ? key : null;
    if (mark === null || sent.current === mark) return;
    sent.current = mark;
    tellRef.current?.(valueRef.current);
  }, [key, has]);
}
