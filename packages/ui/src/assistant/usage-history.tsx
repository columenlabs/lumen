// A person's assistant use over a month: the total, each tier and model, and each chat and run of
// background work (`GET /usage`). The panel's footer opens it; Settings ▸ Spend shows it in place.
import type { UsageEntry, UsageHistory, UsagePart } from '@columenlabs/lumen-ui-types/assistant';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeftIcon, ChevronRightIcon, CpuIcon, MessageSquareIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { DetailsTable } from '../details-table';
import { IconButton } from '../icon-button';
import { InfoLabel } from '../info-tip';
import { cn } from '../lib/utils';
import { Label } from '../ui/label';
import { Spinner } from '../ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import type { AssistantAdapter } from './client';

export const usd = (n: number) =>
  n === 0 ? '$0' : n < 0.01 ? '<$0.01' : `$${n.toFixed(n < 10 ? 2 : 0)}`;
export const tokens = (n: number) =>
  n < 1000
    ? String(n)
    : n < 1_000_000
      ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
      : `${(n / 1e6).toFixed(1)}M`;

export const assistantUsageKey = (client: AssistantAdapter, month?: string) => [
  'lumen-assistant',
  client.key,
  'usage',
  month ?? 'now',
];

/** One month of the person's use (this month when `month` is left out); off when the adapter has no `usage`. */
export function useAssistantUsage(client: AssistantAdapter, month?: string, enabled = true) {
  return useQuery({
    queryKey: assistantUsageKey(client, month),
    queryFn: () => (client.usage as NonNullable<AssistantAdapter['usage']>)(month),
    enabled: enabled && !!client.usage,
  });
}

/** `2026-11` → `November 2026`. */
const monthName = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y ?? 2000, (mo ?? 1) - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
};

/** Today's time, else the day. */
const when = (at: number) => {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** The model of a part, from its label (`Steady · Sonnet 5.5` → `Sonnet 5.5`). */
const modelOf = (p: UsagePart) => p.label.split(' · ').slice(1).join(' · ') || p.label;

/** Rows of one month summed per model (each tier and payer of one model is one row). */
function perModel(rows: UsagePart[]) {
  const out = new Map<string, UsagePart>();
  for (const r of rows) {
    const k = r.model ?? modelOf(r);
    const p = out.get(k);
    if (!p) out.set(k, { ...r, label: modelOf(r) });
    else {
      p.calls += r.calls;
      p.in += r.in;
      p.read += r.read;
      p.out += r.out;
      p.usd += r.usd;
    }
  }
  return [...out.values()].sort((a, b) => b.usd - a.usd);
}

const entryHover = (e: UsageEntry) =>
  [
    e.title,
    ...e.parts.map(
      (p) =>
        `${p.label}: ${usd(p.usd)} · ${tokens(p.in)} in · ${tokens(p.out)} out · ${p.calls} calls`,
    ),
  ].join('\n');

function Entry({ e }: { e: UsageEntry }) {
  const Icon = e.kind === 'chat' ? MessageSquareIcon : CpuIcon;
  return (
    <li className="flex min-w-0 items-center gap-2 py-1.5 text-xs" title={entryHover(e)}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{e.title}</span>
      <time className="shrink-0 text-muted-foreground">{when(e.at)}</time>
      <span className="num w-20 shrink-0 text-right text-muted-foreground">
        ↑{tokens(e.in)} ↓{tokens(e.out)}
      </span>
      <span className="num w-14 shrink-0 text-right">{usd(e.usd)}</span>
    </li>
  );
}

/**
 * A month of use: the total, each model (cost, tokens in and out, calls) and each chat and run,
 * newest first, with ‹ › to step through the months that have any.
 */
export function UsageHistoryView({
  client,
  className,
}: { client: AssistantAdapter; className?: string }) {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const q = useAssistantUsage(client, month);
  const h: UsageHistory | undefined = q.data;
  const at = h ? h.months.indexOf(h.month) : -1;
  const older = h && at >= 0 ? h.months[at + 1] : undefined;
  const newer = h && at > 0 ? h.months[at - 1] : undefined;
  if (!client.usage) return null;
  if (!h)
    return (
      <div className="flex justify-center p-4">
        {q.isError ? (
          <p className="text-muted-foreground text-sm">Usage didn't load. Try again later.</p>
        ) : (
          <Spinner />
        )}
      </div>
    );
  const models = perModel(h.rows);
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex items-center gap-1">
        <IconButton
          icon={ChevronLeftIcon}
          label="Earlier month"
          disabled={!older}
          onClick={() => setMonth(older)}
        />
        <span className="min-w-0 flex-1 truncate text-center font-medium text-sm">
          {monthName(h.month)}
        </span>
        <IconButton
          icon={ChevronRightIcon}
          label="Later month"
          disabled={!newer}
          onClick={() => setMonth(newer)}
        />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="num font-semibold text-2xl">{usd(h.usd)}</span>
        <span className="text-muted-foreground text-xs">
          {h.entries.length === 1 ? '1 chat or run' : `${h.entries.length} chats and runs`}
        </span>
      </div>
      {models.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-3 gap-y-0.5 text-xs">
          <span className="text-muted-foreground">Model</span>
          <span className="text-right text-muted-foreground">Cost</span>
          <span className="text-right text-muted-foreground">In</span>
          <span className="text-right text-muted-foreground">Out</span>
          <span className="text-right text-muted-foreground">Calls</span>
          {models.map((m) => (
            <Fragment key={m.label}>
              <span className="truncate font-medium" title={m.label}>
                {m.label}
              </span>
              <span className="num text-right">{usd(m.usd)}</span>
              <span className="num text-right">{tokens(m.in)}</span>
              <span className="num text-right">{tokens(m.out)}</span>
              <span className="num text-right">{m.calls}</span>
            </Fragment>
          ))}
        </div>
      )}
      {h.entries.length ? (
        <ul className="-my-1.5 max-h-72 divide-y overflow-y-auto">
          {h.entries.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Nothing used this month.</p>
      )}
    </div>
  );
}

/** The ranges the own-key table offers, in days. */
const OWN_RANGES = [
  { id: '1d', days: 1 },
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
] as const;
type OwnRange = (typeof OWN_RANGES)[number]['id'];

/**
 * Spend on the person's own keys and plans over the last 1, 7 or 30 days: one row a chat or run
 * (Session, Date, Amount), newest first, and a Total of the rows. A session counts in the range its
 * last use falls in. Shown when `always` (an own key or plan is set) or any session was paid on one.
 */
export function OwnKeyUsage({ client, always }: { client: AssistantAdapter; always?: boolean }) {
  const [range, setRange] = useState<OwnRange>('7d');
  const now = useAssistantUsage(client).data;
  // The month before, for a range that reaches back past this month's start.
  const before = now?.months[now.months.indexOf(now.month) + 1];
  const prev = useAssistantUsage(client, before, !!before && range === '30d').data;
  if (!now) return null;
  const all = [...now.entries, ...(range === '30d' ? (prev?.entries ?? []) : [])].filter(
    (e) => (e.own_usd ?? 0) > 0,
  );
  if (!always && !all.length) return null;
  const days = OWN_RANGES.find((r) => r.id === range)?.days ?? 7;
  const since = Date.now() - days * 86_400_000;
  const seen = new Set<string>();
  const sessions = all
    .filter((e) => e.at >= since && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => b.at - a.at);
  const total = sessions.reduce((a, e) => a + (e.own_usd ?? 0), 0);
  return (
    <div data-slot="setting-row" className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex items-center gap-4">
        <Label className="min-w-0 flex-1">
          <InfoLabel info="Each chat and run your own key or plan paid for, by its last use.">
            Spent on your keys
          </InfoLabel>
        </Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={range}
          aria-label="Range"
          onValueChange={(v) => v && setRange(v as OwnRange)}
        >
          {OWN_RANGES.map((r) => (
            <ToggleGroupItem key={r.id} value={r.id} aria-label={`Last ${r.id}`}>
              {r.id}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {sessions.length ? (
        <DetailsTable
          head={[
            { label: 'Session', grow: true },
            { label: 'Date', hideOnPhone: true },
            { label: 'Amount', right: true },
          ]}
          rows={sessions.map((e) => ({
            key: e.id,
            cells: [
              <span key="n" className="block truncate" title={e.title}>
                {e.title}
              </span>,
              <time
                key="t"
                dateTime={new Date(e.at).toISOString()}
                title={new Date(e.at).toLocaleString()}
              >
                {when(e.at)}
              </time>,
              usd(e.own_usd ?? 0),
            ],
          }))}
          foot={['Total', <span key="d" className="max-md:hidden" />, usd(total)]}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing spent on your keys in the last {range}.
        </p>
      )}
    </div>
  );
}
