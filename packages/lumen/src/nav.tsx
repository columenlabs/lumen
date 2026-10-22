// Sidebar building blocks an app composes its nav from (shadcn NavMain pattern): a group of links
// that may nest one level (chevron on the right, hidden in icon mode), and a section whose items a
// person adds with `+` and removes with the trash icon. Every item carries an icon; section headers are bold caps without one.
// A section header folds its items: it lights up on hover with a chevron after
// the name, a click folds it, the fold is remembered in the browser, and `+` never folds.
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { type AssistantPageType, useAssistantPages } from './assistant-screen';
import { LumenConfirm } from './confirm';
import { useFolded } from './fold';
import { cn } from './lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from './ui/sidebar';

/** A nav icon: a lucide icon, or a view's emoji drawn at icon size. */
export type NavIcon = ComponentType<{ className?: string }>;

export interface NavItem {
  title: string;
  to: string;
  icon: NavIcon;
  badge?: ReactNode;
  /** Active only on this exact path, not its children. */
  exact?: boolean;
  /** One nested level, shown under a collapsible parent. */
  items?: Omit<NavItem, 'items'>[];
}

function useActive() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return ({ to, exact }: { to: string; exact?: boolean }) =>
    path === to || (!exact && path.startsWith(`${to.replace(/\/$/, '')}/`));
}

/**
 * A sidebar group whose header folds its items: bold caps, no icon. At rest
 * it looks as before; hovered, it lights up and a chevron shows after the name, which stays while
 * folded (and always on touch screens). Icons-only sidebars show every item.
 */
export function FoldGroup({
  label,
  action,
  children,
}: {
  label?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [folded, setFolded] = useFolded(`nav:${label ?? ''}`);
  const { state, isMobile } = useSidebar();
  if (!label) return <SidebarGroup>{children}</SidebarGroup>;
  const icons = state === 'collapsed' && !isMobile;
  return (
    <Collapsible
      open={icons || !folded}
      onOpenChange={(open) => setFolded(!open)}
      className="group/fold"
    >
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="group/label w-full cursor-pointer gap-1 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <span className="truncate">{label}</span>
            <ChevronRightIcon
              aria-hidden
              className="text-muted-foreground opacity-0 transition-[opacity,transform] group-hover/label:opacity-100 group-focus-visible/label:opacity-100 group-data-[state=closed]/fold:opacity-100 group-data-[state=open]/fold:rotate-90 [@media(hover:none)]:opacity-100"
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent>{children}</CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function NavGroup({
  label,
  items,
  pageType,
}: {
  label?: string;
  items: NavItem[];
  /** What its pages stand for in the assistant's @ picker; plain pages by default. */
  pageType?: AssistantPageType;
}) {
  useAssistantPages(
    items.flatMap((i) => [i, ...(i.items ?? []).map((sub) => ({ ...sub, parent: i.title }))]),
    label,
    pageType,
  );
  const active = useActive();
  return (
    <FoldGroup label={label}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) =>
            item.items?.length ? (
              <Collapsible
                key={item.to}
                asChild
                defaultOpen={active(item) || item.items.some(active)}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title} isActive={active(item)}>
                      <item.icon />
                      <span>{item.title}</span>
                      <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[collapsible=icon]:hidden group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items.map((sub) => (
                        <SidebarMenuSubItem key={sub.to}>
                          <SidebarMenuSubButton asChild isActive={active(sub)}>
                            <Link to={sub.to}>
                              <sub.icon />
                              <span>{sub.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ) : (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild tooltip={item.title} isActive={active(item)}>
                  <Link to={item.to}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.badge !== undefined && item.badge !== null && (
                  <SidebarMenuBadge className={typeof item.badge === 'number' ? 'num' : undefined}>
                    {item.badge}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            ),
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </FoldGroup>
  );
}

export interface SectionItem {
  id: string;
  title: string;
  to: string;
  icon: NavIcon;
  /** A count or a value on the right (a % change); hidden while the remove icon shows. */
  badge?: ReactNode;
  /** One nested level, toggled by a chevron; the item itself still links. */
  items?: SectionSubItem[];
  /** Open the nested items on first render (they also open while one is active). */
  defaultOpen?: boolean;
  /** Not removable: no trash icon even when the section has `onRemove`. */
  fixed?: boolean;
  /** What it stands for in the assistant's @ picker, when not the section's `pageType`. */
  type?: AssistantPageType;
}

export interface SectionSubItem {
  id: string;
  title: string;
  to: string;
  /** A colour dot before the title, matching the item's line on a chart. */
  color?: string;
}

const SECTION_BADGE = 'num group-data-[collapsible=icon]:hidden';

/** One section item: a link, its badge, and the chevron and nested items when it has any. */
function SectionRow({
  item,
  active,
  onRemove,
  removeLabel,
}: {
  item: SectionItem;
  active: (i: { to: string; exact?: boolean }) => boolean;
  onRemove?: (item: SectionItem) => void;
  removeLabel: (item: SectionItem) => string;
}) {
  const subs = item.items ?? [];
  const subActive = subs.some((s) => active({ to: s.to, exact: true }));
  const isActive = active({ to: item.to, exact: true }) && !subActive;
  // The open item shows no trash icon.
  const remove = item.fixed || isActive ? undefined : onRemove;
  const row = (
    <>
      <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
        <Link to={item.to}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge !== undefined && item.badge !== null && (
        <SidebarMenuBadge
          className={cn(
            SECTION_BADGE,
            subs.length > 0 && 'right-7',
            // The remove icon shows on hover from md up, and always below it: make room there.
            remove &&
              'max-md:right-7 md:group-focus-within/menu-item:opacity-0 md:group-hover/menu-item:opacity-0',
          )}
        >
          {item.badge}
        </SidebarMenuBadge>
      )}
      {remove && (
        <LumenConfirm
          title={`${removeLabel(item)}?`}
          action="Remove"
          onConfirm={() => remove(item)}
        >
          <SidebarMenuAction
            showOnHover
            aria-label={removeLabel(item)}
            title={removeLabel(item)}
            // Muted while the row is hovered, red while the icon itself is.
            className="text-muted-foreground peer-hover/menu-button:text-muted-foreground hover:bg-transparent hover:text-destructive"
          >
            <Trash2Icon />
          </SidebarMenuAction>
        </LumenConfirm>
      )}
    </>
  );
  if (!subs.length) return <SidebarMenuItem>{row}</SidebarMenuItem>;
  return (
    <Collapsible
      asChild
      defaultOpen={item.defaultOpen || subActive || active(item)}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        {row}
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={`Show or hide ${item.title}`}
            className="data-[state=open]:rotate-90"
          >
            <ChevronRightIcon />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {subs.map((sub) => (
              <SidebarMenuSubItem key={sub.id}>
                <SidebarMenuSubButton asChild isActive={active({ to: sub.to, exact: true })}>
                  <Link to={sub.to}>
                    {sub.color && (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: sub.color }}
                      />
                    )}
                    <span>{sub.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/**
 * A section of things a person keeps (views, trades, a watchlist): `+` adds one, the
 * trash icon on hover removes one. An item may carry a badge and one nested level of links with
 * colour dots. The app supplies the items and both handlers.
 */
export function SidebarSection({
  label,
  items,
  onAdd,
  addLabel = `Add to ${label}`,
  onRemove,
  removeLabel = (item: SectionItem) => `Remove ${item.title}`,
  loading,
  empty,
  children,
  pageType,
  assistantSubType,
}: {
  label: string;
  items: SectionItem[];
  onAdd?: () => void;
  addLabel?: string;
  onRemove?: (item: SectionItem) => void;
  removeLabel?: (item: SectionItem) => string;
  loading?: boolean;
  /** Shown when there are no items. */
  empty?: ReactNode;
  /** Extra content under the items (a search box, a retry line). */
  children?: ReactNode;
  /** What its items stand for in the assistant's @ picker; plain pages by default. */
  pageType?: AssistantPageType;
  /** What its nested items stand for; plain pages by default. */
  assistantSubType?: AssistantPageType;
}) {
  useAssistantPages(
    items.flatMap((i) => [
      i,
      ...(i.items ?? []).map((sub) => ({
        ...sub,
        parent: i.title,
        type: assistantSubType ?? 'page',
      })),
    ]),
    label,
    pageType,
  );
  const active = useActive();
  return (
    <FoldGroup
      label={label}
      action={
        onAdd && (
          <SidebarGroupAction title={addLabel} aria-label={addLabel} onClick={onAdd}>
            <PlusIcon />
          </SidebarGroupAction>
        )
      }
    >
      <SidebarGroupContent>
        <SidebarMenu>
          {loading
            ? [0, 1].map((i) => (
                <SidebarMenuItem key={i}>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))
            : items.map((item) => (
                <SectionRow
                  key={item.id}
                  item={item}
                  active={active}
                  onRemove={onRemove}
                  removeLabel={removeLabel}
                />
              ))}
          {!loading && !items.length && empty && (
            <li className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              {empty}
            </li>
          )}
        </SidebarMenu>
        {children}
      </SidebarGroupContent>
    </FoldGroup>
  );
}
