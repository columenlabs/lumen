// One data cache rule for every app (switching tabs must not fetch again).
// A page's queries stay fresh for 5 minutes and stay in memory for 30, so a tab or page opened
// again shows what it had without a request. Data changes reach the cache another way: a save
// invalidates its keys, a running job polls (`refetchInterval`) until it ends, an ended Task
// invalidates everything (tasks.tsx), and the header's Refresh refetches the page.

import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

type Retry = NonNullable<NonNullable<QueryClientConfig['defaultOptions']>['queries']>['retry'];

/** The app's one QueryClient; `retry` is the app's own rule for failed requests. */
export function createDeskQueryClient({ retry }: { retry?: Retry } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: retry ?? 1,
        refetchOnWindowFocus: false,
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
      },
    },
  });
}
