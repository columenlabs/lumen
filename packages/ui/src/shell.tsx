// The frame every app renders in, from the shadcn sidebar-07 block: the app's
// brand (or an app switcher) top-left, its own nav, the profile bottom-left; collapses to icons on
// desktop and becomes a drawer on phone. An app passes its id, nav and status items; pages render in
// `Page`. What a product adds to every app (the product's app switcher, the assistant, Tasks) comes in through
// the slots below (`brand`, `wrap`, `panel`, `headerActions`, `shared`), never from here.
import { useRouterState } from '@tanstack/react-router';
import {
  ChevronsUpDownIcon,
  LogOutIcon,
  ScrollTextIcon,
  SettingsIcon,
  SunMoonIcon,
} from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { cn } from './lib/utils';
import { LumenFinder, type LumenFinderConfig } from './lumen-finder';
import { usePrefs } from './prefs';
import { withRefreshToken } from './refresh';
import { LumenSettings, type SettingsSectionDef, ThemeToggle, allSettings } from './settings';
import { SourceHealthProvider } from './source-health';
import { StatusTimeZone } from './status';
import { Avatar, AvatarFallback } from './ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from './ui/sidebar';
import { Toaster } from './ui/sonner';
import { TooltipProvider } from './ui/tooltip';
import { WhatsNew } from './whats-new';

interface ShellContext {
  /** The app this page renders in (`data-app` on the root `<html>`). */
  app: string;
  /** Its name, where Settings lists its own sections. */
  appLabel: string;
  /** Where a page's status items render (the status bar's page slot). */
  statusSlot: HTMLElement | null;
  /** Opens Settings at a section (`preferences` or one of the app's own). */
  openSettings: (section?: string) => void;
  /** Closes Settings (a section that sends the person to a page). */
  closeSettings: () => void;
  /** The header's Refresh: reloads the page's data, skipping the server cache. Null without `onRefresh`. */
  refresh: (() => Promise<void>) | null;
  refreshing: boolean;
  /** The app shows Hide amounts in its header (`hideAmounts` on `LumenShell`). */
  hideAmounts: boolean;
  /** The product's buttons on every page header, after Refresh (`headerActions`). */
  headerActions: ReactNode;
}
const Ctx = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('useShell must be used inside <LumenShell>.');
  return c;
}

/** The app this page renders in, or null outside a shell (a preview). */
export function useApp(): { id: string; label: string } | null {
  const c = useContext(Ctx);
  return c ? { id: c.app, label: c.appLabel } : null;
}

/** True while Hide amounts is on in an app that offers it: holding amounts render as `•••••`. */
export function useAmountsHidden(): boolean {
  const offered = useContext(Ctx)?.hideAmounts ?? false;
  return usePrefs().hideAmounts && offered;
}

/** `+$152,372` → `+$•••••`: every number in the text masked, signs and units kept. */
export const maskAmount = (text: string) => text.replace(/\d[\d.,]*/g, '•••••');

/** The sidebar provider writes this cookie on toggle; reading it back keeps the choice per app. */
const sidebarOpen = () =>
  typeof document === 'undefined' || !document.cookie.split('; ').includes('sidebar_state=false');

/** The phone drawer closes once a link in it opens a page. */
function CloseDrawerOnNavigate() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile } = useSidebar();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new path.
  useEffect(() => setOpenMobile(false), [path, setOpenMobile]);
  return null;
}

const SETTINGS_KEYS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘,' : 'Ctrl+,';

/** The profile menu's theme line: not a menu item, so a pick keeps it open. */
function ThemeItem() {
  return (
    <div data-slot="theme-item" className="flex items-center gap-2 px-2 py-1 text-sm">
      <SunMoonIcon className="size-4 text-muted-foreground" />
      <span className="flex-1">Theme</span>
      <ThemeToggle compact />
    </div>
  );
}

/** Who is signed in, for the profile button; null while loading or where nobody is. */
export interface ShellUser {
  email: string;
  /** The name shown, when there is one. */
  name: string | null;
}

/** `AL` from "Ada Lovelace", else the first two letters of the email. */
export function initials(who: ShellUser | null): string {
  if (!who) return '··';
  const parts = (who.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
  return who.email.slice(0, 2).toUpperCase();
}

/** What the profile button shows: the first name only, else the email's name. */
export function firstName(who: ShellUser | null): string {
  if (!who) return 'Signed in';
  return (who.name ?? '').trim().split(/\s+/)[0] || (who.email.split('@')[0] ?? who.email);
}

function NavUser({
  who,
  signOutUrl,
  onSettings,
  onLogs,
}: {
  who: ShellUser | null;
  signOutUrl?: string;
  onSettings: () => void;
  onLogs?: () => void;
}) {
  const { isMobile } = useSidebar();
  const person = (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg text-xs">{initials(who)}</AvatarFallback>
      </Avatar>
      <span className="flex-1 truncate text-left text-sm font-medium">{firstName(who)}</span>
    </>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip="Profile"
              aria-label="Profile"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {person}
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {who?.email ?? 'Signed in'}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onSettings}>
                <SettingsIcon />
                Settings
                <DropdownMenuShortcut>{SETTINGS_KEYS}</DropdownMenuShortcut>
              </DropdownMenuItem>
              {onLogs ? (
                <DropdownMenuItem onSelect={onLogs}>
                  <ScrollTextIcon />
                  Logs
                </DropdownMenuItem>
              ) : null}
              <ThemeItem />
            </DropdownMenuGroup>
            {signOutUrl && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={signOutUrl} data-sign-out>
                    <LogOutIcon />
                    Sign out
                  </a>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export interface LumenShellProps {
  /** The app's id: `data-app` on the root `<html>`, which picks its accent. */
  app: string;
  /** The app's name, heading its own Settings sections. */
  appLabel: string;
  /** The sidebar's top: the app's name, or a switcher between a product's apps. */
  brand: ReactNode;
  /** The app's sidebar content: `NavGroup`s and `SidebarSection`s. */
  nav: ReactNode;
  /** App-wide status bar items (health, freshness); pages add their own through `Page`. */
  status?: ReactNode;
  /** The services the app checks, as one `StatusHealth` chip at the status bar's end. */
  health?: ReactNode;
  /** Status bar items after `health` and What's new, before the time zone. */
  statusEnd?: ReactNode;
  /** Turns on What's new: the app's releases API (`GET ?limit=&before=` answering `{releases}`).
   *  The status bar shows the newest version, which opens each release's Key takeaways. */
  releases?: string;
  /** What's new's app chips: each app's label by id, matched to a takeaway's `apps`. */
  releaseApps?: Record<string, ReactNode>;
  /** The app's own Settings sections, listed after General and the product's. */
  settings?: SettingsSectionDef[];
  /** Sections every app of the product shows, listed after General under `sharedLabel`. */
  shared?: SettingsSectionDef[];
  sharedLabel?: string;
  /** Who is signed in (the profile button); null while it loads. */
  user?: ShellUser | null;
  /** Where Sign out goes; no Sign out without it. */
  signOutUrl?: string;
  /** Settings ▸ General ▸ Profile's content; no Profile section without it. */
  profile?: ReactNode;
  /** Settings ▸ General ▸ Security's content (LumenSignInMethods); no Security section without it. */
  security?: ReactNode;
  /** Reloads the page's data and drops every cached read (TanStack Query `invalidateQueries`);
   *  shows Refresh in the header, which then mounts the page again. */
  onRefresh?: () => Promise<unknown>;
  /** Shows Hide amounts (eye) in the header: masks the fields and values the app marks `amount`. */
  hideAmounts?: boolean;
  /** Opens the app's Logs page; shows Logs in the profile menu. */
  onLogs?: () => void;
  /** The product's buttons on every page header, after Refresh (the product's Tasks and the assistant). */
  headerActions?: ReactNode;
  /** A panel docked right of the page (the product's assistant). */
  panel?: ReactNode;
  /** How ⌘K Find reads in this app: its chips and how the nav's pages group. */
  finder?: LumenFinderConfig;
  /** Wraps the frame in the product's providers, inside the shell so they can call `useShell`. */
  wrap?: (frame: ReactNode) => ReactNode;
  /** The routed page (usually `<Outlet />`). */
  children: ReactNode;
}

// `?settings=<section>` opens Settings there (GitHub's install page returns to it). It is read when
// the page loads, before an app's router can redirect it away, and dropped from the URL so a reload
// does not reopen it.
const settingsFromUrl: string | null = (() => {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const at = url.searchParams.get('settings');
  if (at === null) return null;
  url.searchParams.delete('settings');
  window.history.replaceState(window.history.state, '', url);
  return at || 'profile';
})();

export function LumenShell({
  app,
  appLabel,
  brand,
  nav,
  status,
  health,
  statusEnd,
  releases,
  releaseApps,
  settings,
  shared,
  sharedLabel,
  user = null,
  signOutUrl,
  profile,
  security,
  onRefresh,
  hideAmounts = false,
  onLogs,
  headerActions = null,
  panel,
  finder,
  wrap = (frame) => frame,
  children,
}: LumenShellProps) {
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Refresh reloads the layout too: once the data is fresh the page mounts
  // again, so every card, tab and saved layout starts from what the server holds now.
  const [epoch, setEpoch] = useState(0);
  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await withRefreshToken(onRefresh);
    } finally {
      setRefreshing(false);
      setEpoch((e) => e + 1);
    }
  }, [onRefresh]);
  const [settingsAt, setSettingsAt] = useState<string | null>(settingsFromUrl);
  const [lastSection, setLastSection] = useState(settingsAt ?? 'profile');
  const openSettings = useCallback(
    (section?: string) => {
      const at = section ?? lastSection;
      setLastSection(at);
      setSettingsAt(at);
    },
    [lastSection],
  );
  useEffect(() => {
    document.documentElement.dataset.app = app;
  }, [app]);
  // Find lists every Settings section by name.
  const sectionNames = JSON.stringify(
    allSettings(profile, shared, settings, security).map((s) => ({ id: s.id, title: s.title })),
  );
  const findSettings = useMemo(
    () => JSON.parse(sectionNames) as { id: string; title: string }[],
    [sectionNames],
  );

  return (
    <Ctx.Provider
      value={{
        app,
        appLabel,
        statusSlot,
        openSettings,
        closeSettings: () => setSettingsAt(null),
        refresh: onRefresh ? refresh : null,
        refreshing,
        hideAmounts,
        headerActions,
      }}
    >
      <SourceHealthProvider>
        {wrap(
          <TooltipProvider delayDuration={200}>
            <SidebarProvider defaultOpen={sidebarOpen()}>
              <LumenFinder
                app={app}
                settings={findSettings}
                openSettings={openSettings}
                config={finder}
              >
                <CloseDrawerOnNavigate />
                <Sidebar collapsible="icon">
                  <SidebarHeader>{brand}</SidebarHeader>
                  <SidebarContent>{nav}</SidebarContent>
                  <SidebarFooter>
                    <NavUser
                      who={user}
                      signOutUrl={signOutUrl}
                      onSettings={() => openSettings()}
                      onLogs={onLogs}
                    />
                  </SidebarFooter>
                  <SidebarRail />
                </Sidebar>
                <SidebarInset className="flex min-h-svh min-w-0 flex-col">
                  <div key={epoch} className="flex min-w-0 flex-1 flex-col">
                    {children}
                  </div>
                  <footer
                    data-slot="shell-status"
                    aria-label="Status"
                    className="sticky bottom-0 z-10 flex h-(--shell-status-height) shrink-0 items-center gap-4 overflow-x-auto overflow-y-hidden border-t bg-background px-(--shell-gutter) text-xs whitespace-nowrap text-muted-foreground"
                  >
                    {status}
                    <div ref={setStatusSlot} className="flex shrink-0 items-center gap-4" />
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {health}
                      {releases && <WhatsNew api={releases} apps={releaseApps} />}
                      {statusEnd}
                      <StatusTimeZone />
                    </span>
                  </footer>
                </SidebarInset>
                {panel}
                <LumenSettings
                  open={settingsAt !== null}
                  section={settingsAt ?? lastSection}
                  onOpen={openSettings}
                  onClose={() => setSettingsAt(null)}
                  appLabel={appLabel}
                  profile={profile}
                  security={security}
                  sections={settings}
                  shared={shared}
                  sharedLabel={sharedLabel}
                />
                <Toaster position="bottom-right" />
              </LumenFinder>
            </SidebarProvider>
          </TooltipProvider>,
        )}
      </SourceHealthProvider>
    </Ctx.Provider>
  );
}

/** A status bar entry: an optional health dot, a label and a mono value. */
export function StatusItem({
  label,
  value,
  ok,
  className,
}: {
  label: ReactNode;
  value?: ReactNode;
  /** Green when true, red when false, grey while unknown; no dot when left out. */
  ok?: boolean | null;
  className?: string;
}) {
  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      {ok !== undefined && (
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            ok === null ? 'bg-muted-foreground/40' : ok ? 'bg-gain' : 'bg-destructive',
          )}
        />
      )}
      {label}
      {value !== undefined && (
        <>
          {' '}
          <span className="num text-foreground/80">{value}</span>
        </>
      )}
    </span>
  );
}
