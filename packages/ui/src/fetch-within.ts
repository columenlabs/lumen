/** How long a call to the app's own server may take before it gives up (ms). */
export const FETCH_MS = 15_000;

/**
 * `fetch` that never waits forever: it gives up after `ms` with a `TimeoutError` (the caller's own
 * `signal`, if any, still aborts it as before), so a hung connection becomes an error state or a
 * fallback instead of a spinner that never ends.
 */
export function fetchWithin(url: string, init: RequestInit = {}, ms = FETCH_MS): Promise<Response> {
  const timeout = AbortSignal.timeout(ms);
  const signal =
    init.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([init.signal, timeout])
      : (init.signal ?? timeout);
  return fetch(url, { ...init, signal });
}
