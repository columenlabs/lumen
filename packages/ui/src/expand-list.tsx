// A stack of rows that start collapsed and expand in place: one way to draw every setting that is a
// "thing" (a provider, a sign-in method, a channel) or a "list" (passkeys, devices, keys). Every row
// reads [icon with its health dot] Name, grey detail ... [switch] chevron. Two questions decide the
// rest: can it be turned on or off (`toggle`: a switch), and can it work or break (`health`: a dot on
// the icon). Counts and names go in `meta`. The body is `SettingField` rows or a list's items with
// its Add last; `actions` is its action bar (`SettingActions`). See docs/parts/settings.md.
import { ChevronRightIcon } from 'lucide-react';
import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import { cn } from './lib/utils';
import { type SettingHealth, SettingHealthDot, SettingIcon } from './setting-parts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Switch } from './ui/switch';

const ListCtx = createContext<{ open: string | null; set: (id: string | null) => void } | null>(
  null,
);

/** Rows that start collapsed; opening one closes the others. `defaultOpen` names a row open at first. */
export function LumenExpandList({
  defaultOpen = null,
  className,
  children,
}: {
  defaultOpen?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [open, set] = useState<string | null>(defaultOpen);
  const value = useMemo(() => ({ open, set }), [open]);
  return (
    <ListCtx.Provider value={value}>
      <div className={cn('grid grid-cols-1', className)}>{children}</div>
    </ListCtx.Provider>
  );
}

/**
 * One row that expands in place. Inside a LumenExpandList it opens by `id`; `open` and
 * `onOpenChange` make it controlled; alone it keeps its own state (`defaultOpen`).
 */
export function LumenExpandRow({
  id,
  name,
  meta,
  badge,
  status,
  health,
  healthTitle,
  toggle,
  actions,
  icon,
  end,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  children,
}: {
  id?: string;
  name: ReactNode;
  meta?: ReactNode;
  /** Old name for `status`. */
  badge?: ReactNode;
  /** Deprecated: give `health` instead. A pill drawn before the switch. */
  status?: ReactNode;
  /** Can it work or break? A dot on the icon: green working, red failed, a grey ring not checked
   *  yet. Leave it out (or null, 'off') when it is off, empty, or can't break. */
  health?: SettingHealth | null;
  /** Hover on the dot: when it was checked and what went wrong. */
  healthTitle?: string;
  /** Turns the whole thing on or off: a switch in the header, outside the expand button. */
  toggle?: {
    checked: boolean;
    onCheckedChange: (on: boolean) => void;
    label: string;
    disabled?: boolean;
  };
  /** The action bar under the rows (`SettingActions`). */
  actions?: ReactNode;
  /** A logo or icon before the name (`SettingIcon`). Left out, the row draws the name's first
   *  letter on a tile, so every name lines up and the health dot sits on an icon. */
  icon?: ReactNode;
  /** One quick action on the whole thing in the header where no switch fits (an `IconButton`:
   *  Sign out everywhere else), before the chevron. Adding to a list goes in its body, last. */
  end?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const list = useContext(ListCtx);
  const [own, setOwn] = useState(defaultOpen);
  const inList = list && id !== undefined;
  const open = openProp ?? (inList ? list.open === id : own);
  const change = (o: boolean) => {
    if (onOpenChange) onOpenChange(o);
    else if (inList) list.set(o ? id : null);
    else setOwn(o);
  };
  const label = typeof name === 'string' ? name : undefined;
  const dot = health && health !== 'off' ? health : null;
  return (
    <Collapsible open={open} onOpenChange={change} className="border-b last:border-b-0">
      <div className="flex w-full min-w-0 items-center gap-2 px-1 hover:bg-muted/50">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left">
            <span data-slot="expand-icon" className="relative flex shrink-0 items-center">
              {icon ?? <SettingIcon text={label} />}
              {dot && <SettingHealthDot health={dot} title={healthTitle} />}
            </span>
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="shrink-0 truncate font-medium" title={label}>
                {name}
              </span>
              {meta && (
                <span
                  className="min-w-0 truncate text-sm text-muted-foreground"
                  title={typeof meta === 'string' ? meta : undefined}
                >
                  {meta}
                </span>
              )}
            </span>
            {status ?? badge}
          </button>
        </CollapsibleTrigger>
        {toggle ? (
          <Switch
            checked={toggle.checked}
            onCheckedChange={toggle.onCheckedChange}
            disabled={toggle.disabled}
            aria-label={toggle.label}
          />
        ) : (
          end
        )}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            className="-mr-1 flex min-h-10 w-8 shrink-0 items-center justify-center"
            aria-label={`${open ? 'Collapse' : 'Expand'}${label ? ` ${label}` : ''}`}
          >
            <ChevronRightIcon
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90',
              )}
            />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent
        data-slot="expand-body"
        className="grid grid-cols-1 gap-3 px-1 pt-0 pb-3 has-[[data-slot=setting-field]]:gap-0 has-[[data-slot=setting-field]]:pb-3 has-[[data-slot=setting-field]]:pl-8"
      >
        {children}
        {actions}
      </CollapsibleContent>
    </Collapsible>
  );
}
