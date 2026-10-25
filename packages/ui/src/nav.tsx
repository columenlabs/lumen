// Sidebar building blocks an app composes its nav from (shadcn NavMain pattern): a group of links
// that may nest one level (chevron on the right, hidden in icon mode), and a section whose items a
// person adds with `+` and removes with the trash icon. Every item carries an icon; section headers are bold caps without one.
// A section header folds its items: it lights up on hover with a chevron after
// the name, a click folds it, the fold is remembered in the browser, and `+` never folds.
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';
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

/**
 * How well a link matches where the person is: -1 when it doesn't, else higher for a closer
 * match. A link's query (`/resources?label=a`) must be in the URL too, and each matched key
 * outranks a bare path, so `?label=a` beats `/resources` on `/resources?label=a`.
 */
function useMatch() {
  const { path, search } = useRouterState({
    select: (s) => ({ path: s.location.pathname, search: s.location.searchStr }),
  });
  const here = new URLSearchParams(search);
  return ({ to, exact }: { to: string; exact?: boolean }) => {
    const [base = '', query] = to.split('?');
    const want = new URLSearchParams(query);
    for (const [k, v] of want) if (here.get(k) !== v) return -1;
    const keys = [...want.keys()].length;
    if (path === base) return 2 + keys * 10;
    if (!exact && path.startsWith(`${base.replace(/\/$/, '')}/`)) return 1 + keys * 10;
    return -1;
  };
}

function useActive() {
  const match = useMatch();
  return (i: { to: string; exact?: boolean }) => match(i) >= 0;
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
  /** Its icon, drawn in `color` (a label's icon in the label's colour). */
  icon?: NavIcon;
  /** The icon's colour; without an icon, a colour dot before the title (a chart line's colour). */
  color?: string;
  /** A count on the right, lined up with the section items' badges. */
  badge?: ReactNode;
}

const SECTION_BADGE = 'num group-data-[collapsible=icon]:hidden';

/** One section item: a link, its badge, and the chevron and nested items when it has any. */
function SectionRow({
  item,
  activeId,
  onRemove,
  removeLabel,
}: {
  item: SectionItem;
  /** The one row in the section that is selected: `item.id`, or `item.id/sub.id`. */
  activeId: string | null;
  onRemove?: (item: SectionItem) => void;
  removeLabel: (item: SectionItem) => string;
}) {
  const subs = item.items ?? [];
  const subActive = activeId?.startsWith(`${item.id}/`) ?? false;
  const isActive = activeId === item.id;
  // The open item shows no trash icon.
  const remove = item.fixed || isActive ? undefined : onRemove;
  const [open, setOpen] = useState(Boolean(item.defaultOpen || subActive || isActive));
  const row = (
    <>
      <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
        {/* Clicking an item with nested items opens them too, not only the chevron; clicking the
            item already showing folds them away again. */}
        <Link
          to={item.to}
          onClick={subs.length ? () => setOpen((o) => (isActive ? !o : true)) : undefined}
        >
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge !== undefined && item.badge !== null && (
        <SidebarMenuBadge
          className={cn(
            SECTION_BADGE,
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
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        {row}
        {/* The chevron sits over the item's icon and shows only on hover or keyboard focus, so
            every badge in the section lines up at the right edge and an open item keeps its icon. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={`Show or hide ${item.title}`}
            className="right-auto left-1.5 bg-sidebar opacity-0 group-hover/menu-item:opacity-100 focus-visible:opacity-100 peer-data-[active=true]/menu-button:bg-sidebar-accent [&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-90"
          >
            <ChevronRightIcon />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {/* No right inset, so sub-item counts line up with the section items' counts. */}
          <SidebarMenuSub className="mr-0 pr-0">
            {subs.map((sub) => {
              const hasBadge = sub.badge !== undefined && sub.badge !== null;
              return (
                <SidebarMenuSubItem key={sub.id}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={activeId === `${item.id}/${sub.id}`}
                    className={cn(hasBadge && 'pr-8')}
                  >
                    <Link to={sub.to} title={sub.title}>
                      {sub.icon ? (
                        <span
                          aria-hidden
                          className="flex shrink-0 [&>svg]:size-4"
                          style={{ color: sub.color }}
                        >
                          <sub.icon />
                        </span>
                      ) : (
                        sub.color && (
                          <span
                            aria-hidden
                            className="mx-1 size-2 shrink-0 rounded-full"
                            style={{ background: sub.color }}
                          />
                        )
                      )}
                      <span>{sub.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                  {hasBadge && (
                    <span
                      className={cn(
                        'pointer-events-none absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center px-1 text-xs text-muted-foreground',
                        typeof sub.badge === 'number' && 'num',
                      )}
                    >
                      {sub.badge}
                    </span>
                  )}
                </SidebarMenuSubItem>
              );
            })}
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
  const match = useMatch();
  // One selected row per section: the closest match wins, the first on a tie, so two items that
  // open the same page never both look selected. An open parent is never selected for being open.
  let activeId: string | null = null;
  let best = -1;
  for (const i of items) {
    const own = match({ to: i.to, exact: true });
    if (own > best) [best, activeId] = [own, i.id];
    for (const sub of i.items ?? []) {
      const m = match({ to: sub.to, exact: true });
      if (m > best) [best, activeId] = [m, `${i.id}/${sub.id}`];
    }
  }
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
                  activeId={activeId}
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
