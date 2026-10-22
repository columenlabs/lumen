import { type ChartFormula, parseChartFormula } from '@columenlabs/lumen-ui-types/chart-formula';
import { PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { LumenConfirm } from '../confirm';
import { IconButton } from '../icon-button';
import { type LumenOptionGroup, LumenSelector } from '../lumen-selector';
import { Field, FieldDescription, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import {
  CHART_INDICATORS,
  type ChartIndicator,
  formulaIndicator,
  resolveIndicator,
} from './indicators';

const GROUPS: { heading: string; has: (i: ChartIndicator) => boolean }[] = [
  { heading: 'On price', has: (i) => !i.sourced && i.where === 'overlay' },
  { heading: 'Below price', has: (i) => !i.sourced && i.where === 'pane' },
  { heading: 'From market data', has: (i) => !!i.sourced },
];

/** "For" in the compare chart: every symbol shown, or one of them. */
export const ALL_SHOWN = 'all';

/**
 * A built-in with its own window, typed in the search (`ema 13`, `rsi 7`, `bollinger 20 2.5`,
 * `macd 8 21 5`); null when the search is not one.
 */
function typedBuiltin(search: string): ChartIndicator | null {
  const m = /^\s*(sma|ema|rsi|atr|bollinger|bb|macd)[\s_,]+([\d.\s,_]+)$/i.exec(search);
  if (!m) return null;
  const kind =
    (m[1] as string).toLowerCase() === 'bb' ? 'bollinger' : (m[1] as string).toLowerCase();
  const nums = (m[2] as string).split(/[\s,_]+/).filter(Boolean);
  const id = [kind, ...nums.map((n) => n.replace('.', 'p'))].join('_');
  const i = resolveIndicator(id);
  return i && !i.sourced ? i : null;
}

/** Saved formulas the picker lists first, and how to keep a new one. */
type Mine = {
  list: ChartIndicator[];
  save?: (f: ChartFormula) => Promise<void>;
  remove?: (id: string) => Promise<void>;
};

/** "Indicators" button and a searchable list of everything the chart can draw. */
export function IndicatorPicker({
  selected,
  available,
  reasons,
  targets,
  target = ALL_SHOWN,
  onTarget,
  onToggle,
  mine,
  onAdd,
}: {
  /** Indicator ids picked (for the current `target`). */
  selected: string[];
  /** Indicator ids this chart has values for. */
  available: Set<string>;
  /** Why an indicator is not available here, by id; left out: "no values". */
  reasons?: Map<string, string>;
  /** The symbols on a compare chart: the "For" picker shows All shown and each of them. */
  targets?: string[];
  target?: string;
  onTarget?: (target: string) => void;
  onToggle: (id: string) => void;
  /** The person's saved formulas (Mine); left out: none. */
  mine?: Mine;
  /** Adds a built-in with its own window or a formula; left out: only the catalog is offered. */
  onAdd?: (i: ChartIndicator) => void;
}) {
  const [label, setLabel] = useState('');
  const [f, setF] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ChartIndicator | null>(null);
  // The new formula checked as it is typed: how many bars it needs first, or why it can't run.
  let check: { ok: boolean; text: string } | null = null;
  if (f.trim()) {
    try {
      const { lookback } = parseChartFormula(f);
      check = { ok: true, text: `Checks out · needs ${lookback} bars before its first value` };
    } catch (e) {
      check = { ok: false, text: e instanceof Error ? e.message : String(e) };
    }
  }
  const formula: ChartFormula | null =
    check?.ok && label.trim() ? { label: label.trim(), f: f.trim() } : null;
  const addFormula = () => {
    if (!formula || !onAdd) return;
    onAdd(formulaIndicator(formula));
    setLabel('');
    setF('');
  };
  const saveFormula = () => {
    if (!formula || !mine?.save) return;
    setBusy(true);
    setError(null);
    mine
      .save(formula)
      .then(() => {
        setLabel('');
        setF('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const byId = new Map<string, ChartIndicator>(
    [...(mine?.list ?? []), ...CHART_INDICATORS].map((i) => [i.id, i]),
  );
  const option = (i: ChartIndicator, extra?: React.ReactNode) => {
    const has = available.has(i.id) || !CHART_INDICATORS.some((c) => c.id === i.id);
    return {
      value: i.id,
      label: i.formula ? `ƒ ${i.label}` : i.label,
      keywords: i.f ? [i.f] : undefined,
      disabled: has ? false : (reasons?.get(i.id) ?? 'no values'),
      detail: has ? undefined : (reasons?.get(i.id) ?? 'no values'),
      content: (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{i.formula ? `ƒ ${i.label}` : i.label}</span>
          {i.f && <span className="truncate font-mono text-xs text-muted-foreground">{i.f}</span>}
          {extra}
        </span>
      ),
    };
  };
  const groups: LumenOptionGroup[] = [
    ...(mine && mine.list.length > 0
      ? [
          {
            label: 'Mine',
            options: mine.list.map((i) =>
              option(
                i,
                mine.remove && (
                  <IconButton
                    icon={Trash2Icon}
                    size="icon-xs"
                    label={`Delete ${i.label}`}
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setRemoving(i);
                    }}
                  />
                ),
              ),
            ),
          },
        ]
      : []),
    ...GROUPS.map((g) => ({
      label: g.heading,
      options: CHART_INDICATORS.filter(g.has).map((i) => option(i)),
    })),
  ];
  // A picked row adds a built-in with its own window (or toggles one already on); unpicking turns
  // it off, as the list's rows did.
  const change = (next: string[]) => {
    for (const id of selected) if (!next.includes(id)) onToggle(id);
    for (const id of next) {
      if (selected.includes(id)) continue;
      const i = byId.get(id) ?? resolveIndicator(id, mine?.list);
      if (onAdd && i) onAdd(i);
      else onToggle(id);
    }
  };
  return (
    <>
      <LumenSelector
        multiple
        trigger="icon"
        icon={PlusIcon}
        label="Add indicators"
        align="end"
        search
        empty="No indicator matches."
        groups={groups}
        value={selected}
        onChange={change}
        create={onAdd ? (q) => typedBuiltin(q)?.id ?? null : undefined}
        createLabel={(q) => typedBuiltin(q)?.label ?? 'Type a window: ema 13, rsi 7'}
        header={
          <>
            {targets && targets.length > 1 && onTarget && (
              <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                For
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  spacing={0}
                  value={target}
                  onValueChange={(v) => v && onTarget(v)}
                  aria-label="For"
                  className="flex-wrap"
                >
                  <ToggleGroupItem value={ALL_SHOWN} className="px-2.5">
                    All shown
                  </ToggleGroupItem>
                  {targets.map((t) => (
                    <ToggleGroupItem key={t} value={t} className="px-2.5 font-mono">
                      {t}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}
            {onAdd && (
              <div className="flex flex-col gap-2 border-b p-3">
                <Field>
                  <FieldLabel>New formula</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Name"
                      placeholder="Name"
                      className="h-8 flex-1"
                      value={label}
                      maxLength={60}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                    <IconButton
                      icon={PlusIcon}
                      label="Add to the chart"
                      variant="outline"
                      disabled={!formula}
                      onClick={addFormula}
                    />
                    {mine?.save && (
                      <IconButton
                        icon={SaveIcon}
                        label="Save to Mine"
                        variant="outline"
                        disabled={!formula || busy}
                        busy={busy}
                        onClick={saveFormula}
                      />
                    )}
                  </div>
                  <Input
                    aria-label="Formula"
                    placeholder="(ema(close, 9) - ema(close, 21)) / close * 100"
                    className="h-8 font-mono"
                    value={f}
                    maxLength={400}
                    onChange={(e) => setF(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addFormula()}
                  />
                  <FieldDescription className={check && !check.ok ? 'text-loss' : undefined}>
                    {error ??
                      check?.text ??
                      'Fields open high low close · sma ema rsi stdev highest lowest sum ref change (x, n) · atr(n) · abs min max'}
                  </FieldDescription>
                </Field>
              </div>
            )}
          </>
        }
      />
      {removing && mine?.remove && (
        <LumenConfirm
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Delete ${removing.label}?`}
          description="It leaves Mine on every desk."
          onConfirm={() => {
            void mine.remove?.(removing.id).catch((e: Error) => setError(e.message));
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}
