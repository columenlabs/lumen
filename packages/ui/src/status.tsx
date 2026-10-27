import { cn } from './lib/utils';
import { LumenSelector } from './lumen-selector';
import { TIME_ZONES, type TimeZoneId, setPref, usePrefs, zoneAbbr } from './prefs';

/** Time zone picker: on the right of the status bar, and in Settings. */
export function TimeZoneSelect({
  className,
  short,
}: {
  className?: string;
  /** Shows the zone's short name (PT), the way every time on the page names it. */
  short?: boolean;
  /** Kept for callers; the list flips upward by itself where there is no room below. */
  side?: 'top' | 'bottom';
}) {
  const { timeZone } = usePrefs();
  return (
    <LumenSelector
      label="Time zone"
      size="sm"
      className={className}
      options={TIME_ZONES.map((z) => ({ value: z.id, label: z.label }))}
      value={timeZone}
      display={short ? zoneAbbr(timeZone) : undefined}
      onChange={(v) => setPref('timeZone', v as TimeZoneId)}
    />
  );
}

export function StatusTimeZone({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center', className)}>
      <TimeZoneSelect side="top" short className="h-6 border-0 px-1.5 text-xs shadow-none" />
    </span>
  );
}
