/**
 * A Think chat in the panel's words: the AI SDK's UI message stream (what `chat()` sends) as the
 * panel's `AssistantEvent`s, and a stored chat's messages and cards as its `ChatItem`s. The panel
 * (`@columenlabs/lumen-ui`'s `LumenAssistant`) reads a Think chat the same way as before.
 */
import type {
  AssistantEvent,
  AssistantRefNote,
  ChatItem,
  DraftItem,
  HandOffWhy,
  ScreenItem,
  StepItem,
  UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { rowCount } from '../assistant/tools';
import { webStep } from '../assistant/web';
import type { AgentCard } from './agent';
import type { ScreenCall } from './screen';

/** A tool's name as a line's title: `notes__find_notes` → `find notes`. */
export function stepTitle(name: string): string {
  const own = name.includes('__') ? name.slice(name.indexOf('__') + 2) : name;
  return own.replace(/_/g, ' ');
}

/** The hand off a tool's result reports, when it was one. */
interface HandOffOut {
  tier: string;
  label: string;
  why: HandOffWhy;
  usage: UsagePart;
}

interface Called {
  name: string;
  input?: unknown;
  t0: number;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** What one finished tool call shows as: a line, a card, a hand-off section or nothing. */
function settledCall(
  id: string,
  c: Called,
  out: { output?: unknown; error?: string },
  ms: number,
  cards: Map<string, AgentCard>,
  screens: Map<string, ScreenCall> = new Map(),
): AssistantEvent[] {
  const o = obj(out.output);
  if (c.name === 'screen') {
    // A call the page map refused goes back to the model only; the person sees the one that ran.
    const call = typeof o?.screen === 'string' ? screens.get(o.screen) : undefined;
    if (!call) return [];
    const item: ScreenItem = {
      kind: 'screen',
      id: call.id,
      label: call.label,
      moves: call.moves,
      ...(call.status !== 'sent'
        ? { outcome: { status: call.status, ...(call.text ? { text: call.text } : {}) } }
        : {}),
    };
    return [{ event: 'screen', data: item }];
  }
  const card = cards.get(id);
  if (card?.kind === 'draft' || (o && typeof o.card === 'string')) {
    const draft: DraftItem = {
      kind: 'draft',
      id,
      tool: c.name,
      title: stepTitle(c.name),
      args: card?.args ?? c.input ?? null,
      status: card && card.status !== 'done' && card.status !== 'undone' ? card.status : 'open',
      ...(card?.result !== undefined ? { result: card.result } : {}),
      ...(card?.error ? { error: card.error } : {}),
    };
    return [{ event: 'draft', data: draft }];
  }
  const h = obj(o?.handoff) as HandOffOut | null;
  if (h && typeof h.tier === 'string' && typeof o?.memo === 'string') {
    const task = String(obj(c.input)?.task ?? '');
    return [
      {
        event: 'handoff',
        data: { kind: 'handoff', tier: h.tier, label: h.label, task, why: h.why },
      },
      { event: 'handoff_done', data: { usage: h.usage } },
    ];
  }
  const error = out.error ?? (o && typeof o.error === 'string' ? o.error : undefined);
  const rows = rowCount(o && 'result' in o ? o.result : out.output);
  const web = webStep(c.name, c.input, out.output, !!error || obj(out.output)?.ok === false);
  const step: StepItem = {
    kind: 'step',
    id,
    tool: c.name,
    title: stepTitle(c.name),
    ok: !error,
    ms,
    ...(rows !== undefined && !error ? { rows } : {}),
    ...(error ? { error: error.slice(0, 300) } : {}),
    ...(card?.kind === 'write' || (o && typeof o.change === 'string')
      ? { write: { undo: true, status: card?.status === 'undone' ? 'undone' : 'done' } }
      : {}),
    ...(web ? { web } : {}),
  };
  return [{ event: 'step', data: step }];
}

/**
 * Turns UI message chunks into the panel's events, one chunk at a time. `cards` says how a draft
 * or write ended (a card's id is its tool call's). `advisor` names the advice part.
 */
export function chunkEvents(
  o: {
    advisor?: string;
    cards?: () => Map<string, AgentCard>;
    /** The chat's screen calls by id: a `screen` tool's result names its call. */
    screens?: () => Map<string, ScreenCall>;
    /** A tool's kind this turn: a draft shows as its card only, with no line before it. */
    kindOf?: (name: string) => 'read' | 'draft' | 'write' | undefined;
  } = {},
) {
  const calls = new Map<string, Called>();
  let advising = false;
  return (chunk: { type: string; [k: string]: unknown }): AssistantEvent[] => {
    const id = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';
    switch (chunk.type) {
      case 'text-delta':
        return typeof chunk.delta === 'string' && chunk.delta
          ? [{ event: 'text', data: { delta: chunk.delta } }]
          : [];
      case 'text-end':
        return [{ event: 'text_end', data: {} }];
      case 'tool-input-start': {
        const name = String(chunk.toolName ?? '');
        calls.set(id, { name, t0: Date.now() });
        if (name === 'advisor') {
          advising = true;
          return [{ event: 'advice', data: { tier: 'advisor', label: o.advisor ?? 'Advice' } }];
        }
        if (name === 'escalate' || name === 'screen' || o.kindOf?.(name) === 'draft') return [];
        return [{ event: 'step_start', data: { id, tool: name, title: stepTitle(name) } }];
      }
      case 'tool-input-available': {
        const c = calls.get(id) ?? { name: String(chunk.toolName ?? ''), t0: Date.now() };
        calls.set(id, { ...c, input: chunk.input });
        return [];
      }
      case 'tool-output-available':
      case 'tool-output-error': {
        const c = calls.get(id);
        if (!c) return [];
        calls.delete(id);
        const error =
          chunk.type === 'tool-output-error' ? String(chunk.errorText ?? '') : undefined;
        if (c.name === 'advisor') {
          advising = false;
          return [{ event: 'advice_done', data: error ? { error } : {} }];
        }
        return settledCall(
          id,
          c,
          error !== undefined ? { error } : { output: chunk.output },
          Date.now() - c.t0,
          o.cards?.() ?? new Map(),
          c.name === 'screen' ? (o.screens?.() ?? new Map()) : undefined,
        );
      }
      case 'error':
        return [
          { event: 'error', data: { message: String(chunk.errorText ?? 'The answer failed.') } },
        ];
      case 'abort':
        return advising
          ? [
              { event: 'advice_done', data: {} },
              { event: 'stopped', data: {} },
            ]
          : [{ event: 'stopped', data: {} }];
      default:
        return [];
    }
  };
}

/** A stored UI message, as much of it as a chat's items need. */
interface StoredMessage {
  id?: string;
  role: string;
  parts: { type: string; [k: string]: unknown }[];
  metadata?: unknown;
}

/** A user message's extras, kept in its metadata by `LumenAgent.ask`. */
export interface AskMeta {
  at?: number;
  context?: { label: string };
  refs?: AssistantRefNote[];
  tier?: string;
}

/** A stored chat as the panel's items: the messages in order, each tool call as it ended. */
/** A message steered into an answer: the step it was read at, under the message the answer is to. */
export interface SteerNote {
  step: number;
  text: string;
  at: number;
}

export function itemsOf(
  messages: StoredMessage[],
  cards: AgentCard[],
  screens: Map<string, ScreenCall> = new Map(),
  steers: Record<string, SteerNote[]> = {},
): ChatItem[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const items: ChatItem[] = [];
  let asked: string | undefined;
  for (const m of messages) {
    if (m.role === 'user') {
      asked = m.id;
      const text = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => String(p.text ?? ''))
        .join('');
      const meta = (obj(m.metadata) ?? {}) as AskMeta;
      const images = m.parts
        .filter(
          (p) => p.type === 'file' && typeof p.url === 'string' && p.url.startsWith('data:image/'),
        )
        .map((p) => p.url as string);
      items.push({
        kind: 'user',
        text,
        at: meta.at ?? 0,
        ...(images.length ? { images } : {}),
        ...(meta.context?.label ? { context: meta.context.label } : {}),
        ...(meta.refs?.length ? { refs: meta.refs } : {}),
        ...(meta.tier ? { tier: meta.tier } : {}),
      });
      continue;
    }
    if (m.role !== 'assistant') continue;
    // Steered messages show where the answer read them: before the step they joined.
    const steered = [...((asked && steers[asked]) || [])].sort((x, y) => x.step - y.step);
    const steerTo = (step: number) => {
      while (steered.length && (steered[0] as SteerNote).step <= step) {
        const n = steered.shift() as SteerNote;
        items.push({ kind: 'user', text: n.text, at: n.at, steered: true });
      }
    };
    let step = -1;
    for (const p of m.parts) {
      if (p.type === 'step-start') {
        step += 1;
        steerTo(step);
        continue;
      }
      if (p.type === 'text' && typeof p.text === 'string' && p.text) {
        const last = items[items.length - 1];
        if (last?.kind === 'text') last.text += p.text;
        else items.push({ kind: 'text', text: p.text });
        continue;
      }
      const tool =
        p.type === 'dynamic-tool'
          ? String(p.toolName ?? '')
          : p.type.startsWith('tool-')
            ? p.type.slice(5)
            : '';
      if (!tool || typeof p.toolCallId !== 'string') continue;
      if (tool === 'advisor') {
        items.push({ kind: 'advice', tier: 'advisor', label: 'Advice' });
        continue;
      }
      const ended =
        p.state === 'output-available'
          ? { output: p.output }
          : p.state === 'output-error'
            ? { error: String(p.errorText ?? 'failed') }
            : null;
      if (!ended) continue;
      for (const e of settledCall(
        p.toolCallId,
        { name: tool, input: p.input, t0: 0 },
        ended,
        0,
        byId,
        screens,
      )) {
        if (e.event === 'handoff') items.push({ ...e.data, items: [] });
        else if (e.event === 'handoff_done') {
          const h = items[items.length - 1];
          if (h?.kind === 'handoff') h.usage = e.data.usage;
        } else if (e.event === 'step' || e.event === 'draft' || e.event === 'screen') {
          const { handoff: _h, ...item } = e.data;
          items.push(item);
        }
      }
    }
    steerTo(Number.POSITIVE_INFINITY);
  }
  return items;
}
