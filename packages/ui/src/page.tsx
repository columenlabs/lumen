// The page frame: a fixed-height header (sidebar toggle, breadcrumb, actions)
// and the body, with the shell's gutter, section gap and max width. Pages never set their own outer
// padding or header. On phone the actions stay in the bar as icons and a back chevron replaces the trail.
import { Link, useRouter } from '@tanstack/react-router';
import { ChevronLeftIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAssistantNote } from './assistant-context';
import { cn } from './lib/utils';
import { setPref, usePrefs } from './prefs';
import { useShell } from './shell';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';
import { Separator } from './ui/separator';
import { SidebarTrigger, useSidebar } from './ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

import { IconButton } from './icon-button';
import { LumenFinderButton } from './lumen-finder';

export { IconButton, type IconButtonProps } from './icon-button';

export interface Crumb {
  label: ReactNode;
  /** Where the crumb links; the last crumb is the page itself and never links. */
  to?: string;
  /** Text for the phone back button and keys when `label` is not plain text. */
  name?: string;
}

const crumbName = (c: Crumb) => c.name ?? (typeof c.label === 'string' ? c.label : '');

export interface PageHeaderProps {
  crumbs: Crumb[];
  /** This page's own buttons (section A): `IconButton`s, icon only, name in the tooltip
   * . A divider keeps them apart from the shell's buttons. */
  actions?: ReactNode;
  /** Layout editing (section B's first slot): LumenLayout fills it; pages never do. */
  layout?: ReactNode;
  /** A short status line beside the breadcrumb (under the title on phone). */
  meta?: ReactNode;
  /** This page's status bar items (`StatusItem`), shown after the app's own. */
  status?: ReactNode;
}

/** The fixed-height header; `Page` renders it, or a page with several states renders it itself. */
export function PageHeader({ crumbs, actions, layout, meta, status }: PageHeaderProps) {
  const router = useRouter();
  const { statusSlot, refresh, refreshing, hideAmounts, headerActions } = useShell();
  const hidden = usePrefs().hideAmounts;
  const { isMobile } = useSidebar();
  const parent = [...crumbs.slice(0, -1)].reverse().find((c) => c.to);
  const current = crumbs[crumbs.length - 1];
  // The assistant sees which page this is: its name on the chip, its trail for the model.
  useAssistantNote('page', {
    label: current ? crumbName(current) : '',
    data: { page: crumbs.map(crumbName).filter(Boolean).join(' › ') },
  });
  return (
    <>
      <header
        data-slot="shell-header"
        className="sticky top-0 z-20 flex h-(--shell-header-height) shrink-0 items-center gap-2 overflow-hidden border-b bg-background px-(--shell-gutter)"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="-ml-1" />
          </TooltipTrigger>
          <TooltipContent>Toggle sidebar</TooltipContent>
        </Tooltip>
        <Separator
          orientation="vertical"
          className="hidden data-vertical:h-4 data-vertical:self-center md:block"
        />
        {parent && (
          <IconButton
            icon={ChevronLeftIcon}
            label={`Back to ${crumbName(parent)}`}
            className="md:hidden"
            onClick={() => router.navigate({ to: parent.to })}
          />
        )}
        {!isMobile && (
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {crumbs.map((c, i) => (
                <Fragment key={`${i}-${crumbName(c)}`}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className="min-w-0">
                    {c.to && i < crumbs.length - 1 ? (
                      <BreadcrumbLink asChild>
                        <Link to={c.to}>{c.label}</Link>
                      </BreadcrumbLink>
                    ) : i === crumbs.length - 1 ? (
                      <BreadcrumbPage className="truncate">
                        <h1 className="flex min-w-0 items-center gap-2 truncate font-semibold">
                          {c.label}
                        </h1>
                      </BreadcrumbPage>
                    ) : (
                      <span className="truncate">{c.label}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
        {isMobile && (
          <div className="min-w-0">
            <h1 className="flex min-w-0 items-center gap-2 truncate text-sm leading-tight font-semibold">
              {current?.label}
            </h1>
            {meta && (
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                <span className="truncate">{meta}</span>
              </div>
            )}
          </div>
        )}
        {meta && !isMobile && (
          <div className="ml-1 hidden min-w-0 shrink items-center gap-2 truncate border-l pl-3 text-xs text-muted-foreground md:flex">
            {meta}
          </div>
        )}
        {/* Header buttons: A, the page's own, then a divider, then B, the
            shell's, in the same order on every page. Each is one tight row of icons named by
            their tooltips ("compact, close to each other"). */}
        <div
          className={cn(
            'ml-auto flex shrink-0 items-center gap-0.5',
            // Phone: a page's text buttons show as icons too; their text stays as the accessible name.
            isMobile &&
              '[&_[data-slot=button]]:size-8 [&_[data-slot=button]]:gap-0 [&_[data-slot=button]]:px-0 [&_[data-slot=button]]:text-[0px]',
          )}
        >
          {actions && (
            <>
              <div data-slot="shell-page-actions" className="flex items-center gap-0.5">
                {actions}
              </div>
              <Separator
                orientation="vertical"
                className="mx-2 data-vertical:h-5 data-vertical:self-center"
              />
            </>
          )}
          <div data-slot="shell-actions" className="flex items-center gap-0.5">
            {layout}
            <LumenFinderButton />
            {hideAmounts && (
              <IconButton
                icon={hidden ? EyeOffIcon : EyeIcon}
                label={hidden ? 'Show amounts' : 'Hide amounts'}
                aria-pressed={hidden}
                onClick={() => setPref('hideAmounts', !hidden)}
              />
            )}
            {refresh && (
              <IconButton
                icon={RefreshCwIcon}
                busy={refreshing}
                label="Refresh (skip cache)"
                disabled={refreshing}
                onClick={() => void refresh()}
              />
            )}
            {headerActions}
          </div>
        </div>
      </header>
      {status && statusSlot && createPortal(status, statusSlot)}
    </>
  );
}

/**
 * The page body: the shell's gutter, section gap and max width. A plain block, since the shell's
 * inset is the page's one `main` landmark.
 */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-(--shell-max-width) min-w-0 flex-1 flex-col gap-(--shell-section-gap) p-(--shell-gutter)',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Page({
  className,
  children,
  ...header
}: PageHeaderProps & { className?: string; children: ReactNode }) {
  return (
    <>
      <PageHeader {...header} />
      <PageBody className={className}>{children}</PageBody>
    </>
  );
}
