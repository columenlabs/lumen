// The Group button every LumenView card shows in its header: a saved view's
// table and a page's second table (LumenViewCard) alike.
import type { CustomViewConfig } from '@columenlabs/lumen-ui-types/views';
import { ChevronDownIcon, Grid3x3Icon, ListTreeIcon, TableIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from './lib/utils';
import { LumenSelector } from './lumen-selector';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  type ViewDomain,
  type ViewField,
  type ViewSubgroup,
  pick,
  subgroupLabel,
  subgroupOf,
  subgroupsOf,
} from './view-model';

export const GROUP_NONE = '_none';
export const GROUP_PIVOT = '_pivot';

/** A view's grouping for the visit: by a field, as a pivot, and what each row opens. */
export function useGroup<T>(domain: ViewDomain<T>, config: CustomViewConfig) {
  const groupable = pick(
    domain.fields.filter((f) => f.groupable),
    config.group.fields,
  );
  const [mode, setMode] = useState<string>(
    config.shape === 'pivot' && config.pivot ? GROUP_PIVOT : (config.group.default ?? GROUP_NONE),
  );
  const groupField = groupable.find((f) => f.key === mode) ?? null;
  // What each row opens: the view's pick, else the domain's first.
  const subgroups = subgroupsOf(domain);
  const [sub, setSub] = useState<string | null>(
    () => subgroupOf(domain, config.subgroup)?.key ?? null,
  );
  // A saved grouping patched while the view is open (the assistant's card move) applies at once; the
  // person's own unsaved pick stays while the saved one does not change.
  const savedGroup = JSON.stringify([
    config.shape === 'pivot' && !!config.pivot,
    config.group.default,
    config.subgroup ?? null,
  ]);
  // Taken during render, not in an effect, so a sheet never sees the old pick against the new
  // saved one and saves it back (Sub-group saved from Edit view looped).
  const [seenGroup, setSeenGroup] = useState(savedGroup);
  if (seenGroup !== savedGroup) {
    setSeenGroup(savedGroup);
    setMode(
      config.shape === 'pivot' && config.pivot ? GROUP_PIVOT : (config.group.default ?? GROUP_NONE),
    );
    setSub(subgroupOf(domain, config.subgroup)?.key ?? null);
  }
  const pivot = mode === GROUP_PIVOT && !!config.pivot;
  const grouping = groupable.length > 0 || !!config.pivot || subgroups.length > 0;
  const button = grouping ? (
    <GroupButton
      groupable={groupable}
      pivot={!!config.pivot}
      mode={mode}
      onMode={setMode}
      subgroups={subgroups}
      opensLabel={subgroupLabel(domain)}
      subgroup={sub}
      onSubgroup={setSub}
    />
  ) : null;
  // What the person holds now, for a page that saves or shows it as changed (rule C).
  const held = {
    group: pivot || mode === GROUP_NONE || mode === GROUP_PIVOT ? null : mode,
    pivot,
    subgroup: sub,
  };
  const reset = () => {
    setMode(
      config.shape === 'pivot' && config.pivot ? GROUP_PIVOT : (config.group.default ?? GROUP_NONE),
    );
    setSub(subgroupOf(domain, config.subgroup)?.key ?? null);
  };
  return { groupField: pivot ? null : groupField, pivot, sub, button, held, reset };
}

/**
 * The Group button: says what is on ("Account › Tax lots") and opens two
 * pickers, Group rows by (a field, or Pivot) and Each row opens (the domain's sub-groups), each
 * with None.
 */
export function GroupButton<T>({
  groupable,
  pivot,
  mode,
  onMode,
  subgroups,
  subgroup,
  onSubgroup,
  opensLabel = 'Each row opens',
}: {
  groupable: ViewField<T>[];
  pivot: boolean;
  mode: string;
  onMode: (mode: string) => void;
  subgroups: ViewSubgroup<T>[];
  subgroup: string | null;
  onSubgroup: (key: string | null) => void;
  /** The sub-group picker's name (`subgroupLabel`). */
  opensLabel?: string;
}) {
  const group =
    mode === GROUP_PIVOT ? 'Pivot' : (groupable.find((f) => f.key === mode)?.label ?? null);
  const opens = subgroups.find((s) => s.key === subgroup)?.label ?? null;
  const on = [group, opens].filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('max-w-40 shrink-0', !on.length && 'text-muted-foreground')}
          aria-label="Group"
        >
          <ListTreeIcon />
          <span className="truncate">{on.length ? on.join(' › ') : 'Group'}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-60 flex-col gap-3">
        {(groupable.length > 0 || pivot) && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-rows-by">Group rows by</Label>
            <LumenSelector
              id="group-rows-by"
              label="Group rows by"
              size="sm"
              className="w-full"
              options={[
                { value: GROUP_NONE, label: 'None', icon: TableIcon },
                ...groupable.map((f) => ({ value: f.key, label: f.label, icon: f.icon })),
                ...(pivot ? [{ value: GROUP_PIVOT, label: 'Pivot', icon: Grid3x3Icon }] : []),
              ]}
              value={mode}
              onChange={onMode}
            />
          </div>
        )}
        {subgroups.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="each-row-opens">{opensLabel}</Label>
            <LumenSelector
              id="each-row-opens"
              label={opensLabel}
              size="sm"
              className="w-full"
              disabled={mode === GROUP_PIVOT}
              options={[
                { value: GROUP_NONE, label: 'None' },
                ...subgroups.map((s) => ({ value: s.key, label: s.label, icon: s.icon })),
              ]}
              value={subgroup ?? GROUP_NONE}
              onChange={(v) => onSubgroup(v === GROUP_NONE ? null : v)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
