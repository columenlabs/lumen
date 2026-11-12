// LumenAssistant: the chat that fills LumenAssistantPanel, for any app's assistant served by
// `@columenlabs/lumen-ai/assistant`. A header with the tier, Chats and New chat; the chat itself
// (the person's messages, the answer as it streams, each tool call as a line, drafted changes as
// cards to Save or Dismiss, work handed to a higher tier in its own section); and the composer,
// with Stop, a queued message and the chat's cost and context under it.
import {
  ASSISTANT_IMAGES_MAX,
  ASSISTANT_IMAGE_CHARS,
  type AllowanceState,
  type AllowanceUnit,
  type AssistantImage,
  type AssistantMessage,
  type AssistantQuote,
  type AssistantRefNote,
  type AssistantScreenMove,
  type AssistantStatus,
  type ChatItem,
  type ChatUsage,
  type DraftItem,
  type HandOffItem,
  type ScreenItem,
  type StepItem,
  type UsagePart,
  type WebLink,
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
  GlobeIcon,
  LightbulbIcon,
  ListPlusIcon,
  MonitorIcon,
  PencilIcon,
  PlusIcon,
  ReceiptIcon,
  RefreshCwIcon,
  ReplyIcon,
  SearchIcon,
  SparklesIcon,
  SquareIcon,
  TriangleAlertIcon,
  Undo2Icon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react';
import {
  Fragment,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  LumenAssistantButton,
  LumenAssistantChats,
  LumenAssistantPanel,
  assistantOpen,
  useAssistantHotkey,
} from '../assistant-panel';
import { type ScreenApi, screenMapFor, useAssistantScreen } from '../assistant-screen';
import { useIsMobile } from '../hooks/use-mobile';
import { IconButton } from '../icon-button';
import { errorText } from '../integrations';
import { lazyPart } from '../lazy-part';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Spinner } from '../ui/spinner';
import { Textarea } from '../ui/textarea';
import { ChatImage } from './chat-image';
import type { AssistantAdapter } from './client';
import { chatMarkdown, chatTurns, copyMarkdown, turnMarkdown } from './copy';
import { ReplyToSelection } from './reply-selection';
import {
  type AssistantSource,
  composeAssistant,
  selectionRef,
  useComposeRequest,
  usePageSelection,
  useShownAssistantSources,
} from './sources';
import { UsageHistoryView, tokens, usd } from './usage-history';
import {
  type AssistantChatState,
  type LiveItem,
  type QueuedMessage,
  useAssistantChat,
} from './use-assistant-chat';

// The Markdown renderer (tables included) loads with the first answer (lazy-part.tsx).
// A tab whose build a deploy replaced shows the answer as plain text instead of reloading mid chat.
const ChatMarkdown = lazyPart(
  () => import('./chat-markdown').then((m) => m.default),
  null,
  ({ children }: { children: string }) => <p className="whitespace-pre-wrap">{children}</p>,
);

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

export { usd };
const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export interface LumenAssistantProps {
  client: AssistantAdapter;
  /** The page the person is on, sent with each message. */
  context?: AssistantMessage['context'];
  /** Opens the app's Settings at the assistant (from a "not connected" line). */
  onSettings?: () => void;
  /** Days chats are kept, for the Chats menu's line. */
  keepDays?: number;
  /**
   * Chats belong to a place in the app (a workspace, a project): the Chats menu lists the
   * `current` one's chats (rows whose `scope` matches) and a switch named `label` shows them all,
   * each with its place's `name`. The switch is kept on this device. A row with no `scope` shows
   * only with the switch on.
   */
  chatScope?: { current: string; label: string; name?: (scope: string) => string | undefined };
  /** Closes the panel (its ✕). */
  onClose?: () => void;
  /** An outside chat state (the dock shares one between the button and the panel). */
  chat?: AssistantChatState;
  /**
   * The app's own slash commands, listed before the server's (`createAssistant` `commands`) and the
   * kit's: /compact, /clear, /model and /escalate.
   */
  commands?: AssistantCommand[];
  /** What `@` lists everywhere; a page adds its own with `useAssistantSource`. */
  sources?: readonly AssistantSource[];
  /**
   * Images can go with a message: pasted (Cmd+V / Ctrl+V) or dropped on the box, shown as chips
   * until it is sent. Turn it on when the app's chat route passes `images` on to the agent.
   */
  images?: boolean;
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
  chatScope,
  onClose,
  chat: outside,
  commands = [],
  sources = [],
  images = false,
}: LumenAssistantProps) {
  const own = useAssistantChat(client);
  const chat = outside ?? own;
  const qc = useQueryClient();
  const status = useAssistantStatus(client);
  const [allScopes, setAllScopes] = useAllScopes(client.key);
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

  // The assistant moves the screen (Settings ▸ Screen): the page map goes with each message, and
  // each new screen call runs here once; how it ended goes with the next message.
  const screen = useAssistantScreen();
  const screenOn = !!screen && (s?.screen ?? 'move') === 'move';
  const extra = (): Omit<AssistantMessage, 'message' | 'chat_id'> => ({
    ...(context ? { context } : {}),
    ...(screenOn && screen ? { screen: screenMapFor(screen) } : {}),
  });
  const ran = useRef(new Set<string>());
  const ended = chat.screenEnded;
  useEffect(() => {
    for (const i of screenCalls(chat.items)) {
      if (!i.live || ran.current.has(i.id)) continue;
      ran.current.add(i.id);
      if (!screen) {
        ended({ id: i.id, status: 'failed', text: 'this page cannot be moved' });
        continue;
      }
      void screen.run(i.id, i.moves).then((o) => {
        ended({ id: i.id, ...o });
        // On a phone the panel covers the page: it steps aside so the move shows.
        if (o.status === 'done' && onClose && window.matchMedia('(max-width: 767px)').matches)
          onClose();
      });
    }
  }, [chat.items, screen, ended, onClose]);
  const controls: ScreenControls | null = screen
    ? {
        canUndo: (id) => screen.canUndo(id),
        undo: (id) => void screen.undo(id).then((o) => ended({ id, ...o })),
        go: (item) => {
          ran.current.add(item.id);
          void screen.run(item.id, item.moves, true).then((o) => ended({ id: item.id, ...o }));
        },
      }
    : null;

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
              if (task.trim()) chat.send(task, { ...extra(), tier: above[0]?.id as string });
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
            chats.data
              ?.filter((c) => !chatScope || allScopes || c.scope === chatScope.current)
              .map((c) => ({
                id: c.id,
                title: c.title,
                updated_at: new Date(c.at).toISOString(),
                ...(chatScope && allScopes && c.scope ? { where: chatScope.name?.(c.scope) } : {}),
              })) ?? (chats.isFetched ? [] : null)
          }
          value={chat.chatId ?? undefined}
          toggle={chatScope && { label: chatScope.label, on: allScopes, onChange: setAllScopes }}
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
        <Screen.Provider value={controls}>
          <Messages
            chat={chat}
            status={s}
            onSettings={onSettings}
            onRetry={(at, user) => chat.retry(at, user, extra())}
          />
        </Screen.Provider>
      </AssistantName.Provider>
      <LumenComposer
        name={s?.name ?? 'the assistant'}
        busy={chat.busy}
        queued={chat.queued}
        queue={chat.queue}
        canSteer={chat.canSteer}
        onSteerQueued={chat.steerQueued}
        onUnqueue={chat.unqueue}
        disabled={!s || !!s.wait}
        commands={allCommands}
        tiers={tiers}
        sources={allSources}
        page={context?.label}
        images={images}
        onSend={(text, more, how) => chat.send(text, { ...extra(), ...more }, how)}
        onStop={chat.stop}
      />
      <UsageLine usage={chat.usage} client={client} spent={s?.spend.usd} />
    </div>
  );
}

function Messages({
  chat,
  status,
  onSettings,
  onRetry,
}: {
  chat: AssistantChatState;
  status: AssistantStatus | undefined;
  onSettings?: () => void;
  onRetry: RetryFn;
}) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const count = JSON.stringify(chat.items).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the end as the chat grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  // The app's own link to Settings, else the shell's, at the section that answers the wait.
  const shellSettings = useOpenSettings();
  const settings = onSettings ? (_section: string) => onSettings() : shellSettings;
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <ReplyToSelection box={box} />
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
            {/* Retry waits while an answer runs or nobody can pay: hidden then, never disabled. */}
            <RetryTurn.Provider value={chat.busy || status?.wait ? null : onRetry}>
              <Items items={chat.items} onSettle={chat.settle} busy={chat.busy} turns />
            </RetryTurn.Provider>
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
/** A tier's name for a message's `#` chip. */
const TierNames = createContext<(id: string) => string>((id) => id);
/** Takes back a change made at once (Undo on its line). */
const UndoWrite = createContext<((s: StepItem) => Promise<void>) | null>(null);
type UserItem = Extract<ChatItem, { kind: 'user' }>;
type RetryFn = (at: number, user: UserItem) => void;
/** Sends a failed turn again; null while it can't (an answer runs, nobody can pay). */
const RetryTurn = createContext<RetryFn | null>(null);

/** Where a turn's unretried error sits in the chat, when the turn starts with a message. */
function failedAt(t: { from: number; items: (ChatItem | LiveItem)[] }): number | null {
  if (t.items[0]?.kind !== 'user') return null;
  for (let i = t.items.length - 1; i > 0; i--) {
    const it = t.items[i];
    if (it?.kind === 'error') return it.retried ? null : t.from + i;
  }
  return null;
}

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
  const retry = useContext(RetryTurn);
  if (turns)
    return (
      <div className="flex flex-col gap-3">
        {chatTurns(items).map((t) => {
          const open = busy && t.from + t.items.length === items.length;
          const failed = retry && !open ? failedAt(t) : null;
          return (
            <div key={t.from} data-slot="assistant-turn" className="group/turn flex flex-col gap-3">
              <Items items={t.items} onSettle={onSettle} busy={busy} />
              {!open && <WebSources items={t.items as ChatItem[]} />}
              {!open && (
                <div className="-mt-2 flex justify-end gap-0.5">
                  {/* A failed turn always shows Retry; Copy shows on hover (always on touch). */}
                  {retry && failed !== null && (
                    <IconButton
                      icon={RefreshCwIcon}
                      label="Retry"
                      className="size-6"
                      onClick={() => retry(failed, t.items[0] as UserItem)}
                    />
                  )}
                  <div className="flex opacity-0 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    <IconButton
                      icon={CopyIcon}
                      label="Copy this turn"
                      className="size-6 text-muted-foreground"
                      onClick={() =>
                        copyMarkdown(turnMarkdown(t.items as ChatItem[], name), 'Turn')
                      }
                    />
                  </div>
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
    case 'user': {
      if (item.steered)
        return (
          <div className="ml-8 flex flex-col items-end gap-0.5 self-end">
            <span className="flex items-center gap-1 text-primary text-xs">
              <CornerDownRightIcon className="size-3" />
              Steered
            </span>
            <div className="rounded-lg border border-primary/40 bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
              {item.text}
            </div>
          </div>
        );
      const bubble = (
        <div
          data-chat-from="user"
          className="ml-8 self-end rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap has-[[data-slot=chat-image]]:ml-0 has-[[data-slot=chat-image]]:w-full"
        >
          {item.quote && <QuoteLine quote={item.quote} />}
          {(item.tier || item.refs?.length) && (
            <span className="mb-1 flex flex-wrap gap-1">
              {item.tier && <ComposerChip sign={TIER} label={tierName(item.tier)} />}
              {item.refs?.map((r, i) => (
                <ComposerChip key={`${r.kind}:${r.label}:${i}`} sign={POINT} label={r.label} />
              ))}
            </span>
          )}
          {item.images?.length ? (
            <span className="mb-1 flex flex-wrap gap-1.5">
              {item.images.map((src, i) => (
                <ChatImage key={`${i}:${src.length}`} src={src} alt={`Pasted ${i + 1}`} />
              ))}
            </span>
          ) : null}
          {item.text}
          {item.context && (
            <span className="mt-1 block text-muted-foreground text-xs">on {item.context}</span>
          )}
        </div>
      );
      if (!item.retried) return bubble;
      return (
        <div className="flex flex-col items-end gap-0.5 self-end">
          <span className="flex items-center gap-1 text-primary text-xs">
            <RefreshCwIcon className="size-3" />
            Retry
          </span>
          {bubble}
        </div>
      );
    }
    case 'text':
      return (
        <div
          data-chat-from="assistant"
          className="prose-sm text-sm leading-relaxed [&_code]:font-code [&_code]:text-xs [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_ul]:list-disc"
        >
          <ChatMarkdown>{item.text}</ChatMarkdown>
          {item.live && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/60 align-middle" />
          )}
        </div>
      );
    case 'step':
      return <Step step={item} live={!!item.live} />;
    case 'draft':
      return <Draft draft={item} onSettle={onSettle} busy={busy} />;
    case 'screen':
      return <ScreenChip item={item} />;
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
        <p
          role={item.retried ? undefined : 'alert'}
          className={cn(
            'flex items-start gap-1.5 text-sm',
            item.retried ? 'text-muted-foreground' : 'text-loss',
          )}
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {item.text}
        </p>
      );
  }
}

/** Every screen call in the chat, hand-off sections included. */
function screenCalls(items: LiveItem[]): (ScreenItem & { live?: boolean })[] {
  return items.flatMap((i) =>
    i.kind === 'screen' ? [i] : i.kind === 'handoff' ? screenCalls(i.items as LiveItem[]) : [],
  );
}

/** What the panel can do with a screen call: Undo it, or run one that waited for a tap. */
interface ScreenControls {
  canUndo: ScreenApi['canUndo'];
  undo: (id: string) => void;
  go: (item: ScreenItem) => void;
}
const Screen = createContext<ScreenControls | null>(null);

/** A screen call's moves in words, for the chip's hover. */
const movesText = (moves: AssistantScreenMove[]) =>
  moves
    .map((m) =>
      'go' in m
        ? `Go to ${m.go}`
        : 'settings' in m
          ? `Settings ▸ ${m.settings}${m.row ? ` ▸ ${m.row}` : ''}`
          : 'chart' in m
            ? `Chart ${[m.chart].flat().join(', ')}`
            : 'open' in m
              ? `Open ${m.open}`
              : `Point at ${m.point.replace(/^card:/, '')}`,
    )
    .join(' · ');

/**
 * A screen call in the chat: ✓ and what is on screen, with Undo; why it failed; or, while the
 * person was mid-edit, Go now.
 */
function ScreenChip({ item }: { item: ScreenItem & { live?: boolean } }) {
  const c = useContext(Screen);
  // No outcome and not running: it ran in another tab or before a reload, which kept no result.
  const status = item.outcome?.status ?? (item.live ? 'running' : 'sent');
  const said =
    status === 'failed'
      ? `Couldn't move · ${item.outcome?.text ?? ''}`
      : status === 'waiting'
        ? 'Waits while you edit'
        : status === 'undone'
          ? 'Undone'
          : null;
  return (
    <div
      data-slot="assistant-screen"
      data-status={status}
      className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-muted-foreground text-xs"
    >
      {status === 'running' ? (
        <Spinner className="size-3.5" />
      ) : status === 'done' ? (
        <CheckIcon className="size-3.5 shrink-0 text-edge" />
      ) : status === 'failed' ? (
        <TriangleAlertIcon className="size-3.5 shrink-0 text-loss" />
      ) : status === 'undone' ? (
        <Undo2Icon className="size-3.5 shrink-0" />
      ) : (
        <MonitorIcon className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate" title={`${item.label} · ${movesText(item.moves)}`}>
        <span className={cn(status === 'undone' ? 'line-through' : 'text-foreground')}>
          {item.label}
        </span>
        {said && <span> · {said}</span>}
      </span>
      {status === 'done' && c?.canUndo(item.id) && (
        <IconButton icon={Undo2Icon} label="Undo" size="icon-xs" onClick={() => c.undo(item.id)} />
      )}
      {status === 'waiting' && c && (
        <IconButton
          icon={MonitorIcon}
          label="Go now"
          variant="outline"
          size="icon-xs"
          onClick={() => c.go(item)}
        />
      )}
    </div>
  );
}

const Rule = ({ children }: { children: ReactNode }) => (
  <p className="flex items-center gap-2 text-muted-foreground text-xs before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
    {children}
  </p>
);

/** A page's host without `www.`, or the address when it has none. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A page's path after its host, for a read's line. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname).replace(/\/$/, '');
    return p.split('/').pop() || '';
  } catch {
    return '';
  }
}

/** A web step: a search, its results folded under it, or one page read. */
function WebStep({ step, live }: { step: StepItem; live: boolean }) {
  const web = step.web ?? {};
  const results = web.results ?? [];
  const icon = live ? (
    <Spinner className="size-3" />
  ) : !step.ok ? (
    <CircleAlertIcon className="size-3.5 shrink-0" />
  ) : web.read ? (
    <GlobeIcon className="size-3.5 shrink-0" />
  ) : (
    <SearchIcon className="size-3.5 shrink-0" />
  );
  const line = (
    <>
      {icon}
      {web.tried ? (
        <span className="truncate" title={web.tried.url}>
          Could not open <span className="text-foreground">{hostOf(web.tried.url)}</span>
        </span>
      ) : web.read ? (
        <span className="truncate" title={web.read.title ?? web.read.url}>
          Read <span className="text-foreground">{hostOf(web.read.url)}</span>
          {pathOf(web.read.url) && ` · ${pathOf(web.read.url)}`}
        </span>
      ) : (
        <span className="truncate" title={web.query}>
          Searched the web{web.query ? ': ' : ''}
          {web.query && <span className="text-foreground">{web.query}</span>}
        </span>
      )}
      {!live && !web.read && !web.tried && step.ok && (
        <span className="ml-auto shrink-0 tabular-nums">
          {results.length} result{results.length === 1 ? '' : 's'}
        </span>
      )}
      {step.error && <span className="truncate">· {step.error}</span>}
    </>
  );
  const cls = cn(
    'flex min-w-0 items-center gap-1.5 text-xs',
    step.ok ? 'text-muted-foreground' : 'text-loss',
  );
  if (!results.length) return <p className={cls}>{line}</p>;
  return (
    <Collapsible>
      <CollapsibleTrigger className={cn(cls, 'group/web w-full text-left')}>
        {line}
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/web:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 ml-1.5 flex flex-col gap-0.5 border-l pl-3 text-muted-foreground text-xs">
          {results.map((r) => (
            <li key={r.url} className="min-w-0 truncate">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                title={r.url}
                className="hover:underline"
              >
                <span className="text-foreground">{r.title || hostOf(r.url)}</span> ·{' '}
                {hostOf(r.url)}
              </a>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The pages a turn read, once each, in the order read: the numbers its answer cites. */
function turnPages(items: readonly ChatItem[]): WebLink[] {
  const pages: WebLink[] = [];
  const walk = (list: readonly ChatItem[]) => {
    for (const i of list) {
      if (i.kind === 'handoff') walk(i.items);
      else if (i.kind === 'step' && i.web?.read && !pages.some((p) => p.url === i.web?.read?.url))
        pages.push(i.web.read);
    }
  };
  walk(items);
  return pages;
}

/** The pages a turn read, as numbered chips under its answer; each opens in a new tab. */
function WebSources({ items }: { items: readonly ChatItem[] }) {
  const pages = turnPages(items);
  if (!pages.length) return null;
  return (
    <ol aria-label="Sources" className="flex min-w-0 flex-wrap gap-1.5">
      {pages.map((p, n) => (
        <li key={p.url} className="min-w-0 max-w-full">
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            title={p.title ? `${p.title} · ${p.url}` : p.url}
            className="flex h-6 min-w-0 items-center gap-1.5 rounded-full border pr-2.5 pl-1 text-xs hover:bg-muted"
          >
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 font-medium text-primary text-xs tabular-nums">
              {n + 1}
            </span>
            <span className="truncate">{hostOf(p.url)}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function Step({ step, live }: { step: StepItem; live: boolean }) {
  if (step.web) return <WebStep step={step} live={live} />;
  return <ToolStep step={step} live={live} />;
}

function ToolStep({ step, live }: { step: StepItem; live: boolean }) {
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
              <dt className="whitespace-nowrap text-muted-foreground">{k}</dt>
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

/** The composer's triggers: `@` points at a thing (the `sources`), `#` picks the tier for one message. */
const POINT = '@';
const TIER = '#';

/** A chip over the message box: a tier picked with `#` or a thing pointed at with `@`. */
function ComposerChip({
  sign,
  label,
  onRemove,
}: {
  sign: typeof POINT | typeof TIER;
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

/** What the composer sends with the text: the tier picked with `#` and the things pointed at with `@`. */
export interface ComposerExtra {
  tier?: string;
  refs?: AssistantRefNote[];
  images?: AssistantImage[];
  quote?: AssistantQuote;
}

/**
 * A quote a message replies to: the reply icon and the quoted words. Over the box it is one line
 * with an × (`onRemove`); in a sent message up to two lines. The whole text is in its hover.
 */
function QuoteLine({ quote, onRemove }: { quote: AssistantQuote; onRemove?: () => void }) {
  return (
    <span
      data-slot="chat-quote"
      className={cn(
        'flex min-w-0 items-start gap-1.5 rounded-md bg-background/60 px-2 py-1 text-muted-foreground text-xs whitespace-normal',
        onRemove ? 'mb-2 items-center bg-muted py-0.5 pr-0.5' : 'mb-1.5',
      )}
      title={quote.text}
    >
      <ReplyIcon className={cn('size-3.5 shrink-0', !onRemove && 'mt-0.5')} aria-hidden />
      <span className={cn('min-w-0 flex-1', onRemove ? 'truncate' : 'line-clamp-2 break-words')}>
        {quote.text}
      </span>
      {onRemove && (
        <IconButton icon={XIcon} label="Remove quote" size="icon-xs" onClick={onRemove} />
      )}
    </span>
  );
}

/** The longest edge an image is sent at (what the models read best; larger only costs more). */
const IMAGE_EDGE = 1568;

/**
 * A pasted or dropped image, ready to send: scaled to `IMAGE_EDGE` on a canvas and saved as JPEG
 * (PNG when it has few pixels to lose), as base64. `null` when the browser cannot read it.
 */
async function readImage(file: File): Promise<AssistantImage | null> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, IMAGE_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const png = canvas.toDataURL('image/png');
    const url = png.length < 400_000 ? png : canvas.toDataURL('image/jpeg', 0.85);
    const [head, data] = url.split(',');
    const media_type = head?.includes('png') ? 'image/png' : 'image/jpeg';
    return data ? { media_type, data } : null;
  } catch {
    return null;
  }
}

const imageUrl = (i: AssistantImage) => `data:${i.media_type};base64,${i.data}`;

/**
 * The message box: Enter sends, Shift+Enter breaks a line; Stop while an answer runs. While it
 * runs, words in the box go into it with Enter (Steer, where `canSteer`) or wait for it to end
 * with Alt+Enter (Queue); the `queue` lists above the box, each with Steer now, Edit and Remove.
 * Three
 * triggers list what can follow them as it is typed: `/` at the start a command, `@` a thing to
 * point at (the `sources`), `#` a tier for this message; a picked tier or thing shows as a chip.
 */
export function LumenComposer({
  name,
  busy,
  queued,
  queue,
  canSteer = false,
  onSteerQueued,
  onUnqueue,
  disabled,
  commands = [],
  tiers = [],
  sources = [],
  page,
  images: canAttach = false,
  onSend,
  onStop,
}: {
  name: string;
  /** Images can be pasted or dropped on the box (`LumenAssistant` `images`). */
  images?: boolean;
  /** The page's name for `@` This page; the document's title by default. */
  page?: string;
  busy: boolean;
  /** The first queued message; `queue` lists them all, with their actions. */
  queued: string | null;
  queue?: QueuedMessage[];
  /** Enter steers a message into the running answer; Alt+Enter queues it. */
  canSteer?: boolean;
  onSteerQueued?: (id: string) => void;
  /** Takes a queued message out; Edit puts its words back in the box. */
  onUnqueue?: (id: string) => QueuedMessage | undefined;
  disabled?: boolean;
  commands?: AssistantCommand[];
  /** What `#` lists. */
  tiers?: { id: string; label: string; model_label?: string }[];
  /** What `@` lists, a group each. */
  sources?: readonly AssistantSource[];
  onSend: (text: string, extra: ComposerExtra, how?: 'steer' | 'queue') => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [refs, setRefs] = useState<AssistantRefNote[]>([]);
  const [images, setImages] = useState<AssistantImage[]>([]);
  const [quote, setQuote] = useState<AssistantQuote | null>(null);
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
    if (request.quote) setQuote(request.quote);
    if (request.text !== undefined) {
      setText(request.text);
      setCaret(request.text.length);
    }
    requestAnimationFrame(() => box.current?.focus());
  }, [request]);

  const m = /^\/(\S*)(?:\s(.*))?$/s.exec(text);
  const cmd = m && m[2] !== undefined ? commands.find((c) => c.name === m[1]) : undefined;
  // `@` or `#` as the word the caret is in: `pick @sto|` lists the sources' items matching "sto".
  const word = /(^|\s)([@#])([^\s@#]*)$/.exec(text.slice(0, caret));
  const trigger = word ? word[2] : null;
  const asked = word?.[3] ?? '';
  const open = closed !== `${text}|${caret}`;
  const slash =
    m && commands.length ? (m[2] === undefined ? 'command' : cmd?.options ? 'arg' : null) : null;
  const at = trigger === TIER && tiers.length > 1 ? 'tier' : trigger === POINT ? 'point' : null;
  const picking = open ? (slash ?? at) : null;

  const extra = (): ComposerExtra => ({
    ...(tier ? { tier } : {}),
    ...(refs.length ? { refs } : {}),
    ...(images.length ? { images } : {}),
    ...(quote ? { quote } : {}),
  });
  const clear = () => {
    setText('');
    setCaret(0);
    setTier(null);
    setRefs([]);
    setImages([]);
    setQuote(null);
  };
  /** Adds the image files among `files`; says so when one is left out. Returns whether any was an image. */
  const attach = (files: FileList | File[]): boolean => {
    const picked = [...files].filter((f) => f.type.startsWith('image/'));
    if (!canAttach || !picked.length) return false;
    void (async () => {
      const read = (await Promise.all(picked.map(readImage))).filter(
        (x): x is AssistantImage => !!x,
      );
      if (read.length < picked.length)
        lumenToast.error("That image couldn't be read. Try a PNG or JPEG.");
      setImages((p) => {
        const next = [...p];
        let chars = next.reduce((n, x) => n + x.data.length, 0);
        for (const img of read) {
          if (
            next.length >= ASSISTANT_IMAGES_MAX ||
            chars + img.data.length > ASSISTANT_IMAGE_CHARS
          ) {
            lumenToast.error(`Up to ${ASSISTANT_IMAGES_MAX} images go with one message.`);
            break;
          }
          next.push(img);
          chars += img.data.length;
        }
        return next;
      });
    })();
    return true;
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
  const send = (how?: 'steer' | 'queue') => {
    if (!text.trim() || disabled) return;
    const c = m ? commands.find((x) => x.name === m[1]) : undefined;
    if (c) {
      void run(c, m?.[2] ?? '');
      return;
    }
    onSend(text, extra(), busy ? (how ?? (canSteer ? 'steer' : 'queue')) : undefined);
    clear();
  };
  // Edit: a queued message back in the box, its chips with it.
  const edit = (id: string) => {
    const q = onUnqueue?.(id);
    if (!q) return;
    setText(q.message);
    setCaret(q.message.length);
    if (q.extra?.tier) setTier(q.extra.tier);
    if (q.extra?.refs?.length) setRefs(q.extra.refs);
    if (q.extra?.images?.length) setImages(q.extra.images);
    if (q.extra?.quote) setQuote(q.extra.quote);
    requestAnimationFrame(() => box.current?.focus());
  };
  const waiting = queue ?? (queued ? [{ id: 'queued', message: queued }] : []);
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

  // Each `@` row makes its chip when picked, so what it carries (a card's words) is read then.
  const sourceItems = new Map<string, () => AssistantRefNote>();
  const picked = selection ? selectionRef(selection) : null;
  const added = (r: AssistantRefNote) =>
    refs.some((x) => sameRef(x, r)) ? { disabled: 'Added' } : {};
  const onPage: LumenOption[] = [];
  if (picking === 'point') {
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
    picking === 'point'
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
  const hints = [commands.length && '/', POINT, tiers.length > 1 && TIER].filter(Boolean);

  return (
    <div className="shrink-0 border-t p-3">
      {waiting.length > 0 && (
        <ComposerQueue
          queue={waiting}
          canSteer={busy && canSteer && !!onSteerQueued}
          onSteer={(id) => onSteerQueued?.(id)}
          onEdit={onUnqueue ? edit : undefined}
          onRemove={onUnqueue ? (id) => void onUnqueue(id) : undefined}
        />
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
      {picking === 'tier' && (
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
      {picking === 'point' && (
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
      {quote && <QuoteLine quote={quote} onRemove={() => setQuote(null)} />}
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Images going with your message">
          {images.map((img, i) => (
            <span key={`${i}:${img.data.length}`} className="relative">
              <img
                src={imageUrl(img)}
                alt={`Pasted ${i + 1}`}
                className="size-12 rounded-md border object-cover"
              />
              <button
                type="button"
                aria-label={`Remove image ${i + 1}`}
                className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
                onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {(tierLabel || refs.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tierLabel && (
            <ComposerChip sign={TIER} label={tierLabel} onRemove={() => setTier(null)} />
          )}
          {refs.map((r, i) => (
            <ComposerChip
              key={`${r.kind}:${r.label}:${i}`}
              sign={POINT}
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
          className={cn(
            'max-h-48 min-h-11 resize-none',
            busy && text.trim() && canSteer ? 'pr-18' : 'pr-11',
          )}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            // An image on the clipboard becomes a chip; text pastes as usual.
            if (!e.clipboardData.getData('text/plain') && attach(e.clipboardData.files))
              e.preventDefault();
          }}
          onDragOver={(e) => {
            if (canAttach && [...e.dataTransfer.items].some((x) => x.type.startsWith('image/')))
              e.preventDefault();
          }}
          onDrop={(e) => {
            if (attach(e.dataTransfer.files)) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (picking && list.current?.key(e)) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(e.altKey ? 'queue' : undefined);
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
          ) : busy ? (
            <span className="flex gap-1">
              <IconButton
                icon={ListPlusIcon}
                label={canSteer ? 'Queue for after (⌥↩)' : 'Queue for after (↩)'}
                variant={canSteer ? 'outline' : 'default'}
                size="icon-xs"
                disabled={disabled}
                onClick={() => send('queue')}
              />
              {canSteer && (
                <IconButton
                  icon={CornerDownRightIcon}
                  label="Steer now (↩)"
                  variant="default"
                  size="icon-xs"
                  disabled={disabled}
                  onClick={() => send('steer')}
                />
              )}
            </span>
          ) : (
            <IconButton
              icon={ArrowUpIcon}
              label="Send"
              variant="default"
              size="icon-xs"
              disabled={!text.trim() || disabled}
              onClick={() => send()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What waits above the box while an answer runs: steering messages until the answer reads them,
 * then queued ones in order, each with Steer now, Edit (back in the box) and Remove.
 */
function ComposerQueue({
  queue,
  canSteer,
  onSteer,
  onEdit,
  onRemove,
}: {
  queue: QueuedMessage[];
  canSteer: boolean;
  onSteer: (id: string) => void;
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const waiting = queue.filter((q) => !q.steering).length;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {waiting > 0 && (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <ListPlusIcon className="size-3.5" />
          Queued · {waiting}
        </p>
      )}
      {queue.map((q) => (
        <div
          key={q.id}
          className="flex h-8 min-w-0 items-center gap-1 rounded-md border bg-background pr-1 pl-2 text-sm"
        >
          {q.steering && (
            <CornerDownRightIcon
              aria-label="Steering: Sage reads it at its next step"
              className="size-3.5 shrink-0 animate-pulse text-primary"
            />
          )}
          <span
            className={cn('min-w-0 flex-1 truncate', q.steering && 'text-muted-foreground')}
            title={q.message}
          >
            {q.message}
          </span>
          {!q.steering && canSteer && (
            <IconButton
              icon={CornerDownRightIcon}
              label="Steer now"
              size="icon-xs"
              onClick={() => onSteer(q.id)}
            />
          )}
          {!q.steering && onEdit && (
            <IconButton
              icon={PencilIcon}
              label="Edit"
              size="icon-xs"
              onClick={() => onEdit(q.id)}
            />
          )}
          {!q.steering && onRemove && (
            <IconButton icon={XIcon} label="Remove" size="icon-xs" onClick={() => onRemove(q.id)} />
          )}
        </div>
      ))}
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

/** Share of `in` read from the prompt cache, as a whole percent. */
const hitPct = (p: { in: number; read: number }) => (p.in ? Math.round((p.read / p.in) * 100) : 0);

/**
 * A part's row name: its tier (the label's first piece; the whole label is the hover) and what it
 * was: the main model, `×N` hand-offs to a higher tier, advice or a compaction.
 */
function partRow(p: UsagePart, i: number) {
  const bits = p.label.split(' · ');
  const last = bits[bits.length - 1] ?? '';
  const kind = p.runs
    ? `×${p.runs}`
    : last === 'advice' || last === 'compact'
      ? last
      : i === 0
        ? 'main'
        : '';
  return { tier: bits[0] ?? p.label, kind };
}

/** The chat's use per part: cost, tokens in with the cache %, out, calls; then the total. */
function UsageTable({ usage }: { usage: ChatUsage }) {
  const total = 'mt-1 border-t pt-1';
  return (
    <div className="grid grid-cols-[auto_auto_auto_auto_auto_auto] gap-x-3 gap-y-0.5 whitespace-nowrap text-xs">
      <span />
      <span />
      <span className="text-right text-muted-foreground">Cost</span>
      <span className="text-right text-muted-foreground">In (cached)</span>
      <span className="text-right text-muted-foreground">Out</span>
      <span className="text-right text-muted-foreground">Calls</span>
      {usage.parts.map((p, i) => {
        const r = partRow(p, i);
        return (
          <Fragment key={p.label}>
            <span className="truncate font-medium" title={p.label}>
              {r.tier}
            </span>
            <span className="text-muted-foreground">{r.kind}</span>
            <span className="num text-right">{usd(p.usd)}</span>
            <span className="num text-right">
              {tokens(p.in)} ({hitPct(p)}%)
            </span>
            <span className="num text-right">{tokens(p.out)}</span>
            <span className="num text-right">{p.calls}</span>
          </Fragment>
        );
      })}
      <span className={cn(total, 'font-semibold')}>Total</span>
      <span className={total} />
      <span className={cn(total, 'num text-right font-semibold')}>{usd(usage.usd)}</span>
      <span className={cn(total, 'num text-right')}>
        {tokens(usage.in)} ({hitPct(usage)}%)
      </span>
      <span className={cn(total, 'num text-right')}>{tokens(usage.out)}</span>
      <span className={cn(total, 'num text-right')}>{usage.calls}</span>
    </div>
  );
}

/**
 * This month's total of every chat and run; it opens the month's history (each model, chat and
 * run), a sheet on a phone.
 */
function MonthTotal({
  client,
  spent,
  phone,
  className,
}: { client: AssistantAdapter; spent: number; phone: boolean; className?: string }) {
  const trigger = (
    <button
      type="button"
      className={cn(
        'flex shrink-0 items-center gap-1 tabular-nums hover:text-foreground',
        className,
      )}
      aria-label="Usage this month"
      title="Usage this month: every chat and run"
    >
      <ReceiptIcon className="size-3" aria-hidden />
      <span>
        This month <span className="num">{usd(spent)}</span>
      </span>
    </button>
  );
  return phone ? (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Usage</SheetTitle>
        </SheetHeader>
        <UsageHistoryView client={client} className="px-4 pb-6" />
      </SheetContent>
    </Sheet>
  ) : (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-md max-w-[92vw] p-3">
        <UsageHistoryView client={client} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The chat's cost, tokens in and out and cache hit (a pop-up splits them per part, a sheet on a
 * phone), how full the context is, and this month's total (`MonthTotal`).
 */
function UsageLine({
  usage,
  client,
  spent,
}: { usage: ChatUsage | null; client: AssistantAdapter; spent: number | undefined }) {
  const phone = useIsMobile();
  const month = !!client.usage && spent !== undefined && spent > 0;
  if ((!usage || !usage.calls) && !month) return null;
  const ctx = usage?.context ?? 0;
  const total = month ? (
    <MonthTotal
      client={client}
      spent={spent ?? 0}
      phone={phone}
      className={ctx > 0 ? '' : 'ml-auto'}
    />
  ) : null;
  if (!usage || !usage.calls)
    return (
      <div className="flex shrink-0 items-center gap-3 px-3 pb-2 text-muted-foreground text-xs">
        {total}
      </div>
    );
  const trigger = (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2 tabular-nums hover:text-foreground"
      aria-label="This chat's usage"
    >
      <span className="num truncate">
        {usd(usage.usd)} · ↑{tokens(usage.in)} ↓{tokens(usage.out)}
      </span>
      <span className="num flex shrink-0 items-center gap-0.5" title="Read from cache">
        <ZapIcon className="size-3" aria-hidden />
        {hitPct(usage)}%
      </span>
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-3 px-3 pb-2 text-muted-foreground text-xs">
      {phone ? (
        <Sheet>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>This chat's usage</SheetTitle>
            </SheetHeader>
            <div className="overflow-x-auto px-4 pb-6">
              <UsageTable usage={usage} />
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <UsageTable usage={usage} />
          </PopoverContent>
        </Popover>
      )}
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
      {total}
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

/** The Chats menu's All switch (`chatScope`), kept on this device per assistant. */
function useAllScopes(key: string): [boolean, (on: boolean) => void] {
  const name = `lumen-assistant:${key}:all-scopes`;
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(name) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      if (v) localStorage.setItem(name, '1');
      else localStorage.removeItem(name);
    } catch {}
  };
  return [on, set];
}
