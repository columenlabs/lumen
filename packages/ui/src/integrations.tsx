// Settings ▸ Integrations rows, one look on every app (an app since 2026-10-11, an app since
// 2026-10-12): a row that expands in place, its badge saying whether the key's last test worked, and
// the Test line that runs it again. A saved key says nothing; each row shows whether it works.
import { AlertTriangleIcon, CheckIcon, ChevronRightIcon, RefreshCwIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { LumenExpandRow } from './expand-list';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { usePrefs } from './prefs';
import { Badge } from './ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

/** A key's last test: when, whether it worked, and what it read or why it failed. */
export interface KeyTestResult {
  at: string;
  ok: boolean;
  detail?: string | null;
  error?: string | null;
}

/** `Oct 12, 4:34 PM PDT`-style time in the person's time zone. */
export function useClock() {
  const { timeZone } = usePrefs();
  return (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
}

/** A fetch that never got an answer is a TypeError ("Load failed" in Safari, "Failed to fetch" in Chrome). */
export const errorText = (e: unknown) =>
  e instanceof TypeError
    ? 'The request was cut off before the desk answered (the page was left or the network dropped). Try again.'
    : e instanceof Error
      ? e.message
      : String(e);

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-loss">
      {errorText(error)}
    </p>
  );
}

/** One integration: a row that expands in place (LumenExpandRow, kept under its old name). */
export const IntegrationRow = LumenExpandRow;

/**
 * One linked connection (a bank, a broker) and its accounts (an app banks and
 * An app a broker link brokers alike). Collapsed by default, showing its name, `meta` and status; a
 * connection that needs fixing opens on its own. `actions` sit beside the status, outside the toggle.
 */
export function ConnectionBlock({
  name,
  meta,
  status,
  fix,
  actions,
  children,
}: {
  name: string;
  meta?: string;
  /** `ok` is Connected; `fix` shows the fix button; `failed` shows the last sync failed. */
  status: 'ok' | 'fix' | 'failed';
  /** The fix (sign in again, reconnect); shown while `status` is `fix`. */
  fix?: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(status !== 'ok');
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-md border">
      <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 text-sm">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <ChevronRightIcon
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90',
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{name}</span>
              {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
            </span>
          </button>
        </CollapsibleTrigger>
        {actions}
        {status === 'fix' && fix ? (
          <IconButton
            icon={AlertTriangleIcon}
            size="icon-xs"
            busy={fix.busy}
            label={fix.label}
            variant="outline"
            className="text-warning"
            disabled={fix.disabled}
            onClick={fix.onClick}
          />
        ) : status === 'failed' ? (
          <TestBadge test={{ ok: false }} />
        ) : (
          <Badge variant="outline" className="text-gain">
            <CheckIcon />
            Connected
          </Badge>
        )}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** The row's status: whether the key's last test worked. */
export function TestBadge({ test, ok = 'Works' }: { test: { ok: boolean } | null; ok?: string }) {
  if (!test) return <Badge variant="outline">Not tested</Badge>;
  return test.ok ? (
    <Badge variant="outline" className="text-gain">
      <CheckIcon />
      {ok}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-loss">
      <AlertTriangleIcon />
      Failed
    </Badge>
  );
}

/** The last test's time and outcome, with the Test button that runs it again. */
export function KeyTestLine({
  test,
  run,
}: {
  test: KeyTestResult | null;
  /** Runs the test; the app refreshes its own data when it settles. */
  run: () => Promise<unknown>;
}) {
  const clock = useClock();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const go = async () => {
    setPending(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-1">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {test ? (
          <span className={cn('flex min-w-0 items-center gap-2', !test.ok && 'text-loss')}>
            {test.ok ? (
              <CheckIcon className="size-4 shrink-0 text-gain" />
            ) : (
              <AlertTriangleIcon className="size-4 shrink-0" />
            )}
            <span className="truncate">
              Tested {clock(test.at)} · {test.ok ? `works · ${test.detail}` : 'failed'}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Not tested yet</span>
        )}
        <span className="flex-1" />
        <IconButton
          icon={RefreshCwIcon}
          busy={pending}
          label={pending ? 'Testing…' : 'Test'}
          variant="outline"
          disabled={pending}
          onClick={() => void go()}
        />
      </div>
      {test && !test.ok && test.error ? (
        <p role="alert" className="text-xs text-loss">
          {test.error}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
