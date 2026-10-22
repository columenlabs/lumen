// One card or panel's own error catcher (regression guards option B): a bug in
// one card, or in the assistant panel, shows "This card hit an error" in that card only, with Try again
// and Reload, and the rest of the page keeps working. Before, the only catcher was the router's,
// so the assistant's Chats crash blanked the whole page. Each catch is logged like a page error, with
// `where` naming the card or panel. A file a deploy removed still reloads the tab.
import type { ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorPage, isStaleBuildError, reloadForNewBuild, reportError } from './route-error';

export function LumenBoundary({
  where,
  what = 'card',
  children,
}: {
  /** Logged with the error: the card's id, or the panel's name ("assistant"). */
  where: string;
  what?: 'card' | 'panel';
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      onError={(error) => {
        if (isStaleBuildError(error) && reloadForNewBuild())
          return reportError(error, 'reload', where);
        reportError(error, 'shown', where);
      }}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ErrorPage error={error} onRetry={resetErrorBoundary} what={what} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
