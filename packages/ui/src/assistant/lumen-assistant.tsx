// LumenAssistant: the chat that fills LumenAssistantPanel, for any app's assistant served by
// `@columenlabs/lumen-ai/assistant`. A header with the tier, Chats and New chat; the chat itself
// (the person's messages, the answer as it streams, each tool call as a line, drafted changes as
// cards to Save or Dismiss, work handed to a higher tier in its own section); and the composer,
// with Stop, a queued message and the chat's cost and context under it.
import type {
  AllowanceState,
  AllowanceUnit,
  AssistantMessage,
  AssistantRefNote,
  AssistantStatus,
  ChatItem,
  ChatUsage,
  DraftItem,
  HandOffItem,
  StepItem,
} from '@columenlabs/lumen-ui-types/assistant';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  CornerDownRightIcon,
  CrosshairIcon,
  FileTextIcon,
  LightbulbIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  SquareIcon,
  Undo2Icon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import {
  LumenAssistantButton,
  LumenAssistantChats,
  LumenAssistantPanel,
  assistantOpen,
  useAssistantHotkey,
} from '../assistant-panel';
import { IconButton } from '../icon-button';
import { errorText } from '../integrations';
import { cn } from '../lib/utils';
import {
  type LumenOption,
  LumenSelector,
  LumenSelectorList,
  type LumenSelectorListHandle,
} from '../lumen-selector';
import { lumenToast } from '../lumen-toast';
import { useOpenSettings } from '../shell';
import {
  type PointedAt,
  cardsOnScreen,
  kindName,
  pointAt,
  sectionsOnScreen,
  targetEl,
  textOf,
} from '../spotlight';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Spinner } from '../ui/spinner';
import { Textarea } from '../ui/textarea';
import type { AssistantAdapter } from './client';
import { chatMarkdown, chatTurns, copyMarkdown, turnMarkdown } from './copy';
import {
  type AssistantSource,
  composeAssistant,
  selectionRef,
  useComposeRequest,
  usePageSelection,
  useShownAssistantSources,
} from './sources';
import { type AssistantChatState, type LiveItem, useAssistantChat } from './use-assistant-chat';

/** The main model's context drawn full (tokens); the mark sits where the assistant compacts. */
const CONTEXT_MAX = 200_000;
const COMPACT_AT = 150_000;

export const assistantStatusKey = (client: AssistantAdapter) => [
  'lumen-assistant',
  client.key,
  'status',
];

/** The person's assistant status, shared by the panel and Settings. */
export function useAssistantStatus(client: AssistantAdapter) {
  return useQuery({ queryKey: assistantStatusKey(client), queryFn: () => client.status() });
}

export const usd = (n: number) =>
  n === 0 ? '$0' : n < 0.01 ? '<$0.01' : `$${n.toFixed(n < 10 ? 2 : 0)}`;
const tokens = (n: number) =>
  n < 1000
    ? String(n)
    : n < 1_000_000
      ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
      : `${(n / 1e6).toFixed(1)}M`;
const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export interface LumenAssistantProps {
  client: AssistantAdapter;
  /** The page the person is on, sent with each message. */
  context?: AssistantMessage['context'];
  /** Opens the app's Settings at the assistant (from a "not connected" line). */
  onSettings?: () => void;
  /** Days chats are kept, for the Chats menu's line. */
  keepDays?: number;
  /** Closes the panel (its ✕). */
  onClose?: () => void;
  /** An outside chat state (the dock shares one between the button and the panel). */
  chat?: AssistantChatState;
  /**
   * The app's own slash commands, listed before the server's (`createAssistant` `commands`) and the
   * kit's: /compact, /clear, /model and /escalate.
   */
  commands?: AssistantCommand[];
  /** What `#` lists everywhere; a page adds its own with `useAssistantSource`. */
  sources?: readonly AssistantSource[];
}

/** A slash command: typing `/` in the composer lists them. */
export interface AssistantCommand {
  /** Typed after the slash: `story`. */
  name: string;
  /** One line in the list. */
  about: string;
  /** What follows the name, shown in the list (`<words>`). Without it, picking it runs it. */
  args?: string;
  /** Choices for the words after it, listed as they are typed (a tier, a saved search). */
  options?: () => LumenOption[];
  /** Runs it: a string is sent as the message; nothing when the command acted itself. */
  run: (args: string) => string | undefined | Promise<string | undefined>;
}

/** The assistant's chat: header, messages and composer. */
export function LumenAssistant({
  client,
  context,
  onSettings,
  keepDays = 30,
  onClose,
  chat: outside,
  commands = [],
  sources = [],
}: LumenAssistantProps) {
  const own = useAssistantChat(client);
  const chat = outside ?? own;
  const qc = useQueryClient();
  const status = useAssistantStatus(client);
  const chats = useQuery({
    queryKey: ['lumen-assistant', client.key, 'chats'],
    queryFn: () => client.chats(),
    enabled: false,
  });
  const s = status.data;
  const name = s?.name ?? 'Assistant';
  // A finished answer changes the spend and the chats list.
  useEffect(() => {
    if (chat.busy) return;
    void qc.invalidateQueries({ queryKey: ['lumen-assistant', client.key] });
  }, [chat.busy, qc, client.key]);

  const setTier = async (tier: string) => {
    try {
      qc.setQueryData(assistantStatusKey(client), await client.settings({ tier }));
    } catch (e) {
      lumenToast.error(errorText(e));
    }
  };

  const tiers = s?.tiers ?? [];
  const above = tiers.slice(tiers.findIndex((t) => t.id === s?.tier) + 1);
  // The kit's commands; the app's own (`commands`, then the server's) come first and win a name.
  const builtIns: AssistantCommand[] = [
    {
      name: 'compact',
      about: 'Summarise the chat so far to free up context',
      run: () => '/compact',
    },
    {
      name: 'copy',
      about: 'Copy the last turn as Markdown',
      run: () => {
        const last = chatTurns(chat.items).at(-1);
        if (last) copyMarkdown(turnMarkdown(last.items, name), 'Turn');
        return undefined;
      },
    },
    {
      name: 'clear',
      about: 'Start a new chat',
      run: () => {
        chat.reset();
        return undefined;
      },
    },
    ...(tiers.length > 1
      ? [
          {
            name: 'model',
            about: 'Answer on another tier from now on',
            args: '<tier>',
            options: () =>
              tiers.map((t) => ({ value: t.id, label: t.label, detail: t.model_label })),
            run: (arg: string) => {
              const t = tiers.find(
                (x) => x.id === arg || x.label.toLowerCase() === arg.toLowerCase(),
              );
              if (t) void setTier(t.id);
              else lumenToast.error(`No tier is called ${arg || 'that'}.`);
              return undefined;
            },
          },
        ]
      : []),
    ...(above[0]
      ? [
          {
            name: 'escalate',
            about: `Hand a task to ${above[0].label}`,
            args: '<task>',
            run: (task: string) => {
              if (task.trim())
                chat.send(task, { ...(context ? { context } : {}), tier: above[0]?.id as string });
              return undefined;
            },
          },
        ]
      : []),
  ];
  const served: AssistantCommand[] = (s?.commands ?? []).map((c) => ({
    ...c,
    run: (args: string) => `/${c.name}${args ? ` ${args}` : ''}`,
  }));
  const allCommands: AssistantCommand[] = [];
  for (const c of [...commands, ...served, ...builtIns])
    if (!allCommands.some((x) => x.name === c.name)) allCommands.push(c);
  const shown = useShownAssistantSources();
  const allSources = [...shown, ...sources.filter((x) => !shown.some((y) => y.id === x.id))];

  return (
    <div data-assistant="" className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <SparklesIcon className="size-4 text-edge" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {chat.title || s?.name || 'Assistant'}
        </span>
        {s && s.tiers.length > 1 && (
          <LumenSelector
            trigger="chip"
            size="sm"
            label="Tier"
            value={s.tier}
            options={s.tiers.map((t) => ({ value: t.id, label: t.label, detail: t.model_label }))}
            onChange={(t) => void setTier(t)}
          />
        )}
        <LumenAssistantChats
          chats={
            chats.data?.map((c) => ({
              id: c.id,
              title: c.title,
              updated_at: new Date(c.at).toISOString(),
            })) ?? (chats.isFetched ? [] : null)
          }
          value={chat.chatId ?? undefined}
          note={`Chats are kept ${keepDays} days after their last message.`}
          onRefresh={() => void chats.refetch()}
          onOpen={(c) => void chat.open(c.id)}
        />
        <IconButton
          icon={CopyIcon}
          label="Copy chat"
          disabled={!chat.items.length}
          onClick={() => copyMarkdown(chatMarkdown(chat.title, chat.items, name), 'Chat')}
        />
        <IconButton
          icon={PlusIcon}
          label="New chat"
          disabled={!chat.items.length}
          onClick={chat.reset}
        />
        {onClose && (
          <IconButton icon={XIcon} label={`Close ${s?.name ?? 'assistant'}`} onClick={onClose} />
        )}
      </div>
      <AssistantName.Provider value={name}>
        <Messages chat={chat} status={s} onSettings={onSettings} />
      </AssistantName.Provider>
      <LumenComposer
        name={s?.name ?? 'the assistant'}
        busy={chat.busy}
        queued={chat.queued}
        disabled={!s || !!s.wait}
        commands={allCommands}
        tiers={tiers}
        sources={allSources}
        page={context?.label}
        onSend={(text, extra) => chat.send(text, { ...(context ? { context } : {}), ...extra })}
        onStop={chat.stop}
      />
      <UsageLine usage={chat.usage} />
    </div>
  );
}

function Messages({
  chat,
  status,
  onSettings,
}: {
  chat: AssistantChatState;
  status: AssistantStatus | undefined;
  onSettings?: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = JSON.stringify(chat.items).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the end as the chat grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  // The app's own link to Settings, else the shell's, at the section that answers the wait.
  const shellSettings = useOpenSettings();
  const settings = onSettings ? (_section: string) => onSettings() : shellSettings;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {status?.wait && (
        <Alert className="mb-3">
          <CircleAlertIcon />
          <AlertDescription className="flex flex-col items-start gap-2">
            {status.wait === 'app_cap' && status.allowance
              ? allowanceWait(status.allowance)
              : WAIT[status.wait](
                  status.admin,
                  status.providers.find((p) => p.id === status.wait_provider)?.label ?? 'API',
                )}
            {settings && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  settings(
                    status.wait === 'app_cap' && status.allowance
                      ? 'assistant-allowance'
                      : 'assistant-providers',
                  )
                }
              >
                {status.wait === 'app_cap' &&
                status.allowance &&
                status.allowance.request?.status !== 'open'
                  ? 'Request more'
                  : 'Open Settings'}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {chat.loading ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner /> Loading the chat…
        </p>
      ) : chat.items.length === 0 && !status?.wait ? (
        <p className="pt-8 text-center text-muted-foreground text-sm">
          Ask {status?.name ?? 'the assistant'} anything.
        </p>
      ) : (
        <TierNames.Provider value={(id) => status?.tiers.find((t) => t.id === id)?.label ?? id}>
          <UndoWrite.Provider value={chat.undo}>
            <Items items={chat.items} onSettle={chat.settle} busy={chat.busy} turns />
          </UndoWrite.Provider>
        </TierNames.Provider>
      )}
      {chat.busy && !chat.items.some(isLive) && (
        <p className="flex items-center gap-2 py-1 text-muted-foreground text-sm">
          <Spinner /> Thinking…
        </p>
      )}
      <div ref={end} />
    </div>
  );
}

const isLive = (i: LiveItem): boolean =>
  !!i.live || (i.kind === 'handoff' && (i.items as LiveItem[]).some(isLive));

const WAIT: Record<
  NonNullable<AssistantStatus['wait']>,
  (admin: boolean, provider: string) => string
> = {
  not_connected: (admin, provider) =>
    admin
      ? `Add an ${provider} key in Settings ▸ Model providers, or pick another model in Models.`
      : `No ${provider} key is set yet. Add your own in Settings, or pick another model in Models.`,
  app_cap: () =>
    "You reached this month's cap on the shared keys. Add your own key, or wait for next month.",
  own_cap: () => 'Your own keys reached their monthly cap. Raise it in Settings ▸ Model providers.',
};

/** An allowance in its unit: `$4.20`, or `350 credits`. */
export const allowanceAmount = (u: AllowanceUnit, n: number) =>
  u.usd === 1 && u.many === 'dollars'
    ? usd(n)
    : `${n.toLocaleString()} ${n === 1 ? u.one : u.many}`;

function allowanceWait(a: AllowanceState) {
  if (a.request?.status === 'open')
    return `You used your allowance on the shared keys. Your request for ${allowanceAmount(a.unit, a.request.amount)} is waiting, or add your own key.`;
  return a.period === 'once'
    ? 'You used your allowance on the shared keys. Request more, or add your own key.'
    : "You used this month's allowance on the shared keys. Request more, or add your own key.";
}

/** The assistant's name, for a copied turn's headings. */
const AssistantName = createContext('Assistant');
/** A tier's name for a message's `@` chip. */
const TierNames = createContext<(id: string) => string>((id) => id);
/** Takes back a change made at once (Undo on its line). */
const UndoWrite = createContext<((s: StepItem) => Promise<void>) | null>(null);

function Items({
  items,
  onSettle,
  busy,
  turns,
}: {
  items: (ChatItem | LiveItem)[];
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
  /** At the top level each turn sits in one block with a copy icon (on hover; always on touch). */
  turns?: boolean;
}) {
  const name = useContext(AssistantName);
  if (turns)
    return (
      <div className="flex flex-col gap-3">
        {chatTurns(items).map((t) => {
          const open = busy && t.from + t.items.length === items.length;
          return (
            <div key={t.from} data-slot="assistant-turn" className="group/turn flex flex-col gap-3">
              <Items items={t.items} onSettle={onSettle} busy={busy} />
              {!open && (
                <div className="-mt-2 flex justify-end opacity-0 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <IconButton
                    icon={CopyIcon}
                    label="Copy this turn"
                    className="size-6 text-muted-foreground"
                    onClick={() => copyMarkdown(turnMarkdown(t.items as ChatItem[], name), 'Turn')}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  // Cards drafted one after another sit in one stack, so many of them skim as lines.
  const rows: ({ at: number; item: LiveItem } | { at: number; drafts: DraftItem[] })[] = [];
  items.forEach((item, at) => {
    const last = rows[rows.length - 1];
    const prev = items[at - 1];
    if (item.kind === 'draft' && prev?.kind === 'draft' && last) {
      if ('drafts' in last) last.drafts.push(item);
      else rows[rows.length - 1] = { at: last.at, drafts: [prev as DraftItem, item] };
    } else rows.push({ at, item: item as LiveItem });
  });
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) =>
        'drafts' in r ? (
          <DraftStack key={r.at} drafts={r.drafts} onSettle={onSettle} busy={busy} />
        ) : (
          <Item key={r.at} item={r.item} onSettle={onSettle} busy={busy} />
        ),
      )}
    </div>
  );
}

function Item({
  item,
  onSettle,
  busy,
}: {
  item: LiveItem;
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
}) {
  const tierName = useContext(TierNames);
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-8 self-end rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          {(item.tier || item.refs?.length) && (
            <span className="mb-1 flex flex-wrap gap-1">
              {item.tier && <ComposerChip sign="@" label={tierName(item.tier)} />}
              {item.refs?.map((r, i) => (
                <ComposerChip key={`${r.kind}:${r.label}:${i}`} sign="#" label={r.label} />
              ))}
            </span>
          )}
          {item.text}
          {item.context && (
            <span className="mt-1 block text-muted-foreground text-xs">on {item.context}</span>
          )}
        </div>
      );
    case 'text':
      return (
        <div className="prose-sm text-sm leading-relaxed [&_code]:font-code [&_code]:text-xs [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_ul]:list-disc">
          <Markdown
            allowedElements={['p', 'strong', 'em', 'code', 'ul', 'ol', 'li', 'a', 'pre', 'br']}
            unwrapDisallowed
          >
            {item.text}
          </Markdown>
          {item.live && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/60 align-middle" />
          )}
        </div>
      );
    case 'step':
      return <Step step={item} live={!!item.live} />;
    case 'draft':
      return <Draft draft={item} onSettle={onSettle} busy={busy} />;
    case 'handoff':
      return <HandOff item={item} onSettle={onSettle} busy={busy} />;
    case 'advice':
      return (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          {item.live ? <Spinner className="size-3" /> : <LightbulbIcon className="size-3.5" />}
          {item.live
            ? `Asking ${item.label}…`
            : item.error
              ? `${item.label} could not advise (${item.error})`
              : `Asked ${item.label}`}
        </p>
      );
    case 'compacted':
      return <Rule>Compacted: earlier messages are sent as a summary</Rule>;
    case 'stopped':
      return <Rule>{item.reason === 'cap' ? "Stopped at this month's spend cap" : 'Stopped'}</Rule>;
    case 'error':
      return (
        <p role="alert" className="flex items-start gap-1.5 text-loss text-sm">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {item.text}
        </p>
      );
  }
}

const Rule = ({ children }: { children: ReactNode }) => (
  <p className="flex items-center gap-2 text-muted-foreground text-xs before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
    {children}
  </p>
);

function Step({ step, live }: { step: StepItem; live: boolean }) {
  const undo = useContext(UndoWrite);
  const [undoing, setUndoing] = useState(false);
  const w = step.write;
  const take = async () => {
    if (!undo) return;
    setUndoing(true);
    try {
      await undo(step);
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setUndoing(false);
    }
  };
  return (
    <p
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs',
        step.ok ? 'text-muted-foreground' : 'text-loss',
      )}
    >
      {live ? (
        <Spinner className="size-3" />
      ) : w ? (
        <PencilIcon className="size-3.5 shrink-0" />
      ) : step.ok ? (
        <WrenchIcon className="size-3.5 shrink-0" />
      ) : (
        <CircleAlertIcon className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{step.title}</span>
      {!live && (
        <span className="shrink-0 tabular-nums">
          {step.rows !== undefined && `${step.rows} row${step.rows === 1 ? '' : 's'} · `}
          {seconds(step.ms)}
        </span>
      )}
      {step.error && <span className="truncate">· {step.error}</span>}
      {w?.status === 'undone' ? (
        <span className="shrink-0">· Undone</span>
      ) : (
        w?.undo &&
        undo && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 shrink-0 px-2 text-xs"
            disabled={undoing}
            onClick={() => void take()}
          >
            {undoing ? <Spinner /> : <Undo2Icon />}
            Undo
          </Button>
        )
      )}
    </p>
  );
}

/** The arguments as short lines: `name: value`. */
function argLines(args: unknown): [string, string][] {
  if (!args || typeof args !== 'object') return [];
  return Object.entries(args as Record<string, unknown>).map(([k, v]) => [
    k,
    typeof v === 'string' ? v : JSON.stringify(v),
  ]);
}

/** One line that says what a card would change: its first few values. */
const argSummary = (args: unknown) =>
  argLines(args)
    .slice(0, 3)
    .map(([, v]) => v)
    .join(' · ');

function DraftStatus({ draft }: { draft: DraftItem }) {
  return draft.status === 'saved' ? (
    <span className="flex shrink-0 items-center gap-1 text-gain text-xs">
      <CheckIcon className="size-3.5" /> Saved
    </span>
  ) : draft.status === 'dismissed' ? (
    <span className="shrink-0 text-muted-foreground text-xs">Dismissed</span>
  ) : draft.status === 'failed' ? (
    <span className="shrink-0 text-loss text-xs">Failed</span>
  ) : null;
}

/** Saves or dismisses a card, a toast on failure. */
function useSettle(onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>) {
  const [pending, setPending] = useState<'save' | 'dismiss' | null>(null);
  const go = async (draft: DraftItem, action: 'save' | 'dismiss') => {
    setPending(action);
    try {
      await onSettle(draft, action);
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setPending(null);
    }
  };
  return { pending, go };
}

/**
 * A drafted change. Open, it shows what it would run with and Save or Dismiss; settled, or as a
 * row in a stack of cards, it is one line that opens in place.
 */
function Draft({
  draft,
  onSettle,
  busy,
  row,
}: {
  draft: DraftItem;
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
  /** One line in a stack of cards. */
  row?: boolean;
}) {
  const { pending, go } = useSettle(onSettle);
  const [open, setOpen] = useState(!row && draft.status === 'open');
  const lines = argLines(draft.args);
  const actions = draft.status === 'open' && (
    <div className="flex shrink-0 justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={!!pending || busy}
        onClick={() => void go(draft, 'dismiss')}
      >
        Dismiss
      </Button>
      <Button size="sm" disabled={!!pending || busy} onClick={() => void go(draft, 'save')}>
        {pending === 'save' ? <Spinner /> : <CheckIcon />}
        Save
      </Button>
    </div>
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="assistant-draft"
      className={cn(
        'flex flex-col text-sm',
        row ? 'border-b px-1 py-1.5 last:border-b-0' : 'gap-2 rounded-lg border bg-card p-3',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={`${open ? 'Hide' : 'Show'} ${draft.title}`}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <ChevronRightIcon
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90',
              )}
            />
            <span className="shrink-0 font-medium">{draft.title}</span>
            {!open && (
              <span className="min-w-0 truncate text-muted-foreground text-xs">
                {argSummary(draft.args)}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <DraftStatus draft={draft} />
        {row && draft.status === 'open' && (
          <>
            <IconButton
              icon={XIcon}
              label={`Dismiss ${draft.title}`}
              size="icon-xs"
              disabled={!!pending || busy}
              onClick={() => void go(draft, 'dismiss')}
            />
            <IconButton
              icon={pending === 'save' ? Spinner : CheckIcon}
              label={`Save ${draft.title}`}
              size="icon-xs"
              variant="outline"
              disabled={!!pending || busy}
              onClick={() => void go(draft, 'save')}
            />
          </>
        )}
      </div>
      <CollapsibleContent className={cn('flex flex-col gap-2', row && 'pt-1.5 pl-5')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {lines.slice(0, 12).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-code break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {!row && actions}
      </CollapsibleContent>
      {draft.error && <p className="text-loss text-xs">{draft.error}</p>}
    </Collapsible>
  );
}

/** Two or more cards in a row: one stack with a count, Save all and Dismiss all, a line each. */
function DraftStack({
  drafts,
  onSettle,
  busy,
}: {
  drafts: DraftItem[];
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
}) {
  const [all, setAll] = useState<'save' | 'dismiss' | null>(null);
  const open = drafts.filter((d) => d.status === 'open');
  const saved = drafts.filter((d) => d.status === 'saved').length;
  const failed = drafts.filter((d) => d.status === 'failed').length;
  // One at a time, in order: a later change may build on an earlier one.
  const settleAll = async (action: 'save' | 'dismiss') => {
    setAll(action);
    try {
      for (const d of open) await onSettle(d, action);
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setAll(null);
    }
  };
  return (
    <div
      data-slot="assistant-draft-stack"
      className="flex flex-col rounded-lg border bg-card p-2 text-sm"
    >
      <div className="flex items-center gap-2 px-1 pb-1.5">
        <span className="min-w-0 flex-1 text-xs">
          <span className="font-medium">{drafts.length} changes</span>
          <span className="text-muted-foreground">
            {' · '}
            {[
              open.length && `${open.length} to review`,
              saved && `${saved} saved`,
              failed && `${failed} failed`,
            ]
              .filter(Boolean)
              .join(' · ') || 'all settled'}
          </span>
        </span>
        {open.length > 1 && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!all || busy}
              onClick={() => void settleAll('dismiss')}
            >
              Dismiss all
            </Button>
            <Button size="sm" disabled={!!all || busy} onClick={() => void settleAll('save')}>
              {all === 'save' ? <Spinner /> : <CheckIcon />}
              Save all
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-col border-t">
        {drafts.map((d) => (
          <Draft key={d.id} draft={d} onSettle={onSettle} busy={busy || !!all} row />
        ))}
      </div>
    </div>
  );
}

const WHY: Record<HandOffItem['why'], string> = {
  asked: 'you asked',
  judgement: 'needs judgement',
  stuck: 'stuck',
  check_failed: 'a check failed',
};

function HandOff({
  item,
  onSettle,
  busy,
}: {
  item: HandOffItem;
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
}) {
  return (
    <section className="flex flex-col gap-2 border-l-2 border-primary/40 pl-3">
      <p className="flex items-center gap-1.5 text-xs">
        <CornerDownRightIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{item.label}</span>
        <span className="text-muted-foreground">· {WHY[item.why]}</span>
        {item.usage && (
          <span className="ml-auto text-muted-foreground tabular-nums">{usd(item.usage.usd)}</span>
        )}
      </p>
      <p className="text-muted-foreground text-xs">{item.task}</p>
      <Items items={item.items} onSettle={onSettle} busy={busy} />
    </section>
  );
}

/** A chip over the message box: a tier picked with `@` or a thing pointed at with `#`. */
function ComposerChip({
  sign,
  label,
  onRemove,
}: {
  sign: '@' | '#';
  label: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs">
      <span className="text-muted-foreground">{sign}</span>
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

/** What the composer sends with the text: the tier picked with `@` and the things pointed at with `#`. */
export interface ComposerExtra {
  tier?: string;
  refs?: AssistantRefNote[];
}

/**
 * The message box: Enter sends, Shift+Enter breaks a line; Stop while an answer runs. Three
 * triggers list what can follow them as it is typed: `/` at the start a command, `@` a tier for
 * this message, `#` a thing to point at (the `sources`); a picked tier or thing shows as a chip.
 */
export function LumenComposer({
  name,
  busy,
  queued,
  disabled,
  commands = [],
  tiers = [],
  sources = [],
  page,
  onSend,
  onStop,
}: {
  name: string;
  /** The page's name for `#` This page; the document's title by default. */
  page?: string;
  busy: boolean;
  queued: string | null;
  disabled?: boolean;
  commands?: AssistantCommand[];
  /** What `@` lists. */
  tiers?: { id: string; label: string; model_label?: string }[];
  /** What `#` lists, a group each. */
  sources?: readonly AssistantSource[];
  onSend: (text: string, extra: ComposerExtra) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [refs, setRefs] = useState<AssistantRefNote[]>([]);
  const list = useRef<LumenSelectorListHandle>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const selection = usePageSelection();
  // An app's compose request (`composeAssistant`): its chips and text, ready to finish.
  const [request, take] = useComposeRequest();
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request fills the box.
  useEffect(() => {
    if (!request) return;
    take();
    if (request.refs?.length) setRefs((p) => [...p, ...(request.refs ?? [])]);
    if (request.tier) setTier(request.tier);
    if (request.text !== undefined) {
      setText(request.text);
      setCaret(request.text.length);
    }
    requestAnimationFrame(() => box.current?.focus());
  }, [request]);

  const m = /^\/(\S*)(?:\s(.*))?$/s.exec(text);
  const cmd = m && m[2] !== undefined ? commands.find((c) => c.name === m[1]) : undefined;
  // `@` or `#` as the word the caret is in: `pick #sto|` lists the sources' items matching "sto".
  const word = /(^|\s)([@#])([^\s@#]*)$/.exec(text.slice(0, caret));
  const trigger = word ? (word[2] as '@' | '#') : null;
  const asked = word?.[3] ?? '';
  const open = closed !== `${text}|${caret}`;
  const slash =
    m && commands.length ? (m[2] === undefined ? 'command' : cmd?.options ? 'arg' : null) : null;
  const at = trigger === '@' && tiers.length > 1 ? '@' : trigger === '#' ? '#' : null;
  const picking = open ? (slash ?? at) : null;

  const extra = (): ComposerExtra => ({
    ...(tier ? { tier } : {}),
    ...(refs.length ? { refs } : {}),
  });
  const clear = () => {
    setText('');
    setCaret(0);
    setTier(null);
    setRefs([]);
  };
  const run = async (c: AssistantCommand, args: string) => {
    const keep = extra();
    clear();
    try {
      const out = await c.run(args.trim());
      if (out) onSend(out, keep);
    } catch (e) {
      lumenToast.error(errorText(e));
    }
  };
  const send = () => {
    if (!text.trim() || disabled) return;
    const c = m ? commands.find((x) => x.name === m[1]) : undefined;
    if (c) {
      void run(c, m?.[2] ?? '');
      return;
    }
    onSend(text, extra());
    clear();
  };
  const pickCommand = (o: LumenOption) => {
    const c = commands.find((x) => x.name === o.value);
    if (!c) return;
    if (c.args) {
      setText(`/${c.name} `);
      setCaret(c.name.length + 2);
      box.current?.focus();
    } else void run(c, '');
  };
  // Takes the `@word` or `#word` out of the text once its pick is a chip.
  const dropWord = () => {
    if (!word) return;
    const start = caret - 1 - asked.length;
    const next = text.slice(0, start) + text.slice(caret).replace(/^ /, '');
    setText(next);
    setCaret(start);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(start, start);
    });
  };

  // Each `#` row makes its chip when picked, so what it carries (a card's words) is read then.
  const sourceItems = new Map<string, () => AssistantRefNote>();
  const picked = selection ? selectionRef(selection) : null;
  const added = (r: AssistantRefNote) =>
    refs.some((x) => sameRef(x, r)) ? { disabled: 'Added' } : {};
  const onPage: LumenOption[] = [];
  if (picking === '#') {
    const pageRef = (): AssistantRefNote => ({
      kind: 'page',
      label: page || document.title || 'This page',
      path: location.pathname + location.search,
      text: textOf(document.querySelector('main') ?? document.body, 6000),
    });
    sourceItems.set('page', pageRef);
    onPage.push({
      value: 'page',
      label: 'This page',
      group: 'On this page',
      icon: FileTextIcon,
      detail: page || document.title,
      keywords: ['screen', 'page'],
      ...added({ kind: 'page', label: page || document.title || 'This page' }),
    });
    for (const c of cardsOnScreen()) {
      const label = c.title || kindName(c.kind);
      const ref = { kind: 'card', label, id: c.id };
      sourceItems.set(`card:${c.id}`, () => ({
        ...ref,
        card_kind: kindName(c.kind),
        text: textOf(targetEl(`card:${c.id}`)),
      }));
      onPage.push({
        value: `card:${c.id}`,
        label,
        group: 'On this page',
        detail: kindName(c.kind),
        target: `card:${c.id}`,
        ...added(ref),
      });
    }
    for (const x of sectionsOnScreen().slice(0, 60)) {
      const ref = { kind: x.kind, label: x.label, id: x.id };
      sourceItems.set(`section:${x.id}`, () => ({
        ...ref,
        text: textOf(targetEl(`section:${x.id}`)),
      }));
      onPage.push({
        value: `section:${x.id}`,
        label: x.label,
        group: 'On this page',
        detail: x.kind,
        target: `section:${x.id}`,
        ...added(ref),
      });
    }
    onPage.push({
      value: 'point',
      label: 'Point at something…',
      group: 'On this page',
      icon: CrosshairIcon,
      description: 'Click a card or a part of the page; Esc cancels',
    });
  }
  if (picked) sourceItems.set('selection', () => picked);
  const sourceOptions: LumenOption[] =
    picking === '#'
      ? [
          ...(picked
            ? [
                {
                  value: 'selection',
                  label: picked.label,
                  group: 'Selected text',
                  ...(selection?.where ? { detail: selection.where } : {}),
                  ...added(picked),
                },
              ]
            : []),
          ...onPage,
          ...sources.flatMap((s) =>
            s.items(asked).map((i) => {
              const value = `${s.id}:${i.id}`;
              sourceItems.set(value, () => i.ref);
              return {
                value,
                label: i.label,
                group: s.label,
                ...(i.detail ? { detail: i.detail } : {}),
                ...(s.icon ? { icon: s.icon } : {}),
                ...(i.keywords ? { keywords: i.keywords } : {}),
                ...(i.target ? { target: i.target } : {}),
                ...added(i.ref),
              };
            }),
          ),
        ]
      : [];
  // Point at…: on a phone the sheet covers the page, so it steps aside while the person picks and
  // comes back with the pick as a chip and the words typed so far.
  const point = async () => {
    const phone = window.matchMedia('(max-width: 767px)').matches;
    const typed = text.slice(0, caret - 1 - asked.length) + text.slice(caret).replace(/^ /, '');
    if (phone) assistantOpen.write(false);
    const p = await pointAt();
    if (phone)
      composeAssistant({
        text: typed,
        refs: [...refs, ...(p ? [pointedRef(p)] : [])],
        ...(tier ? { tier } : {}),
      });
    else if (p) setRefs((prev) => [...prev, pointedRef(p)]);
    requestAnimationFrame(() => box.current?.focus());
  };
  const tierLabel = tiers.find((t) => t.id === tier)?.label;
  const hints = [commands.length && '/', tiers.length > 1 && '@', '#'].filter(Boolean);

  return (
    <div className="shrink-0 border-t p-3">
      {queued && (
        <p className="mb-2 truncate text-muted-foreground text-xs">
          Queued: <span className="text-foreground">{queued}</span>
        </p>
      )}
      {picking === 'command' && (
        <LumenSelectorList
          handle={list}
          label="Commands"
          className="mb-2"
          fuzzy
          query={m?.[1] ?? ''}
          options={commands.map((c) => ({
            value: c.name,
            label: `/${c.name}`,
            ...(c.args ? { detail: c.args } : {}),
            description: c.about,
          }))}
          empty="No command matches"
          onPick={pickCommand}
          onClose={() => setClosed(`${text}|${caret}`)}
        />
      )}
      {picking === 'arg' && cmd?.options && (
        <LumenSelectorList
          handle={list}
          label={`/${cmd.name}`}
          className="mb-2"
          fuzzy
          query={m?.[2] ?? ''}
          options={cmd.options()}
          onPick={(o) => void run(cmd, o.value)}
          onClose={() => setClosed(`${text}|${caret}`)}
        />
      )}
      {picking === '@' && (
        <LumenSelectorList
          handle={list}
          label="Answer this message on"
          className="mb-2"
          fuzzy
          query={asked}
          options={tiers.map((t) => ({
            value: t.id,
            label: t.label,
            ...(t.model_label ? { detail: t.model_label } : {}),
          }))}
          empty="No tier matches"
          onPick={(o) => {
            setTier(o.value);
            dropWord();
          }}
          onClose={() => setClosed(`${text}|${caret}`)}
        />
      )}
      {picking === '#' && (
        <LumenSelectorList
          handle={list}
          label="Point at"
          className="mb-2"
          query={asked}
          options={sourceOptions}
          empty="Nothing matches"
          onPick={(o) => {
            dropWord();
            if (o.value === 'point') {
              void point();
              return;
            }
            const r = sourceItems.get(o.value)?.();
            if (r) setRefs((p) => [...p, r]);
          }}
          onClose={() => setClosed(`${text}|${caret}`)}
        />
      )}
      {(tierLabel || refs.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tierLabel && <ComposerChip sign="@" label={tierLabel} onRemove={() => setTier(null)} />}
          {refs.map((r, i) => (
            <ComposerChip
              key={`${r.kind}:${r.label}:${i}`}
              sign="#"
              label={r.label}
              onRemove={() => setRefs((p) => p.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
      <div className="relative">
        <Textarea
          ref={box}
          aria-label={`Message ${name}`}
          placeholder={`Ask ${name}…${hints.length ? ` (${hints.join(' ')})` : ''}`}
          className="max-h-48 min-h-11 resize-none pr-11"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (picking && list.current?.key(e)) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="absolute right-1.5 bottom-1.5">
          {busy && !text.trim() ? (
            <IconButton
              icon={SquareIcon}
              label="Stop"
              variant="outline"
              size="icon-xs"
              onClick={onStop}
            />
          ) : (
            <IconButton
              icon={ArrowUpIcon}
              label={busy ? 'Queue' : 'Send'}
              variant="default"
              size="icon-xs"
              disabled={!text.trim() || disabled}
              onClick={send}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// The same thing pointed at twice: its kind and what finds it, whatever its words read then.
const refKey = (r: AssistantRefNote) =>
  r.kind === 'page'
    ? 'page'
    : JSON.stringify([r.kind, r.id ?? r.label, r.kind === 'selection' ? r.text : null]);
const sameRef = (a: AssistantRefNote, b: AssistantRefNote) => refKey(a) === refKey(b);

/** A card or section the person pointed at, as a chip with its words. */
const pointedRef = (p: PointedAt): AssistantRefNote =>
  p.kind === 'card'
    ? {
        kind: 'card',
        label: p.card.title || kindName(p.card.kind),
        id: p.card.id,
        card_kind: kindName(p.card.kind),
        text: textOf(p.el),
      }
    : { kind: p.section.kind, label: p.section.label, id: p.section.id, text: textOf(p.el) };

/** The chat's cost and tokens (a popup splits them per part), and how full the context is. */
function UsageLine({ usage }: { usage: ChatUsage | null }) {
  if (!usage || !usage.calls) return null;
  const ctx = usage.context ?? 0;
  return (
    <div className="flex shrink-0 items-center gap-3 px-3 pb-2 text-muted-foreground text-xs">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="tabular-nums hover:text-foreground">
            {usd(usage.usd)} · {tokens(usage.in + usage.out)} tokens
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-1 p-2 text-xs">
          {usage.parts.map((p) => (
            <div key={p.label} className="flex justify-between gap-2 tabular-nums">
              <span className="truncate">{p.label}</span>
              <span>
                {tokens(p.in)} in · {tokens(p.out)} out · {usd(p.usd)}
              </span>
            </div>
          ))}
          <p className="pt-1 text-muted-foreground">
            {tokens(usage.read)} of {tokens(usage.in)} in read from cache
          </p>
        </PopoverContent>
      </Popover>
      {ctx > 0 && (
        <span
          className="ml-auto flex items-center gap-1.5"
          title={`Context ${tokens(ctx)} of ${tokens(CONTEXT_MAX)}`}
        >
          <span className="relative h-1 w-16 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                'absolute inset-y-0 left-0',
                ctx > COMPACT_AT ? 'bg-warning' : 'bg-primary/60',
              )}
              style={{ width: `${Math.min(100, (ctx / CONTEXT_MAX) * 100)}%` }}
            />
            <span
              className="absolute inset-y-0 w-px bg-foreground/40"
              style={{ left: `${(COMPACT_AT / CONTEXT_MAX) * 100}%` }}
            />
          </span>
          <span className="tabular-nums">{tokens(ctx)}</span>
        </span>
      )}
    </div>
  );
}

/**
 * The assistant docked in LumenShell: put `button` in `headerActions` and `panel` in `panel`.
 * Open or closed is this browser tab's own, and ⌘J toggles it.
 */
export function useLumenAssistantDock(
  client: AssistantAdapter,
  o: Omit<LumenAssistantProps, 'client' | 'chat' | 'onClose'> & { name: string } = {
    name: 'Assistant',
  },
) {
  const open = assistantOpen.use();
  const chat = useAssistantChat(client);
  const [request] = useComposeRequest();
  useEffect(() => {
    if (request && !assistantOpen.get()) assistantOpen.write(true);
  }, [request]);
  const [unread, setUnread] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !chat.busy && !assistantOpen.get()) setUnread(true);
    wasBusy.current = chat.busy;
  }, [chat.busy]);
  const setOpen = (v: boolean) => {
    assistantOpen.write(v);
    if (v) setUnread(false);
  };
  useAssistantHotkey(() => setOpen(!assistantOpen.get()));
  const { name, ...props } = o;
  return {
    open,
    setOpen,
    chat,
    button: (
      <LumenAssistantButton name={name} open={open} unread={unread} onOpen={() => setOpen(true)} />
    ),
    panel: (
      <LumenAssistantPanel name={name} open={open} onOpenChange={setOpen}>
        {() => (
          <LumenAssistant client={client} chat={chat} onClose={() => setOpen(false)} {...props} />
        )}
      </LumenAssistantPanel>
    ),
  };
}
