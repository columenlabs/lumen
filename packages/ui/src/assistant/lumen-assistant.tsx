// LumenAssistant: the chat that fills LumenAssistantPanel, for any app's assistant served by
// `@columenlabs/lumen-ai/assistant`. A header with the tier, Chats and New chat; the chat itself
// (the person's messages, the answer as it streams, each tool call as a line, drafted changes as
// cards to Save or Dismiss, work handed to a higher tier in its own section); and the composer,
// with Stop, a queued message and the chat's cost and context under it.
import type {
  AssistantMessage,
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
  CircleAlertIcon,
  CornerDownRightIcon,
  LightbulbIcon,
  PlusIcon,
  SparklesIcon,
  SquareIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
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
import { LumenSelector } from '../lumen-selector';
import { lumenToast } from '../lumen-toast';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Spinner } from '../ui/spinner';
import { Textarea } from '../ui/textarea';
import type { AssistantAdapter } from './client';
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
}

/** The assistant's chat: header, messages and composer. */
export function LumenAssistant({
  client,
  context,
  onSettings,
  keepDays = 30,
  onClose,
  chat: outside,
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

  return (
    <div className="flex h-full min-h-0 flex-col">
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
          icon={PlusIcon}
          label="New chat"
          disabled={!chat.items.length}
          onClick={chat.reset}
        />
        {onClose && (
          <IconButton icon={XIcon} label={`Close ${s?.name ?? 'assistant'}`} onClick={onClose} />
        )}
      </div>
      <Messages chat={chat} status={s} onSettings={onSettings} />
      <LumenComposer
        name={s?.name ?? 'the assistant'}
        busy={chat.busy}
        queued={chat.queued}
        disabled={!s || !!s.wait}
        onSend={(text) => chat.send(text, context ? { context } : undefined)}
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
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {status?.wait && (
        <Alert className="mb-3">
          <CircleAlertIcon />
          <AlertDescription className="flex flex-col items-start gap-2">
            {WAIT[status.wait](
              status.admin,
              status.providers.find((p) => p.id === status.wait_provider)?.label ?? 'API',
            )}
            {onSettings && (
              <Button size="sm" variant="outline" onClick={onSettings}>
                Open Settings
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
        <Items items={chat.items} onSettle={chat.settle} busy={chat.busy} />
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
    "You reached this month's cap on the app's keys. Add your own key, or wait for next month.",
  own_cap: () => 'Your own keys reached their monthly cap. Raise it in Settings ▸ Model providers.',
};

function Items({
  items,
  onSettle,
  busy,
}: {
  items: (ChatItem | LiveItem)[];
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items only append; index is their identity.
        <Item key={i} item={item as LiveItem} onSettle={onSettle} busy={busy} />
      ))}
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
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-8 self-end rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
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
  return (
    <p
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs',
        step.ok ? 'text-muted-foreground' : 'text-loss',
      )}
    >
      {live ? (
        <Spinner className="size-3" />
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

function Draft({
  draft,
  onSettle,
  busy,
}: {
  draft: DraftItem;
  onSettle: (d: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  busy: boolean;
}) {
  const [pending, setPending] = useState<'save' | 'dismiss' | null>(null);
  const go = async (action: 'save' | 'dismiss') => {
    setPending(action);
    try {
      await onSettle(draft, action);
    } catch (e) {
      lumenToast.error(errorText(e));
    } finally {
      setPending(null);
    }
  };
  return (
    <div
      data-slot="assistant-draft"
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{draft.title}</span>
        {draft.status === 'saved' ? (
          <span className="flex items-center gap-1 text-gain text-xs">
            <CheckIcon className="size-3.5" /> Saved
          </span>
        ) : draft.status === 'dismissed' ? (
          <span className="text-muted-foreground text-xs">Dismissed</span>
        ) : draft.status === 'failed' ? (
          <span className="text-loss text-xs">Failed</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {argLines(draft.args)
          .slice(0, 8)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-code">{v}</dd>
            </div>
          ))}
      </dl>
      {draft.error && <p className="text-loss text-xs">{draft.error}</p>}
      {draft.status === 'open' && (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!!pending || busy}
            onClick={() => void go('dismiss')}
          >
            Dismiss
          </Button>
          <Button size="sm" disabled={!!pending || busy} onClick={() => void go('save')}>
            {pending === 'save' ? <Spinner /> : <CheckIcon />}
            Save
          </Button>
        </div>
      )}
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

/** The message box: Enter sends, Shift+Enter breaks a line; Stop while an answer runs. */
export function LumenComposer({
  name,
  busy,
  queued,
  disabled,
  onSend,
  onStop,
}: {
  name: string;
  busy: boolean;
  queued: string | null;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };
  const slash = text.startsWith('/') && !text.includes(' ');
  return (
    <div className="shrink-0 border-t p-3">
      {queued && (
        <p className="mb-2 truncate text-muted-foreground text-xs">
          Queued: <span className="text-foreground">{queued}</span>
        </p>
      )}
      {slash && (
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted"
          onClick={() => setText('/compact')}
        >
          <span className="font-code">/compact</span>
          <span className="text-muted-foreground">Summarise the chat so far</span>
        </button>
      )}
      <div className="relative">
        <Textarea
          aria-label={`Message ${name}`}
          placeholder={`Ask ${name}…`}
          className="max-h-48 min-h-11 resize-none pr-11"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
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
