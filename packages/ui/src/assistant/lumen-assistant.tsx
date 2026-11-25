// LumenAssistant: the chat that fills LumenAssistantPanel, for any app's assistant served by
// `@columenlabs/lumen-ai/assistant`. A header with the tier, Chats and New chat; the chat itself
// (the person's messages, the answer as it streams, each tool call as a line, drafted changes as
// cards to Save or Dismiss, work handed to a higher tier in its own section); and the composer,
// with Stop, a queued message and the chat's cost and context under it.
import {
  ASSISTANT_IMAGES_MAX,
  ASSISTANT_IMAGE_CHARS,
  ASSISTANT_IMAGE_NAME_MAX,
  type AllowanceState,
  type AllowanceUnit,
  type AssistantImage,
  type AssistantMessage,
  type AssistantQuote,
  type AssistantRefNote,
  type AssistantScreenMove,
  type AssistantStatus,
  type AssistantTask,
  type AssistantTaskState,
  type AssistantTaskTone,
  type AssistantTaskView,
  COMPACT_AT,
  type ChatItem,
  type ChatUsage,
  type DraftItem,
  type HandOffItem,
  type ScreenItem,
  type StepChoices,
  type StepItem,
  type TaskItem,
  type UsagePart,
  type WebLink,
  stepLineParts,
  stepLineText,
} from '@columenlabs/lumen-ui-types/assistant';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  CopyIcon,
  CornerDownRightIcon,
  CrosshairIcon,
  EyeIcon,
  FileTextIcon,
  GlobeIcon,
  HandIcon,
  InfoIcon,
  LightbulbIcon,
  ListPlusIcon,
  LoaderCircleIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  MonitorIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ReplyIcon,
  SearchIcon,
  SparklesIcon,
  SquareIcon,
  TriangleAlertIcon,
  Undo2Icon,
  WrenchIcon,
  XIcon,
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
import { FactList } from '../fact-list';
import { deviceNow } from '../hooks/use-device';
import { IconButton } from '../icon-button';
import { errorText, plainError } from '../integrations';
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
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '../ui/input-group';
import { Spinner } from '../ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { VoiceButton } from '../voice-input';
import { ChatImage } from './chat-image';
import type { AssistantAdapter } from './client';
import { chatMarkdown, chatTurns, copyMarkdown, turnMarkdown } from './copy';
import { ImageCard, ImagePending, toolIs } from './image-card';
import { ReplyToSelection } from './reply-selection';
import {
  type AssistantSource,
  composeAssistant,
  selectionRef,
  useComposeRequest,
  usePageSelection,
  useShownAssistantSources,
} from './sources';
import { tokens, usd } from './usage-history';
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
  ({ children }: { children: string; live?: boolean }) => (
    <p className="whitespace-pre-wrap">{children}</p>
  ),
);

/** The main model's context drawn full (tokens); the mark sits where the assistant compacts. */
const CONTEXT_MAX = 200_000;

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
const seconds = (ms?: number) =>
  !ms ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

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
   * only with the switch on. The menu asks the client for the `current` place's chats
   * (`chats(scope)`), so a server that caps its list still lists that place's older chats.
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
  /**
   * Toggles beside the paperclip, one per mode ("Make an image"): one turned on goes with the next
   * message as its `use`, and the app's plan reads it (call the tool that makes an image).
   */
  modes?: AssistantMode[];
  /**
   * The app's tool that makes images: while it runs its line is a "Making the image" box, and its
   * card's Make another sends again with `mode` on.
   */
  imageTool?: { tool: string; mode?: string };
  /**
   * Where the server compacts the chat, in tokens (the agent's `compactAt()`): the context donut turns
   * yellow at 75% of it and red at it. The person's Auto-compact (status `compact_at`) wins; 150k by default.
   */
  compactAt?: number;
  /**
   * A task in the chat (`AssistantTask`, the app's work in its own session): the buttons in its
   * card's header, such as Discard and Accept, from the app; `live` while the task's turn runs
   * (the card adds Stop then).
   */
  taskActions?: (task: AssistantTask, live: boolean) => ReactNode;
  /**
   * The app's word on where a task stands, ahead of the chat's: it took or dropped the task's result
   * in its own screens. While a task is open, each message the person sends goes to it.
   */
  taskState?: (task: AssistantTask) => AssistantTaskState | undefined;
  /**
   * The header of a task's card (`AssistantTaskView`): its tone (running, ready, settled, failed,
   * waiting on an answer, stopped), title and the line under it. Without it the card shows the
   * task's label and the chat's word for its state.
   */
  taskView?: (task: AssistantTask, live: boolean) => AssistantTaskView | undefined;
  /**
   * A turn drawn as a task's card: given a turn's items (the person's message and what answered
   * it, up to any task of its own), the app returns a task for a turn that is one piece of work
   * (an edit it reviews), and the turn's steps and words go inside a card like a task's, with the
   * app's `taskView` header and `taskActions` buttons. Undefined keeps the turn as lines. A returned
   * `items` replaces the card's steps: a piece of work later turns added to shows their steps too.
   * Null draws nothing for the turn: an earlier card holds it (its message as a Steer row).
   */
  turnTask?: (items: ChatItem[]) => (AssistantTask & { items?: ChatItem[] }) | null | undefined;
  /** The composer's words while the person's messages steer a piece of work ("Steer this change…"). */
  composerHint?: string;
}

/** A composer mode: its toggle's icon and label (also its tooltip and aria-label). */
export interface AssistantMode {
  id: string;
  icon: LucideIcon;
  label: string;
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
  modes = [],
  imageTool,
  compactAt = COMPACT_AT,
  taskActions,
  taskState,
  taskView,
  turnTask,
  composerHint,
}: LumenAssistantProps) {
  const own = useAssistantChat(client);
  const chat = outside ?? own;
  // While the chat ends in an open task, its waiting messages sit under its card, not above the box.
  const tail = chat.items[chat.items.length - 1];
  const queueUnder =
    tail?.kind === 'task' && (taskState?.(tail) ?? tail.state) === 'open' && chat.queue.length > 0;
  const editQueued = useRef<((id: string) => void) | null>(null);
  const qc = useQueryClient();
  const status = useAssistantStatus(client);
  const [allScopes, setAllScopes] = useAllScopes(client.key);
  // The Chats menu asks for this place's chats (`chatScope`) unless All is on, so they list however
  // many newer chats other places have.
  const scope = chatScope && !allScopes ? chatScope.current : undefined;
  const chats = useQuery({
    queryKey: ['lumen-assistant', client.key, 'chats', ...(scope ? [scope] : [])],
    queryFn: () => client.chats(scope),
    enabled: false,
  });
  // Once the menu has been opened, the All switch reads the list it now shows.
  const listed = useRef(false);
  const refetchChats = chats.refetch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scope reads its own list
  useEffect(() => {
    if (listed.current) void refetchChats();
  }, [scope, refetchChats]);
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
  // While a task is open, every message goes to it (the app decides what that means); the task
  // ends when the app takes or drops its result.
  const openTask =
    chat.task && (taskState?.(chat.task) ?? chat.task.state) === 'open' ? chat.task : null;
  const extra = (): Omit<AssistantMessage, 'message' | 'chat_id'> => ({
    ...(context ? { context } : {}),
    ...(screenOn && screen ? { screen: screenMapFor(screen) } : {}),
    ...(openTask ? { task: openTask.id } : {}),
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
        if (o.status === 'done' && onClose && deviceNow().narrow) onClose();
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

  // The app picks the tier itself (pick_tier false): no tier menu, `#`, /model or /escalate.
  const tiers = s?.pick_tier === false ? [] : (s?.tiers ?? []);
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
        {s && tiers.length > 1 && (
          <LumenSelector
            trigger="chip"
            size="sm"
            label="Tier"
            value={s.tier}
            options={tiers.map((t) => ({ value: t.id, label: t.label, detail: t.model_label }))}
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
          onRefresh={() => {
            listed.current = true;
            void chats.refetch();
          }}
          onOpen={(c) => void chat.open(c.id)}
        />
        <IconButton
          icon={CopyIcon}
          label="Copy chat"
          disabled={!chat.items.length}
          onClick={() =>
            copyMarkdown(
              chatMarkdown(chat.title, chat.items, name, chat.chatId ?? undefined),
              'Chat',
            )
          }
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
          <ImageTool.Provider value={imageTool ?? null}>
            <TaskSlots.Provider
              value={{
                actions: taskActions,
                state: taskState,
                view: taskView,
                turn: turnTask,
                stop: chat.stop,
              }}
            >
              <TaskAnswer.Provider value={s?.wait ? null : (text) => chat.send(text, extra())}>
                <TaskQueue.Provider
                  value={
                    queueUnder
                      ? {
                          queue: chat.queue,
                          canSteer: chat.busy && chat.canSteer,
                          onSteer: chat.steerQueued,
                          onEdit: (id) => editQueued.current?.(id),
                          onRemove: (id) => void chat.unqueue(id),
                        }
                      : null
                  }
                >
                  <Messages
                    chat={chat}
                    status={s}
                    onSettings={onSettings}
                    onRetry={(at, user) => chat.retry(at, user, extra())}
                    onFresh={(choice) => chat.fresh(choice, extra())}
                    onAnswer={(text) => chat.send(text, extra())}
                  />
                </TaskQueue.Provider>
              </TaskAnswer.Provider>
            </TaskSlots.Provider>
          </ImageTool.Provider>
        </Screen.Provider>
      </AssistantName.Provider>
      <LumenComposer
        name={s?.name ?? 'the assistant'}
        hint={composerHint}
        busy={chat.busy}
        queued={chat.queued}
        queue={chat.queue}
        canSteer={chat.canSteer}
        onSteerQueued={chat.steerQueued}
        onUnqueue={chat.unqueue}
        queueShown={queueUnder}
        editQueued={editQueued}
        disabled={!s || !!s.wait}
        commands={allCommands}
        tiers={tiers}
        sources={allSources}
        page={context?.label}
        images={images}
        modes={modes}
        onSend={(text, more, how) => chat.send(text, { ...extra(), ...more }, how)}
        onStop={chat.stop}
        meter={
          <ContextDonut
            usage={chat.usage}
            compactAt={s?.compact_at ?? compactAt}
            items={chat.items}
          />
        }
      />
    </div>
  );
}

/** How near the end of the chat (px) still counts as at the end, so it keeps following. */
const FOLLOW_PX = 48;

function Messages({
  chat,
  status,
  onSettings,
  onRetry,
  onFresh,
  onAnswer,
}: {
  chat: AssistantChatState;
  status: AssistantStatus | undefined;
  onSettings?: () => void;
  onRetry: RetryFn;
  onFresh: (choice: 'new' | 'stay') => void;
  /** Sends a quick reply as the person's message. */
  onAnswer: (text: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const slots = useContext(TaskSlots);
  const count = JSON.stringify(chat.items).length;
  // Follow the chat as it grows only while the person is at its end: once they scroll up to read,
  // a streaming answer or a card that changes leaves their place alone. Sending a message, or
  // opening another chat, goes to the end again.
  const pinned = useRef(true);
  const onScroll = () => {
    const el = box.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_PX;
  };
  // How many messages the person has sent: a reload in place swaps each item for the server's copy
  // (a new `at`), which must not count as a new message and pull the list back to its end.
  const sent = chat.items.reduce((n, it) => n + (it.kind === 'user' ? 1 : 0), 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new message or chat pins the end again
  useEffect(() => {
    pinned.current = true;
  }, [sent, chat.chatId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the end as the chat grows
  useEffect(() => {
    const el = box.current;
    // The list's own scroll only: scrollIntoView would move the page and every scroll box around it.
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count, sent, chat.chatId, chat.loading]);
  // The app's own link to Settings, else the shell's, at the section that answers the wait.
  const shellSettings = useOpenSettings();
  const settings = onSettings ? (_section: string) => onSettings() : shellSettings;
  return (
    <div
      ref={box}
      onScroll={onScroll}
      className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3"
    >
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
      ) : chat.items.length === 0 && !status?.wait ? null : (
        <TierNames.Provider value={(id) => status?.tiers.find((t) => t.id === id)?.label ?? id}>
          <UndoWrite.Provider value={chat.undo}>
            {/* Retry waits while an answer runs or nobody can pay: hidden then, never disabled. */}
            <RetryTurn.Provider value={chat.busy || status?.wait ? null : onRetry}>
              <FreshChoice.Provider value={chat.busy ? null : onFresh}>
                <Items items={chat.items} onSettle={chat.settle} busy={chat.busy} turns />
              </FreshChoice.Provider>
            </RetryTurn.Provider>
          </UndoWrite.Provider>
        </TierNames.Provider>
      )}
      {!chat.busy &&
        !status?.wait &&
        (() => {
          // A task's question shows its answers in its card (its Follow-up step), so they never show twice.
          const c = lastTurnInCard(chat.items, slots.turn) ? null : lastChoices(chat.items);
          return c ? (
            <div className="mt-2">
              <QuickReplies key={chat.items.length} choices={c} onSend={onAnswer} />
            </div>
          ) : null;
        })()}
      {/* A turn the app draws as a card shows its own running state there, never a second Thinking. */}
      {chat.busy && !chat.items.some(isLive) && !lastTurnInCard(chat.items, slots.turn) && (
        <p className="flex items-center gap-2 py-1 text-muted-foreground text-sm">
          <Spinner /> Thinking…
        </p>
      )}
      <div ref={end} />
    </div>
  );
}

const isLive = (i: LiveItem): boolean =>
  !!i.live || ((i.kind === 'handoff' || i.kind === 'task') && (i.items as LiveItem[]).some(isLive));

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
/** The app's image tool (`LumenAssistant` `imageTool`). */
const ImageTool = createContext<{ tool: string; mode?: string } | null>(null);
const UndoWrite = createContext<((s: StepItem) => Promise<void>) | null>(null);
type UserItem = Extract<ChatItem, { kind: 'user' }>;
type RetryFn = (at: number, user: UserItem) => void;

/** Answers the fresh-chat card; null while an answer runs. */
const FreshChoice = createContext<((choice: 'new' | 'stay') => void) | null>(null);

/**
 * The app asks before answering: the message above starts new work and this chat is long, so a
 * fresh chat answers it faster and for less. ＋ takes it there, × keeps it here.
 */
function FreshCard() {
  const choose = useContext(FreshChoice);
  return (
    <div
      data-slot="assistant-fresh"
      className="flex min-w-0 items-center gap-2 rounded-lg border bg-card py-2 pr-2 pl-3 text-sm"
    >
      <span className="min-w-0 flex-1">This looks like new work. Start a fresh chat for it?</span>
      {choose && (
        <span className="flex shrink-0 gap-1">
          <IconButton icon={XIcon} label="Keep it in this chat" onClick={() => choose('stay')} />
          <IconButton
            icon={PlusIcon}
            label="New chat with this message"
            variant="default"
            onClick={() => choose('new')}
          />
        </span>
      )}
    </div>
  );
}
/** Sends a failed turn again; null while it can't (an answer runs, nobody can pay). */
const RetryTurn = createContext<RetryFn | null>(null);

/** Where a turn's unretried error sits in the chat, when the turn starts with a message. */
/**
 * Where a turn failed, for Retry: its error, or the task block it ended inside (an end lands in the
 * block its turn ran in), with the message to send again (the block's newest ask before the error).
 */
function failedAt(t: {
  from: number;
  items: (ChatItem | LiveItem)[];
}): { at: number; user: UserItem } | null {
  const first = t.items[0];
  if (first?.kind !== 'user') return null;
  for (let i = t.items.length - 1; i > 0; i--) {
    const it = t.items[i];
    if (it?.kind === 'error') return it.retried ? null : { at: t.from + i, user: first };
    if (it?.kind === 'task' && i === t.items.length - 1) {
      const inner = it.items as (ChatItem | LiveItem)[];
      const e = inner.findLastIndex((x) => x.kind === 'error');
      const ask = inner.findLastIndex((x) => x.kind === 'user' && !x.steered);
      const err = inner[e];
      if (e < 0 || ask > e || err?.kind !== 'error') return null;
      if (err.retried) return null;
      const user = ask >= 0 ? (inner[ask] as UserItem) : first;
      return { at: t.from + i, user };
    }
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
  const slots = useContext(TaskSlots);
  if (turns)
    return (
      <div className="flex flex-col gap-3">
        {chatTurns(items).map((t) => {
          const open = busy && t.from + t.items.length === items.length;
          const failed = retry && !open ? failedAt(t) : null;
          // The app may draw the turn as a task's card (`turnTask`): its lines up to any task of its own.
          const cut = t.items.findIndex((i) => i.kind === 'task' || i.kind === 'handoff');
          const lead = cut < 0 ? t.items : t.items.slice(0, cut);
          const task =
            slots.turn && lead[0]?.kind === 'user' ? slots.turn(lead as ChatItem[]) : undefined;
          // Held by an earlier card (shown there as a Steer row): nothing of its own.
          if (task === null && cut < 0) return null;
          return (
            <div key={t.from} data-slot="assistant-turn" className="group/turn flex flex-col gap-3">
              {task === null ? (
                <Items items={t.items.slice(cut)} onSettle={onSettle} busy={busy} />
              ) : task ? (
                <>
                  <TaskBlock
                    item={{ ...task, kind: 'task', items: task.items ?? (lead as ChatItem[]) }}
                    onSettle={onSettle}
                    busy={busy}
                  />
                  {cut >= 0 && <Items items={t.items.slice(cut)} onSettle={onSettle} busy={busy} />}
                </>
              ) : (
                <Items items={t.items} onSettle={onSettle} busy={busy} />
              )}
              {!open && <WebSources items={t.items as ChatItem[]} />}
              {!open && (
                <div className="-mt-2 flex justify-end gap-0.5">
                  {/* A failed turn always shows Retry; Copy shows on hover (always on touch). */}
                  {retry && failed !== null && (
                    <IconButton
                      icon={RefreshCwIcon}
                      label="Retry"
                      className="size-6"
                      onClick={() => retry(failed.at, failed.user)}
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
  // Read-only calls in a row fold into one line (`StepFoldLine`), as they do in a task's card.
  const rows: (
    | { at: number; item: LiveItem }
    | { at: number; drafts: DraftItem[] }
    | { at: number; looked: StepItem[] }
  )[] = [];
  items.forEach((item, at) => {
    const last = rows[rows.length - 1];
    const prev = items[at - 1] as LiveItem | undefined;
    if (lookup(item as LiveItem) && prev && lookup(prev) && last) {
      if ('looked' in last) last.looked.push(item as StepItem);
      else rows[rows.length - 1] = { at: last.at, looked: [prev as StepItem, item as StepItem] };
    } else if (item.kind === 'draft' && prev?.kind === 'draft' && last) {
      if ('drafts' in last) last.drafts.push(item);
      else rows[rows.length - 1] = { at: last.at, drafts: [prev as DraftItem, item] };
    } else rows.push({ at, item: item as LiveItem });
  });
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) =>
        'drafts' in r ? (
          <DraftStack key={r.at} drafts={r.drafts} onSettle={onSettle} busy={busy} />
        ) : 'looked' in r ? (
          <StepFoldLine key={r.at} steps={r.looked} />
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
          <div className="ml-8 flex min-w-0 max-w-[calc(100%-2rem)] flex-col items-end gap-0.5 self-end">
            <span className="flex items-center gap-1 text-primary text-xs">
              <CornerDownRightIcon className="size-3" />
              Steered
            </span>
            <div className="min-w-0 max-w-full rounded-lg border border-primary/40 bg-muted px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              {item.text}
            </div>
          </div>
        );
      const bubble = (
        <div
          data-chat-from="user"
          className="ml-8 min-w-0 max-w-[calc(100%-2rem)] self-end rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] has-[[data-slot=chat-image]]:ml-0 has-[[data-slot=chat-image]]:w-full has-[[data-slot=chat-image]]:max-w-full"
        >
          {item.quote && <QuoteLine quote={item.quote} />}
          {(item.tier || item.refs?.length) && (
            <span className="mb-1 flex min-w-0 flex-wrap gap-1">
              {item.tier && <ComposerChip sign={TIER} label={tierName(item.tier)} />}
              {item.refs?.map((r, i) => (
                <ComposerChip key={`${r.kind}:${r.label}:${i}`} sign={POINT} label={r.label} />
              ))}
            </span>
          )}
          {item.images?.length ? (
            <span className="mb-1 flex flex-wrap gap-1.5">
              {item.images.map((src, i) => (
                <ChatImage
                  key={`${i}:${src.length}`}
                  src={src}
                  alt={item.imageNames?.[i] || `Image ${i + 1}`}
                />
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
        <div className="flex w-full min-w-0 flex-col items-end gap-0.5 self-end">
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
          className="prose-sm min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere] [&_code]:font-code [&_code]:text-xs [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_ul]:list-disc"
        >
          <ChatMarkdown live={item.live}>{item.text}</ChatMarkdown>
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
    case 'task':
      return <TaskBlock item={item} onSettle={onSettle} busy={busy} />;
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
    case 'fresh':
      return <FreshCard />;
    case 'stopped':
      return (
        <Rule>
          {item.reason === 'cap'
            ? "Stopped at this month's spend cap"
            : item.reason === 'limit'
              ? 'Stopped at the time limit'
              : 'Stopped'}
        </Rule>
      );
    case 'error':
      // The app was deployed mid-answer: what ran above stands, nothing failed on the person's side.
      if (item.code === 'app_updated')
        return (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            {item.text} Steps shown as done above are done; check the result, then ask again for
            anything left.
          </p>
        );
      return (
        <p
          role={item.retried ? undefined : 'alert'}
          className={cn(
            'flex items-start gap-1.5 text-sm',
            item.retried ? 'text-muted-foreground' : 'text-loss',
          )}
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {plainError(item.text)}
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
  const results = (web.lookup ? web.reads : web.results) ?? [];
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
          {web.lookup ? 'Looked up' : 'Searched the web'}
          {web.query ? ': ' : ''}
          {web.query && <span className="text-foreground">{web.query}</span>}
        </span>
      )}
      {!live && !web.read && !web.tried && step.ok && (
        <span className="ml-auto shrink-0 tabular-nums">
          {results.length} {web.lookup ? 'source' : 'result'}
          {results.length === 1 ? '' : 's'}
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
      else if (i.kind === 'step')
        for (const p of i.web?.read ? [i.web.read] : (i.web?.reads ?? []))
          if (!pages.some((x) => x.url === p.url)) pages.push(p);
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
  const images = useContext(ImageTool);
  if (step.image) return <ImageCard step={step} image={step.image} mode={images?.mode} />;
  if (live && images && toolIs(step.tool, images.tool)) return <ImagePending />;
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
  // A change that did not land is a failure too, whatever the call returned.
  const ok = step.ok && w?.status !== 'failed';
  const facts = [
    step.rows !== undefined ? `${step.rows} row${step.rows === 1 ? '' : 's'}` : '',
    seconds(step.ms),
  ].filter(Boolean);
  return (
    <p
      data-slot="chat-step"
      data-ok={ok}
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs',
        ok ? 'text-muted-foreground' : 'text-loss',
      )}
    >
      {live ? (
        <Spinner className="size-3" />
      ) : !ok ? (
        <CircleAlertIcon className="size-3.5 shrink-0" />
      ) : w ? (
        <PencilIcon className="size-3.5 shrink-0" />
      ) : (
        <WrenchIcon className="size-3.5 shrink-0" />
      )}
      <span className="truncate" title={stepLineText(step.title)}>
        {stepLineParts(step.title).map((part, i) =>
          part.name ? (
            // A name (`stepName`): a token in the accent colour, so it reads as the thing it names.
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed line, in order
              key={i}
              data-step-name
              className={cn(
                'rounded px-1 font-medium',
                ok ? 'bg-primary/10 text-primary' : 'bg-loss/10',
              )}
            >
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
      </span>
      {!live && facts.length > 0 && (
        <span className="shrink-0 tabular-nums">{facts.join(' · ')}</span>
      )}
      {(step.error || w?.error) && (
        <span className="truncate" title={step.error ?? w?.error}>
          · {step.error ?? w?.error}
        </span>
      )}
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
      </p>
      {item.task && <p className="text-muted-foreground text-xs">{item.task}</p>}
      <Items items={item.items} onSettle={onSettle} busy={busy} />
    </section>
  );
}

/** The app's parts of a task's card (`taskActions`, `taskState`, `taskView`) and the chat's Stop. */
const TaskSlots = createContext<{
  actions?: (task: AssistantTask, live: boolean) => ReactNode;
  state?: (task: AssistantTask) => AssistantTaskState | undefined;
  view?: (task: AssistantTask, live: boolean) => AssistantTaskView | undefined;
  turn?: (items: ChatItem[]) => (AssistantTask & { items?: ChatItem[] }) | null | undefined;
  stop?: () => void;
}>({});

/** Sends a quick reply or an answer in the person's words (null while the chat cannot take one). */
const TaskAnswer = createContext<((text: string) => void) | null>(null);

/** Messages waiting for the running task, drawn under its card: Steer now, Edit, Remove. */
const TaskQueue = createContext<{
  queue: QueuedMessage[];
  canSteer: boolean;
  onSteer: (id: string) => void;
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
} | null>(null);

/** The words a card says without the app's own view. */
const TASK_STATE: Record<AssistantTaskState, string> = {
  open: 'Open',
  done: 'Kept',
  dropped: 'Dropped',
};

/** Each tone's icon and colour: the icon sits in a tinted square at the head of the card. */
const TONE: Record<
  AssistantTaskTone,
  { icon: LucideIcon; box: string; word: string; spin?: boolean }
> = {
  live: {
    icon: LoaderCircleIcon,
    box: 'bg-primary/12 text-primary',
    word: 'text-primary',
    spin: true,
  },
  ready: { icon: CircleCheckIcon, box: 'bg-gain/15 text-gain', word: 'text-gain' },
  review: { icon: EyeIcon, box: 'bg-info/15 text-info', word: 'text-info' },
  done: {
    icon: CheckCheckIcon,
    box: 'bg-muted text-muted-foreground',
    word: 'text-muted-foreground',
  },
  failed: { icon: CircleAlertIcon, box: 'bg-loss/12 text-loss', word: 'text-loss' },
  ask: { icon: HandIcon, box: 'bg-warning/15 text-warning', word: 'text-warning' },
  stopped: {
    icon: CircleXIcon,
    box: 'bg-muted text-muted-foreground',
    word: 'text-muted-foreground',
  },
};

/** m:ss since a time, ticking each second while shown. */
function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
  );
}

/** Where a task's card sits among its items: after the person's last message that tools answered. */
function cardAt(items: LiveItem[]): number {
  const last = items.findLastIndex((i) => i.kind === 'step' || i.kind === 'draft');
  if (last < 0) return items.findLastIndex((i) => i.kind === 'user') + 1;
  for (let i = last; i >= 0; i--) if (items[i]?.kind === 'user') return i + 1;
  return 0;
}

/**
 * A piece of the assistant's work as one card: a tinted icon for where it stands, its title and the
 * line under it (`AssistantTaskView`), the app's buttons, Stop while it runs, a thin running bar,
 * and a chevron that shows its steps (`children`). The chat draws each task this way; an app draws
 * its own work the same way (an edit waiting for review) so every piece of work looks alike.
 */
export function WorkCard({
  view,
  live = false,
  state,
  actions,
  onStop,
  steps = 0,
  open: shownAt,
  rows = false,
  children,
}: {
  view: AssistantTaskView;
  live?: boolean;
  /** The task's own state, for `data-state`. */
  state?: string;
  actions?: ReactNode;
  onStop?: () => void;
  /** How many steps `children` holds: no chevron without any. */
  steps?: number;
  /** Starts open; by default it is open while the work runs. */
  open?: boolean;
  /** `children` are rows with their own padding and lines (a task's steps), drawn edge to edge. */
  rows?: boolean;
  children?: ReactNode;
}) {
  const tone = TONE[view.tone];
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = (open ?? (shownAt || live)) && steps > 0;
  const Icon = tone.icon;
  return (
    <section
      data-slot="chat-task"
      data-state={state}
      data-tone={view.tone}
      aria-label={view.title}
      className={cn(
        'flex min-w-0 flex-col overflow-clip rounded-lg border bg-card',
        view.tone === 'live' && 'border-primary/45',
        view.tone === 'ready' && 'border-gain/45',
        view.tone === 'review' && 'border-info/45',
        view.tone === 'failed' && 'border-loss/45',
        view.tone === 'ask' && 'border-warning/45',
      )}
    >
      {/* The header stays in view while a long card scrolls by (the chat pads 0.75rem). */}
      <div
        data-slot="chat-task-head"
        className="sticky -top-3 z-10 flex min-w-0 items-center gap-2.5 rounded-t-lg bg-card py-2 pr-1.5 pl-2.5"
      >
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', tone.box)}>
          <Icon className={cn('size-4', tone.spin && 'animate-spin')} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-sm" title={view.title}>
            {view.title}
          </span>
          {(view.detail || view.state || (live && view.since)) && (
            <span className="flex min-w-0 gap-1 text-muted-foreground text-xs">
              {view.detail && (
                <span className="min-w-0 truncate" title={view.detail}>
                  {view.detail}
                </span>
              )}
              {view.state && (
                <span className={cn('shrink-0', tone.word)}>
                  {view.detail ? '· ' : ''}
                  {view.state}
                </span>
              )}
              {live && view.since ? (
                <span className="shrink-0 tabular-nums">
                  · <Clock since={view.since} />
                </span>
              ) : null}
            </span>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {actions}
          {onStop && (
            <IconButton
              icon={SquareIcon}
              label="Stop"
              variant="outline"
              size="icon-sm"
              onClick={onStop}
            />
          )}
          {steps > 0 && (
            <IconButton
              icon={shown ? ChevronUpIcon : ChevronDownIcon}
              label={shown ? 'Hide steps' : 'Show steps'}
              size="icon-sm"
              aria-expanded={shown}
              onClick={() => setOpen(!shown)}
            />
          )}
        </span>
      </div>
      {live && (
        <div className="h-0.5 w-full overflow-hidden bg-primary/15">
          <div className="h-full w-1/3 animate-[lumen-progress_1.4s_ease-in-out_infinite] bg-primary" />
        </div>
      )}
      {shown && <div className={cn('border-t', !rows && 'px-3 py-2')}>{children}</div>}
    </section>
  );
}

/** A line of the assistant's words as a row's title: its first sentence, without Markdown marks. */
function firstLine(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>[\]]|\(https?:[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = plain.match(/^(.{12,}?[.!?:])(\s|$)/);
  return m?.[1] ?? plain;
}

/** One row of a task's card: a step line, a fold of lookups, the assistant's words or the person's. */
type TaskRow =
  | { key: string; kind: 'line'; item: LiveItem }
  | { key: string; kind: 'lookups'; steps: StepItem[] }
  | {
      key: string;
      kind: 'words';
      tag: 'Plan' | 'Result' | 'Follow-up' | 'Reply';
      text: string;
      /** The words are still streaming: drawn like a live answer (no raw Markdown marks). */
      live?: boolean;
      choices?: StepChoices;
    }
  | { key: string; kind: 'you'; text: string; steered: boolean };

/** A step that only looked something up: several in a row fold into one line. */
const lookup = (i: LiveItem): boolean =>
  i.kind === 'step' &&
  i.ok !== false &&
  !i.write &&
  !i.writing &&
  !i.choices &&
  !i.image &&
  (!i.live || !!i.fold);

/** "a", "a and b", "a, b and c". */
const andList = (parts: string[]): string =>
  parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

/** A fold's calls by what they read: the app's groups (`StepItem.fold`), else identical lines. */
function foldGroups(steps: StepItem[]) {
  const groups = new Map<
    string,
    { fold?: StepItem['fold']; line: string; n: number; whats: string[] }
  >();
  for (const s of steps) {
    const key = s.fold ? `g:${s.fold.group}` : `l:${stepLineText(s.title)}`;
    const g = groups.get(key) ?? { fold: s.fold, line: stepLineText(s.title), n: 0, whats: [] };
    g.n += 1;
    if (s.fold?.what && !g.whats.includes(s.fold.what)) g.whats.push(s.fold.what);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * A fold's line in one sentence: what was read ("Read 3 guides and the API reference"), each group
 * worded by the app (`StepFold.one` / `many`); calls with no group say their own line, ×N when
 * repeated. While a call in it runs, its own present-tense line.
 */
export function foldLine(steps: StepItem[]): string {
  const live = (steps as LiveItem[]).findLast((x) => x.kind === 'step' && x.live);
  if (live?.kind === 'step') return stepLineText(live.title);
  const groups = foldGroups(steps);
  const read = groups
    .filter((g) => g.fold)
    .map((g) => {
      const f = g.fold as NonNullable<StepItem['fold']>;
      const form = (g.n === 1 ? f.one : f.many) ?? f.group;
      return form.replaceAll('{n}', String(g.n)).replaceAll('{what}', g.whats[0] ?? '');
    });
  const lines = groups.filter((g) => !g.fold).map((g) => (g.n > 1 ? `${g.line} ×${g.n}` : g.line));
  return [read.length ? `Read ${andList(read)}` : '', ...lines].filter(Boolean).join(' · ');
}

/** A fold opened: one row per group (what it read, or how many lookups), no times. */
function FoldDetail({ steps }: { steps: StepItem[] }) {
  const done = (steps as LiveItem[]).filter((x) => !(x.kind === 'step' && x.live)) as StepItem[];
  const groups = foldGroups(done);
  const facts = groups
    .filter((g) => g.fold)
    .map((g) => {
      const value = g.whats.length ? g.whats.join(' · ') : `${g.n} lookup${g.n === 1 ? '' : 's'}`;
      return { label: (g.fold as NonNullable<StepItem['fold']>).group, value, title: value };
    });
  const lines = groups.filter((g) => !g.fold);
  return (
    <div
      data-slot="chat-fold"
      className="flex min-w-0 flex-col gap-1.5 text-muted-foreground text-xs"
    >
      {facts.length > 0 && <FactList className="text-xs" facts={facts} />}
      {lines.map((g) => (
        <p key={g.line} className="truncate" title={g.line}>
          {g.n > 1 ? `${g.line} ×${g.n}` : g.line}
        </p>
      ))}
    </div>
  );
}

/** Read-only calls in a row in a plain turn: one line that opens to what they read. */
function StepFoldLine({ steps }: { steps: StepItem[] }) {
  const [open, setOpen] = useState(false);
  const live = (steps as LiveItem[]).some((x) => x.kind === 'step' && x.live);
  const line = foldLine(steps);
  return (
    <div data-slot="chat-step-fold" className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded text-left text-muted-foreground text-xs hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {live ? <Spinner className="size-3" /> : <SearchIcon className="size-3.5 shrink-0" />}
        <span className="truncate" title={line}>
          {line}
        </span>
        {open ? (
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
        )}
      </button>
      {open && (
        <div className="pl-5">
          <FoldDetail steps={steps} />
        </div>
      )}
    </div>
  );
}

/**
 * A task's items as the rows of its card. Each turn's words are a step of their own: before its
 * tools they are its Plan, after them its Result, and the last words of a turn that asks are the
 * Follow-up, holding the question's answers. Lookups in a row fold into one line; the person's
 * later messages (answers, steering) are rows too.
 */
function taskRows(items: LiveItem[], answerable: StepChoices | null): TaskRow[] {
  const rows: TaskRow[] = [];
  let looked: StepItem[] = [];
  let turnHasTools = false;
  let turnStart = 0;
  const flush = () => {
    if (looked.length === 1)
      rows.push({ key: `l${rows.length}`, kind: 'line', item: looked[0] as LiveItem });
    else if (looked.length) rows.push({ key: `k${rows.length}`, kind: 'lookups', steps: looked });
    looked = [];
  };
  items.forEach((it, n) => {
    if (it.kind === 'user') {
      flush();
      turnHasTools = false;
      turnStart = rows.length + 1;
      rows.push({ key: `u${n}`, kind: 'you', text: it.text, steered: true });
      return;
    }
    if (it.kind === 'step' && it.choices) return;
    if (lookup(it)) {
      looked.push(it as StepItem);
      turnHasTools = true;
      return;
    }
    flush();
    if (it.kind === 'text') {
      if (!it.text.trim()) return;
      const later = items.slice(n + 1);
      const toolsAfter = later.findIndex((x) => x.kind === 'user');
      const rest = toolsAfter < 0 ? later : later.slice(0, toolsAfter);
      const tag = rest.some((x) => x.kind === 'step' && !x.choices)
        ? 'Plan'
        : turnHasTools || rows.slice(turnStart).some((r) => r.kind !== 'words')
          ? 'Result'
          : 'Reply';
      rows.push({ key: `t${n}`, kind: 'words', tag, text: it.text, live: it.live });
      return;
    }
    if (it.kind === 'step' || it.kind === 'draft') turnHasTools = true;
    rows.push({ key: `i${n}`, kind: 'line', item: it });
  });
  flush();
  // The last words of the chat, while its question waits: the Follow-up, with its answers.
  if (answerable) {
    const last = rows.findLastIndex((r) => r.kind === 'words');
    const r = rows[last];
    if (r?.kind === 'words' && last >= rows.findLastIndex((x) => x.kind === 'you'))
      rows[last] = { ...r, tag: 'Follow-up', choices: answerable };
  }
  return rows;
}

const ROW_ICON: Record<TaskRow['kind'] | 'Plan' | 'Result' | 'Follow-up' | 'Reply', LucideIcon> = {
  line: WrenchIcon,
  lookups: SearchIcon,
  words: LightbulbIcon,
  you: CornerDownRightIcon,
  Plan: LightbulbIcon,
  Result: CircleCheckIcon,
  'Follow-up': CircleHelpIcon,
  Reply: MessageSquareTextIcon,
};

/** The person's answer in their own words, under a Follow-up's quick replies. */
function OwnAnswer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <form
      className="flex min-w-0 items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Something else…"
        aria-label="Answer in your own words"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <IconButton
        icon={ArrowUpIcon}
        label="Send"
        size="icon-xs"
        type="submit"
        disabled={!text.trim()}
      />
    </form>
  );
}

/** One row of a task's card: a line that opens to its whole text (one open at a time). */
function TaskRowView({
  row,
  open,
  onToggle,
  onSettle,
  busy,
}: {
  row: TaskRow;
  open: boolean;
  onToggle: () => void;
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
}) {
  const answer = useContext(TaskAnswer);
  if (row.kind === 'line')
    return (
      <div className="border-t px-3 py-1.5 first:border-t-0">
        <Item item={row.item} onSettle={onSettle} busy={busy} />
      </div>
    );
  const tag =
    row.kind === 'words' ? row.tag : row.kind === 'you' ? (row.steered ? 'Steer' : 'You') : null;
  const Icon = ROW_ICON[row.kind === 'words' ? row.tag : row.kind];
  const now = row.kind === 'words' && row.tag === 'Follow-up';
  const title =
    row.kind === 'lookups'
      ? foldLine(row.steps)
      : row.kind === 'words'
        ? firstLine(row.text)
        : row.text;
  return (
    <div
      data-slot="chat-task-row"
      data-open={open || undefined}
      className="border-t first:border-t-0"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          now && 'bg-primary/5',
        )}
      >
        {row.kind === 'lookups' &&
        (row.steps as LiveItem[]).some((x) => x.kind === 'step' && x.live) ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : (
          <Icon
            className={cn('size-3.5 shrink-0', now ? 'text-primary' : 'text-muted-foreground')}
            aria-hidden
          />
        )}
        {tag && (
          <span
            className={cn(
              'shrink-0 text-xs uppercase tracking-wide',
              now ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {tag}
          </span>
        )}
        <span
          className={cn('min-w-0 flex-1 truncate', !open && !now && 'text-muted-foreground')}
          title={title}
        >
          {title}
        </span>
        {open ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-2 px-3 pt-0.5 pb-2.5">
          {row.kind === 'lookups' ? (
            <FoldDetail steps={row.steps} />
          ) : row.kind === 'words' ? (
            <Item
              item={{ kind: 'text', text: row.text, live: row.live } as LiveItem}
              onSettle={onSettle}
              busy={busy}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{row.text}</p>
          )}
          {row.kind === 'words' && row.choices && answer && (
            <>
              <QuickReplies key={row.key} choices={row.choices} onSend={answer} />
              <OwnAnswer onSend={answer} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A task's turns in the chat (`TaskItem`) as one card: a tinted icon for where it stands, its title
 * and a line under it (the app's `taskView`), the app's buttons (`taskActions`), Stop while it runs
 * and a chevron that folds its steps. The person's first message sits above it; everything after,
 * the assistant's words included, is a step inside it (`taskRows`). Only the newest step is open:
 * when the next one starts the one before folds, and any step opens again with a tap. Messages
 * queued while it runs wait under it (`TaskQueue`).
 */
function TaskBlock({
  item,
  onSettle,
  busy,
}: {
  item: TaskItem;
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
}) {
  const slots = useContext(TaskSlots);
  const answer = useContext(TaskAnswer);
  const queue = useContext(TaskQueue);
  const state = slots.state?.(item) ?? item.state;
  const items = item.items as LiveItem[];
  const live = items.some(isLive);
  const view = slots.view?.(item, live) ?? {
    tone: live ? 'live' : state === 'open' ? 'ready' : 'done',
    title: item.label,
    state: live ? 'Working' : TASK_STATE[state],
  };
  // The request that opened the task sits above its card when the block starts with it; a later
  // message carried into the task (a follow-up while it is open) is a Steer row inside the card.
  const first = items[0]?.kind === 'user' ? 0 : -1;
  const head = items.slice(0, first + 1);
  const inner = items.slice(first + 1);
  const answerable = answer && !busy ? lastChoices(items) : null;
  const rows = taskRows(inner, answerable);
  // The newest row is open unless the person picked another since the rows last changed.
  const [picked, setPicked] = useState<{ at: number; open: number | null } | null>(null);
  const newest = rows.length - 1;
  // A fold of lookups stays one line until tapped; the newest words or message open.
  const auto = rows[newest]?.kind === 'line' || rows[newest]?.kind === 'lookups' ? null : newest;
  const open = picked && picked.at === rows.length ? picked.open : auto;
  const failed = inner.some((x) => x.kind === 'step' && (!x.ok || x.write?.status === 'failed'));
  const card = (
    <WorkCard
      view={view}
      live={live}
      state={state}
      actions={slots.actions?.(item, live)}
      onStop={live ? slots.stop : undefined}
      steps={rows.length}
      open={failed || !!answerable || state === 'open'}
      rows
    >
      {rows.map((r, n) => (
        <TaskRowView
          key={r.key}
          row={r}
          open={open === n}
          onToggle={() => setPicked({ at: rows.length, open: open === n ? null : n })}
          onSettle={onSettle}
          busy={busy}
        />
      ))}
    </WorkCard>
  );
  return (
    <div data-slot="chat-task-turns" className="flex min-w-0 flex-col gap-3">
      {head.length > 0 && <Items items={head} onSettle={onSettle} busy={busy} />}
      {card}
      {queue && state === 'open' && queue.queue.length > 0 && (
        <ComposerQueue
          queue={queue.queue}
          canSteer={queue.canSteer}
          onSteer={queue.onSteer}
          onEdit={queue.onEdit}
          onRemove={queue.onRemove}
        />
      )}
    </div>
  );
}

/**
 * Whether the chat's last turn is drawn as a task's card: a task or handoff of its own, or the app's
 * `turnTask` draws it (or holds it as a Steer row in an earlier card). Such a card shows the turn's
 * quick replies in its Follow-up step, so the chat must not show them again under it.
 */
function lastTurnInCard(
  items: (ChatItem | LiveItem)[],
  turn: ((items: ChatItem[]) => unknown) | undefined,
): boolean {
  const t = chatTurns(items).at(-1);
  if (!t) return false;
  const cut = t.items.findIndex((i) => i.kind === 'task' || i.kind === 'handoff');
  if (cut >= 0) return true;
  return !!turn && t.items[0]?.kind === 'user' && turn(t.items as ChatItem[]) !== undefined;
}

/** The quick replies the last turn offers (`StepItem.choices`), unless the person answered since. */
function lastChoices(items: (ChatItem | LiveItem)[]): StepChoices | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i] as LiveItem;
    if (it.kind === 'user') return null;
    if (it.kind === 'task') {
      const inner = lastChoices(it.items as LiveItem[]);
      if (inner || (it.items as LiveItem[]).some((x) => x.kind === 'user')) return inner;
      continue;
    }
    if (it.kind === 'step' && it.choices) return it.choices;
  }
  return null;
}

/**
 * Quick replies under the assistant's question: one row per answer, the suggested one outlined,
 * numbered so a key picks it (when no text box has the focus). With `multi` each row ticks, and
 * Send sends the ticked ones together. They are shortcuts: typing an answer in the box works too.
 */
export function QuickReplies({
  choices,
  onSend,
}: {
  choices: StepChoices;
  onSend: (text: string) => void;
}) {
  const [picked, setPicked] = useState<number[]>(() =>
    choices.multi ? choices.options.flatMap((o, n) => (o.on ? [n] : [])) : [],
  );
  const { options, multi, suggested } = choices;
  const pick = (n: number) => {
    const o = options[n];
    if (!o) return;
    if (!multi) return onSend(o.label);
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > options.length) return;
      e.preventDefault();
      pickRef.current(n - 1);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [options.length]);
  return (
    <fieldset
      data-slot="chat-choices"
      aria-label="Quick replies"
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
    >
      {options.map((o, n) => {
        const on = picked.includes(n);
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={multi ? on : undefined}
            onClick={() => pick(n)}
            className={cn(
              'flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              n === suggested && !multi && 'border-primary ring-1 ring-primary',
              on && 'border-primary',
            )}
          >
            {multi ? (
              <>
                <span
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded border',
                    on && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {on && <CheckIcon className="size-3" />}
                </span>
                <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-muted font-medium text-muted-foreground text-xs tabular-nums">
                  {n + 1}
                </span>
              </>
            ) : (
              <kbd className="grid size-4.5 shrink-0 place-items-center rounded bg-muted font-medium text-xs text-muted-foreground">
                {n + 1}
              </kbd>
            )}
            <span className="min-w-0 flex-1 truncate" title={o.label}>
              {o.label}
              {(o.note || n === suggested) && (
                <span className="ml-1.5 text-muted-foreground text-xs">
                  {o.note ?? 'suggested'}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {multi && (
        <div className="flex items-center justify-end gap-2 text-muted-foreground text-xs">
          <span>{picked.length} picked</span>
          <IconButton
            icon={ArrowUpIcon}
            label="Send picks"
            variant="default"
            size="icon-sm"
            disabled={!picked.length}
            onClick={() =>
              onSend(
                options
                  .filter((_, n) => picked.includes(n))
                  .map((o) => o.label)
                  .join('; '),
              )
            }
          />
        </div>
      )}
    </fieldset>
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
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs"
      title={label}
    >
      <span className="shrink-0 text-muted-foreground">{sign}</span>
      <span className="min-w-0 truncate">{label}</span>
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
  use?: string;
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
 * A pasted, dropped or picked image, ready to send: scaled to `IMAGE_EDGE` on a canvas and saved as JPEG
 * (PNG when it has few pixels to lose), as base64. `null` when the browser cannot read it.
 */
export async function readAssistantImage(
  file: File,
  name?: string,
): Promise<AssistantImage | null> {
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
    const named = (name ?? file.name ?? '').trim().slice(0, ASSISTANT_IMAGE_NAME_MAX);
    return data ? { media_type, data, ...(named ? { name: named } : {}) } : null;
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
  hint,
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
  modes = [],
  onSend,
  onStop,
  meter,
  voice = true,
  queueShown = false,
  editQueued,
}: {
  /** The queue is drawn under the running task's card instead of above the box. */
  queueShown?: boolean;
  /** Gets this box's Edit, so a queued message shown elsewhere comes back here to edit. */
  editQueued?: { current: ((id: string) => void) | null };
  /** A mic beside Send that types what the person says (`VoiceButton`); hidden where the browser can't. */
  voice?: boolean;
  /** Drawn in the icon row after the paperclip and the modes: `LumenAssistant` puts its context donut here. */
  meter?: ReactNode;
  /** Toggles beside the paperclip (`LumenAssistant` `modes`). */
  modes?: AssistantMode[];
  name: string;
  /** Words in the empty box in place of "Ask <name>…" (steering a piece of work). */
  hint?: string;
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
  const [use, setUse] = useState<string | null>(null);
  const list = useRef<LumenSelectorListHandle>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const filePick = useRef<HTMLInputElement>(null);
  const selection = usePageSelection();
  // An app's compose request (`composeAssistant`): its chips and text, ready to finish.
  const [request, take] = useComposeRequest();
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request fills the box.
  useEffect(() => {
    if (!request) return;
    take();
    // Make another: sent at once, the box left as it is.
    if (request.send && request.text) {
      onSend(request.text, {
        ...(request.images?.length ? { images: request.images } : {}),
        ...(request.use ? { use: request.use } : {}),
      });
      return;
    }
    if (request.images?.length)
      setImages((p) => [...p, ...(request.images ?? [])].slice(0, ASSISTANT_IMAGES_MAX));
    if (request.use) setUse(request.use);
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
    ...(use ? { use } : {}),
  });
  const clear = () => {
    setText('');
    setCaret(0);
    setTier(null);
    setRefs([]);
    setImages([]);
    setQuote(null);
    setUse(null);
  };
  /** Adds the image files among `files`; says so when one is left out. Returns whether any was an image. */
  const attach = (files: FileList | File[], pasted = false): boolean => {
    const picked = [...files].filter((f) => f.type.startsWith('image/'));
    if (!canAttach || !picked.length) return false;
    void (async () => {
      const read = (
        await Promise.all(
          picked.map((f) =>
            readAssistantImage(
              f,
              pasted && (!f.name || /^image\.\w+$/i.test(f.name)) ? 'Pasted image' : undefined,
            ),
          ),
        )
      ).filter((x): x is AssistantImage => !!x);
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
    if (q.extra?.use) setUse(q.extra.use);
    requestAnimationFrame(() => box.current?.focus());
  };
  if (editQueued) editQueued.current = onUnqueue ? edit : null;
  const waiting = queueShown ? [] : (queue ?? (queued ? [{ id: 'queued', message: queued }] : []));
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
    const phone = deviceNow().narrow;
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
      {/* The box and its tools are one InputGroup: the tools sit on their own row under the text,
          so a long message never runs under them (a scrolled box hides any padding kept for them). */}
      <InputGroup>
        <InputGroupTextarea
          ref={box}
          aria-label={`Message ${name}`}
          placeholder={`${hint ?? `Ask ${name}…`}${hints.length ? ` (${hints.join(' ')})` : ''}`}
          className="max-h-48 min-h-11"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            // An image on the clipboard becomes a chip, even when the clipboard has its text too
            // (a copied file's name, a drawing from a document); text alone pastes as usual.
            if (attach(e.clipboardData.files, true)) e.preventDefault();
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
        <InputGroupAddon align="block-end" className="gap-0.5 px-1.5 pb-1.5">
          {canAttach && (
            <>
              <IconButton
                icon={PaperclipIcon}
                label="Attach images"
                size="icon-xs"
                disabled={disabled}
                onClick={() => filePick.current?.click()}
              />
              <input
                ref={filePick}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) attach(e.target.files);
                  e.target.value = '';
                }}
              />
            </>
          )}
          {modes.map((md) => (
            <IconButton
              key={md.id}
              icon={md.icon}
              label={md.label}
              size="icon-xs"
              variant={use === md.id ? 'secondary' : 'ghost'}
              aria-pressed={use === md.id}
              className={cn(use === md.id && 'text-primary')}
              disabled={disabled}
              onClick={() => setUse((u) => (u === md.id ? null : md.id))}
            />
          ))}
          {meter}
          <div className="ml-auto flex items-center gap-0.5">
            {voice && (
              // Full colour beside Send: only Send dims while the box is empty.
              <VoiceButton
                value={text}
                onChange={setText}
                size="icon-xs"
                disabled={disabled}
                className="text-foreground"
              />
            )}
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
                {canSteer && !images.length && !refs.length && (
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
        </InputGroupAddon>
      </InputGroup>
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
          {!q.steering && canSteer && !q.extra?.images?.length && !q.extra?.refs?.length && (
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

/** Share of the compact point from which the donut turns yellow; red at the compact point itself. */
const CONTEXT_WATCH = 0.75;

/** What the context pop-up counts from the chat: its turns, and the images and pointed-at things sent. */
function chatCounts(items: ChatItem[]) {
  let turns = 0;
  let attached = 0;
  for (const i of items) {
    if (i.kind !== 'user' || i.steered) continue;
    turns += 1;
    attached += (i.images?.length ?? 0) + (i.refs?.length ?? 0);
  }
  return { turns, attached };
}

/**
 * How full the chat's context is, as a small donut in the composer's icon row (after the paperclip and
 * the modes). It fills against `CONTEXT_MAX`: neutral, yellow from 75% of the compact point, red at it
 * (75k and 100k when chats compact at 100k). Hover, focus or a tap (touch has no hover) opens its pop-up:
 * context used of the most with a bar, that the chat compacts on its own, its turns, the images and
 * attachments sent, and how much of the last turn came from the prompt cache. No price: a person reads
 * their use in Settings.
 */
function ContextDonut({
  usage,
  compactAt,
  items,
}: {
  usage: ChatUsage | null;
  compactAt: number;
  items: ChatItem[];
}) {
  const [open, setOpen] = useState(false);
  const touch = useRef(false);
  const wasOpen = useRef(false);
  const ctx = usage?.context ?? 0;
  if (ctx <= 0) return null;
  const share = Math.min(1, ctx / CONTEXT_MAX);
  const r = 6;
  const round = 2 * Math.PI * r;
  const level = ctx >= compactAt ? 'alert' : ctx >= compactAt * CONTEXT_WATCH ? 'watch' : 'ok';
  const tone =
    level === 'alert'
      ? 'text-destructive'
      : level === 'watch'
        ? 'text-warning'
        : 'text-muted-foreground';
  const cached = usage && usage.in > 0 ? Math.round((usage.read / usage.in) * 100) : null;
  const { turns, attached } = chatCounts(items);
  const said = `Context ${tokens(ctx)} of ${tokens(CONTEXT_MAX)}`;
  const rows: [string, string][] = [
    ['This chat', `${turns} ${turns === 1 ? 'turn' : 'turns'}`],
    ['Images and attachments', String(attached)],
    ...(cached !== null ? ([['Cache read', `${cached}%`]] as [string, string][]) : []),
  ];
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={said}
          aria-expanded={open}
          data-testid="context-donut"
          data-level={level}
          // A tap opens or closes the pop-up (touch has no hover); a mouse click leaves it open.
          // The press itself counts as outside the pop-up and closes it, so the tap reads the state before.
          onPointerDown={(e) => {
            touch.current = e.pointerType !== 'mouse';
            wasOpen.current = open;
            e.preventDefault();
          }}
          onClick={(e) => {
            e.preventDefault();
            setOpen(touch.current ? !wasOpen.current : true);
          }}
          className={cn(
            'grid size-6 place-items-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            tone,
          )}
        >
          <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden="true">
            <title>{said}</title>
            <circle
              cx="8"
              cy="8"
              r={r}
              fill="none"
              strokeWidth="2.5"
              className="stroke-muted-foreground/25"
            />
            <circle
              cx="8"
              cy="8"
              r={r}
              fill="none"
              strokeWidth="2.5"
              stroke="currentColor"
              strokeDasharray={`${share * round} ${round}`}
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent
        data-testid="context-popup"
        className="flex w-56 flex-col items-stretch gap-1.5 px-3 py-2.5 text-left font-sans tabular-nums"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">Context</span>
          <span className="whitespace-nowrap">
            {tokens(ctx)} <span className="text-muted-foreground">/ {tokens(CONTEXT_MAX)}</span>
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted-foreground/20">
          <div
            className={cn(
              'h-full rounded-full',
              level === 'alert'
                ? 'bg-destructive'
                : level === 'watch'
                  ? 'bg-warning'
                  : 'bg-foreground/60',
            )}
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </div>
        <span className="text-muted-foreground">Auto-compacts as needed</span>
        <div className="my-0.5 border-t" />
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <span className="truncate text-muted-foreground">{k}</span>
            <span className="whitespace-nowrap">{v}</span>
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
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
