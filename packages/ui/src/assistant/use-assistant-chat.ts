// One chat with the assistant in the browser: its items built from the answer's stream as it
// comes, Stop, a message queued while an answer runs, opening an older chat and starting anew.
import type {
  AssistantEvent,
  AssistantMessage,
  AssistantScreenOutcome,
  ChatItem,
  ChatUsage,
  DraftItem,
  HandOffItem,
  StepItem,
} from '@columenlabs/lumen-ui-types/assistant';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../integrations';
import type { AssistantAdapter } from './client';

/** The browser's IANA zone, sent with each message for the assistant's bearings. */
function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// Screen calls' outcomes not yet sent (they go with the next message), kept for this tab so a
// reload neither loses them nor leaves their chips without a result.
const SCREEN_KEY = 'lumen-assistant:screen';
function readOutcomes(): Map<string, AssistantScreenOutcome> {
  try {
    const m = new Map<string, AssistantScreenOutcome>(
      JSON.parse(sessionStorage.getItem(SCREEN_KEY) ?? '[]'),
    );
    return m;
  } catch {
    return new Map();
  }
}
function keepOutcomes(m: Map<string, AssistantScreenOutcome>) {
  try {
    if (m.size) sessionStorage.setItem(SCREEN_KEY, JSON.stringify([...m].slice(-50)));
    else sessionStorage.removeItem(SCREEN_KEY);
  } catch {}
}

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
  /** Takes back a change the assistant made at once (Undo on its line). */
  undo: (step: StepItem) => Promise<void>;
  /** A screen call ended in the browser: shown on its chip, and sent with the next message. */
  screenEnded: (outcome: AssistantScreenOutcome) => void;
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
    case 'screen': {
      // Live until the browser runs it: the panel runs a screen call once, while it is new.
      const { handoff: _h, ...call } = e.data;
      sink.push({ ...call, live: true });
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

/**
 * Nothing streams any more: a text or step cut by Stop ends where it was. A screen call stays live
 * until the browser has run it (`screenEnded`).
 */
const settled = (items: LiveItem[]): LiveItem[] =>
  items.map((i) => {
    if (i.kind === 'handoff') return { ...i, items: settled(i.items as LiveItem[]) };
    if (!i.live || i.kind === 'screen') return i;
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
  const outcomes = useRef<Map<string, AssistantScreenOutcome> | null>(null);
  outcomes.current ??= readOutcomes();
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
      // Every screen outcome not yet sent goes with this message; kept again if it fails.
      const sent = [...(outcomes.current?.values() ?? [])];
      outcomes.current?.clear();
      keepOutcomes(new Map());
      try {
        await client.send(
          {
            message,
            ...(idRef.current ? { chat_id: idRef.current } : {}),
            ...(browserZone() ? { time_zone: browserZone() } : {}),
            ...extra,
            ...(sent.length ? { outcomes: sent } : {}),
          },
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
        for (const o of sent) if (!outcomes.current?.has(o.id)) outcomes.current?.set(o.id, o);
        if (outcomes.current) keepOutcomes(outcomes.current);
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
        // A call that ended here but whose outcome is not sent yet shows it already.
        const kept = outcomes.current ?? new Map();
        setItems(
          c.items.map((i) => {
            const o = i.kind === 'screen' && !i.outcome ? kept.get(i.id) : undefined;
            return o && i.kind === 'screen'
              ? { ...i, outcome: { status: o.status, ...(o.text ? { text: o.text } : {}) } }
              : i;
          }),
        );
        setUsage(c.usage ?? null);
      } catch (err) {
        setItems([{ kind: 'error', text: errorText(err) }]);
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  // Puts a settled card or an undone line back in place, in a hand-off section too.
  const replace = useCallback((next: DraftItem | StepItem) => {
    const swap = (list: LiveItem[]): LiveItem[] =>
      list.map((i) =>
        i.kind === next.kind && i.id === next.id
          ? next
          : i.kind === 'handoff'
            ? { ...i, items: swap(i.items as LiveItem[]) }
            : i,
      );
    setItems(swap);
  }, []);

  const settle = useCallback(
    async (draft: DraftItem, action: 'save' | 'dismiss') => {
      const id = idRef.current;
      if (!id) return;
      replace(await client.settleDraft(id, draft.id, action));
    },
    [client, replace],
  );

  const undo = useCallback(
    async (step: StepItem) => {
      const id = idRef.current;
      if (!id) return;
      replace(await client.undoWrite(id, step.id));
    },
    [client, replace],
  );

  const screenEnded = useCallback((o: AssistantScreenOutcome) => {
    outcomes.current?.set(o.id, o);
    if (outcomes.current) keepOutcomes(outcomes.current);
    const outcome = { status: o.status, ...(o.text ? { text: o.text } : {}) };
    const mark = (list: LiveItem[]): LiveItem[] =>
      list.map((i) =>
        i.kind === 'screen' && i.id === o.id
          ? { kind: 'screen', id: i.id, label: i.label, moves: i.moves, outcome }
          : i.kind === 'handoff'
            ? { ...i, items: mark(i.items as LiveItem[]) }
            : i,
      );
    setItems(mark);
  }, []);

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
    undo,
    screenEnded,
  };
}
