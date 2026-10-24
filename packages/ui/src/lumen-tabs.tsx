// LumenTabs: a page's
// tabs, each tab its own LumenLayout. The tabs sit on the left of one row and what only the open tab
// uses (its inputs, its Run or Cancel) at the right end, so the page header keeps only what acts on
// the whole page. Tabs and actions share one row on a phone too, the tabs
// scrolling sideways in what the actions leave ("it splits into 2 rows"); only
// actions so wide that the tabs would get under 12rem wrap to a line under them.
import type { ReactNode } from 'react';
import type { NavIcon } from './nav';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

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
}: {
  tabs: LumenTab<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  /** What only the open tab uses, at the row's right end. */
  actions?: ReactNode;
}) {
  const shown = tabs.filter((t) => !t.hidden);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* min-w-48, not min-w-fit: a min width of all the tabs beat max-w-full, so the list never
          scrolled and pushed the actions to a second line. */}
      <div className="min-w-48 max-w-full flex-1">
        {shown.length ? (
          <Tabs value={value} onValueChange={(v) => onChange(v as V)}>
            <TabsList className="max-w-full overflow-x-auto">
              {shown.map(({ value: v, label, icon: Icon, after }) => (
                <TabsTrigger key={v} value={v}>
                  <Icon />
                  {label}
                  {after}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
      </div>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}
