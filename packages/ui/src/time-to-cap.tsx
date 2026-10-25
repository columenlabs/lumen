// Pace on screen: the window picker (a segmented control; a chip picker on a phone) and the
// "Hits limit" cell, one value: when the meter reaches its cap ("in 2h 05m"), "At cap", or
// "Resets first". Its colour is the meter level of where it lands at reset (grey, amber, red), so a
// meter that will land at 80% of its cap reads amber even though it never reaches it.
import type { MeterLevels } from '@columenlabs/lumen-ui-types/views';
import { ZapIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { cn } from './lib/utils';
import { LumenSelector } from './lumen-selector';
import { METER_LEVEL_COLOR, meterLevel } from './meter-level';
import { PACE_WINDOWS, type Pace, type PaceWindow, durationText, usePaceWindow } from './pace';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** Picks the pace window (6h, 12h, 24h, 7d) for every page at once; a header action. */
export function PaceWindowPicker({ className }: { className?: string }) {
  const [w, setW] = usePaceWindow();
  const mobile = useIsMobile();
  if (mobile)
    return (
      <LumenSelector
        trigger="chip"
        icon={ZapIcon}
        label="Pace window"
        size="sm"
        align="end"
        value={w}
        onChange={(v) => setW(v as PaceWindow)}
        options={PACE_WINDOWS.map((x) => ({ value: x.id, label: x.id, detail: `last ${x.id}` }))}
        className={className}
      />
    );
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={w}
      onValueChange={(v) => v && setW(v as PaceWindow)}
      aria-label="Pace window"
      title="Pace: the rate over the last…"
      className={className}
    >
      <span className="flex h-8 items-center gap-1 rounded-l-md border border-r-0 px-2 text-muted-foreground text-xs">
        <ZapIcon className="size-3.5" />
        Pace
      </span>
      {PACE_WINDOWS.map((x) => (
        <ToggleGroupItem key={x.id} value={x.id} className="num px-2.5 text-xs">
          {x.id}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** What a pace reads as: the words and the level they're coloured by. */
export function paceText(
  p: Pace,
  short = false,
): { text: string; level: ReturnType<typeof meterLevel> } {
  if (p.eta === 0) return { text: short ? 'cap' : 'At cap', level: 'alert' };
  const level = meterLevel(p.atReset);
  if (p.hits)
    return { text: short ? durationText(p.eta, true) : `in ${durationText(p.eta)}`, level };
  return { text: short ? '—' : 'Resets first', level: short ? 'ok' : level };
}

/**
 * One meter's time to its cap at the pace window's rate. `label` names the meter when it isn't the
 * one the row already shows; `short` is the phone cell (`2h`, `3d`, `—`).
 */
export function TimeToCap({
  pace,
  label,
  short,
  levels,
  className,
}: {
  pace: Pace | null;
  label?: ReactNode;
  short?: boolean;
  /** This cell's own levels; left out, the app's `meterLevels`. */
  levels?: Partial<MeterLevels>;
  className?: string;
}) {
  if (!pace) return <span className="text-muted-foreground">—</span>;
  const t = paceText(pace, short);
  const level = levels && pace.eta > 0 ? meterLevel(pace.atReset, levels) : t.level;
  const c = METER_LEVEL_COLOR[level];
  const quiet = level === 'ok' && !pace.hits;
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-sm text-xs',
        quiet ? 'text-muted-foreground' : 'px-1.5',
        className,
      )}
      style={
        quiet
          ? undefined
          : level === 'ok'
            ? { background: 'var(--muted)' }
            : {
                background: `color-mix(in oklab, ${c} 18%, transparent)`,
                color: `color-mix(in oklab, ${c} 80%, var(--foreground))`,
              }
      }
    >
      {label && <span className="truncate max-md:max-w-16">{label}</span>}
      <span className="num">{t.text}</span>
    </span>
  );
}
