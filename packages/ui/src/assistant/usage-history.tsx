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
import { SettingField } from '../setting-parts';
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

/** How the own-key table names calls a plan sign-in paid. */
const PLAN_NAME = 'ChatGPT plan';

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
export function OwnKeyUsage({
  client,
  always,
  usable,
}: {
  client: AssistantAdapter;
  always?: boolean;
  /** Providers the person can pay with now: earlier spend on any other is listed apart, uncounted. */
  usable?: string[];
}) {
  const [range, setRange] = useState<OwnRange>('7d');
  const now = useAssistantUsage(client).data;
  // The month before, for a range that reaches back past this month's start.
  const before = now?.months[now.months.indexOf(now.month) + 1];
  const prev = useAssistantUsage(client, before, !!before && range === '30d').data;
  if (!now) return null;
  const all = [...now.entries, ...(range === '30d' ? (prev?.entries ?? []) : [])].filter(
    (e) => (e.own_usd ?? 0) > 0 || (e.own_plan_calls ?? 0) > 0,
  );
  if (!always && !all.length) return null;
  const days = OWN_RANGES.find((r) => r.id === range)?.days ?? 7;
  const since = Date.now() - days * 86_400_000;
  const seen = new Set<string>();
  const sessions = all
    .filter((e) => e.at >= since && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => b.at - a.at);
  // This month's own spend that no chat or run carries (spent before per-chat tracking), so the
  // table never reads "nothing" while the cap's own numbers say otherwise.
  const tagged = now.entries.reduce((a, e) => a + (e.own_usd ?? 0), 0);
  // A plan sign-in's calls cost nothing, so they are no one's spend.
  const ownRows = now.rows.filter((r) => r.payer === 'own' && !r.free && r.way !== 'plan');
  const removed =
    usable && ownRows.length
      ? ownRows
          .filter((r) => r.provider && !usable.includes(r.provider))
          .reduce((a, r) => a + r.usd, 0)
      : 0;
  const ownMonth = ownRows.reduce((a, r) => a + r.usd, 0);
  const left = ownMonth - tagged - removed;
  const untracked = left >= 0.01 ? left : 0;
  const gone = removed >= 0.01 ? removed : 0;
  // A plan sign-in's calls at API rates (an estimate; the plan charged $0), so plan use counts too.
  const planRows = now.rows.filter(
    (r) => r.payer === 'own' && !r.free && (r.way === 'plan' || (!r.way && r.usd < 0.0005)),
  );
  const planListMonth = planRows.reduce((a, r) => a + (r.list_usd ?? 0), 0);
  const planListEarlier = Math.max(
    0,
    planListMonth - now.entries.reduce((a, e) => a + (e.own_plan_usd ?? 0), 0),
  );
  const keyTotal = sessions.reduce((a, e) => a + (e.own_usd ?? 0), 0) + untracked + gone;
  const planTotal = sessions.reduce((a, e) => a + (e.own_plan_usd ?? 0), 0);
  const earlier = 'Earlier this month, not per chat';
  const removedText = 'Key not in use now, not counted';
  // Calls a plan sign-in paid: free to the person, so listed by count. A $0 own row from before
  // rows recorded their way is a plan's too (a key call always costs something).
  const planCalls = planRows.reduce((a, r) => a + r.calls, 0);
  const calls = (n: number) => (n === 1 ? '1 call' : `${n} calls`);
  // Plan calls no chat or run carries (made before each entry kept its own count).
  const planEarlier = Math.max(
    0,
    planCalls - now.entries.reduce((a, e) => a + (e.own_plan_calls ?? 0), 0),
  );
  const planText = `Earlier, ${PLAN_NAME}, ${calls(planEarlier)}`;
  const named = (e: (typeof sessions)[number]) =>
    e.own_plan_calls ? `${e.title} · ${PLAN_NAME}, ${calls(e.own_plan_calls)}` : e.title;
  const total = keyTotal + planTotal + (planEarlier ? planListEarlier : 0);
  const anyPlan = planTotal > 0 || (planEarlier > 0 && planListEarlier > 0);
  // An amount with plan calls in it reads ≈: the plan's part is what API rates would charge.
  const amount = (key: number, plan: number, title: string) =>
    plan > 0 ? (
      <span key="a" title={title}>
        ≈{usd(key + plan)}
      </span>
    ) : (
      usd(key)
    );
  const planTitle = (key: number, plan: number) =>
    `${key > 0 ? `${usd(key)} on your key + ` : ''}about ${usd(plan)} at API rates on your ${PLAN_NAME}, which charged $0`;
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pb-3 first:border-t-0">
      <SettingField
        label="Spent on your keys"
        info="Each chat and run your own key or plan paid for, by its last use. A ≈ amount prices plan calls at API rates; the plan charges $0."
        className="border-t-0"
        end={
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
        }
      />
      {sessions.length || untracked || gone || planEarlier ? (
        <DetailsTable
          head={[
            { label: 'Session', grow: true },
            { label: 'Date', hideOnPhone: true },
            { label: 'Amount', right: true },
          ]}
          rows={[
            ...sessions.map((e) => ({
              key: e.id,
              cells: [
                <span key="n" className="block truncate" title={named(e)}>
                  {named(e)}
                </span>,
                <time
                  key="t"
                  dateTime={new Date(e.at).toISOString()}
                  title={new Date(e.at).toLocaleString()}
                >
                  {when(e.at)}
                </time>,
                amount(
                  e.own_usd ?? 0,
                  e.own_plan_usd ?? 0,
                  planTitle(e.own_usd ?? 0, e.own_plan_usd ?? 0),
                ),
              ],
            })),
            ...(untracked
              ? [
                  {
                    key: 'earlier',
                    cells: [
                      <span
                        key="n"
                        className="block truncate text-muted-foreground"
                        title={earlier}
                      >
                        {earlier}
                      </span>,
                      <span key="t" />,
                      usd(untracked),
                    ],
                  },
                ]
              : []),
            ...(gone
              ? [
                  {
                    key: 'removed',
                    cells: [
                      <span
                        key="n"
                        className="block truncate text-muted-foreground"
                        title={removedText}
                      >
                        {removedText}
                      </span>,
                      <span key="t" />,
                      usd(gone),
                    ],
                  },
                ]
              : []),
            ...(planEarlier
              ? [
                  {
                    key: 'plan',
                    cells: [
                      <span
                        key="n"
                        className="block truncate text-muted-foreground"
                        title={planText}
                      >
                        {planText}
                      </span>,
                      <span key="t" />,
                      amount(0, planListEarlier, planTitle(0, planListEarlier)),
                    ],
                  },
                ]
              : []),
          ]}
          foot={[
            'Total',
            <span key="d" className="max-md:hidden" />,
            anyPlan
              ? amount(keyTotal, total - keyTotal, planTitle(keyTotal, total - keyTotal))
              : usd(total),
          ]}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing spent on your keys in the last {range}.
        </p>
      )}
    </div>
  );
}
