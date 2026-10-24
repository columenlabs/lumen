import { ChevronRightIcon, type LucideIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

export interface DrawerSectionProps {
  /** An icon before the title; a form's numbered steps leave it out. */
  icon?: LucideIcon;
  title: string;
  /** A count chip after the title (rows in the section). */
  count?: number | null;
  /** A short note on the right of the header ("None"). */
  hint?: string | null;
  /** A short plain line under the header, shown only while closed: what the section is set to. */
  summary?: ReactNode;
  /** Buttons at the right of the header (a `ResetButton`), outside the fold's trigger. */
  actions?: ReactNode;
  /** Sections start collapsed unless set open. */
  defaultOpen?: boolean;
  /** Controlled open state, when the caller opens a section itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * One section of a pullout drawer, on every app (p2e style): a header of
 * chevron, icon, title, optional count and note, with no background until hovered; a hairline
 * between sections. Drawers stack these under their title instead of their own headings.
 */
export function DrawerSection({
  icon: Icon,
  title,
  count,
  hint,
  summary,
  actions,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
}: DrawerSectionProps) {
  // Kept here too when the caller leaves it uncontrolled, so the summary knows when to show.
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open ?? own;
  const trigger = (
    <CollapsibleTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        // No background, grey only on hover, open or not.
        className="w-full justify-start px-1 aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
      >
        <ChevronRightIcon className="text-muted-foreground transition-transform group-data-[state=open]/section:rotate-90" />
        {Icon && <Icon className="text-muted-foreground" />}
        <span className="truncate">{title}</span>
        {count != null && (
          <Badge variant="secondary" className="num">
            {count}
          </Badge>
        )}
        {hint && <span className="ml-auto font-normal text-muted-foreground text-xs">{hint}</span>}
      </Button>
    </CollapsibleTrigger>
  );
  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(o) => {
        setOwn(o);
        onOpenChange?.(o);
      }}
      className="group/section border-t py-1 first:border-t-0"
    >
      {actions ? (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{trigger}</div>
          {actions}
        </div>
      ) : (
        trigger
      )}
      {summary && !isOpen && (
        <p className="line-clamp-3 pr-1 pb-1 pl-5.5 text-muted-foreground text-xs">{summary}</p>
      )}
      {/* Content lines up with the icon: px-1 + chevron + gap; the chevron is the indent. */}
      <CollapsibleContent className="pt-1 pr-1 pb-2 pl-5.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
