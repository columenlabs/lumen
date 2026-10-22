// A page that waits on what it shows (every reload of a workspace said
// "Workspaces need the assistant on this app" until its data came). Nothing is missing until proven: the
// page's skeleton (its tab row too, when it has tabs) while anything it needs is still unknown,
// Not found only after a 404 or a lookup that finished without it, and any other failure with Retry.
import type { UseQueryResult } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { ApiError } from './api-fetch';
import { LumenLayout } from './lumen-layout';
import { useLumenLoad } from './lumen-source';
import type { Crumb } from './page';
import { Skeleton } from './ui/skeleton';

export function LumenPageState({
  crumbs,
  title,
  icon,
  query,
  waiting = false,
  error,
  notFound = 'Nothing here with this id. It may have been deleted.',
  tabs = false,
}: {
  /** The crumbs before the page's own; the last one says …, Not found or Could not load. */
  crumbs: Crumb[];
  /** The placeholder card's name and icon, as the page's first card shows them. */
  title: string;
  icon: LucideIcon;
  /** What the page waits on; none when the address itself is wrong. */
  query?: Pick<
    UseQueryResult<unknown, Error>,
    'data' | 'error' | 'isError' | 'isFetching' | 'isPending' | 'dataUpdatedAt' | 'refetch'
  >;
  /** Something else the page needs is not known yet (whether the app has the assistant). */
  waiting?: boolean;
  /** A known reason the page cannot load, shown in place of Not found. */
  error?: Error | null;
  /** Said once the page is proven missing. */
  notFound?: string;
  /** The page has a tab row: its skeleton shows above the card while loading. */
  tabs?: boolean;
}) {
  const read = useLumenLoad(...(query ? [query] : []));
  const failed = query?.isError ? query.error : null;
  const loading = !error && (waiting || (!!query?.isPending && !failed));
  const missing =
    !loading && !error && (!failed || (failed instanceof ApiError && failed.status === 404));
  const load = loading
    ? { ...read, loading: true, fetching: true, error: null }
    : { ...read, loading: false, error: missing ? new Error(notFound) : (error ?? failed) };
  return (
    <LumenLayout
      crumbs={[...crumbs, { label: loading ? '…' : missing ? 'Not found' : 'Could not load' }]}
      intro={
        tabs && loading ? (
          <div aria-busy="true" aria-label="Loading tabs" className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        ) : undefined
      }
      cards={[{ id: 'page', link: false, title, icon, kind: 'table', load, children: null }]}
    />
  );
}
