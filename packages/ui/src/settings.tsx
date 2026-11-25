// Settings: one large dialog, opened from the profile menu or Ctrl/Cmd+, with
// its sections listed on the left. General holds Profile (display name, email,
// sign out), Appearance (theme, font, text size, glass) and Preferences (time zone, observability
// details), the same on every app; then All apps (Notifications, the assistant, MCP), then the app's own
// sections (an app: Repos). On phone the list becomes a picker.
// A search box tops the list and filters the rows on every section.
// `?settings=<section>` in the URL opens it at that section (GitHub's install page returns there).
import {
  ChevronRightIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunIcon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useAssistantMoves } from './assistant-screen';
import { InfoTip } from './info-tip';
import { LumenSelector } from './lumen-selector';
import {
  FONTS,
  FONT_SIZES,
  type FontId,
  type FontSizeId,
  type Theme,
  setPref,
  usePrefs,
} from './prefs';
import {
  SettingField,
  type SettingHealth,
  SettingStatus,
  SettingsSearch,
  settingMatches as matches,
  sectionHealth,
} from './setting-parts';
import { TimeZoneSelect } from './status';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar';
import { Switch } from './ui/switch';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const THEMES: { value: Theme; label: string; short: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light theme', short: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark theme', short: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'Follow the device', short: 'System', icon: MonitorIcon },
];

/** A section an app adds to Settings, listed under the app's name. */
export interface SettingsSectionDef {
  id: string;
  title: string;
  icon: typeof SunIcon;
  description?: ReactNode;
  content: ReactNode;
  /** Listed indented under the section before it (the assistant ▸ Model providers). */
  sub?: boolean;
  /** What the section's footer holds (a status line, Revert and Save). The footer is pinned under
   *  every section, empty when it has nothing; `SettingsFooter` fills it too. */
  footer?: ReactNode;
  /** The section's state from its things (`sectionHealth`): a pill by the title, a dot in the list. */
  health?: SettingHealth | null;
  /** What hovering the section's pill says (which thing failed). */
  healthTitle?: string;
}

/** A labelled group of sections in Settings: one per app when a product shows several apps' settings together. */
export interface SettingsGroupDef {
  label: string;
  sections: SettingsSectionDef[];
}

/** The Settings search text; rows that do not match it hide. */

/** The open section's header slot for its actions (Add and Resync sit by the
 *  title, not on a sub-header). Each section gets its own, so search results keep theirs apart. */
const ActionsSlot = createContext<HTMLElement | null>(null);

/** Renders its children in the section header, right of the title. */
export function SettingsActions({ children }: { children: ReactNode }) {
  const el = useContext(ActionsSlot);
  return el ? createPortal(children, el) : null;
}

/** The open section's footer slot, pinned under its body. */
const FooterSlot = createContext<HTMLElement | null>(null);

/** Renders its children in the open section's footer, from anywhere in the section's content. */
export function SettingsFooter({ children }: { children: ReactNode }) {
  const el = useContext(FooterSlot);
  return el ? createPortal(children, el) : null;
}

function ActionsScope({
  children,
}: {
  children: (
    slot: (el: HTMLDivElement | null) => void,
    footer: (el: HTMLDivElement | null) => void,
  ) => ReactNode;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [foot, setFoot] = useState<HTMLDivElement | null>(null);
  return (
    <ActionsSlot.Provider value={el}>
      <FooterSlot.Provider value={foot}>{children(setEl, setFoot)}</FooterSlot.Provider>
    </ActionsSlot.Provider>
  );
}

/**
 * One setting: the kit's `SettingField` (docs/parts/settings.md), with `description` behind its (i).
 * Kept so older call sites build; it draws nothing of its own. New code uses `SettingField`.
 * @deprecated Use `SettingField`.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <SettingField label={label} info={description} htmlFor={htmlFor}>
      {children}
    </SettingField>
  );
}

/** Light, dark or system: in Settings with labels, in the profile menu as icons with tooltips. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const prefs = usePrefs();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={prefs.theme}
      onValueChange={(v) => v && setPref('theme', v as Theme)}
      aria-label="Theme"
    >
      {THEMES.map((t) =>
        compact ? (
          <Tooltip key={t.value}>
            <TooltipTrigger asChild>
              <ToggleGroupItem value={t.value} aria-label={t.label}>
                <t.icon />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{t.short}</TooltipContent>
          </Tooltip>
        ) : (
          <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label}>
            <t.icon />
            {t.short}
          </ToggleGroupItem>
        ),
      )}
    </ToggleGroup>
  );
}

function Appearance() {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col">
      <SettingRow label="Theme">
        <ThemeToggle />
      </SettingRow>
      <SettingRow label="Font">
        <LumenSelector
          label="Font"
          size="sm"
          className="w-40"
          options={FONTS.map((f) => ({ value: f.id, label: f.label }))}
          value={prefs.font}
          onChange={(v) => setPref('font', v as FontId)}
        />
      </SettingRow>
      <SettingRow label="Text size">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={prefs.fontSize}
          onValueChange={(v) => v && setPref('fontSize', v as FontSizeId)}
          aria-label="Text size"
        >
          {FONT_SIZES.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} aria-label={`${f.label} text`}>
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
      <SettingRow label="Glass surfaces" htmlFor="settings-glass">
        <Switch
          id="settings-glass"
          checked={prefs.glass}
          onCheckedChange={(v) => setPref('glass', v)}
        />
      </SettingRow>
    </div>
  );
}

function Preferences({
  extra,
  observability = true,
}: { extra?: ReactNode; observability?: boolean }) {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col">
      <SettingRow label="Time zone">
        <TimeZoneSelect />
      </SettingRow>
      {observability && (
        <SettingRow label="Observability details" htmlFor="settings-observability">
          <Switch
            id="settings-observability"
            checked={prefs.observability}
            onCheckedChange={(v) => setPref('observability', v)}
          />
        </SettingRow>
      )}
      {extra}
    </div>
  );
}

/** General: the person's own settings, the same on every app. */
const PROFILE: Omit<SettingsSectionDef, 'content'> = {
  id: 'profile',
  title: 'Profile',
  icon: UserRoundIcon,
};
const SECURITY: Omit<SettingsSectionDef, 'content'> = {
  id: 'security',
  title: 'Security',
  icon: ShieldCheckIcon,
};
const general = (preferences?: ReactNode, observability?: boolean): SettingsSectionDef[] => [
  {
    id: 'appearance',
    title: 'Appearance',
    icon: PaletteIcon,
    content: <Appearance />,
  },
  {
    id: 'preferences',
    title: 'Preferences',
    icon: SlidersHorizontalIcon,
    content: <Preferences extra={preferences} observability={observability} />,
  },
];

function generalSettings(
  profile: ReactNode | undefined,
  security?: ReactNode,
  preferences?: ReactNode,
  observability?: boolean,
): SettingsSectionDef[] {
  return [
    ...(profile ? [{ ...PROFILE, content: profile }] : []),
    ...(security ? [{ ...SECURITY, content: security }] : []),
    ...general(preferences, observability),
  ];
}

/** Every Settings section in the order the dialog lists them: General, the product's, the groups', the app's. */
export function allSettings(
  profile: ReactNode | undefined,
  shared: SettingsSectionDef[] = [],
  sections: SettingsSectionDef[] = [],
  security?: ReactNode,
  groups: SettingsGroupDef[] = [],
  preferences?: ReactNode,
): SettingsSectionDef[] {
  return [
    ...generalSettings(profile, security, preferences),
    ...shared,
    ...groups.flatMap((g) => g.sections),
    ...sections,
  ];
}

/** The group parent of a section: itself when sections follow it as `sub`, the section before
 *  its run of `sub` sections when it is one, else null. */
function navParent(lists: SettingsSectionDef[][], id: string): string | null {
  const list = lists.find((l) => l.some((s) => s.id === id)) ?? [];
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return null;
  if (!list[i]?.sub) return list[i + 1]?.sub ? id : null;
  for (let j = i - 1; j >= 0; j--) if (!list[j]?.sub) return list[j]?.id ?? null;
  return null;
}

/** One nav group's rows: plain sections, and each section with `sub` sections after it as a
 *  folding group (WAI disclosure: the label opens the section, the chevron only folds). */
function SettingsNavRows({
  items,
  all,
  activeId,
  searching,
  unfolded,
  onUnfold,
  onGo,
}: {
  /** The sections shown (all, or the search's matches). */
  items: SettingsSectionDef[];
  /** Every section of the group, so a matching sub section keeps its parent above it. */
  all: SettingsSectionDef[];
  activeId: string | null;
  searching: boolean;
  unfolded: ReadonlySet<string>;
  onUnfold: (id: string, on: boolean) => void;
  onGo: (id: string) => void;
}) {
  const shown = new Set(items.map((s) => s.id));
  const runs: { head: SettingsSectionDef; subs: SettingsSectionDef[] }[] = [];
  for (const s of all) {
    const last = runs[runs.length - 1];
    if (s.sub && last) last.subs.push(s);
    else runs.push({ head: s, subs: [] });
  }
  const row = (
    s: SettingsSectionDef,
    o: { active: boolean; sub?: boolean; health?: SettingHealth | null; healthTitle?: string },
  ) => (
    <SidebarMenuButton
      isActive={o.active}
      className={o.sub ? 'pl-7' : undefined}
      title={s.title}
      onClick={() => onGo(s.id)}
    >
      <s.icon />
      <span>{s.title}</span>
      {o.health && o.health !== 'off' && (
        <SettingStatus health={o.health} title={o.healthTitle} dot />
      )}
    </SidebarMenuButton>
  );
  return runs.map(({ head, subs }) => {
    const subsShown = subs.filter((s) => shown.has(s.id));
    if (!shown.has(head.id) && !subsShown.length) return null;
    if (!subs.length)
      return (
        <SidebarMenuItem key={head.id}>
          {row(head, {
            active: head.id === activeId,
            health: head.health,
            healthTitle: head.healthTitle,
          })}
        </SidebarMenuItem>
      );
    const open = searching || unfolded.has(head.id);
    const childActive = subs.some((s) => s.id === activeId);
    // Folded, the parent carries a problem of its sections (failed, then not tested), never
    // their green: all fine shows only its own dot. It stands in for an open section too.
    const own = head.health ?? null;
    const problem = open
      ? undefined
      : (['failed', 'untested'] as const).find((h) => subs.some((s) => s.health === h));
    const worst =
      problem && sectionHealth([own ?? 'off', problem]) === problem && problem !== own
        ? problem
        : own;
    const blame = worst !== own ? subs.find((s) => s.health === worst) : undefined;
    const contentId = `settings-nav-${head.id}`;
    return (
      <Collapsible key={head.id} asChild open={open} onOpenChange={(o) => onUnfold(head.id, o)}>
        <SidebarMenuItem>
          {row(head, {
            active: head.id === activeId || (!open && childActive),
            health: worst,
            healthTitle: blame
              ? `${blame.title}${blame.healthTitle ? `: ${blame.healthTitle}` : ''}`
              : head.healthTitle,
          })}
          {!searching && (
            <CollapsibleTrigger asChild>
              <SidebarMenuAction
                data-slot="settings-nav-fold"
                aria-controls={contentId}
                aria-label={`${open ? 'Hide' : 'Show'} ${head.title} pages`}
                title={`${open ? 'Hide' : 'Show'} ${head.title} pages`}
                className="top-1 size-6 w-6 text-muted-foreground [&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-90"
              >
                <ChevronRightIcon />
              </SidebarMenuAction>
            </CollapsibleTrigger>
          )}
          <CollapsibleContent id={contentId}>
            <SidebarMenu>
              {subsShown.map((s) => (
                <SidebarMenuItem key={s.id}>
                  {row(s, {
                    active: s.id === activeId,
                    sub: true,
                    health: s.health,
                    healthTitle: s.healthTitle,
                  })}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  });
}

export function LumenSettings({
  open,
  section,
  onOpen,
  onClose,
  appLabel,
  profile,
  security,
  sections = [],
  shared = [],
  sharedLabel = 'All apps',
  groups = [],
  preferences,
  observability = true,
}: {
  open: boolean;
  /** The section shown; unknown ids show Profile. */
  section: string;
  onOpen: (section: string) => void;
  onClose: () => void;
  /** The app's name, heading its own sections. */
  appLabel: string;
  /** Profile's content, the first General section; none without it. */
  profile?: ReactNode;
  /** Security's content, after Profile (LumenSignInMethods); none without it. */
  security?: ReactNode;
  sections?: SettingsSectionDef[];
  /** Sections the product adds to every app (the assistant), listed under `sharedLabel` after General. */
  shared?: SettingsSectionDef[];
  sharedLabel?: string;
  /** More labelled groups (one per app), listed after the shared ones and before the app's own. */
  groups?: SettingsGroupDef[];
  /** The app's own rows (`SettingField`s), added under General ▸ Preferences after the kit's,
   *  for a per-device choice that belongs with the rest rather than in a section of its own. */
  preferences?: ReactNode;
  /** Shows Preferences ▸ Observability details (each view's load time); an app hides it from
   *  people who don't need it, such as everyone but its admins. */
  observability?: boolean;
}) {
  const all = allSettings(profile, shared, sections, security, groups, preferences);
  const general = generalSettings(profile, security, preferences, observability);
  const current = all.find((s) => s.id === section) ?? (all[0] as SettingsSectionDef);
  // The assistant opens Settings at a section (it never changes a setting); Undo puts it back as it was.
  useAssistantMoves('settings', {
    settings: onOpen,
    sections: all.map((s) => ({ id: s.id, title: s.title })),
    snapshot: () => (open ? section : null),
    restore: (s) => (typeof s === 'string' ? onOpen(s) : onClose()),
  });

  // Ctrl/Cmd+, opens Settings, like most apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpen(section);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen, section]);

  // Search: every section's matching rows show at once; a section matching by
  // title or description shows whole. Sections with nothing to show drop out of the nav.
  const [query, setQuery] = useState('');
  const q = query.trim();
  const pane = useRef<HTMLElement>(null);
  const [found, setFound] = useState<string[]>([]);
  useLayoutEffect(() => {
    if (!q) return;
    const ids = [...(pane.current?.querySelectorAll<HTMLElement>('[data-settings-section]') ?? [])]
      .filter((el) => el.dataset.whole === 'true' || el.querySelector('[data-slot=setting-field]'))
      .map((el) => el.dataset.settingsSection ?? '');
    setFound((f) => (f.join() === ids.join() ? f : ids));
  });
  // A long nav scrolls; keep the open section's row in view (Settings can open at one far down).
  const navList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() =>
      navList.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(id);
  }, [open]);
  // A section with `sub` sections after it is a group in the nav, folded until it is opened by
  // its chevron or holds the open section. Kept while the app runs; a reload folds them again.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const unfold = (id: string, on: boolean) =>
    setUnfolded((u) => {
      if (u.has(id) === on) return u;
      const next = new Set(u);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  // Opening a section any way (a click, a link, the assistant) unfolds the group that holds it,
  // even when it was folded while one of its sections stayed open.
  const navLists = [general, shared, ...groups.map((g) => g.sections), sections];
  const sectionsNow = useRef(navLists);
  sectionsNow.current = navLists;
  useEffect(() => {
    const parent = navParent(sectionsNow.current, current.id);
    if (parent) setUnfolded((u) => (u.has(parent) ? u : new Set(u).add(parent)));
  }, [current.id]);
  const shown = (s: SettingsSectionDef) => !q || found.includes(s.id);
  const go = (id: string) => {
    setQuery('');
    const parent = navParent(navLists, id);
    if (parent) unfold(parent, true);
    onOpen(id);
  };

  const navGroups = [
    { label: 'General', all: general },
    { label: sharedLabel, all: shared },
    ...groups.map((g) => ({ label: g.label, all: g.sections })),
    ...(sections.length ? [{ label: appLabel, all: sections }] : []),
  ]
    .map((g) => ({ ...g, items: g.all.filter(shown) }))
    .filter((g) => g.items.length);

  const search = (
    <InputGroup className="bg-background">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        className="[&::-webkit-search-cancel-button]:hidden"
        aria-label="Search settings"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery('')}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );

  const header = (s: SettingsSectionDef, slot: (el: HTMLDivElement | null) => void) => (
    // Title, then its description beside it on one line ("Billing | Stripe keys and checkout"),
    // both centred on the same middle line (never baseline: the title row holds an icon, so its
    // baseline sits low and the description drops). On a phone the description goes under the
    // title. Actions sit at the right.
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <h3
          id={`settings-${s.id}-title`}
          className="flex shrink-0 items-center gap-2 text-base font-semibold"
        >
          <s.icon className="size-4 text-muted-foreground" />
          {s.title}
          {s.health && <SettingStatus health={s.health} title={s.healthTitle} />}
        </h3>
        {/* One line, never wrapped; scripts/check-settings-copy.sh keeps it short. */}
        {s.description && (
          <p
            className="min-w-0 truncate text-sm text-muted-foreground sm:border-l sm:pl-3"
            title={typeof s.description === 'string' ? s.description : undefined}
          >
            {s.description}
          </p>
        )}
      </div>
      <div ref={slot} className="flex shrink-0 items-center gap-2 empty:hidden" />
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) onOpen(section);
        else {
          setQuery('');
          onClose();
        }
      }}
    >
      <DialogContent
        data-slot="settings"
        // Esc clears the search first, then closes.
        onEscapeKeyDown={(e) => {
          if (query) {
            e.preventDefault();
            setQuery('');
          }
        }}
        className="flex h-[min(720px,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl md:flex-row"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Your preferences and this desk's settings.
        </DialogDescription>
        <nav
          aria-label="Settings sections"
          className="hidden min-h-0 w-56 shrink-0 flex-col border-r bg-sidebar pt-2 md:flex"
        >
          <div className="shrink-0 px-2 pt-1 pb-1">{search}</div>
          <div
            ref={navList}
            data-slot="settings-nav-list"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-2 *:shrink-0"
          >
            {navGroups.map((g) => (
              <SidebarGroup key={g.label} className="py-1">
                <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SettingsNavRows
                      items={g.items}
                      all={g.all}
                      activeId={q ? null : current.id}
                      searching={!!q}
                      unfolded={unfolded}
                      onUnfold={unfold}
                      onGo={go}
                    />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </div>
        </nav>
        <div className="flex flex-col gap-2 border-b p-3 pr-12 md:hidden">
          {search}
          {!q && (
            <LumenSelector
              label="Settings section"
              className="w-full"
              groups={navGroups.map((g) => ({
                label: g.label,
                options: g.items.map((s) => ({
                  value: s.id,
                  label: s.title,
                  icon: s.icon,
                  indent: !!s.sub,
                })),
              }))}
              value={current.id}
              onChange={go}
            />
          )}
        </div>
        {q ? (
          <section
            ref={pane}
            aria-label="Search results"
            // The top band on desktop keeps results clear of the dialog's X.
            className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-4 pb-8 md:mt-12 md:border-t md:px-6 md:pt-6"
          >
            {all.map((s) => {
              const whole = matches(q, s.title, s.description);
              return (
                <ActionsScope key={s.id}>
                  {(slot) => (
                    <div
                      data-settings-section={s.id}
                      data-whole={whole}
                      aria-labelledby={`settings-${s.id}-title`}
                      className={
                        whole
                          ? 'flex flex-col gap-3'
                          : 'hidden flex-col gap-3 has-[[data-slot=setting-field]]:flex'
                      }
                    >
                      {header(s, slot)}
                      <Separator />
                      <SettingsSearch.Provider value={whole ? '' : q}>
                        {s.content}
                      </SettingsSearch.Provider>
                    </div>
                  )}
                </ActionsScope>
              );
            })}
            {!found.length && (
              <p className="text-sm text-muted-foreground">No settings match “{q}”.</p>
            )}
          </section>
        ) : (
          <ActionsScope key={current.id}>
            {(slot, footer) => (
              <section
                aria-labelledby={`settings-${current.id}-title`}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {/* Header stays put; only the body scrolls, so content never runs under the X. */}
                <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 md:px-6 md:pt-6">
                  {header(current, slot)}
                  <Separator />
                </div>
                {/* Children keep their height (`*:shrink-0`): a flex child that clips (a bordered table)
                would shrink to fit and cut its rows off instead of letting the body scroll. */}
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4 *:shrink-0 md:px-6 [&:has(+[data-slot=settings-footer]:empty)]:end-fade">
                  {current.content}
                </div>
                {/* Pinned under the body while it holds something; empty, it is gone and the body fades out. */}
                <div
                  ref={footer}
                  data-slot="settings-footer"
                  className="flex min-h-12 shrink-0 items-center justify-end gap-2 border-t px-4 py-2 empty:hidden md:px-6"
                >
                  {current.footer}
                </div>
              </section>
            )}
          </ActionsScope>
        )}
      </DialogContent>
    </Dialog>
  );
}
