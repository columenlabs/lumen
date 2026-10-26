// A stack of rows that start collapsed and expand in place: a settings page's providers, channels or
// accounts, each row's name, a line about it and a badge, its own settings inside. One row is open
// at a time within a LumenExpandList.
import { ChevronRightIcon } from 'lucide-react';
import { type ReactNode, createContext, useContext, useState } from 'react';
import { cn } from './lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

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
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  children,
}: {
  id?: string;
  name: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
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
  return (
    <Collapsible open={open} onOpenChange={change} className="border-b last:border-b-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{name}</span>
            {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
          </span>
          {badge}
          <ChevronRightIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid grid-cols-1 gap-5 px-1 pt-1 pb-5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
