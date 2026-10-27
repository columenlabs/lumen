// The app switcher (in Lumen for any product with more than one app): the
// sidebar's top shows the current app and opens a menu of the product's apps. LumenShell's `brand`
// takes it; the product passes the apps the person can open. Apps may sit in groups, and an app on
// another site (`external`) shows its host and an arrow, so a person can tell a page of this app from
// a separate one. `LumenSuiteSwitcher` reads the list from an address instead, for an app that
// joins a suite it doesn't run (the address is set per deployment; none, the menu lists only itself).
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRightIcon, ChevronsUpDownIcon } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { cn } from './lib/utils';
import type { NavIcon } from './nav';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from './ui/sidebar';
import { lucideIcon } from './view-icons';

/** One app of the product. */
export interface LumenApp {
  id: string;
  /** Its plain name, for the collapsed sidebar's tooltip. */
  name: string;
  /** How its name is drawn (e.g. the app's accent, then a shared suffix); `name` when left out. */
  label?: ReactNode;
  /** Its mark; `iconUrl`, then the name's first letter, when left out. */
  icon?: NavIcon;
  /** An image of its mark (another site's favicon). */
  iconUrl?: string;
  href: string;
  /** The heading it sits under; apps with none lead the menu under `menuLabel`. */
  group?: string;
  /** On another site: the menu shows its host and an arrow. */
  external?: boolean;
}

function AppMark({ app, className }: { app: LumenApp; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (app.icon) return <app.icon className={className} />;
  if (app.iconUrl && !broken)
    return (
      <img
        src={app.iconUrl}
        alt=""
        className={cn(className, 'object-contain')}
        onError={() => setBroken(true)}
      />
    );
  return (
    <span className="text-xs font-semibold leading-none">{app.name.slice(0, 1).toUpperCase()}</span>
  );
}

const hostOf = (href: string) => {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
};

export function LumenAppSwitcher({
  current,
  apps,
  product,
  menuLabel = 'Apps',
}: {
  /** The app this page belongs to; it leads `apps` even when the menu leaves it out. */
  current: LumenApp;
  /** The apps the menu lists, in order; a group shows where its first app is. */
  apps: LumenApp[];
  /** The product's name under the app's (or where it is, such as its host). */
  product?: string;
  menuLabel?: string;
}) {
  const { isMobile } = useSidebar();
  const groups: { label: string; apps: LumenApp[] }[] = [];
  for (const a of apps) {
    const label = a.group ?? menuLabel;
    const g = groups.find((x) => x.label === label);
    if (g) g.apps.push(a);
    else if (a.group) groups.push({ label, apps: [a] });
    else groups.unshift({ label, apps: [a] });
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={current.name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <AppMark app={current} className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{current.label ?? current.name}</span>
                {product && (
                  <span className="truncate text-xs text-muted-foreground">{product}</span>
                )}
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 max-w-96 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            {groups.map((g, i) => (
              <Fragment key={g.label}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {g.label}
                </DropdownMenuLabel>
                {g.apps.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    asChild
                    className={cn('gap-2 p-2', a.id === current.id && 'bg-muted')}
                  >
                    <a href={a.href} aria-current={a.id === current.id ? 'page' : undefined}>
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                        <AppMark app={a} className="size-3.5 shrink-0" />
                      </div>
                      <span className={cn('truncate', a.external && 'shrink-0')}>
                        {a.label ?? a.name}
                      </span>
                      {a.external && (
                        <>
                          <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                            {hostOf(a.href)}
                          </span>
                          <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        </>
                      )}
                    </a>
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** One app as a suite list gives it: `icon` is a lucide name, `url` an absolute address. */
export interface SuiteApp {
  id: string;
  name: string;
  url: string;
  icon?: string;
  iconUrl?: string;
  group?: string;
}

/** What a suite list address answers. */
export interface SuiteList {
  apps: SuiteApp[];
}

/** How far `url` matches this page: its host, then the longest path it starts. */
const matchLength = (url: string, here: URL) => {
  try {
    const u = new URL(url);
    if (u.host !== here.host) return -1;
    const path = u.pathname.replace(/\/$/, '');
    return path === '' || here.pathname === path || here.pathname.startsWith(`${path}/`)
      ? path.length
      : -1;
  } catch {
    return -1;
  }
};

/** The suite's apps as switcher apps; an app on another host is `external`. */
export function suiteApps(list: SuiteList, here: URL): LumenApp[] {
  return list.apps.map((a) => ({
    id: a.id,
    name: a.name,
    href: a.url,
    icon: a.icon ? lucideIcon(a.icon) : undefined,
    iconUrl: a.iconUrl,
    group: a.group,
    external: hostOf(a.url) !== here.host,
  }));
}

/**
 * The switcher of an app that joins a suite someone else runs: it reads the suite's apps from
 * `source` (sent with this browser's cookies, so the suite must allow this origin) and marks this
 * app in it. With no `source`, or when the list can't be read, the menu lists only `current`.
 */
export function LumenSuiteSwitcher({
  source,
  current,
  product,
  menuLabel,
}: {
  /** The suite list address (answers a `SuiteList`); none: no suite. */
  source?: string;
  /** This app; the list's entry for this page's address takes its place. */
  current: LumenApp;
  product?: string;
  menuLabel?: string;
}) {
  const list = useQuery({
    queryKey: ['lumen-suite', source],
    enabled: !!source,
    queryFn: async (): Promise<SuiteList> => {
      const res = await fetch(source as string, { credentials: 'include' });
      if (!res.ok) throw new Error(`suite list ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const here = new URL(location.href);
  const apps = list.data ? suiteApps(list.data, here) : [];
  // This page's entry is the one whose address it sits under (longest path wins); this app keeps its own mark.
  let best = -1;
  let mine: string | undefined;
  for (const a of list.data?.apps ?? []) {
    const n = matchLength(a.url, here);
    if (n > best) {
      best = n;
      mine = a.id;
    }
  }
  const shown = apps.map((a) =>
    a.id === mine ? { ...a, ...current, id: a.id, group: a.group, external: false } : a,
  );
  const me = shown.find((a) => a.id === mine) ?? current;
  return (
    <LumenAppSwitcher
      current={me}
      apps={shown.length ? shown : [current]}
      product={product ?? here.host}
      menuLabel={menuLabel}
    />
  );
}
