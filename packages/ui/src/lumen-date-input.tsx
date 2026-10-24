// A date picker with ‹ › to step one open day back or forward, and an optional Today.
import { CalendarClockIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { Input } from './ui/input';

export type LumenDateInputProps = {
  /** The day as ISO `yyyy-mm-dd`, or '' for none. */
  value: string;
  onChange: (iso: string) => void;
  /** Earliest and latest day the picker and the steps reach. */
  min?: string;
  max?: string;
  /** Which days the steps land on (a trading calendar); every day when left out. */
  isOpen?: (iso: string) => boolean;
  /** What a day is called in the step tooltips: "Previous trading day". Default "day". */
  unit?: string;
  /** Shows a Today icon button that runs this. */
  onToday?: () => void;
  /** Today is already shown: the Today button is off. */
  atToday?: boolean;
  /** `sm` for toolbars and card headers, `default` in forms. */
  size?: 'sm' | 'default';
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
};

const DAY = 86_400_000;
/** The furthest a step looks for an open day (long holiday runs fit easily). */
const REACH = 14;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** The next open day from `iso` in direction `dir`, inside min and max; null when none. */
export function stepDate(
  iso: string,
  dir: 1 | -1,
  { min, max, isOpen }: Pick<LumenDateInputProps, 'min' | 'max' | 'isOpen'> = {},
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  let day = iso;
  for (let i = 0; i < REACH; i++) {
    day = addDays(day, dir);
    if ((min && day < min) || (max && day > max)) return null;
    if (!isOpen || isOpen(day)) return day;
  }
  return null;
}

/**
 * The kit's date picker: the browser's date input between ‹ and › icon buttons that step
 * one open day (an app passes its trading calendar as `isOpen`), Alt+← and Alt+→ while it
 * has focus, and an optional Today. Every date field in an app uses it.
 */
export function LumenDateInput({
  value,
  onChange,
  min,
  max,
  isOpen,
  unit = 'day',
  onToday,
  atToday,
  size = 'sm',
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: LumenDateInputProps) {
  const prev = disabled ? null : stepDate(value, -1, { min, max, isOpen });
  const next = disabled ? null : stepDate(value, 1, { min, max, isOpen });
  const btn = size === 'sm' ? 'icon-xs' : 'icon-sm';
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!e.altKey) return;
    const to = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : undefined;
    if (to === undefined) return;
    e.preventDefault();
    if (to) onChange(to);
  };
  return (
    <div className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      <IconButton
        icon={ChevronLeftIcon}
        label={`Previous ${unit}`}
        size={btn}
        disabled={!prev}
        onClick={() => prev && onChange(prev)}
      />
      <Input
        type="date"
        id={id}
        aria-label={ariaLabel ?? 'Date'}
        className={cn('tabular-nums', size === 'sm' ? 'h-7 w-32 text-xs md:text-xs' : 'w-36')}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
      />
      <IconButton
        icon={ChevronRightIcon}
        label={`Next ${unit}`}
        size={btn}
        disabled={!next}
        onClick={() => next && onChange(next)}
      />
      {onToday && (
        <IconButton
          icon={CalendarClockIcon}
          label="Today"
          size={btn}
          disabled={disabled || atToday}
          onClick={onToday}
        />
      )}
    </div>
  );
}
