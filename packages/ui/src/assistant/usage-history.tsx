// A person's assistant use over a month: the total, each tier and model, and each chat and run of
// background work (`GET /usage`). The panel's footer opens it; Settings ▸ Spend shows it in place.
import type { UsageEntry, UsageHistory, UsagePart } from '@columenlabs/lumen-ui-types/assistant';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CpuIcon,
  HashIcon,
  KeyRoundIcon,
  MessageSquareIcon,
  ReceiptIcon,
} from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import { DetailsTable } from '../details-table';
import { IconButton } from '../icon-button';
import { InfoLabel } from '../info-tip';
import { cn } from '../lib/utils';
import { type FilterField, LumenTokenizedFilter, useLumenFilter } from '../lumen-filter';
import { LumenTable } from '../lumen-view';
import { SettingField } from '../setting-parts';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Spinner } from '../ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { CHIP_TONE, type ViewChipTone, type ViewDomain, type ViewField } from '../view-model';
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
  // An amount with plan calls in it is an estimate: the plan's part is what API rates would charge.
  const amount = (key: number, plan: number, title: string) =>
    plan > 0 ? (
      <span key="a" title={title}>
        {usd(key + plan)}
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
        info="Each chat and run your own key or plan paid for, by its last use. Plan amounts are estimates at API rates; the plan charges $0."
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

/**
 * What one chat has cost so far, as a chip for the assistant's header: what was charged (credits or
 * the person's key) plus a plan sign-in's calls at API rates (an estimate, said in its hover).
 * Nothing while the chat has no history line. The hover splits it.
 */
export function AssistantChatCost({
  client,
  chatId,
  busy,
}: {
  client: AssistantAdapter;
  chatId: string | null | undefined;
  /** The chat is answering: the chip reads its history again when the answer ends. */
  busy?: boolean;
}) {
  const q = useAssistantUsage(client, undefined, !!chatId);
  const { refetch } = q;
  // Read again once an answer ends, so the chip follows the chat.
  useEffect(() => {
    if (!busy && chatId) void refetch();
  }, [busy, chatId, refetch]);
  const e = chatId ? q.data?.entries.find((x) => x.id === `chat:${chatId}`) : undefined;
  if (!e) return null;
  const plan = e.own_plan_usd ?? 0;
  const charged = e.usd;
  const total = charged + plan;
  if (total < 0.005 && !e.own_plan_calls) return null;
  const own = e.own_usd ?? 0;
  const lines = [
    own > 0 ? `${usd(own)} on your key` : null,
    charged - own >= 0.005 ? `${usd(charged - own)} on credits` : null,
    e.own_plan_calls
      ? `${e.own_plan_calls === 1 ? '1 call' : `${e.own_plan_calls} calls`} on your ${PLAN_NAME}: ${usd(plan)} estimate at API rates (charged $0)`
      : null,
  ].filter(Boolean) as string[];
  const text = usd(total);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`This chat cost ${text}`}
          className="shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Badge variant="outline" className="num whitespace-nowrap">
            {text}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">This chat</span>
          {lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Who paid for a usage row: the person's API key, their plan sign-in, or the app's credits. */
type UsageType = 'key' | 'plan' | 'credits' | 'internal';
const TYPE_LABEL: Record<UsageType, string> = {
  key: 'API key',
  plan: 'Sign-in',
  credits: 'Credits',
  internal: 'Internal',
};
const TYPE_TONE: Record<UsageType, ViewChipTone> = {
  key: 'sky',
  plan: 'amber',
  credits: 'muted',
  internal: 'muted',
};

/** One line of the usage table: a chat or run, or a month's spend no chat or run carries. */
interface UsageRow {
  id: string;
  title: string;
  type: UsageType;
  /** Last use, ms; 0 for spend from before each chat kept its own count. */
  at: number;
  calls: number;
  /** Tokens, where the row kept them. */
  tokens?: { in: number; read: number; out: number };
  /** What the person's key paid, the app's credits paid, and a plan's calls at API rates. */
  key: number;
  credits: number;
  plan: number;
  /** Calls a plan sign-in answered. */
  planCalls?: number;
}
/** Dollars with no `<` or `≈` (the table's note says which amounts are estimates). */
const money = (n: number) => (n === 0 ? '$0' : `$${n.toFixed(n < 10 ? 2 : 0)}`);
const amountOf = (r: UsageRow) => r.key + r.credits + r.plan;
const EARLIER = 'Earlier';

/** This month's rows: every chat and run, then the spend no chat or run carries, by who paid. */
function usageRows(h: UsageHistory): UsageRow[] {
  // One row a session: a chat, or every run of one task on one thing (each Rebuild of a part).
  const sessions = new Map<string, UsageRow>();
  for (const e of h.entries) {
    const key = e.own_usd ?? 0;
    const plan = e.own_plan_usd ?? 0;
    const id = e.kind === 'chat' ? e.id : `task:${e.task ?? ''}:${e.title}`;
    const s = sessions.get(id);
    const planCalls = (s?.planCalls ?? 0) + (e.own_plan_calls ?? 0);
    const row: UsageRow = {
      id,
      title: e.title,
      type: 'credits',
      at: Math.max(s?.at ?? 0, e.at),
      calls: (s?.calls ?? 0) + e.calls,
      tokens: {
        in: (s?.tokens?.in ?? 0) + e.in,
        read: (s?.tokens?.read ?? 0) + e.read,
        out: (s?.tokens?.out ?? 0) + e.out,
      },
      key: (s?.key ?? 0) + key,
      credits: (s?.credits ?? 0) + Math.max(0, e.usd - key),
      plan: (s?.plan ?? 0) + plan,
      planCalls,
    };
    // Its type is whoever paid most; the hover splits the rest.
    const top = Math.max(row.key, row.credits, row.plan);
    row.type =
      row.plan > 0 && row.plan === top
        ? 'plan'
        : row.key > 0 && row.key === top
          ? 'key'
          : row.credits > 0 || !planCalls
            ? 'credits'
            : 'plan';
    if (e.internal) row.type = 'internal';
    sessions.set(id, row);
  }
  const out = [...sessions.values()];
  const sum = (xs: number[]) => xs.reduce((a, n) => a + n, 0);
  const earlier = (type: UsageType, title: string, calls: number, amount: number) =>
    amount >= 0.01 &&
    out.push({
      id: `earlier:${type}:${title}`,
      title,
      type,
      at: 0,
      calls,
      key: type === 'key' ? amount : 0,
      credits: type === 'credits' ? amount : 0,
      plan: type === 'plan' ? amount : 0,
    });
  const own = h.rows.filter((r) => r.payer === 'own' && !r.free);
  const plans = own.filter((r) => r.way === 'plan' || (!r.way && r.usd < 0.0005));
  const keys = own.filter((r) => !plans.includes(r));
  const app = h.rows.filter((r) => r.payer !== 'own' && !r.free);
  earlier(
    'key',
    'Earlier this month, not per chat',
    Math.max(
      0,
      sum(keys.map((r) => r.calls)) - sum(h.entries.filter((e) => e.own_usd).map((e) => e.calls)),
    ),
    sum(keys.map((r) => r.usd)) - sum(h.entries.map((e) => e.own_usd ?? 0)),
  );
  earlier(
    'plan',
    'Earlier this month, not per chat',
    Math.max(0, sum(plans.map((r) => r.calls)) - sum(h.entries.map((e) => e.own_plan_calls ?? 0))),
    sum(plans.map((r) => r.list_usd ?? 0)) - sum(h.entries.map((e) => e.own_plan_usd ?? 0)),
  );
  earlier(
    'credits',
    'Earlier this month, not per chat',
    Math.max(
      0,
      sum(app.map((r) => r.calls)) -
        sum(h.entries.filter((e) => e.usd > (e.own_usd ?? 0)).map((e) => e.calls)),
    ),
    sum(app.map((r) => r.usd)) - sum(h.entries.map((e) => Math.max(0, e.usd - (e.own_usd ?? 0)))),
  );
  // The app's own calls are kept (and counted above, so no Earlier row takes them) but not shown.
  return out.filter((r) => r.type !== 'internal');
}

/** A row's hover: its tokens (cache reads as a share of input) and what it cost, by who paid. */
function UsageTip({ r, children }: { r: UsageRow; children: ReactNode }) {
  const t = r.tokens;
  const lines: [string, string][] = [
    ...(t
      ? ([
          ['Input', tokens(t.in)],
          ['Cache read', `${tokens(t.read)} · ${t.in ? Math.round((t.read / t.in) * 100) : 0}%`],
          ['Output', tokens(t.out)],
        ] as [string, string][])
      : []),
    ...(r.key > 0 ? ([['Cost (your key)', money(r.key)]] as [string, string][]) : []),
    ...(r.credits > 0 || (r.type === 'credits' && !r.plan)
      ? ([['Credits', money(r.credits)]] as [string, string][])
      : []),
    ...(r.plan > 0 || r.type === 'plan'
      ? ([['Estimate (API rates)', money(r.plan)]] as [string, string][])
      : []),
  ];
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-72">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="whitespace-normal break-words font-medium">{r.title}</span>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
            {lines.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="opacity-75">{k}</dt>
                <dd className="num text-right">{v}</dd>
              </Fragment>
            ))}
          </dl>
          {!t && <span className="opacity-75">Spent before each chat kept its own count.</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Midnight of `d`'s day, local time. */
const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Days from `at`'s day back to today (0 today, 1 yesterday). */
const daysAgo = (at: number) =>
  Math.round((startOf(new Date()) - startOf(new Date(at))) / 86_400_000);
/** Days since Monday, today included (0 on a Monday). */
const sinceMonday = () => (new Date().getDay() + 6) % 7;
const sameMonth = (at: number) => {
  const d = new Date(at);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
};

/** Grouping by date: Today, Yesterday, This week, This month, then each month by name. Spend
 *  from before chats kept their own count is this month's. */
const dayOf = (at: number) => {
  if (!at) return 'This month';
  const n = daysAgo(at);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n <= sinceMonday()) return 'This week';
  if (sameMonth(at)) return 'This month';
  return new Date(at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

/** A row's date: today's time, Yesterday, the weekday this week, else the day. */
const relWhen = (at: number) => {
  const n = daysAgo(at);
  if (n <= 0)
    return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (n === 1) return 'Yesterday';
  if (n <= sinceMonday()) return new Date(at).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const USAGE_FIELDS: ViewField<UsageRow>[] = [
  {
    key: 'title',
    label: 'Session',
    icon: MessageSquareIcon,
    format: 'text',
    // Names run long (a chat's first line): as wide as the table leaves after its other columns
    // (the table's box is a size container), never under the usual name column.
    maxWidth: 'max(12rem, calc(100cqw - 22rem))',
    value: (r) => r.title,
    render: (r) => (
      <UsageTip r={r}>
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard reaches the row's hover
          tabIndex={0}
          className={cn(
            'rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            !r.at && 'text-muted-foreground',
          )}
        >
          {r.title}
        </span>
      </UsageTip>
    ),
  },
  {
    key: 'type',
    label: 'Type',
    icon: KeyRoundIcon,
    format: 'text',
    groupable: true,
    filterable: true,
    value: (r) => TYPE_LABEL[r.type],
    render: (r) => (
      <UsageTip r={r}>
        <Badge variant="outline" className={cn('whitespace-nowrap', CHIP_TONE[TYPE_TONE[r.type]])}>
          {TYPE_LABEL[r.type]}
        </Badge>
      </UsageTip>
    ),
  },
  {
    key: 'at',
    label: 'Date',
    icon: CalendarIcon,
    format: 'integer',
    hideOnPhone: true,
    value: (r) => r.at,
    render: (r) => (
      <UsageTip r={r}>
        {r.at ? (
          <time dateTime={new Date(r.at).toISOString()} className="text-muted-foreground">
            {relWhen(r.at)}
          </time>
        ) : (
          <span className="text-muted-foreground">{EARLIER}</span>
        )}
      </UsageTip>
    ),
  },
  {
    key: 'calls',
    label: 'Calls',
    icon: HashIcon,
    format: 'integer',
    hideOnPhone: true,
    aggregate: 'sum',
    value: (r) => r.calls,
    render: (r) => (
      <UsageTip r={r}>
        <span>{r.calls}</span>
      </UsageTip>
    ),
  },
  {
    key: 'amount',
    label: 'Amount',
    icon: ReceiptIcon,
    format: 'price',
    aggregate: 'sum',
    value: (r) => amountOf(r),
    render: (r) => (
      <UsageTip r={r}>
        <span>{money(amountOf(r))}</span>
      </UsageTip>
    ),
    rollRender: (rows) => money(rows.reduce((a, r) => a + amountOf(r), 0)),
  },
];
/** Grouping by date: each day, then the spend from before chats kept their own count. */
const DAY_FIELD: ViewField<UsageRow> = {
  key: 'day',
  label: 'Date',
  icon: CalendarIcon,
  format: 'text',
  groupable: true,
  value: (r) => dayOf(r.at),
};
const USAGE_DOMAIN: ViewDomain<UsageRow> = {
  id: 'assistant-usage',
  fields: USAGE_FIELDS,
  rowKey: (r) => r.id,
  text: (r) => [r.title],
  formulas: false,
};
const USAGE_FILTER: FilterField<UsageRow>[] = [
  { key: 'type', label: 'Type', icon: KeyRoundIcon, values: (r) => [TYPE_LABEL[r.type]] },
];
const GROUPS = [
  { id: 'type', label: 'Type', field: USAGE_FIELDS[1] },
  { id: 'none', label: 'None', field: null },
  { id: 'date', label: 'Date', field: DAY_FIELD },
] as const;
type UsageGroup = (typeof GROUPS)[number]['id'];

/**
 * This month's use, one row a session (a chat, or every run of one task on one thing): its Type (the person's API key, their plan sign-in, or
 * the app's credits), Date, Calls and Amount, grouped by Type, Date or not at all, filtered by
 * type or name. A row's hover gives its tokens and cost. A sign-in's amount is an estimate: the
 * same tokens at the model's API rates (the plan charges $0).
 */
export function AssistantUsageTable({ client }: { client: AssistantAdapter }) {
  const [group, setGroup] = useState<UsageGroup>('type');
  const q = useAssistantUsage(client);
  const rows = useMemo(() => (q.data ? usageRows(q.data) : []), [q.data]);
  const filter = useLumenFilter(rows, USAGE_FILTER, { text: (r) => [r.title] });
  if (!client.usage) return null;
  if (!q.data)
    return (
      <div className="flex justify-center p-4">
        {q.isError ? (
          <p className="text-muted-foreground text-sm">Usage didn't load. Try again later.</p>
        ) : (
          <Spinner />
        )}
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <LumenTokenizedFilter
          filter={filter}
          label="Filter usage"
          placeholder="Filter: type, or a session name"
          className="min-w-48 flex-1"
          link={null}
        />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={group}
          aria-label="Group by"
          onValueChange={(v) => v && setGroup(v as UsageGroup)}
        >
          {GROUPS.map((g) => (
            <ToggleGroupItem key={g.id} value={g.id} aria-label={`Group by ${g.label}`}>
              {g.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="@container min-w-0">
        <LumenTable
          domain={USAGE_DOMAIN}
          rows={filter.results}
          groupBy={GROUPS.find((g) => g.id === group)?.field ?? null}
          sort={{ key: 'at', desc: true }}
          emptyState={
            rows.length ? undefined : (
              <p className="text-muted-foreground text-sm">Nothing used this month.</p>
            )
          }
          onClearFilter={filter.clear}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Sign-in amounts are estimates: your {PLAN_NAME} charges $0, so the amount is what the same
        tokens would cost at the model's API rates. Key and credit amounts are what was charged.
      </p>
    </div>
  );
}
