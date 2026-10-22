// A page's load inputs:
// what decides which rows load (a window, a quarter, an expiry, an explorer view's symbol and
// range, a calendar week) is one compact picker among the page header's icons (or at the right of
// the tab row, `LumenTabs`, when only one tab uses it), never a row of its own above the cards. Its button says what is picked; a tap opens the inputs.
import { ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function PageInputs({
  summary,
  label = 'Inputs',
  children,
}: {
  /** What is picked, short: `1Y`, `Q2 2026`, `AAPL · 2024–2026`. */
  summary: ReactNode;
  /** The picker's name: its tooltip and accessible name. */
  label?: string;
  /** The inputs, one per line, each with its own label. */
  children: ReactNode;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 max-w-48 gap-1.5 px-2"
              aria-label={label}
            >
              <SlidersHorizontalIcon className="text-muted-foreground" />
              <span className="num truncate">{summary}</span>
              <ChevronDownIcon className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** One input in the picker: its label above it. */
export function PageInput({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
