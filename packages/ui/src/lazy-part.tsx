/**
 * A part of the kit loaded only when it first shows (a chart, Edit widget, What's new), so an app's
 * first page never downloads what it doesn't draw. The import must be a dynamic `import()` with the
 * part's module, and every other import of that module elsewhere in the kit's static graph must be
 * type-only, or the bundler keeps it in the first file.
 */
import { type ComponentType, type ReactNode, Suspense, lazy } from 'react';

export function lazyPart<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = null,
): ComponentType<P> {
  const Part = lazy(() => load().then((c) => ({ default: c })));
  function LazyPart(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Part {...props} />
      </Suspense>
    );
  }
  return LazyPart;
}
