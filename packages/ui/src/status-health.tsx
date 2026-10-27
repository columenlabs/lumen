// Service health in the status bar ("consolidate into a clickable or hoverable
// pop-up"): one chip with the worst state of every service the app checks, opening a list of each
// service and its latency, on hover with a mouse and on tap with a finger or keyboard.
import type { ReactNode } from 'react';
import { useHoverOpen } from './hooks/use-hover-open';
import { cn } from './lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export interface HealthProbe {
  name: string;
  /** Up when true, down when false, not checked yet when null. */
  ok: boolean | null;
  ms?: number | null;
  /** Why it is down, or anything else worth a line. */
  note?: string;
}

/** Keeps the list off the window's edge on a narrow screen. */
const COLLISION_PAD = 8;

const dot = (ok: boolean | null) =>
  cn(
    'size-2 shrink-0 rounded-full',
    ok === null ? 'bg-muted-foreground/40' : ok ? 'bg-gain' : 'bg-destructive',
  );

/** The chip's word: every service up, the one that is down, or how many are. */
function summary(probes: HealthProbe[]): { ok: boolean | null; text: string } {
  const down = probes.filter((p) => p.ok === false);
  if (down.length === 1) return { ok: false, text: `${down[0]?.name} down` };
  if (down.length) return { ok: false, text: `${down.length} down` };
  if (probes.some((p) => p.ok === null)) return { ok: null, text: 'Checking' };
  return { ok: true, text: 'All up' };
}

export function StatusHealth({
  probes,
  checked,
  error,
}: {
  probes: HealthProbe[];
  /** When the services were last checked, as the app words it. */
  checked?: ReactNode;
  /** The check itself failed (no answer from the Worker). */
  error?: string;
}) {
  const { open, setOpen, hover, content: pop } = useHoverOpen();
  if (!probes.length && !error) return null;
  const s = error ? { ok: false, text: 'Check failed' } : summary(probes);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Services: ${s.text}`}
        className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted hover:text-foreground"
        {...hover}
      >
        <span aria-hidden className={dot(s.ok)} />
        Services
        <span className={cn('num', s.ok === false ? 'text-destructive' : 'text-foreground/80')}>
          {s.text}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        collisionPadding={COLLISION_PAD}
        className="w-auto min-w-56 gap-1.5 text-xs"
        {...pop}
      >
        <ul aria-label="Services" className="flex flex-col gap-1">
          {probes.map((p) => (
            <li key={p.name} className="flex items-center gap-2">
              <span aria-hidden className={dot(p.ok)} />
              <span className="flex-1">
                {p.name}
                {p.note && <span className="ml-1.5 text-muted-foreground">{p.note}</span>}
              </span>
              <span
                className={cn('num', p.ok === false ? 'text-destructive' : 'text-foreground/80')}
              >
                {p.ok === false ? 'down' : p.ms != null ? `${p.ms} ms` : '—'}
              </span>
            </li>
          ))}
        </ul>
        {error && <p className="text-destructive">{error}</p>}
        {checked && (
          <p className="border-t pt-1.5 text-muted-foreground">
            Checked <span className="num">{checked}</span>
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
