// One chat with the assistant in the browser: its items built from the answer's stream as it
// comes, Stop, messages steered into or queued after a running answer, opening an older chat and
// starting anew.
import type {
  AssistantEvent,
  AssistantImage,
  AssistantMessage,
  AssistantScreenOutcome,
  ChatItem,
  ChatUsage,
  DraftItem,
  HandOffItem,
  StepItem,
} from '@columenlabs/lumen-ui-types/assistant';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api-fetch';
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

/**
 * An item as the panel draws it: a text still streaming, a step still running. `writing` marks a
 * running step whose tool makes a change at once, so an app can show what it changes as changing.
 */
export type LiveItem = ChatItem & { live?: boolean; writing?: boolean };

type Extra = Omit<AssistantMessage, 'message' | 'chat_id'>;

/** A message sent while an answer runs: waiting for it to end, or steered into it. */
export interface QueuedMessage {
  id: string;
  message: string;
  extra?: Extra;
  /** Sent into the running answer, not read by it yet. */
  steering?: boolean;
}

let queuedSeq = 0;
const queuedId = () => `q${++queuedSeq}`;

export interface AssistantChatState {
  chatId: string | null;
  title: string;
  items: LiveItem[];
  usage: ChatUsage | null;
  /** An answer is streaming. */
  busy: boolean;
  /** The first message waiting for the answer to end (`queue` has them all). */
  queued: string | null;
  /** Messages sent while the answer runs, in order: steering ones first wait to be read. */
  queue: QueuedMessage[];
  /** The adapter takes a message into a running answer (Steer). */
  canSteer: boolean;
  /** The chat is loading. */
  loading: boolean;
  /**
   * Sends now, or while an answer runs: `steer` (the default where the adapter can) into it at its
   * next step, else queued for after it.
   */
  send: (message: string, extra?: Extra, how?: 'steer' | 'queue') => void;
  /**
   * Sends a failed turn again (Retry): `user` is the turn's message, `at` the error it ended in, which
   * then stops offering Retry. Its words, parts, tier and images go again, with `extra` from now.
   */
  retry: (at: number, user: Extract<ChatItem, { kind: 'user' }>, extra?: Extra) => void;
  /** A queued message steered into the running answer now. */
  steerQueued: (id: string) => void;
  /** Takes a queued message out; its words and extras come back (Edit puts them in the box). */
  unqueue: (id: string) => QueuedMessage | undefined;
  stop: () => void;
  open: (id: string) => Promise<void>;
  reset: () => void;
  settle: (draft: DraftItem, action: 'save' | 'dismiss') => Promise<void>;
  /** Takes back a change the assistant made at once (Undo on its line). */
  undo: (step: StepItem) => Promise<void>;
  /** A screen call ended in the browser: shown on its chip, and sent with the next message. */
  screenEnded: (outcome: AssistantScreenOutcome) => void;
  /**
   * Answers the fresh-chat card (`fresh` item): `new` sends its message in a new chat, `stay`
   * sends it here again, kept in this chat.
   */
  fresh: (choice: 'new' | 'stay', extra?: Extra) => void;
}

/** What a sent message carried besides its words, to send it again (Retry, a fresh chat). */
function resendOf(user: Extract<ChatItem, { kind: 'user' }>): Extra {
  const images = (user.images ?? []).flatMap((src) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(src);
    return m ? [{ media_type: m[1], data: m[2] } as AssistantImage] : [];
  });
  return {
    ...(user.refs?.length ? { refs: user.refs } : {}),
    ...(user.quote ? { quote: user.quote } : {}),
    ...(user.tier ? { tier: user.tier } : {}),
    ...(images.length ? { images } : {}),
  };
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
    case 'step_start': {
      // A second start for the same call words it again, now that its arguments are in.
      const at = sink.findIndex((i) => i.kind === 'step' && i.id === e.data.id);
      const running = at >= 0 ? sink[at] : undefined;
      if (running?.kind === 'step' && 'live' in running && running.live) {
        sink[at] = { ...running, title: e.data.title };
        break;
      }
      sink.push({
        kind: 'step',
        id: e.data.id,
        tool: e.data.tool,
        title: e.data.title,
        ok: true,
        ms: 0,
        live: true,
        ...(e.data.write ? { writing: true } : {}),
      });
      break;
    }
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
    case 'fresh':
      items.push({ kind: 'fresh' });
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
    const { live: _l, writing: _w, ...rest } = i;
    return rest as LiveItem;
  });

export function useAssistantChat(client: AssistantAdapter): AssistantChatState {
  const [chatId, setChatId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<LiveItem[]>([]);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  // An adapter whose app has no steer route: Steer hides and messages queue.
  const [steerOff, setSteerOff] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const outcomes = useRef<Map<string, AssistantScreenOutcome> | null>(null);
  outcomes.current ??= readOutcomes();
  const idRef = useRef<string | null>(null);
  idRef.current = chatId;

  const queueRef = useRef<QueuedMessage[]>([]);
  queueRef.current = queue;

  /** Steering messages not read (all, or those `texts`) go back to waiting, first in line. */
  const unsteer = useCallback((texts?: string[]) => {
    setQueue((q) => {
      const left = [...(texts ?? [])];
      const back = q.map((x) => {
        if (!x.steering) return x;
        if (texts) {
          const at = left.indexOf(x.message);
          if (at < 0) return x;
          left.splice(at, 1);
        }
        return { ...x, steering: false };
      });
      return back.some((x, i) => x !== q[i]) ? back : q;
    });
  }, []);

  const run = useCallback(
    async (message: string, extra?: Extra, retried?: boolean) => {
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
            ...(extra?.quote ? { quote: extra.quote } : {}),
            ...(extra?.tier ? { tier: extra.tier } : {}),
            ...(retried ? { retried: true } : {}),
            ...(extra?.images?.length
              ? { images: extra.images.map((i) => `data:${i.media_type};base64,${i.data}`) }
              : {}),
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
            else if (e.event === 'steered') {
              // Read by the answer here: the line moves from the queue into the chat.
              setQueue((q) => {
                const at = q.findIndex((m) => m.steering && m.message === e.data.text);
                return at < 0 ? q : [...q.slice(0, at), ...q.slice(at + 1)];
              });
              setItems((p) => [
                ...settled(p),
                { kind: 'user', text: e.data.text, at: e.data.at, steered: true },
              ]);
            } else if (e.event === 'unsteered') unsteer(e.data.texts);
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
        // Steers the answer never read (Stop, an error) wait for the next answer instead.
        unsteer();
        abort.current = null;
        setBusy(false);
      }
    },
    [client, unsteer],
  );

  // A queued message goes once the answer ends, one an answer.
  useEffect(() => {
    if (busy) return;
    const next = queue[0];
    if (!next || next.steering) return;
    setQueue((q) => q.slice(1));
    void run(next.message, next.extra);
  }, [busy, queue, run]);

  const canSteer = !!client.steer && !steerOff;

  // Into the running answer; refused (none runs, the model reads none) it waits in the queue.
  const steerIn = useCallback(
    async (m: QueuedMessage) => {
      const id = idRef.current;
      let steered = false;
      if (id && client.steer && abort.current)
        try {
          steered = (await client.steer(id, m.message)).steered;
        } catch (err) {
          if (err instanceof ApiError && [404, 405, 410].includes(err.status)) setSteerOff(true);
        }
      if (!steered) setQueue((q) => q.map((x) => (x.id === m.id ? { ...x, steering: false } : x)));
    },
    [client],
  );

  const send = useCallback(
    (message: string, extra?: Extra, how?: 'steer' | 'queue') => {
      const text = message.trim();
      if (!text) return;
      if (!abort.current) return void run(text, extra);
      const steer = (how ?? 'steer') === 'steer' && canSteer && !!idRef.current;
      const m: QueuedMessage = {
        id: queuedId(),
        message: text,
        ...(extra ? { extra } : {}),
        ...(steer ? { steering: true } : {}),
      };
      // Steering ones sit first: they are read before anything queued after the answer.
      setQueue((q) =>
        steer ? [...q.filter((x) => x.steering), m, ...q.filter((x) => !x.steering)] : [...q, m],
      );
      if (steer) void steerIn(m);
    },
    [run, canSteer, steerIn],
  );

  const retry = useCallback(
    (at: number, user: Extract<ChatItem, { kind: 'user' }>, extra?: Extra) => {
      if (abort.current) return;
      setItems((p) =>
        p.map((x, i) => (i === at && x.kind === 'error' ? { ...x, retried: true } : x)),
      );
      void run(user.text, { ...extra, ...resendOf(user) }, true);
    },
    [run],
  );

  const itemsRef = useRef<LiveItem[]>([]);
  itemsRef.current = items;
  const fresh = useCallback(
    (choice: 'new' | 'stay', extra?: Extra) => {
      if (abort.current) return;
      const list = itemsRef.current;
      const card = list.findLastIndex((i) => i.kind === 'fresh');
      const at = list.findLastIndex((i, n) => n < card && i.kind === 'user');
      const user = list[at];
      if (card < 0 || user?.kind !== 'user') return;
      if (choice === 'new') {
        // A new chat, as New chat makes one, and the message is its first.
        setQueue([]);
        setChatId(null);
        idRef.current = null;
        setTitle('');
        setItems([]);
        setUsage(null);
        void run(user.text, { ...extra, ...resendOf(user) });
      } else {
        // The message goes again in its place, without the card.
        setItems((p) => p.slice(0, at));
        void run(user.text, { ...extra, ...resendOf(user), stay: true });
      }
    },
    [run],
  );

  const steerQueued = useCallback(
    (id: string) => {
      const m = queueRef.current.find((x) => x.id === id && !x.steering);
      if (!m || !abort.current) return;
      const on = { ...m, steering: true };
      setQueue((q) => [
        ...q.filter((x) => x.steering),
        on,
        ...q.filter((x) => !x.steering && x.id !== id),
      ]);
      void steerIn(on);
    },
    [steerIn],
  );

  const unqueue = useCallback((id: string) => {
    const m = queueRef.current.find((x) => x.id === id && !x.steering);
    if (m) setQueue((q) => q.filter((x) => x.id !== id));
    return m;
  }, []);

  const stop = useCallback(() => abort.current?.abort(), []);

  const reset = useCallback(() => {
    abort.current?.abort();
    setQueue([]);
    setChatId(null);
    idRef.current = null;
    setTitle('');
    setItems([]);
    setUsage(null);
  }, []);

  const open = useCallback(
    async (id: string) => {
      abort.current?.abort();
      setQueue([]);
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
    queued: queue[0]?.message ?? null,
    queue,
    canSteer,
    loading,
    send,
    retry,
    steerQueued,
    unqueue,
    stop,
    open,
    reset,
    settle,
    undo,
    screenEnded,
    fresh,
  };
}
