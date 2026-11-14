/**
 * A Think chat in the panel's words: the AI SDK's UI message stream (what `chat()` sends) as the
 * panel's `AssistantEvent`s, and a stored chat's messages and cards as its `ChatItem`s. The panel
 * (`@columenlabs/lumen-ui`'s `LumenAssistant`) reads a Think chat the same way as before.
 */
import type {
  AssistantEvent,
  AssistantQuote,
  AssistantRefNote,
  ChatItem,
  DraftItem,
  HandOffWhy,
  ScreenItem,
  StepImage,
  StepItem,
  UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { rowCount } from '../assistant/tools';
import { webStep } from '../assistant/web';
import type { AgentCard } from './agent';
import type { ScreenCall } from './screen';
import { TOOL_SEARCH } from './search';

/** A tool's name as a line's title: `notes__find_notes` → `find notes`. */
export function stepTitle(name: string): string {
  const own = name.includes('__') ? name.slice(name.indexOf('__') + 2) : name;
  return own.replace(/_/g, ' ');
}

/**
 * How a chat's tool lines are worded. `plain` keeps every inner name off the screen: no tool ids,
 * no tier or model, no row counts and no error text (the app logs those; see `StepRecord.error`).
 * A line reads the tool's own `title` (`titleOf`), else a word for what it did.
 */
export interface StepNames {
  plain?: boolean;
  /** The tool's own title, when it has one. */
  titleOf?: (name: string) => string | undefined;
  /**
   * A line that says what this call did and to what (`LumenAgent.stepLine`): present tense while it
   * runs, past tense with a short result when it answered, "Couldn't …" when it failed. Left out
   * (or `undefined`), the line reads the tool's title.
   */
  lineOf?: (c: StepCall) => string | undefined;
}

/** One tool call as its line is worded: its name, arguments, answer and where it stands. */
export interface StepCall {
  id: string;
  /** The tool's name as the model called it (`group__tool`). */
  tool: string;
  input?: unknown;
  /** Its answer, once it answered. */
  output?: unknown;
  state: 'running' | 'done' | 'failed';
}

/** A line's text kept to one short line. */
const oneLine = (t: string | undefined) => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 120) : undefined;
};

/** The line the app gave for this call, when it gave one; never throws. */
function lineFor(names: StepNames, c: StepCall): string | undefined {
  try {
    return oneLine(names.lineOf?.(c));
  } catch {
    return undefined;
  }
}

/**
 * Whether a call shows no line at all: in a plain chat, the tool search that turns more tools on is
 * the assistant finding its own tools, not something it did for the person.
 */
export function hiddenStep(name: string, names: StepNames = {}): boolean {
  return !!names.plain && name === TOOL_SEARCH;
}

/** What a plain line says when a call failed: the assistant reads the error and goes on. */
export const PLAIN_FAILED = "didn't work";
/** A plain hand-off's heading: a closer look, never the tier it went to. */
export const PLAIN_HANDOFF = 'Take a closer look';

/** The line's title: the tool's own title, else its name (or, plain, a word for what it did). */
export function shownTitle(
  name: string,
  names: StepNames = {},
  kind?: 'read' | 'draft' | 'write',
): string {
  const own = names.titleOf?.(name);
  if (own) return own;
  if (!names.plain) return stepTitle(name);
  if (name === 'escalate') return PLAIN_HANDOFF;
  return kind === 'write'
    ? 'Make a change'
    : kind === 'draft'
      ? 'Draft a change'
      : 'Look something up';
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

/** A tool's `image` output as the panel's card: a same-site path or an https address only. */
function stepImage(v: unknown): StepImage | undefined {
  const i = obj(v);
  const url = typeof i?.url === 'string' ? i.url : '';
  if (!/^(\/[^/\\]|https:\/\/)/.test(url)) return undefined;
  return {
    url,
    ...(typeof i?.alt === 'string' ? { alt: i.alt.slice(0, 300) } : {}),
    ...(typeof i?.cost === 'string' ? { cost: i.cost.slice(0, 40) } : {}),
  };
}

/** What one finished tool call shows as: a line, a card, a hand-off section or nothing. */
function settledCall(
  id: string,
  c: Called,
  out: { output?: unknown; error?: string },
  ms: number,
  cards: Map<string, AgentCard>,
  screens: Map<string, ScreenCall> = new Map(),
  names: StepNames = {},
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
      title: shownTitle(c.name, names, 'draft'),
      args: card?.args ?? c.input ?? null,
      status: card && card.status !== 'done' && card.status !== 'undone' ? card.status : 'open',
      ...(card?.result !== undefined ? { result: card.result } : {}),
      ...(card?.error ? { error: card.error } : {}),
    };
    return [{ event: 'draft', data: draft }];
  }
  const h = obj(o?.handoff) as HandOffOut | null;
  if (h && typeof h.tier === 'string' && typeof o?.memo === 'string') {
    // Plain: the tier and the task the model wrote for it stay off the screen.
    const task = names.plain ? '' : String(obj(c.input)?.task ?? '');
    const label = names.plain ? PLAIN_HANDOFF : h.label;
    return [
      {
        event: 'handoff',
        data: { kind: 'handoff', tier: h.tier, label, task, why: h.why },
      },
      { event: 'handoff_done', data: { usage: h.usage } },
    ];
  }
  const error = out.error ?? (o && typeof o.error === 'string' ? o.error : undefined);
  const rows = rowCount(o && 'result' in o ? o.result : out.output);
  const image = stepImage(o?.image);
  const web = webStep(c.name, c.input, out.output, !!error || obj(out.output)?.ok === false);
  const wrote = card?.kind === 'write' || (o && typeof o.change === 'string');
  // The app's own line says what the call did; a failed one already says it did not ("Couldn't …").
  const line = lineFor(names, {
    id,
    tool: c.name,
    input: c.input,
    ...(error
      ? {}
      : { output: o && 'result' in o && o.change !== undefined ? o.result : out.output }),
    state: error ? 'failed' : 'done',
  });
  const step: StepItem = {
    kind: 'step',
    id,
    tool: c.name,
    title: line ?? shownTitle(c.name, names, wrote ? 'write' : 'read'),
    ok: !error,
    ms,
    ...(rows !== undefined && !error && !names.plain ? { rows } : {}),
    ...(error && !(line && names.plain)
      ? { error: names.plain ? PLAIN_FAILED : error.slice(0, 300) }
      : {}),
    ...(wrote
      ? { write: { undo: true, status: card?.status === 'undone' ? 'undone' : 'done' } }
      : {}),
    ...(web ? { web } : {}),
    ...(image && !error ? { image } : {}),
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
    /** How the lines are worded. */
    names?: StepNames;
    /** A tool call failed: its name and whole error, before a plain line hides them (for logs). */
    failed?: (f: { tool: string; error: string; ms: number }) => void;
  } = {},
) {
  const names = o.names ?? {};
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
        if (
          name === 'escalate' ||
          name === 'screen' ||
          o.kindOf?.(name) === 'draft' ||
          hiddenStep(name, names)
        )
          return [];
        // A tool that makes a change at once says so as it starts, so an app can show that what it
        // changes is being changed now, before the model has finished writing the call.
        const kind = o.kindOf?.(name);
        const write = kind === 'write';
        return [
          {
            event: 'step_start',
            data: {
              id,
              tool: name,
              title: shownTitle(name, names, kind),
              ...(write ? { write } : {}),
            },
          },
        ];
      }
      case 'tool-input-available': {
        const c = calls.get(id) ?? { name: String(chunk.toolName ?? ''), t0: Date.now() };
        calls.set(id, { ...c, input: chunk.input });
        // Its arguments are in: the running line can say what it is doing and to what.
        if (
          c.name === 'advisor' ||
          c.name === 'escalate' ||
          c.name === 'screen' ||
          o.kindOf?.(c.name) === 'draft' ||
          hiddenStep(c.name, names)
        )
          return [];
        const line = lineFor(names, { id, tool: c.name, input: chunk.input, state: 'running' });
        if (!line) return [];
        const write = o.kindOf?.(c.name) === 'write';
        return [
          {
            event: 'step_start',
            data: { id, tool: c.name, title: line, ...(write ? { write } : {}) },
          },
        ];
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
        const ms = Date.now() - c.t0;
        if (hiddenStep(c.name, names)) return [];
        const out = obj(chunk.output);
        const said = error ?? (out && typeof out.error === 'string' ? out.error : undefined);
        if (said !== undefined) {
          try {
            o.failed?.({ tool: c.name, error: said.slice(0, 2000), ms });
          } catch {
            // a log hook never breaks the answer
          }
        }
        return settledCall(
          id,
          c,
          error !== undefined ? { error } : { output: chunk.output },
          ms,
          o.cards?.() ?? new Map(),
          c.name === 'screen' ? (o.screens?.() ?? new Map()) : undefined,
          names,
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
  /** The piece of the chat the message replies to; its words to the model are the first text part. */
  quote?: AssistantQuote;
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
  names: StepNames = {},
): ChatItem[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const items: ChatItem[] = [];
  let asked: string | undefined;
  for (const m of messages) {
    if (m.role === 'user') {
      asked = m.id;
      const meta = (obj(m.metadata) ?? {}) as AskMeta;
      const text = m.parts
        .filter((p) => p.type === 'text')
        .slice(meta.quote ? 1 : 0)
        .map((p) => String(p.text ?? ''))
        .join('');
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
        ...(meta.quote ? { quote: meta.quote } : {}),
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
      if (hiddenStep(tool, names)) continue;
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
        names,
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
