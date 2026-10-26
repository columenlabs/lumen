// Settings: one large dialog, opened from the profile menu or Ctrl/Cmd+, with
// its sections listed on the left. General holds Profile (display name, email,
// sign out), Appearance (theme, font, text size, glass) and Preferences (time zone, observability
// details), the same on every app; then All apps (Notifications, the assistant, MCP), then the app's own
// sections (an app: Repos). On phone the list becomes a picker.
// A search box tops the list and filters the rows on every section.
// `?settings=<section>` in the URL opens it at that section (GitHub's install page returns there).
import {
  LogOutIcon,
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
import { toast } from 'sonner';
import { useAssistantMoves } from './assistant-screen';
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
import { TimeZoneSelect } from './status';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
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
}

/** A labelled group of sections in Settings: one per app when a product shows several apps' settings together. */
export interface SettingsGroupDef {
  label: string;
  sections: SettingsSectionDef[];
}

/** The Settings search text; rows that do not match it hide. */
const SearchContext = createContext('');
const matches = (query: string, ...texts: ReactNode[]) =>
  texts.some((t) => typeof t === 'string' && t.toLowerCase().includes(query.toLowerCase()));

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

/** One setting: title and description on the left, its control on the right. */
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
  const query = useContext(SearchContext);
  if (query && !matches(query, label, description)) return null;
  return (
    <div data-slot="setting-row" className="flex items-center gap-4 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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
      <SettingRow label="Theme" description="Light, dark, or follow the device.">
        <ThemeToggle />
      </SettingRow>
      <SettingRow label="Font" description="The typeface for text. Numbers keep their own.">
        <LumenSelector
          label="Font"
          size="sm"
          className="w-40"
          options={FONTS.map((f) => ({ value: f.id, label: f.label }))}
          value={prefs.font}
          onChange={(v) => setPref('font', v as FontId)}
        />
      </SettingRow>
      <SettingRow label="Text size" description="Larger text makes everything a little roomier.">
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
      <SettingRow
        label="Glass surfaces"
        description="Frosted cards and panels."
        htmlFor="settings-glass"
      >
        <Switch
          id="settings-glass"
          checked={prefs.glass}
          onCheckedChange={(v) => setPref('glass', v)}
        />
      </SettingRow>
    </div>
  );
}

function Preferences() {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col">
      <SettingRow label="Time zone" description="Every time on every desk shows in this zone.">
        <TimeZoneSelect />
      </SettingRow>
      <SettingRow
        label="Observability details"
        description="Show how long each card and view took to load, with its rows and when."
        htmlFor="settings-observability"
      >
        <Switch
          id="settings-observability"
          checked={prefs.observability}
          onCheckedChange={(v) => setPref('observability', v)}
        />
      </SettingRow>
    </div>
  );
}

/** General: the person's own settings, the same on every app. */
const PROFILE: Omit<SettingsSectionDef, 'content'> = {
  id: 'profile',
  title: 'Profile',
  icon: UserRoundIcon,
  description: 'Your name and sign-in on every desk.',
};
const SECURITY: Omit<SettingsSectionDef, 'content'> = {
  id: 'security',
  title: 'Security',
  icon: ShieldCheckIcon,
  description: 'How you sign in. Changes ask you to confirm it’s you.',
};
const GENERAL: SettingsSectionDef[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    icon: PaletteIcon,
    description: 'How every desk looks, saved in this browser.',
    content: <Appearance />,
  },
  {
    id: 'preferences',
    title: 'Preferences',
    icon: SlidersHorizontalIcon,
    description: 'Times and details on every desk, saved in this browser.',
    content: <Preferences />,
  },
];

function generalSettings(
  profile: ReactNode | undefined,
  security?: ReactNode,
): SettingsSectionDef[] {
  return [
    ...(profile ? [{ ...PROFILE, content: profile }] : []),
    ...(security ? [{ ...SECURITY, content: security }] : []),
    ...GENERAL,
  ];
}

/** Every Settings section in the order the dialog lists them: General, the product's, the groups', the app's. */
export function allSettings(
  profile: ReactNode | undefined,
  shared: SettingsSectionDef[] = [],
  sections: SettingsSectionDef[] = [],
  security?: ReactNode,
  groups: SettingsGroupDef[] = [],
): SettingsSectionDef[] {
  return [
    ...generalSettings(profile, security),
    ...shared,
    ...groups.flatMap((g) => g.sections),
    ...sections,
  ];
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
}) {
  const all = allSettings(profile, shared, sections, security, groups);
  const general = generalSettings(profile, security);
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
      .filter((el) => el.dataset.whole === 'true' || el.querySelector('[data-slot=setting-row]'))
      .map((el) => el.dataset.settingsSection ?? '');
    setFound((f) => (f.join() === ids.join() ? f : ids));
  });
  const shown = (s: SettingsSectionDef) => !q || found.includes(s.id);
  const go = (id: string) => {
    setQuery('');
    onOpen(id);
  };

  const navGroups = [
    { label: 'General', items: general.filter(shown) },
    { label: sharedLabel, items: shared.filter(shown) },
    ...groups.map((g) => ({ label: g.label, items: g.sections.filter(shown) })),
    ...(sections.length ? [{ label: appLabel, items: sections.filter(shown) }] : []),
  ].filter((g) => g.items.length);

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
    // Actions sit at the bottom right, in line with the description.
    <div className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3
          id={`settings-${s.id}-title`}
          className="flex items-center gap-2 text-base font-semibold"
        >
          <s.icon className="size-4 text-muted-foreground" />
          {s.title}
        </h3>
        {/* One line, never wrapped; scripts/check-settings-copy.sh keeps it short. */}
        {s.description && (
          <p
            className="truncate text-sm text-muted-foreground"
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
          className="hidden w-56 shrink-0 flex-col border-r bg-sidebar py-2 md:flex"
        >
          <div className="px-2 pt-1 pb-1">{search}</div>
          {navGroups.map((g) => (
            <SidebarGroup key={g.label} className="py-1">
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((s) => (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton
                        isActive={!q && s.id === current.id}
                        className={s.sub ? 'pl-7' : undefined}
                        onClick={() => go(s.id)}
                      >
                        <s.icon />
                        <span>{s.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
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
                          : 'hidden flex-col gap-3 has-[[data-slot=setting-row]]:flex'
                      }
                    >
                      {header(s, slot)}
                      <Separator />
                      <SearchContext.Provider value={whole ? '' : q}>
                        {s.content}
                      </SearchContext.Provider>
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
