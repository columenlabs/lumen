// Settings parts: the three slots every thing in a Settings section is built from (docs/parts/settings.md).
// Header: LumenExpandRow's icon, name, summary, `status` pill, `toggle` for the whole thing, chevron.
// Rows: `SettingField`, one setting each: a short label right beside its control group, a switch for
// that one setting at the row's end (`end`). Values a person reads or copies are `SettingValue`.
// Action bar: `SettingActions`, the last result, Test and Remove (trash, confirms) for the whole thing.
// A row is never a lone button ("Last test", "Remove keys"), and a label never repeats the thing's name.
// Built on shadcn's Field and InputGroup parts.
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';
import { LumenConfirm } from './confirm';
import { IconButton } from './icon-button';
import { InfoTip } from './info-tip';
import { type KeyTestResult, errorText, useClock } from './integrations';
import { cn } from './lib/utils';
import { Badge } from './ui/badge';
import { InputGroup, InputGroupAddon, InputGroupButton } from './ui/input-group';
import { Label } from './ui/label';

/** One setting inside an item: its label, then its control group, then an optional switch at the end. */
export function SettingField({
  label,
  info,
  htmlFor,
  end,
  stack = false,
  className,
  children,
}: {
  /** The setting's own name ("Keys", "Webhook"), never the thing's ("Plaid keys"). */
  label: string;
  /** Details behind an (i) beside the label. */
  info?: ReactNode;
  htmlFor?: string;
  /** A switch that turns this one setting on or off, at the row's end. */
  end?: ReactNode;
  /** On a phone, put the label (and `end`) above the control so a long value stays readable. */
  stack?: boolean;
  className?: string;
  /** The control: an input, a picker, a `SettingValue`, a ToggleGroup. Its own buttons sit inside it. */
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="setting-field"
      data-stack={stack || undefined}
      className={cn(
        'flex min-h-10 min-w-0 items-center gap-3 border-t border-border/60 py-1.5 first:border-t-0',
        stack && 'max-sm:flex-wrap max-sm:gap-y-1.5',
        className,
      )}
    >
      <div
        className={cn(
          'flex w-32 shrink-0 items-center gap-1.5 max-sm:w-24',
          stack && 'max-sm:w-auto max-sm:flex-1',
          // Nothing beside it but `end`: the label takes the row, so a short name never cuts off.
          children === undefined && 'w-auto min-w-0 flex-1 shrink max-sm:w-auto',
        )}
      >
        <Label
          htmlFor={htmlFor}
          className="truncate font-normal text-muted-foreground"
          title={label}
        >
          {label}
        </Label>
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </div>
      {children !== undefined && (
        <div
          className={cn(
            'flex min-w-0 max-w-md flex-1 items-center gap-2',
            stack && 'max-sm:order-2 max-sm:max-w-none max-sm:basis-full',
          )}
        >
          {children}
        </div>
      )}
      {end && <div className={cn('ml-auto shrink-0', stack && 'max-sm:order-1')}>{end}</div>}
    </div>
  );
}

/** A value read in place: cut to one line with the full text on hover, with Copy and Replace inside. */
export function SettingValue({
  value,
  label,
  mono = false,
  copy = false,
  onReplace,
  replaceLabel = 'Replace',
  replaceIcon: ReplaceIcon = PencilIcon,
}: {
  value: string;
  /** The value's name for Copy's and Replace's accessible names. */
  label: string;
  mono?: boolean;
  copy?: boolean;
  onReplace?: () => void;
  replaceLabel?: string;
  /** Replace's icon: a pencil, or a sign-in for `Sign in again`. */
  replaceIcon?: ComponentType<{ className?: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <InputGroup className="h-8 min-w-0">
      <span
        className={cn('min-w-0 flex-1 truncate px-2.5 text-sm', mono && 'font-code text-xs')}
        title={value}
      >
        {value}
      </span>
      {(copy || onReplace) && (
        <InputGroupAddon align="inline-end">
          {copy && (
            <InputGroupButton
              size="icon-xs"
              aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
              title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
              onClick={() => void doCopy()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </InputGroupButton>
          )}
          {onReplace && (
            <InputGroupButton
              size="icon-xs"
              aria-label={`${replaceLabel} ${label.toLowerCase()}`}
              title={`${replaceLabel} ${label.toLowerCase()}`}
              onClick={onReplace}
            >
              <ReplaceIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/** The five words a thing's status takes: Works, Failed, Not tested, Off, or a count. */
export type SettingHealth = 'works' | 'failed' | 'untested' | 'off';

/** Where a thing stands from its switch and last test. */
export function settingHealth(
  on: boolean,
  test: { ok: boolean } | null | undefined,
): SettingHealth {
  if (!on) return 'off';
  if (!test) return 'untested';
  return test.ok ? 'works' : 'failed';
}

/** A section's health from its things: the worst one wins (Failed, then Not tested, then Works); Off when none is on. */
export function sectionHealth(items: SettingHealth[]): SettingHealth | null {
  if (!items.length) return null;
  for (const h of ['failed', 'untested', 'works'] as const) if (items.includes(h)) return h;
  return 'off';
}

const HEALTH: Record<SettingHealth, { word: string; cls: string }> = {
  works: { word: 'Works', cls: 'text-gain' },
  failed: { word: 'Failed', cls: 'text-loss' },
  untested: { word: 'Not tested', cls: 'text-muted-foreground' },
  off: { word: 'Off', cls: 'text-muted-foreground' },
};

/** The status pill in a thing's header (or a section's title). Hover tells when and what. */
export function SettingStatus({
  health,
  count,
  title,
  dot = false,
}: {
  health?: SettingHealth | null;
  /** A count instead of a state ("2 hooks"). */
  count?: string;
  /** What hover shows: the last test's time and detail, or which items are failing. */
  title?: string;
  /** Only the dot, for the Settings sidebar. */
  dot?: boolean;
}) {
  if (count !== undefined)
    return (
      <Badge variant="outline" className="shrink-0" title={title}>
        {count}
      </Badge>
    );
  if (!health) return null;
  const h = HEALTH[health];
  const mark = (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        health === 'works' && 'bg-gain',
        health === 'failed' && 'bg-loss',
        (health === 'untested' || health === 'off') && 'border border-muted-foreground',
      )}
    />
  );
  if (dot)
    return (
      <span className="ml-auto flex items-center" title={title ?? h.word} aria-label={h.word}>
        {mark}
      </span>
    );
  return (
    <Badge variant="outline" className={cn('shrink-0 gap-1.5', h.cls)} title={title}>
      {mark}
      {h.word}
    </Badge>
  );
}

/** The thing's action bar: its last result on the left, then any `children`, Test and Remove. */
export function SettingActions({
  test,
  onTest,
  remove,
  children,
}: {
  /** The last test; its time shows, and its detail or error on hover. */
  test?: KeyTestResult | null;
  /** Runs the test; the app refreshes its own data when it settles. */
  onTest?: () => Promise<unknown>;
  /** Removes the thing (its keys, its sign-in): a trash icon that confirms first. */
  remove?: {
    label: string;
    title?: ReactNode;
    description?: ReactNode;
    action?: string;
    run: () => unknown;
  };
  /** Other actions on the whole thing (Sync now, Sign in again), icon first. */
  children?: ReactNode;
}) {
  const clock = useClock();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const go = async () => {
    if (!onTest) return;
    setPending(true);
    setError(null);
    try {
      await onTest();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const failed = error ? errorText(error) : test && !test.ok ? (test.error ?? 'Failed') : null;
  return (
    <div
      data-slot="setting-actions"
      className="mt-1 flex min-h-10 min-w-0 items-center gap-2 border-t pt-2 text-sm"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {pending ? (
          <span className="text-muted-foreground">Testing…</span>
        ) : failed ? (
          <span role="alert" className="flex min-w-0 items-center gap-1.5 text-loss" title={failed}>
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span className="truncate">{failed}</span>
          </span>
        ) : test ? (
          <span
            className="flex min-w-0 items-center gap-1.5 text-gain"
            title={test.detail ?? undefined}
          >
            <CheckIcon className="size-4 shrink-0" />
            <span className="truncate">Tested {clock(test.at)}</span>
          </span>
        ) : onTest ? (
          <span className="text-muted-foreground">Not tested yet</span>
        ) : null}
      </span>
      {children}
      {onTest && (
        <IconButton
          icon={RefreshCwIcon}
          busy={pending}
          label={pending ? 'Testing…' : 'Test'}
          variant="outline"
          disabled={pending}
          onClick={() => void go()}
        />
      )}
      {remove && (
        <LumenConfirm
          title={remove.title ?? `${remove.label}?`}
          description={remove.description}
          action={remove.action ?? 'Remove'}
          onConfirm={remove.run}
        >
          <IconButton
            icon={Trash2Icon}
            label={remove.label}
            variant="outline"
            className="text-loss"
          />
        </LumenConfirm>
      )}
    </div>
  );
}
