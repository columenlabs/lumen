// The router's error page for every app (Logs, and Feed before it, showed a
// bare "Something went wrong / Show error" that looked like a crash).
//
// The usual cause is a tab still running the build before a deploy: its next page asks for files
// the server no longer has. Vite then fires `vite:preloadError`; cancelling that event (as this did
// before) makes the import resolve to `undefined`, so the page threw "Cannot read properties of
// undefined (reading 'LogsPage')", which nothing recognised as a new build and the error page
// showed until the reload landed. Now the event is never cancelled, the import fails as what it
// is, and the page shows "Updating" while the tab reloads onto the new build.
//
// Any other error is tried once more on its own; if it fails again the page says so with Try again
// and Reload. Every error is sent to the Worker (`POST /api/client-error`), which writes it to
// Workers Logs, so it can be read there.
import { type ErrorComponentProps, useRouter } from '@tanstack/react-router';
import { ChevronRight, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchWithin } from './fetch-within';
import { reportClientError } from './telemetry';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty';
import { Spinner } from './ui/spinner';

const KEY = 'lumen_new_build_reload';
const GAP_MS = 10_000;

/** A dynamic import that failed to load (Chrome, Firefox, Safari wording), not a page's own bug. */
export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return (
    message.startsWith('Failed to fetch dynamically imported module') ||
    message.startsWith('error loading dynamically imported module') ||
    message.startsWith('Importing a module script failed') ||
    message.includes('Unable to preload CSS') ||
    // Safari, when a missing file comes back as a page instead of a script.
    message.includes('is not a valid JavaScript MIME type')
  );
}

/** A reload this tab has already started; anything failing meanwhile waits for it. */
let reloadStarted = false;

/** Whether this tab has not reloaded for a new build in the last 10 s. */
function mayReload(): boolean {
  if (reloadStarted) return true;
  try {
    return Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) >= GAP_MS;
  } catch {
    return true;
  }
}

/**
 * Reloads onto the new build unless it already did in the last 10 s (a file that is truly missing
 * then shows its error instead of reloading forever); says whether a reload is under way.
 */
export function reloadForNewBuild(): boolean {
  if (reloadStarted) return true;
  if (!mayReload()) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No sessionStorage (private mode): reload anyway.
  }
  reloadStarted = true;
  window.location.reload();
  return true;
}

/** The bit of a TanStack router this needs: each route's component, lazy ones with `preload`. */
type LazyRoutes = { routesById: Record<string, { options: { component?: unknown } }> };

/**
 * Fetches every lazy page of this build once the tab is idle, so a later click never asks the
 * server for files a deploy has since replaced. Without it each deploy (many a day) made the next
 * click on a page not yet opened reload the whole tab, which cut the assistant answer short.
 */
/** How long after load the other pages' files start loading. */
const PRELOAD_AFTER_MS = 8_000;

function preloadPages(router: LazyRoutes) {
  const run = () => {
    for (const route of Object.values(router.routesById)) {
      const preload = (route.options.component as { preload?: () => Promise<unknown> } | undefined)
        ?.preload;
      preload?.().catch(() => {});
    }
  };
  // Not at load: the page's own first render and data come first. At load a phone was still
  // building the page, and every other page's files were fetched and run beside it (2026-10-22).
  const idle = () =>
    setTimeout(
      () =>
        'requestIdleCallback' in window ? window.requestIdleCallback(run) : setTimeout(run, 1000),
      PRELOAD_AFTER_MS,
    );
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

/**
 * Keeps an open tab working across deploys: every page's files load up front (when a router is
 * given), and a file a deploy removed reloads the tab onto the new build. The event is never
 * cancelled: cancelling it makes the import resolve to nothing, which the page then hits as a bug.
 */
export function watchNewBuilds(router?: LazyRoutes) {
  window.addEventListener('vite:preloadError', () => {
    reloadForNewBuild();
  });
  if (router) preloadPages(router);
  watchDeploys();
}

/** How often a tab in view asks whether a deploy has replaced its build. */
const CHECK_MS = 10 * 60_000;

/** This tab's entry script, the hashed file every build names afresh. */
const entryOf = (html: string) =>
  html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1] ?? null;

/** Whether the app's page now names another entry script than the one this tab runs. */
async function newBuildOut(): Promise<boolean> {
  const mine = document
    .querySelector<HTMLScriptElement>('script[type="module"][src]')
    ?.getAttribute('src');
  if (!mine) return false;
  try {
    const res = await fetchWithin(import.meta.env.BASE_URL ?? '/', { cache: 'no-store' }, 5000);
    if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) return false;
    const live = entryOf(await res.text());
    return !!live && live !== mine;
  } catch {
    return false;
  }
}

/**
 * A tab left open across deploys keeps running its old build until a file it asks for is gone,
 * so it can be a day behind and talk to a Worker that expects the new one (* The assistant on a phone tab from yesterday said the app had no workspaces). The tab asks whether a
 * deploy has replaced its build when it comes back into view and every 10 minutes while in view,
 * and offers Reload once per new build. It never reloads on its own: that would cut work short.
 */
function watchDeploys() {
  let offered = false;
  let busy = false;
  const check = async () => {
    if (offered || busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      if (!(await newBuildOut())) return;
      offered = true;
      toast('A new version is ready', {
        duration: Number.POSITIVE_INFINITY,
        action: { label: 'Reload', onClick: () => window.location.reload() },
      });
    } finally {
      busy = false;
    }
  };
  document.addEventListener('visibilitychange', () => void check());
  setInterval(() => void check(), CHECK_MS);
}

/** When each error was last sent from each place, so the same one is sent once. */
const sent = new Map<string, number>();

/** Last error tried again on its own, so a page that keeps failing is tried once, not forever. */
let retried: { message: string; at: number } | null = null;

/**
 * Sends a page error to the Worker's log; never throws, never retries. `where` names the card or
 * panel that caught it (LumenBoundary); left out, the whole page did.
 */
export function reportError(error: unknown, outcome: 'reload' | 'retry' | 'shown', where?: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  // React renders a failing part twice before giving up: one line per error and place.
  const key = `${where ?? 'page'} ${outcome} ${err.message}`;
  if (Date.now() - (sent.get(key) ?? 0) < GAP_MS) return;
  sent.set(key, Date.now());
  reportClientError(err);
  const body = JSON.stringify({
    message: err.message.slice(0, 500),
    stack: (err.stack ?? '').slice(0, 2000),
    path: window.location.pathname + window.location.search,
    build: import.meta.url.split('/').pop() ?? '',
    outcome,
    where: where ?? 'page',
  });
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never break the page.
  }
}

/**
 * One centred message with its buttons, the same on every app: the whole page's (RouteError) or
 * one card's or panel's (LumenBoundary, `what` "card" or "panel", smaller).
 */
export function ErrorPage({
  error,
  onRetry,
  what = 'page',
}: {
  error: unknown;
  onRetry: () => void;
  what?: 'page' | 'card' | 'panel';
}) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return (
    <Empty className={what === 'page' ? 'min-h-[50vh]' : 'gap-3 p-4 md:p-6'}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>This {what} hit an error</EmptyTitle>
        <EmptyDescription>Try again, or reload the app. It has been logged.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button size="sm" onClick={onRetry}>
            <RotateCcw />
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw />
            Reload
          </Button>
        </div>
        <Collapsible className="w-full text-left">
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
            Details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-left text-xs whitespace-pre-wrap">
              {stack ?? message}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </EmptyContent>
    </Empty>
  );
}

/**
 * The router's error page: "Updating" while the tab reloads onto a new build; any other error is
 * tried once more on its own, then shown with Try again and Reload. Each one is logged.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const [mode] = useState<'reload' | 'retry' | 'shown'>(() => {
    if (isStaleBuildError(error) && mayReload()) return 'reload';
    const message = error instanceof Error ? error.message : String(error);
    if (!retried || retried.message !== message || Date.now() - retried.at > GAP_MS) return 'retry';
    return 'shown';
  });
  const retry = () => {
    reset();
    router.invalidate();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per error page.
  useEffect(() => {
    reportError(error, mode);
    if (mode === 'reload') reloadForNewBuild();
    if (mode === 'retry') {
      retried = { message: error instanceof Error ? error.message : String(error), at: Date.now() };
      retry();
    }
  }, []);
  if (mode === 'shown') return <ErrorPage error={error} onRetry={retry} />;
  return (
    <Empty className="min-h-[50vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyDescription>
          {mode === 'reload' ? 'Updating to the new version' : 'Loading'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
