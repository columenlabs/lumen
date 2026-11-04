/**
 * A part of the kit loaded only when it first shows (a chart, Edit widget, What's new), so an app's
 * first page never downloads what it doesn't draw. The import must be a dynamic `import()` with the
 * part's module, and every other import of that module elsewhere in the kit's static graph must be
 * type-only, or the bundler keeps it in the first file.
 *
 * Every lazy part also loads on its own once the tab is idle (8 s after load). A deploy replaces
 * the hashed files, so a tab that first drew a part after one asked for a file that was gone and
 * reloaded: the assistant's first answer reloaded the page mid chat (2026-11-04,
 * `chat-markdown-*.js`). Loaded early, the part is in the tab's module map before any deploy.
 */
import { type ComponentType, type ReactNode, Suspense, lazy } from 'react';

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

/** How long after load the lazy parts start loading: the first page's own work comes first. */
const PRELOAD_AFTER_MS = 8_000;

const loaders = new Set<() => Promise<unknown>>();
let scheduled = false;

function schedulePreload() {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;
  const run = () => {
    for (const load of loaders) load().catch(() => {});
  };
  const idle = () =>
    setTimeout(
      () =>
        'requestIdleCallback' in window ? window.requestIdleCallback(run) : setTimeout(run, 1000),
      PRELOAD_AFTER_MS,
    );
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

export function lazyPart<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = null,
  /** Drawn instead when a deploy removed the part's file, so the tab keeps working (no reload). */
  stale?: ComponentType<P>,
): ComponentType<P> {
  let pending: Promise<ComponentType<P>> | null = null;
  const once = () => {
    pending ??= load().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  loaders.add(once);
  schedulePreload();
  const Part = lazy(() =>
    once().then(
      (c) => ({ default: c }),
      (error) => {
        if (stale && isStaleBuildError(error)) return { default: stale };
        throw error;
      },
    ),
  );
  function LazyPart(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Part {...props} />
      </Suspense>
    );
  }
  return LazyPart;
}
