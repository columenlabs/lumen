// The header's Refresh: reloads the page's data and asks the app's server to skip
// its cache. While a refresh runs, `refreshHeaders()` carries one token per click; an app's API client
// adds it to every request and the server drops its cached reads once per token.

import { REFRESH_HEADER } from '@columenlabs/lumen-types';

let token: string | null = null;

/** Headers an app's API client adds to each request; empty unless a refresh is running. */
export function refreshHeaders(): Record<string, string> {
  return token ? { [REFRESH_HEADER]: token } : {};
}

/** Runs `reload` with a fresh token set, so the requests it makes skip the server cache. */
export async function withRefreshToken(reload: () => Promise<unknown>): Promise<void> {
  token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await reload();
  } finally {
    token = null;
  }
}
