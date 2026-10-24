// The app switcher (in Lumen for any product with more than one app): the
// sidebar's top shows the current app and opens a menu of the product's apps. LumenShell's `brand`
// takes it; the product passes the apps the person can open.
import { ChevronsUpDownIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from './ui/sidebar';

/** One app of the product. */
export interface LumenApp {
  id: string;
  /** Its plain name, for the collapsed sidebar's tooltip. */
  name: string;
  /** How its name is drawn (e.g. the app's accent, then a shared suffix); `name` when left out. */
  label?: ReactNode;
  icon: LucideIcon;
  href: string;
}

export function LumenAppSwitcher({
  current,
  apps,
  product,
  menuLabel = 'Apps',
}: {
  /** The app this page belongs to; it leads `apps` even when the menu leaves it out. */
  current: LumenApp;
  /** The apps the menu lists, in order. */
  apps: LumenApp[];
  /** The product's name under the app's. */
  product?: string;
  menuLabel?: string;
}) {
  const { isMobile } = useSidebar();
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
                <current.icon className="size-4" />
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
            className="min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {menuLabel}
            </DropdownMenuLabel>
            {apps.map((a) => (
              <DropdownMenuItem
                key={a.id}
                asChild
                className={cn('gap-2 p-2', a.id === current.id && 'bg-muted')}
              >
                <a href={a.href} aria-current={a.id === current.id ? 'page' : undefined}>
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <a.icon className="size-3.5 shrink-0" />
                  </div>
                  {a.label ?? a.name}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
