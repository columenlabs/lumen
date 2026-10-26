// One chat with the assistant in the browser: its items built from the answer's stream as it
// comes, Stop, a message queued while an answer runs, opening an older chat and starting anew.
import type {
  AssistantEvent,
  AssistantMessage,
  ChatItem,
  ChatUsage,
  DraftItem,
  HandOffItem,
} from '@columenlabs/lumen-ui-types/assistant';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../integrations';
import type { AssistantAdapter } from './client';

/** An item as the panel draws it: a text still streaming, a step still running. */
export type LiveItem = ChatItem & { live?: boolean };

export interface AssistantChatState {
  chatId: string | null;
  title: string;
  items: LiveItem[];
  usage: ChatUsage | null;
  /** An answer is streaming. */
  busy: boolean;
  /** A message waiting for the answer to end. */
  queued: string | null;
  /** The chat is loading. */
  loading: boolean;
  send: (message: string, extra?: Omit<AssistantMessage, 'message' | 'chat_id'>) => void;
  stop: () => void;
  open: (id: string) => Promise<void>;
  reset: () => void;
  settle: (draft: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
}

/** Where an event lands: the chat, or the last hand-off section when it came from inside one. */
function sinkOf(items: LiveItem[], handoff?: boolean): LiveItem[] {
  if (!handoff) return items;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it?.kind === 'handoff') return it.items as LiveItem[];
  }
  return items;
}

/** A copy of the items with one event applied (hand-off sections copied too). */
export function applyEvent(prev: LiveItem[], e: AssistantEvent): LiveItem[] {
  const items: LiveItem[] = prev.map((i) =>
    i.kind === 'handoff' ? { ...i, items: [...(i.items as LiveItem[])] } : i,
  );
  const inside = 'handoff' in e.data && e.data.handoff === true;
  const sink = sinkOf(items, inside);
  const last = sink[sink.length - 1];
  switch (e.event) {
    case 'text':
      if (last?.kind === 'text' && last.live)
        sink[sink.length - 1] = { ...last, text: last.text + e.data.delta };
      else sink.push({ kind: 'text', text: e.data.delta, live: true });
      break;
    case 'text_end':
      if (last?.kind === 'text') sink[sink.length - 1] = { kind: 'text', text: last.text };
      break;
    case 'step_start':
      sink.push({
        kind: 'step',
        id: e.data.id,
        tool: e.data.tool,
        title: e.data.title,
        ok: true,
        ms: 0,
        live: true,
      });
      break;
    case 'step': {
      const { handoff: _h, ...step } = e.data;
      const at = sink.findIndex((i) => i.kind === 'step' && i.id === step.id);
      if (at >= 0) sink[at] = step;
      else sink.push(step);
      break;
    }
    case 'draft': {
      const { handoff: _h, ...draft } = e.data;
      sink.push(draft);
      break;
    }
    case 'handoff':
      items.push({ ...e.data, items: [] } as HandOffItem);
      break;
    case 'handoff_done': {
      const h = [...items].reverse().find((i): i is HandOffItem => i.kind === 'handoff');
      if (h) h.usage = e.data.usage;
      break;
    }
    case 'advice':
      items.push({ kind: 'advice', tier: e.data.tier, label: e.data.label, live: true });
      break;
    case 'advice_done': {
      const at = items.findLastIndex((i) => i.kind === 'advice');
      const a = items[at];
      if (a?.kind === 'advice')
        items[at] = {
          kind: 'advice',
          tier: a.tier,
          label: a.label,
          ...(e.data.error ? { error: e.data.error } : {}),
        };
      break;
    }
    case 'compacted':
      items.push({ kind: 'compacted' });
      break;
    case 'stopped':
      items.push({ kind: 'stopped', ...(e.data.reason ? { reason: e.data.reason } : {}) });
      break;
    case 'error':
      items.push({
        kind: 'error',
        text: e.data.message,
        ...(e.data.code ? { code: e.data.code } : {}),
      });
      break;
  }
  return items;
}

/** Nothing streams any more: a text or step cut by Stop ends where it was. */
const settled = (items: LiveItem[]): LiveItem[] =>
  items.map((i) => {
    if (i.kind === 'handoff') return { ...i, items: settled(i.items as LiveItem[]) };
    if (!i.live) return i;
    const { live: _l, ...rest } = i;
    return rest as LiveItem;
  });

export function useAssistantChat(client: AssistantAdapter): AssistantChatState {
  const [chatId, setChatId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<LiveItem[]>([]);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState<{
    message: string;
    extra?: Omit<AssistantMessage, 'message' | 'chat_id'>;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const idRef = useRef<string | null>(null);
  idRef.current = chatId;

  const run = useCallback(
    async (message: string, extra?: Omit<AssistantMessage, 'message' | 'chat_id'>) => {
      const ctl = new AbortController();
      abort.current = ctl;
      setBusy(true);
      if (message !== '/compact')
        setItems((p) => [
          ...p,
          {
            kind: 'user',
            text: message,
            at: Date.now(),
            ...(extra?.context ? { context: extra.context.label } : {}),
            ...(extra?.refs?.length ? { refs: extra.refs } : {}),
            ...(extra?.tier ? { tier: extra.tier } : {}),
          },
        ]);
      try {
        await client.send(
          { message, ...(idRef.current ? { chat_id: idRef.current } : {}), ...extra },
          (e) => {
            if (e.event === 'chat') {
              idRef.current = e.data.id;
              setChatId(e.data.id);
              setTitle(e.data.title);
            } else if (e.event === 'usage') setUsage(e.data);
            else if (e.event === 'done') setUsage(e.data.usage);
            else setItems((p) => applyEvent(p, e));
          },
          ctl.signal,
        );
      } catch (err) {
        if (ctl.signal.aborted) setItems((p) => [...p, { kind: 'stopped' }]);
        else setItems((p) => [...p, { kind: 'error', text: errorText(err) }]);
      } finally {
        setItems(settled);
        abort.current = null;
        setBusy(false);
      }
    },
    [client],
  );

  // A queued message goes once the answer ends.
  useEffect(() => {
    if (busy || !queued) return;
    setQueued(null);
    void run(queued.message, queued.extra);
  }, [busy, queued, run]);

  const send = useCallback(
    (message: string, extra?: Omit<AssistantMessage, 'message' | 'chat_id'>) => {
      const text = message.trim();
      if (!text) return;
      if (abort.current) setQueued({ message: text, ...(extra ? { extra } : {}) });
      else void run(text, extra);
    },
    [run],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  const reset = useCallback(() => {
    abort.current?.abort();
    setQueued(null);
    setChatId(null);
    idRef.current = null;
    setTitle('');
    setItems([]);
    setUsage(null);
  }, []);

  const open = useCallback(
    async (id: string) => {
      abort.current?.abort();
      setQueued(null);
      setLoading(true);
      try {
        const c = await client.chat(id);
        idRef.current = c.id;
        setChatId(c.id);
        setTitle(c.title);
        setItems(c.items);
        setUsage(c.usage ?? null);
      } catch (err) {
        setItems([{ kind: 'error', text: errorText(err) }]);
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  const settle = useCallback(
    async (draft: DraftItem, action: 'save' | 'dismiss') => {
      const id = idRef.current;
      if (!id) return;
      const next = await client.settleDraft(id, draft.id, action);
      const swap = (list: LiveItem[]): LiveItem[] =>
        list.map((i) =>
          i.kind === 'draft' && i.id === next.id
            ? next
            : i.kind === 'handoff'
              ? { ...i, items: swap(i.items as LiveItem[]) }
              : i,
        );
      setItems(swap);
    },
    [client],
  );

  return {
    chatId,
    title,
    items,
    usage,
    busy,
    queued: queued?.message ?? null,
    loading,
    send,
    stop,
    open,
    reset,
    settle,
  };
}
