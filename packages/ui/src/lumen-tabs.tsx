// LumenTabs: a page's
// tabs, each tab its own LumenLayout. The tabs sit on the left of one row and what only the open tab
// uses (its inputs, its Run or Cancel) at the right end, so the page header keeps only what acts on
// the whole page. Tabs and actions share one row on a phone too ("it splits into 2 rows"); only
// actions so wide that the tabs would get under 12rem wrap to a line under them. Tabs that do not
// fit what the actions leave fold into a More menu at the row's end, never a cut-off tab.
import { ChevronDownIcon } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from './lib/utils';
import type { NavIcon } from './nav';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** The row's gap between tabs (`gap-6` in TabsList). */
const GAP = 24;
/** The More button, drawn like a tab. */
const MORE =
  'relative inline-flex shrink-0 items-center gap-1.5 pb-2 text-sm leading-4 font-medium whitespace-nowrap outline-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * One tab: its icon, its name and a count or mark after it. Every tab has an icon; a tab the person edits takes theirs through `iconOf` and LumenTabDrawer.
 */
export interface LumenTab<V extends string = string> {
  value: V;
  label: ReactNode;
  icon: NavIcon;
  /** After the name: a count, a dot. */
  after?: ReactNode;
  /** Left out of the row (a tab this page does not have). */
  hidden?: boolean;
}

export function LumenTabs<V extends string>({
  tabs,
  value,
  onChange,
  actions,
  variant = 'row',
}: {
  tabs: LumenTab<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  /** What only the open tab uses, at the row's right end. */
  actions?: ReactNode;
  /**
   * `row` (default): icon and name side by side, the rest in More. `stacked`: a phone panel's bar,
   * the tabs sharing the row evenly, each its icon over a short name. `icons`: icons only, each
   * named in its tooltip, for a small floating panel.
   */
  variant?: 'row' | 'stacked' | 'icons';
}) {
  const shown = tabs.filter((t) => !t.hidden);
  if (variant !== 'row')
    return (
      <EvenTabs
        tabs={shown}
        value={value}
        onChange={onChange}
        actions={actions}
        icons={variant === 'icons'}
      />
    );
  return <RowTabs tabs={shown} value={value} onChange={onChange} actions={actions} />;
}

/** A bar of tabs that share the row evenly: icon over name, or icons alone with a tooltip. */
function EvenTabs<V extends string>({
  tabs,
  value,
  onChange,
  actions,
  icons,
}: {
  tabs: LumenTab<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  actions?: ReactNode;
  icons: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Tabs value={value} onValueChange={(v) => onChange(v as V)} className="min-w-0 flex-1">
        <TabsList className="w-full gap-0">
          {tabs.map((t) => {
            const name = typeof t.label === 'string' ? t.label : undefined;
            const trigger = (
              <TabsTrigger
                key={t.value}
                value={t.value}
                aria-label={icons ? name : undefined}
                className={cn(
                  'relative min-h-11 min-w-0 flex-1 justify-center py-1 after:inset-x-3',
                  !icons && 'flex-col gap-0.5 text-xs leading-3 [&_svg]:size-5',
                )}
              >
                <t.icon />
                {!icons && <span className="max-w-full truncate">{t.label}</span>}
                {t.after && (
                  <span className={cn('text-xs', !icons ? 'absolute top-0.5 left-1/2 ml-2' : '')}>
                    {t.after}
                  </span>
                )}
              </TabsTrigger>
            );
            return icons ? (
              <Tooltip key={t.value}>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent>{t.label}</TooltipContent>
              </Tooltip>
            ) : (
              trigger
            );
          })}
        </TabsList>
      </Tabs>
      {actions}
    </div>
  );
}

function RowTabs<V extends string>({
  tabs: shown,
  value,
  onChange,
  actions,
}: {
  tabs: LumenTab<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  actions?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  // How many tabs fit before the More menu; all of them until measured.
  const [fit, setFit] = useState(shown.length);
  // The More button names the open tab when it is folded, so its width moves with the open tab.
  const sig = `${shown.map((t) => t.value).join('|')}#${value}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the tab set changes
  useLayoutEffect(() => {
    const el = box.current;
    const r = ruler.current;
    if (!el || !r) return;
    const measure = () => {
      const widths = [...r.children].map((c) => (c as HTMLElement).offsetWidth);
      const more = widths.pop() ?? 0;
      // A few pixels spare for rounding, so the row never needs to scroll.
      const room = el.clientWidth - 4;
      const all = widths.reduce((a, w, i) => a + w + (i ? GAP : 0), 0);
      if (all <= room) return setFit(widths.length);
      let used = more;
      let n = 0;
      for (const w of widths) {
        if (used + GAP + w > room) break;
        used += GAP + w;
        n++;
      }
      setFit(Math.max(1, n));
    };
    measure();
    // The row's room, and the tabs' own widths (a count that arrives after the first paint).
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    seen.observe(r);
    return () => seen.disconnect();
  }, [sig]);
  const inRow = shown.slice(0, fit);
  const folded = shown.slice(fit);
  const openFolded = folded.find((t) => t.value === value);
  const trigger = (t: LumenTab<V>) => (
    <>
      <t.icon />
      {t.label}
      {t.after}
    </>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* min-w-48, not min-w-fit: a min width of all the tabs beat max-w-full, so the list never
          fitted what the actions leave and pushed them to a second line. */}
      <div ref={box} className="relative min-w-48 max-w-full flex-1">
        {/* Every tab and the More button, laid out unseen with the row's own parts (a phone
            draws tabs larger), to measure what fits. */}
        <Tabs aria-hidden className="pointer-events-none invisible absolute h-0 overflow-hidden">
          <TabsList ref={ruler} className="w-max">
            {shown.map((t) => (
              <TabsTrigger key={t.value} value={t.value} tabIndex={-1}>
                {trigger(t)}
              </TabsTrigger>
            ))}
            <span data-slot="tabs-trigger" className={MORE}>
              {openFolded ? trigger(openFolded) : 'More'}
              <ChevronDownIcon />
            </span>
          </TabsList>
        </Tabs>
        {shown.length ? (
          <Tabs value={value} onValueChange={(v) => onChange(v as V)}>
            <TabsList className="max-w-full overflow-x-hidden">
              {inRow.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {trigger(t)}
                </TabsTrigger>
              ))}
              {folded.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    data-slot="tabs-trigger"
                    data-state={openFolded ? 'active' : 'inactive'}
                    className={cn(
                      MORE,
                      openFolded &&
                        'text-foreground after:bg-primary [&_svg:first-child]:text-primary',
                    )}
                  >
                    {openFolded ? trigger(openFolded) : 'More'}
                    <ChevronDownIcon className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-auto min-w-44"
                    // A pick from the menu moves the tab; no keyboard ring back on the button.
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as V)}>
                      {folded.map((t) => (
                        <DropdownMenuRadioItem key={t.value} value={t.value}>
                          {trigger(t)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </TabsList>
          </Tabs>
        ) : null}
      </div>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}
