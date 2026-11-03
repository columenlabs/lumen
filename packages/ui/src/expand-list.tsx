// A stack of rows that start collapsed and expand in place: a settings page's providers, channels or
// accounts, each row's name, a line about it and a badge, its own settings inside. One row is open
// at a time within a LumenExpandList. The header holds the thing's `status` pill and the `toggle` that
// turns the whole thing on or off; the body is `SettingField` rows; `actions` is its action bar
// (`SettingActions`: last result, Test, Remove). See setting-parts.tsx.
import { ChevronRightIcon } from 'lucide-react';
import { type ReactNode, createContext, useContext, useState } from 'react';
import { cn } from './lib/utils';
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
  return (
    <ListCtx.Provider value={{ open, set }}>
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
  toggle,
  actions,
  icon,
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
  /** The thing's status pill (`SettingStatus`): Works, Failed, Not tested, Off, or a count. */
  status?: ReactNode;
  /** Turns the whole thing on or off: a switch in the header, outside the expand button. */
  toggle?: {
    checked: boolean;
    onCheckedChange: (on: boolean) => void;
    label: string;
    disabled?: boolean;
  };
  /** The action bar under the rows (`SettingActions`). */
  actions?: ReactNode;
  /** A logo or icon before the name. */
  icon?: ReactNode;
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
  const chevron = (
    <ChevronRightIcon
      className={cn(
        'size-4 shrink-0 text-muted-foreground transition-transform',
        open && 'rotate-90',
      )}
    />
  );
  const label = typeof name === 'string' ? name : undefined;
  return (
    <Collapsible open={open} onOpenChange={change} className="border-b last:border-b-0">
      <div className="flex w-full min-w-0 items-center gap-3 px-1 hover:bg-muted/50">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left">
            {icon}
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
            {!toggle && chevron}
          </button>
        </CollapsibleTrigger>
        {toggle && (
          <>
            <Switch
              checked={toggle.checked}
              onCheckedChange={toggle.onCheckedChange}
              disabled={toggle.disabled}
              aria-label={toggle.label}
            />
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="py-3"
                aria-label={`${open ? 'Collapse' : 'Expand'}${label ? ` ${label}` : ''}`}
              >
                {chevron}
              </button>
            </CollapsibleTrigger>
          </>
        )}
      </div>
      <CollapsibleContent
        data-slot="expand-body"
        className="grid grid-cols-1 gap-5 px-1 pt-1 pb-5 has-[[data-slot=setting-field]]:gap-0 has-[[data-slot=setting-field]]:pb-3 has-[[data-slot=setting-field]]:pl-8"
      >
        {children}
        {actions}
      </CollapsibleContent>
    </Collapsible>
  );
}
