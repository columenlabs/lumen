/**
 * `LumenAgent`: one chat as a Cloudflare Think agent, run on the app's tiers, keys and tool groups.
 * Think keeps the loop, the messages, streaming, resume and compaction; the app answers `plan` for
 * each turn (which model on whose key, the instructions, the tools at the person's access, what is
 * left to spend) and hears `settle` when the turn ends, to record the spend.
 *
 *   export class SageChat extends LumenAgent<Env> {
 *     plan(turn) { return sagePlan(this.env, this.name, turn); }
 *     settle(s) { return recordSpend(this.env, this.name, s); }
 *   }
 *
 * An `Assistant` gives both: `assistant.agentTurn(caller, input)` returns a plan and its settle.
 */

import { createAITools } from '@cloudflare/computer/tools/ai-sdk';
import {
  type ChatResponseResult,
  type PrepareStepContext,
  type Session,
  type StepConfig,
  type StepContext,
  Think,
  type ThinkModel,
  type TurnConfig,
  type TurnContext,
} from '@cloudflare/think';
import {
  ASSISTANT_IMAGES_MAX,
  ASSISTANT_IMAGE_CHARS,
  ASSISTANT_IMAGE_NAME_MAX,
  ASSISTANT_IMAGE_TYPES,
  ASSISTANT_QUOTE_MAX,
  type AssistantChat,
  type AssistantEffort,
  type AssistantEvent,
  type AssistantImage,
  type AssistantQuote,
  type AssistantRefNote,
  type AssistantScreenMap,
  type AssistantScreenOutcome,
  type AssistantTask,
  COMPACT_AT,
  type ChatUsage,
  type StepFold,
  type UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { createCompactFunction } from 'agents/sessions';
import { type ModelMessage, type ToolSet, generateText } from 'ai';
import type { ModelDef } from '../assistant/models';
import {
  type ModelKey,
  SUMMARY_ASK,
  type SentPrompt,
  advisorTool,
  aiModel,
  cacheCheckOf,
  lockedEffort,
  planFallback,
  turnSettings,
} from './models';
import { errorData } from './respond';
import {
  type ScreenCall,
  screenMapOf,
  screenNews,
  screenOutcomesOf,
  screenRules,
  screenTool,
} from './screen';
import {
  type AskMeta,
  type SteerNote,
  type StepCall,
  type StepNames,
  chunkEvents,
  itemsOf,
  shownTitle,
} from './stream';
import {
  type KeptTask,
  LABELS_KEPT,
  LABEL_MAX,
  TASKS_KEPT,
  openTask,
  taskBlocks,
  taskNews,
  threadOf,
  turnKeys,
} from './tasks';
import {
  type AiToolsOptions,
  type DraftCall,
  type OpenedTools,
  type SourceAt,
  openAiTools,
} from './tools';
import { UsageMeter } from './usage';

/** What a plan's extra tools get: the open tools, a meter of their own and the cap. */
export interface TurnTools {
  opened: OpenedTools;
  /**
   * The agent's own file tools over its workspace (read, list, find, grep and the rest, as Think
   * gives the main model), so a hand-off reads the same files the app wrote for this turn.
   */
  files: ToolSet;
  /** A new part of this answer's usage (a hand off), counted against the cap. */
  meter(model: ModelDef, label: string, free?: boolean): UsageMeter;
  /** Spent this answer reached what the payer has left. */
  over(): boolean;
}

/** What one turn runs on, as the app decides it. */
export interface AgentTurnPlan {
  /** The tier's model, and the key or sign-in it runs on. */
  model: ModelDef;
  key: ModelKey;
  effort?: AssistantEffort;
  /**
   * Take `effort` even though this conversation runs at another one. Its next call then reads
   * nothing from the prompt cache; without it the conversation keeps its first call's effort.
   */
  resetEffort?: boolean;
  /** Output tokens per call; left out on a plan sign-in, which takes no cap. */
  out?: number;
  /** The usage part's label: `Tier · Model`. */
  label: string;
  /** The app's instructions and the kit's rules, joined; a function sees the tools opened. */
  system: string | ((t: OpenedTools) => string);
  /** Put before the person's newest message for the model only (bearings, the page). */
  lead?: string;
  /** The tool groups at the person's access. */
  sources: SourceAt[];
  /** Tools beside the groups' (hand off), made once those are open. */
  more?: (t: TurnTools) => ToolSet;
  /** Call this tool first (a message handed to a higher tier). */
  first?: string;
  /**
   * @deprecated Ignored: every turn sends the whole tool list, so the prompt cache reads it (see the
   * README, "Tools: the whole list on every call"). Kept so an app that still sets it type-checks.
   */
  lazy?: { at?: number; core?: string[] };
  /** Claude's advisor: a bigger Claude reads the chat and sends a plan. */
  advisor?: { model: ModelDef; label: string; maxUses: number; maxTokens: number };
  /**
   * Who answers when the ChatGPT plan `key` signs in with reaches its usage limit: a Claude model
   * on the payer's own key, for the rest of the turn. Its use is its own part (`label`).
   */
  fallback?: { model: ModelDef; key: ModelKey; label: string };
  /** Dollars the payer has left; at or past it the model gets no more tools. */
  left?: number;
  /** The person lets the assistant move their screen: the `screen` tool joins when the browser sent its map. */
  screen?: boolean;
  /** Most model calls in one answer (`MAX_STEPS`, 8); the last one answers in words, with no tools. */
  maxSteps?: number;
  /** Tokens past which this chat compacts (the person's Auto-compact); `compactAt()` when unset. */
  compactAt?: number;
  /**
   * A message sent while the answer runs joins it at its next step (Steer); on unless `false`,
   * for a model that should not read a new message between its calls. Refused steers are queued.
   */
  steer?: boolean;
  /**
   * This turn is a task (`AssistantTask`): the app's work in its own session, inside this chat. The
   * model reads `brief` (sent as first given, so the task's turns stay in the prompt cache) and the
   * task's own messages, never the rest of the chat; the chat's other turns never read the task's
   * messages and hear in one line how it ended (`endTask`). The panel shows its turns as one block.
   */
  task?: { id: string; label: string; brief: string };
  /**
   * This turn's title, known before it runs (an app's router can name the work with its verdict):
   * kept on the person's message (`ChatItem` user `label`) and sent at once as a `label` event, so the
   * panel can draw the turn as a card with its title before the first step.
   */
  title?: string;
  /** Fetch for provider calls (a metered one). */
  fetch?: typeof fetch;
  tools?: Omit<AiToolsOptions, 'maxChars'>;
}

/** How a turn ended, with its usage, for the app to record. */
export interface AgentTurnEnd {
  outcome: 'ok' | 'stopped' | 'error';
  /** The main model's part first, then advice and hand offs; parts with no calls left out. */
  parts: UsagePart[];
  /** Tokens in the main model's last call: how full its context is. */
  context?: number;
  /** Model calls of the main tier. */
  steps: number;
  ms: number;
  /** The spend cap stopped tool use in this answer. */
  capped: boolean;
  /** Changes the answer made: writes run at once and draft cards (left out when none). */
  changes?: number;
}

export const CAP_NOTE =
  'The spend cap for this month is reached: answer now from what you have, in a sentence or two. You can call no more tools.';

/** The last call of an answer: no tools, so the answer never ends on a tool's result with nothing said. */
export const LAST_STEP_NOTE =
  "This is the answer's last call and you can call no more tools: answer now from what you found. If the task is not finished, say what is done, what is left and that you can carry on when asked.";

/** Most model calls in one answer when the plan names none. */
export const MAX_STEPS = 8;

/** Put before a message the person steered into a running answer, for the model only. */
export const STEER_NOTE =
  'The person sent this while you were working. Take it into account from here on; it does not cancel what you were asked before unless it says so.';

/** A card in the chat: a draft the person saves or dismisses, or a write made at once (Undo). */
export interface AgentCard {
  id: string;
  kind: 'draft' | 'write';
  group: string;
  /** The tool's own name, not the `group__tool` the model calls. */
  tool: string;
  args: unknown;
  result?: unknown;
  status: 'open' | 'saved' | 'dismissed' | 'failed' | 'done' | 'undone';
  error?: string;
  at: number;
}

/** Past this many tokens in the chat Think summarizes its older part. */
export { COMPACT_AT };

export const CARD_NOTE =
  "A card is on the person's screen; nothing has changed yet. Say what it will do when they save it. The next message tells you how it ended.";

/** What the model is told of cards settled and changes undone since its last answer. */
export function cardNews(cards: AgentCard[]): string {
  const undone = cards.filter((c) => c.kind === 'write' && c.status === 'undone');
  const ended = cards.filter((c) => c.kind === 'draft' && c.status !== 'open');
  const line = (c: AgentCard) =>
    `${c.group}/${c.tool} ${JSON.stringify(c.args ?? {}).slice(0, 300)}`;
  const back = undone.length
    ? `The person undid these changes you made: ${undone.map(line).join('; ')}. Do not make them again unless asked.\n\n`
    : '';
  if (!ended.length) return back;
  return `${back}Cards since your last answer:\n${ended
    .map(
      (c) =>
        `- ${line(c)}: ${c.status}${c.error ? ` (${c.error})` : ''}${c.result !== undefined ? ` → ${JSON.stringify(c.result).slice(0, 300)}` : ''}`,
    )
    .join('\n')}\n\n`;
}

export interface CardRow {
  id: string;
  kind: string;
  grp: string;
  tool: string;
  args: string;
  result: string | null;
  status: string;
  error: string | null;
  told: number;
  at: number;
}

/** Longest stored card result. Past it the result is kept as its cut text, so the row stays valid JSON. */
export const CARD_RESULT_MAX = 20_000;

/** A card's result as stored: JSON, pictures' data left out, and still valid JSON when it is cut. */
export function cardResult(result: unknown): string | null {
  if (result === undefined) return null;
  const text = JSON.stringify(result, (k, v) =>
    k === 'data' && typeof v === 'string' && v.length > 1_000 ? `(${v.length} chars left out)` : v,
  );
  if (text === undefined) return null;
  return text.length > CARD_RESULT_MAX
    ? JSON.stringify({ cut: true, text: text.slice(0, CARD_RESULT_MAX - 100) })
    : text;
}

/** A stored value read back; a row written cut by an older release comes back as its text, never a throw. */
const parsed = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return { cut: true, text: s };
  }
};

export const cardOf = (r: CardRow): AgentCard => ({
  id: r.id,
  kind: r.kind as AgentCard['kind'],
  group: r.grp,
  tool: r.tool,
  args: parsed(r.args),
  ...(r.result === null ? {} : { result: parsed(r.result) }),
  status: r.status as AgentCard['status'],
  ...(r.error ? { error: r.error } : {}),
  at: r.at,
});

/** The panel's command that compacts the chat now (the kit's slash command). */
export const COMPACT_COMMAND = '/compact';

/** The messages with `lead` put before the newest message the person wrote. */
export function withLead(messages: ModelMessage[], lead: string | undefined): ModelMessage[] {
  if (!lead) return messages;
  let i = messages.length - 1;
  while (i >= 0 && messages[i]?.role !== 'user') i -= 1;
  return i < 0 ? messages : leadAt(messages, i, lead);
}

/** The leads a chat has sent, kept so each earlier message is sent again exactly as it was. */
export interface SentLeads {
  /** Each person's message (`leadKey`) and the lead it went with. */
  sent: Record<string, string>;
  /** The last whole lead, which the next one is told against. */
  last?: string;
}

/** Leads kept per chat; the oldest go first (a compacted chat no longer has their messages). */
const LEADS_KEPT = 60;
const LEAD_SAME = 'Context: as in my last message.\n\n';
const LEAD_CHANGED = 'Context: what changed since my last message (the rest is as it was).';

/** A person's message's place among theirs and a hash of its words: the same message turn after turn. */
function leadKey(n: number, m: ModelMessage): string {
  const text =
    typeof m.content === 'string'
      ? m.content
      : m.content.map((p) => (p.type === 'text' ? p.text : p.type)).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${n}:${(h >>> 0).toString(36)}`;
}

/**
 * The lead for the newest message, told against the last one: the whole lead the first time, a line
 * when nothing changed, else only the lines that are new and the lines that went (the whole lead
 * when that is not much shorter).
 */
export function leadDelta(last: string | undefined, next: string): string {
  if (!next || last === undefined) return next;
  if (last === next) return LEAD_SAME;
  const was = new Set(last.split('\n'));
  const is = new Set(next.split('\n'));
  const added = next.split('\n').filter((l) => l.trim() && !was.has(l));
  const gone = last.split('\n').filter((l) => l.trim() && !is.has(l));
  const delta = `${LEAD_CHANGED}\n${added.length ? `Now:\n${added.join('\n')}\n` : ''}${gone.length ? `No longer:\n${gone.join('\n')}\n` : ''}\n`;
  return delta.length < next.length * 0.6 ? delta : next;
}

/**
 * The chat's messages with every lead where it was first sent, and the newest message's lead told
 * against the last. A provider's prompt cache reuses only earlier messages sent exactly as before:
 * a lead moved off the last message changed it, and that message and every step after it were
 * paid again on the next turn. Unchanged context costs one line, changed context only what changed.
 */
export function stickyLeads(
  messages: ModelMessage[],
  kept: SentLeads,
  lead: string,
): { messages: ModelMessage[]; kept: SentLeads } {
  const users = messages.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  const newest = users.at(-1);
  const sent = { ...kept.sent };
  // Told against the last lead only when an earlier message still carries one (not after compaction).
  let last = users.some((i, n) => i !== newest && sent[leadKey(n, messages[i] as ModelMessage)])
    ? kept.last
    : undefined;
  let out = messages;
  users.forEach((i, n) => {
    const m = messages[i] as ModelMessage;
    const key = leadKey(n, m);
    if (i === newest && sent[key] === undefined && lead) {
      sent[key] = leadDelta(last, lead);
      last = lead;
    }
    const l = sent[key];
    if (l) out = leadAt(out, i, l);
  });
  const keys = Object.keys(sent);
  for (const k of keys.slice(0, Math.max(0, keys.length - LEADS_KEPT))) delete sent[k];
  return { messages: out, kept: { sent, ...(last !== undefined && { last }) } };
}

/** The message at `i` (one the person wrote) with `lead` put before what it says. */
export function leadAt(messages: ModelMessage[], i: number, lead: string): ModelMessage[] {
  const m = messages[i];
  if (!m || m.role !== 'user') return messages;
  const content =
    typeof m.content === 'string'
      ? `${lead}${m.content}`
      : [{ type: 'text' as const, text: lead }, ...m.content];
  return [...messages.slice(0, i), { ...m, content }, ...messages.slice(i + 1)];
}

/** A turn id as the app may give one (`AskInput.id`): `u_` and 16 lowercase letters or digits. */
export const TURN_ID = /^u_[a-z0-9]{16}$/;

/** The id the person's message is stored under: the app's own when it gave a valid one, else a new one. */
export function turnIdOf(given: unknown): string {
  return typeof given === 'string' && TURN_ID.test(given)
    ? given
    : `u_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/** One message the person sent, with the page, refs and tier the composer added. */
export interface AskInput {
  message: string;
  /**
   * The id to store the person's message under (`u_` + 16 letters or digits), so the app can name the
   * turn before it runs (a trace id, a log line). Left out or malformed, a new one is made. Copies of
   * the chat show it on the turn's heading.
   */
  id?: string;
  /** Images to look at with the message; kept to the allowed types, count and size. */
  images?: AssistantImage[];
  context?: { label: string; note?: unknown };
  refs?: AssistantRefNote[];
  /** The piece of the chat this message replies to (Reply on selected text). */
  quote?: AssistantQuote;
  /** A composer mode the person turned on for this message, by id; the app's plan reads it. */
  use?: string;
  tier?: string;
  time_zone?: string;
  /** What the browser can show (Screen on): the `screen` tool and its rules join the turn. */
  screen?: AssistantScreenMap;
  /** How earlier screen calls ended in the browser. */
  outcomes?: AssistantScreenOutcome[];
  /** The person kept this message in this chat after a fresh chat was offered (`offerFresh`). */
  stay?: boolean;
  /** The open task the composer keeps this message on (its chip); the app's plan decides. */
  task?: string;
  /** How many images went with the message (set by the agent: the images go in its parts). */
  image_count?: number;
}

/** A quote as sent, checked: its text cut to `ASSISTANT_QUOTE_MAX`, and whose message it came from. */
export function quoteOf(q: unknown): AssistantQuote | undefined {
  const o = q as Partial<AssistantQuote> | null;
  const text = typeof o?.text === 'string' ? o.text.trim().slice(0, ASSISTANT_QUOTE_MAX) : '';
  if (!text) return undefined;
  return { text, from: o?.from === 'user' ? 'user' : 'assistant' };
}

/**
 * The words the model reads before a message that replies to a quote: which message it came from
 * and the quote itself. It is the message's first text part; the panel shows the quote from the
 * message's metadata instead, so `itemsOf` leaves this part out.
 */
export function quoteLead(q: AssistantQuote): string {
  const whose = q.from === 'user' ? 'their own earlier message' : 'your earlier answer';
  const lines = q.text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return `The person replies to this part of ${whose}:\n${lines}\n\n`;
}

/**
 * The images a message may carry, as file parts: allowed types only, at most `ASSISTANT_IMAGES_MAX`,
 * and no more than `ASSISTANT_IMAGE_CHARS` of base64 together; the rest are left out (`imagesLeftOut`
 * says which, so the message can say so). A named image keeps its name as the part's `filename`.
 */
export function imageParts(
  images: unknown,
): { type: 'file'; mediaType: string; url: string; filename?: string }[] {
  return sortImages(images).kept;
}

/**
 * A line for the message when some of its images could not go (over the count or the size), naming
 * them, so the model tells the person instead of answering as if they came. '' when all went.
 */
export function imagesLeftOut(images: unknown): string {
  const { left } = sortImages(images);
  if (!left.length) return '';
  const names = left.map((i) => i.name || `image ${i.at}`);
  return `(Not attached, too many or too large for one message: ${names.join(', ')}. Tell the person to send ${left.length === 1 ? 'it' : 'them'} in another message.)`;
}

function sortImages(images: unknown) {
  const kept: { type: 'file'; mediaType: string; url: string; filename?: string }[] = [];
  const left: { name?: string; at: number }[] = [];
  if (!Array.isArray(images)) return { kept, left };
  let chars = 0;
  (images as Partial<AssistantImage>[]).forEach((i, n) => {
    const type = ASSISTANT_IMAGE_TYPES.find((t) => t === i?.media_type);
    if (!type || typeof i?.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(i.data)) return;
    const name = typeof i.name === 'string' ? i.name.trim().slice(0, ASSISTANT_IMAGE_NAME_MAX) : '';
    if (kept.length >= ASSISTANT_IMAGES_MAX || chars + i.data.length > ASSISTANT_IMAGE_CHARS) {
      left.push({ ...(name ? { name } : {}), at: n + 1 });
      return;
    }
    chars += i.data.length;
    kept.push({
      type: 'file',
      mediaType: type,
      url: `data:${type};base64,${i.data}`,
      ...(name ? { filename: name } : {}),
    });
  });
  return { kept, left };
}

/** Where an answer's events go: the app's route, over RPC. */
export interface AskSink {
  event(e: AssistantEvent): void | Promise<void>;
}

/** Usage parts added up: same label, one part. */
export function chatUsage(parts: UsagePart[], context?: number): ChatUsage {
  const by = new Map<string, UsagePart>();
  for (const p of parts) {
    const was = by.get(p.label);
    by.set(
      p.label,
      was
        ? {
            label: p.label,
            calls: was.calls + p.calls,
            in: was.in + p.in,
            read: was.read + p.read,
            out: was.out + p.out,
            usd: was.usd + p.usd,
            ...(was.runs || p.runs ? { runs: (was.runs ?? 0) + (p.runs ?? 0) } : {}),
          }
        : { ...p },
    );
  }
  const all = [...by.values()];
  const sum = (k: 'calls' | 'in' | 'read' | 'out' | 'usd') => all.reduce((a, p) => a + p[k], 0);
  return {
    calls: sum('calls'),
    in: sum('in'),
    read: sum('read'),
    out: sum('out'),
    usd: sum('usd'),
    parts: all,
    ...(context ? { context } : {}),
  };
}

export interface AdvisorIteration {
  type?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface Running {
  plan: AgentTurnPlan;
  system: string;
  tools: OpenedTools;
  main: UsageMeter;
  advice?: UsageMeter;
  meters: UsageMeter[];
  context?: number;
  steps: number;
  capped: boolean;
  /** Writes and draft cards this answer made (`AgentTurnEnd.changes`). */
  changes?: number;
  t0: number;
}

export abstract class LumenAgent<Env = unknown> extends Think<Env> {
  /** The turn the app runs now. Throw to refuse it (no key, no money); the error is shown. */
  abstract plan(turn: TurnContext): Promise<AgentTurnPlan>;
  /** A turn ended: record its spend and how it went. Errors here are logged, never shown. */
  abstract settle(end: AgentTurnEnd): Promise<void>;

  /** Saves a draft: runs its write as the person. The result is shown and told to the model. */
  protected applyDraft(_card: AgentCard): Promise<unknown> {
    return Promise.reject(new Error('Saving a card is not set up here.'));
  }
  /** Takes back a write made at once (Undo). */
  protected undoWrite(_card: AgentCard): Promise<void> {
    return Promise.reject(new Error('This change cannot be undone here.'));
  }

  /** Think's own MCP servers are never merged in: connectors reach a turn as the app's tool groups (`ext_`). */
  override includeMcpTools = false;

  #turn: Running | null = null;
  #input: AskInput | null = null;
  /** The answer's events go here while it runs; a steer's line goes here too. */
  #sink: AskSink | null = null;
  /** The person's message this answer is to, by id: where its steers are kept. */
  #asked: string | null = null;
  /** Steered messages waiting for the next step. */
  #steers: { text: string; at: number }[] = [];
  /** Steered messages read this answer: where they sit in the step's messages, and their words. */
  #steered: { index: number; text: string }[] = [];
  #metaTabled = false;

  /** What the person sent with the message this turn answers (page, refs, tier, zone). */
  protected get input(): AskInput | null {
    return this.#input;
  }

  #meta() {
    if (!this.#metaTabled) {
      this.sql`CREATE TABLE IF NOT EXISTS lumen_chat (k TEXT PRIMARY KEY, v TEXT NOT NULL)`;
      this.#metaTabled = true;
    }
  }

  #get<T>(k: string): T | null {
    this.#meta();
    const [r] = this.sql<{ v: string }>`SELECT v FROM lumen_chat WHERE k = ${k} LIMIT 1`;
    return r ? (JSON.parse(r.v) as T) : null;
  }

  #put(k: string, v: unknown) {
    this.#meta();
    this.sql`INSERT OR REPLACE INTO lumen_chat (k, v) VALUES (${k}, ${JSON.stringify(v)})`;
  }

  /**
   * Whether to ask the person to take `input` to a fresh chat before answering it: `true` when it
   * starts new work and this chat is long (the app decides both, e.g. from `usage().context`).
   * The panel then shows a card: ＋ sends the message in a new chat, × sends it here again with
   * `stay`. Off (`false`) unless the app overrides it; a throw counts as `false`.
   */
  /**
   * A new chat's name from its first message, or null to keep that message as its name (the
   * default). An app returns its assistant's `nameChat`, which runs on the app's titles task.
   */
  protected async nameChat(_input: AskInput): Promise<string | null> {
    return null;
  }

  /**
   * The answer's stream with the chat's name sent in it once it is ready: a second `chat` event the
   * panel reads like the first, between the answer's own events, and before `done` it waits for a
   * name still on its way. The name is kept as the chat's title.
   */
  #withName(sink: AskSink, naming: Promise<string | null>): AskSink {
    let name: string | null | undefined;
    let sent = false;
    void naming.then((n) => {
      name = n;
    });
    const send = async () => {
      if (sent || !name) return;
      sent = true;
      this.#put('title', name);
      await sink.event({ event: 'chat', data: { id: this.name, title: name } });
    };
    return {
      event: async (e) => {
        if (e.event === 'done') {
          name = await naming;
          await send();
          await sink.event(e);
          return;
        }
        await sink.event(e);
        await send();
      },
    };
  }

  protected async offerFresh(_input: AskInput): Promise<boolean> {
    return false;
  }

  /**
   * Whether the chat's tool lines keep inner names off the screen: each reads its tool's title
   * (or a word for what it did), with no tool id, tier, model, row count or error text. Off
   * (`false`) unless the app overrides it; the app logs the details from `onStep`.
   */
  protected plainSteps(): boolean {
    return false;
  }

  /**
   * A tool call's line in the person's words: a verb and what it acted on, from the call's own
   * arguments and answer. `running` is present tense ("Editing Lid"), `done` past tense with a short
   * result when it helps ("Edited Lid: wall 2 → 3 mm"), `failed` says it did not ("Couldn't edit
   * Lid"). Return `undefined` to keep the tool's title. A plain chat's line names no tool id, model,
   * engine or code. The kit words its own web lookup; the app words its tools by overriding this
   * (and may call `super.stepLine(c)` for the kit's). A finished line is kept with the chat, so a
   * chat read back shows the same words.
   */
  protected stepLine(c: StepCall): string | undefined {
    if (c.tool !== 'web__lookup') return undefined;
    const q = (c.input as { question?: unknown } | null)?.question;
    const question = typeof q === 'string' ? q.trim() : '';
    if (!question) return undefined;
    return c.state === 'running'
      ? `Looking up ${question}`
      : c.state === 'failed'
        ? `Couldn't look up ${question}`
        : `Looked up ${question}`;
  }

  /** How this chat words its tool lines: plain or not, with the titles of every tool it offered. */
  #names(): StepNames {
    return {
      plain: this.plainSteps(),
      titleOf: (n) =>
        this.#turn?.tools.info.find((i) => i.name === n)?.title ??
        this.#get<Record<string, string>>('titles')?.[n],
      lineOf: (c) => {
        if (c.state === 'running') return this.stepLine(c);
        const kept = this.#get<string>(`line:${c.id}`);
        if (kept) return kept;
        const line = this.stepLine(c);
        if (line) this.#put(`line:${c.id}`, line.slice(0, 200));
        return line;
      },
      foldOf: (c) => {
        if (c.state === 'running') return this.stepFold(c);
        const kept = this.#get<StepFold>(`fold:${c.id}`);
        if (kept) return kept;
        const fold = this.stepFold(c);
        if (fold) this.#put(`fold:${c.id}`, fold);
        return fold;
      },
    };
  }

  /**
   * Where a read-only call sits when calls in a row fold into one line: its `group` (the row's
   * label, "Guides"), the thing it read (`what`, "Retries") and how the line words the group
   * (`one`, `many`, with `{n}` and `{what}`). Return `undefined` to show the call's own line. Kept
   * with the chat like its line, so a chat read back folds the same.
   */
  protected stepFold(_c: StepCall): StepFold | undefined {
    return undefined;
  }

  /**
   * A tool call this answer failed: its name and whole error (a plain line shows neither). Does
   * nothing unless the app overrides it, e.g. to log it with the chat's ids.
   */
  protected stepFailed(_f: { tool: string; error: string; ms: number }): void {}

  /** A tool line's title as this chat words it (`plainSteps`), for an app's own card answers. */
  protected stepTitleOf(name: string, kind?: 'read' | 'draft' | 'write'): string {
    return shownTitle(name, this.#names(), kind);
  }

  /** Keeps the titles of a turn's tools, so a chat read back words its lines the same. */
  #keepTitles(info: { name: string; title?: string }[]) {
    const titles = this.#get<Record<string, string>>('titles') ?? {};
    let changed = false;
    for (const i of info)
      if (i.title && titles[i.name] !== i.title) {
        titles[i.name] = i.title.slice(0, 80);
        changed = true;
      }
    if (changed) this.#put('titles', titles);
  }

  /** The chat's running use: every answer's parts added up, and the last context size. */
  usage(): ChatUsage {
    return this.#get<ChatUsage>('usage') ?? chatUsage([]);
  }

  /** The chat as the panel reads it: title, last message, items and use. */
  async view(id = this.name): Promise<AssistantChat> {
    const open = openTask(this.#tasks());
    return {
      id,
      title: this.#get<string>('title') ?? '',
      at: this.#get<number>('at') ?? 0,
      items: taskBlocks(
        itemsOf(
          await this.getMessages(),
          this.cards(),
          this.#screens(),
          this.#get<Record<string, SteerNote[]>>('steers') ?? {},
          this.#names(),
          this.#get<Record<string, string>>('task_of') ?? {},
          this.#get<Record<string, string>>('turn_labels') ?? {},
        ),
        this.#tasks(),
      ),
      usage: this.usage(),
      ...(open ? { task: open } : {}),
      ...(this.#turn ? { running: true } : {}),
    };
  }

  #tasks(): Record<string, KeptTask> {
    return this.#get<Record<string, KeptTask>>('tasks') ?? {};
  }

  /** The chat's tasks, by id. */
  chatTasks(): Record<string, AssistantTask> {
    return Object.fromEntries(
      Object.entries(this.#tasks()).map(([id, t]) => [id, { id, label: t.label, state: t.state }]),
    );
  }

  /**
   * A task ended: the app took its result (`done`) or it was dropped. The chat's next turn hears it
   * in one line, with the task's last answer. Ending one that already ended changes nothing.
   */
  endTask(id: string, state: 'done' | 'dropped'): AssistantTask | null {
    const tasks = this.#tasks();
    const t = tasks[id];
    if (!t) return null;
    if (t.state === 'open') {
      const taskOf = this.#get<Record<string, string>>('task_of') ?? {};
      let last = '';
      let mine = false;
      for (const m of this.messages) {
        if (m.role === 'user') mine = taskOf[m.id] === id;
        else if (m.role === 'assistant' && mine) {
          const said = m.parts
            .map((p) => (p.type === 'text' ? p.text : ''))
            .join('')
            .trim();
          if (said) last = said;
        }
      }
      tasks[id] = { ...t, state, told: false, ...(last ? { last } : {}) };
      this.#put('tasks', tasks);
    }
    const now = tasks[id] as KeptTask;
    return { id, label: now.label, state: now.state };
  }

  /**
   * Starts the turn's task, or carries it on: kept with its brief as first sent, and the person's
   * newest message (`asked`, its key among the turn's messages) marked as the task's.
   */
  /** Keeps a turn's label (`AgentTurnPlan.title`) on the person's message, the newest LABELS_KEPT. */
  #putLabel(id: string, label: string) {
    const labels = this.#get<Record<string, string>>('turn_labels') ?? {};
    delete labels[id];
    labels[id] = label;
    const ids = Object.keys(labels);
    for (const k of ids.slice(0, Math.max(0, ids.length - LABELS_KEPT))) delete labels[k];
    this.#put('turn_labels', labels);
  }

  #startTask(task: NonNullable<AgentTurnPlan['task']>, key: string | null): KeptTask {
    const tasks = this.#tasks();
    const was = tasks[task.id];
    const t: KeptTask = was
      ? { ...was, label: task.label, state: 'open', at: Date.now() }
      : { label: task.label, brief: task.brief, state: 'open', at: Date.now() };
    tasks[task.id] = t;
    const ids = Object.keys(tasks).sort(
      (a, b) => (tasks[a] as KeptTask).at - (tasks[b] as KeptTask).at,
    );
    for (const id of ids.slice(0, Math.max(0, ids.length - TASKS_KEPT))) delete tasks[id];
    this.#put('tasks', tasks);
    if (this.#asked) {
      const taskOf = this.#get<Record<string, string>>('task_of') ?? {};
      taskOf[this.#asked] = task.id;
      this.#put('task_of', taskOf);
    }
    if (key) {
      const byKey = this.#get<Record<string, string>>('task_keys') ?? {};
      byKey[key] = task.id;
      this.#put('task_keys', byKey);
    }
    return t;
  }

  /** Tasks that ended since the chat's own side last answered, as its note; marks them told. */
  #taskNews(): string {
    const tasks = this.#tasks();
    const ended = Object.entries(tasks).filter(([, t]) => t.state !== 'open' && t.told === false);
    if (!ended.length) return '';
    for (const [id, t] of ended) tasks[id] = { ...t, told: true };
    this.#put('tasks', tasks);
    return taskNews(ended);
  }

  /**
   * Stops the answer running now (the panel's Stop): what was said and made so far is kept, and
   * the answer's stream ends with `stopped`.
   */
  stop(): void {
    if (this.#sink) this.#stopping = true;
    this.cancelAllChats();
  }

  /** Stop was pressed for the answer running now. */
  #stopping = false;

  /**
   * A message for the answer running now: it joins at the answer's next step (after the tool it
   * is on), shown there as steered. `steered: false` when no answer runs or its plan turned steer
   * off: the panel queues it. One the answer ends without reading comes back as `unsteered`.
   */
  steer(message: string): { steered: boolean } {
    const text = message.trim();
    const t = this.#turn;
    if (!text || !t || !this.#sink || t.plan.steer === false) return { steered: false };
    this.#steers.push({ text: text.slice(0, 20_000), at: Date.now() });
    return { steered: true };
  }

  /**
   * One answer to `input`, its events sent to `sink` in the panel's words: the chat's title, the
   * text, each tool line and card, then its use. The app's route calls it over RPC.
   */
  async ask(input: AskInput, given: AskSink): Promise<void> {
    const at = Date.now();
    this.#capped = false;
    // A new chat is named while its first answer runs (`nameChat`); its first message stands in.
    const naming = this.#get<string>('title') ? null : this.nameChat(input).catch(() => null);
    const sink = naming ? this.#withName(given, naming) : given;
    let title = this.#get<string>('title');
    if (!title) {
      title = input.message.replace(/\s+/g, ' ').trim().slice(0, 60);
      this.#put('title', title);
    }
    this.#put('at', at);
    await sink.event({ event: 'chat', data: { id: this.name, title } });
    if (input.message.trim() === COMPACT_COMMAND) {
      await this.#compactNow(input, sink);
      await sink.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
      return;
    }
    // New work in a long chat: the panel asks first, and the message is not kept or answered here.
    if (!input.stay && (await this.offerFresh(input).catch(() => false))) {
      await sink.event({ event: 'fresh', data: {} });
      await sink.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
      return;
    }
    this.#outcomes(screenOutcomesOf(input.outcomes));
    const quote = quoteOf(input.quote);
    const meta: AskMeta = {
      at,
      ...(input.context ? { context: { label: input.context.label } } : {}),
      ...(input.refs?.length ? { refs: input.refs } : {}),
      ...(quote ? { quote } : {}),
      ...(input.tier ? { tier: input.tier } : {}),
    };
    const toEvents = chunkEvents({
      ...(this.#last?.plan.advisor ? { advisor: this.#last.plan.advisor.label } : {}),
      cards: () => new Map(this.cards().map((c) => [c.id, c])),
      screens: () => this.#screens(),
      kindOf: (n) => this.#turn?.tools.info.find((i) => i.name === n)?.kind,
      names: this.#names(),
      failed: (f) => this.stepFailed(f),
    });
    const map = screenMapOf(input.screen);
    const userId = turnIdOf(input.id);
    this.#sink = sink;
    this.#stopping = false;
    this.#asked = userId;
    this.#steers = [];
    this.#steered = [];
    // The images go in the message's parts; the turn's plan reads the rest.
    const { images: _images, ...asked } = input;
    const pictures = imageParts(input.images);
    const leftOut = imagesLeftOut(input.images);
    this.#input = {
      ...asked,
      ...(map ? { screen: map } : {}),
      ...(pictures.length ? { image_count: pictures.length } : {}),
    };
    if (!map) delete this.#input.screen;
    let failed = false;
    try {
      await this.chat(
        {
          id: userId,
          role: 'user',
          parts: [
            ...(quote ? [{ type: 'text' as const, text: quoteLead(quote) }] : []),
            { type: 'text', text: input.message },
            ...pictures,
            ...(leftOut ? [{ type: 'text' as const, text: `\n\n${leftOut}` }] : []),
          ],
          metadata: meta,
        },
        {
          onStart: () => undefined,
          onEvent: async (json) => {
            let chunk: { type: string; [k: string]: unknown };
            try {
              chunk = JSON.parse(json);
            } catch {
              return;
            }
            for (const e of toEvents(chunk)) await sink.event(e);
          },
          onDone: () => undefined,
          onError: async (message) => {
            failed = true;
            await sink.event({ event: 'error', data: { message: message.slice(0, 500) } });
          },
        },
      );
    } catch (err) {
      if (!failed)
        await sink.event({
          event: 'error',
          data: errorData(err),
        });
    } finally {
      this.#input = null;
      this.#sink = null;
      this.#asked = null;
      this.#steered = [];
    }
    // Steers the answer ended before reading go back to the panel, first in its queue.
    const unread = this.#steers.splice(0).map((s) => s.text);
    if (unread.length) await sink.event({ event: 'unsteered', data: { texts: unread } });
    if (this.#capped) await sink.event({ event: 'stopped', data: { reason: 'cap' } });
    else if (this.#stopping) await sink.event({ event: 'stopped', data: {} });
    this.#stopping = false;
    await sink.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
  }

  #capped = false;
  /** The last turn's model and key, for compaction between turns. */
  #last: { plan: AgentTurnPlan } | null = null;
  /** The last turn's prompt as it was sent, so a compaction reads it back from the cache. */
  #sent: SentPrompt | null = null;
  /** The turn's own prompt, before any step changed it. */
  #turnSent: SentPrompt | null = null;
  /** Usage spent between turns (compaction), settled with the next turn. */
  #owed: UsageMeter[] = [];
  #tabled = false;

  #cards() {
    if (!this.#tabled) {
      this
        .sql`CREATE TABLE IF NOT EXISTS lumen_cards (id TEXT PRIMARY KEY, kind TEXT NOT NULL, grp TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT, status TEXT NOT NULL, error TEXT, told INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)`;
      this.#tabled = true;
    }
  }

  #addCard(kind: AgentCard['kind'], d: DraftCall, result?: unknown) {
    this.#cards();
    if (this.#turn) this.#turn.changes = (this.#turn.changes ?? 0) + 1;
    const id = d.call ?? `card_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    this
      .sql`INSERT OR REPLACE INTO lumen_cards (id, kind, grp, tool, args, result, status, at) VALUES (${id}, ${kind}, ${d.group}, ${d.tool}, ${JSON.stringify(d.args ?? null)}, ${cardResult(result)}, ${kind === 'draft' ? 'open' : 'done'}, ${Date.now()})`;
    return id;
  }

  #card(id: string): AgentCard | null {
    this.#cards();
    const [r] = this.sql<CardRow>`SELECT * FROM lumen_cards WHERE id = ${id} LIMIT 1`;
    return r ? cardOf(r) : null;
  }

  #setCard(id: string, status: AgentCard['status'], o: { result?: unknown; error?: string } = {}) {
    this
      .sql`UPDATE lumen_cards SET status = ${status}, result = COALESCE(${o.result === undefined ? null : cardResult(o.result)}, result), error = ${o.error ?? null}, told = 0 WHERE id = ${id}`;
  }

  #screensTabled = false;
  #screenTable() {
    if (!this.#screensTabled) {
      this
        .sql`CREATE TABLE IF NOT EXISTS lumen_screens (id TEXT PRIMARY KEY, label TEXT NOT NULL, moves TEXT NOT NULL, status TEXT NOT NULL, text TEXT, told INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL)`;
      this.#screensTabled = true;
    }
  }

  /** The chat's screen calls (at most 200), by id. */
  #screens(): Map<string, ScreenCall> {
    this.#screenTable();
    const rows = this.sql<{
      id: string;
      label: string;
      moves: string;
      status: string;
      text: string | null;
    }>`SELECT id, label, moves, status, text FROM lumen_screens ORDER BY at DESC LIMIT 200`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          label: r.label,
          moves: JSON.parse(r.moves),
          status: r.status as ScreenCall['status'],
          ...(r.text ? { text: r.text } : {}),
        },
      ]),
    );
  }

  /** How screen calls ended in the browser: kept, and told to the model with its next turn. */
  #outcomes(list: AssistantScreenOutcome[]) {
    if (!list.length) return;
    this.#screenTable();
    for (const o of list)
      this
        .sql`UPDATE lumen_screens SET status = ${o.status}, text = ${o.text ?? null}, told = 0 WHERE id = ${o.id} AND (status != ${o.status} OR COALESCE(text, '') != ${o.text ?? ''})`;
  }

  /** Screen calls whose end the model has not heard, as its note; marks them told. */
  #screenNews(): string {
    this.#screenTable();
    const rows = this.sql<{
      id: string;
      label: string;
      moves: string;
      status: string;
      text: string | null;
    }>`SELECT id, label, moves, status, text FROM lumen_screens WHERE told = 0 ORDER BY at LIMIT 20`;
    if (!rows.length) return '';
    for (const r of rows) this.sql`UPDATE lumen_screens SET told = 1 WHERE id = ${r.id}`;
    return screenNews(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        moves: JSON.parse(r.moves),
        status: r.status as ScreenCall['status'],
        ...(r.text ? { text: r.text } : {}),
      })),
    );
  }

  /** The chat's cards, newest last: drafts and writes made at once (at most 200). */
  cards(): AgentCard[] {
    this.#cards();
    return this.sql<CardRow>`SELECT * FROM lumen_cards ORDER BY at DESC LIMIT 200`
      .map(cardOf)
      .reverse();
  }

  /** The person saved a draft: its write runs now. */
  async saveCard(id: string): Promise<AgentCard> {
    const c = this.#card(id);
    if (!c || c.kind !== 'draft') throw new Error('That card is gone.');
    if (c.status !== 'open') throw new Error(`That card is already ${c.status}.`);
    try {
      const result = await this.applyDraft(c);
      this.#setCard(id, 'saved', { result });
    } catch (err) {
      this.#setCard(id, 'failed', { error: String((err as Error)?.message ?? err).slice(0, 300) });
    }
    return this.#card(id) as AgentCard;
  }

  /** The person dismissed a draft: nothing changes. */
  dismissCard(id: string): AgentCard {
    const c = this.#card(id);
    if (!c || c.kind !== 'draft') throw new Error('That card is gone.');
    if (c.status !== 'open') throw new Error(`That card is already ${c.status}.`);
    this.#setCard(id, 'dismissed');
    return this.#card(id) as AgentCard;
  }

  /** The person undid a write made at once. */
  async undoCard(id: string): Promise<AgentCard> {
    const c = this.#card(id);
    if (!c || c.kind !== 'write') throw new Error('That change is gone.');
    if (c.status === 'undone') throw new Error('That change is already undone.');
    await this.undoWrite(c);
    this.#setCard(id, 'undone');
    return this.#card(id) as AgentCard;
  }

  /** Cards settled since the model last heard, as its note; marks them told. */
  #news(): string {
    this.#cards();
    const rows = this
      .sql<CardRow>`SELECT * FROM lumen_cards WHERE told = 0 AND status IN ('saved', 'dismissed', 'failed', 'undone') ORDER BY at LIMIT 50`;
    if (!rows.length) return '';
    for (const r of rows) this.sql`UPDATE lumen_cards SET told = 1 WHERE id = ${r.id}`;
    return cardNews(rows.map(cardOf));
  }

  /**
   * Past this many tokens Think summarizes the chat's older part, out of sight of the person
   * (`COMPACT_AT` by default). An app overrides it to keep its chats shorter.
   */
  protected compactAt(): number {
    return COMPACT_AT;
  }

  /** Think compacts the chat past `compactAt()` tokens, on the last turn's model and key. */
  override configureSession(session: Session) {
    return session
      .onCompaction(createCompactFunction({ summarize: (prompt) => this.#summarize(prompt) }))
      .compactAfter(this.compactAt());
  }

  /**
   * /compact: the chat's older part summarized now, as Think does past `compactAt()`, on the last
   * turn's model and key (planned afresh when this object has not answered yet). Never a message
   * to the model, and nothing to answer.
   */
  async #compactNow(input: AskInput, sink: AskSink): Promise<void> {
    try {
      if (!this.#last) {
        this.#input = { ...input, message: '' };
        try {
          this.#last = { plan: await this.plan({ messages: [] } as unknown as TurnContext) };
        } finally {
          this.#input = null;
        }
      }
      const r = await this.session.compact();
      if (r) await sink.event({ event: 'compacted', data: {} });
      else
        await sink.event({
          event: 'text',
          data: { delta: 'This chat is already short: nothing to compact yet.' },
        });
    } catch (err) {
      console.error(JSON.stringify({ event: 'assistant_compact_failed', error: String(err) }));
      await sink.event({
        event: 'error',
        data: { message: 'The chat could not be compacted. Try again, or start a new chat.' },
      });
    }
  }

  async #summarize(prompt: string): Promise<string> {
    const last = this.#last;
    if (!last) throw new Error('No model to compact with until the next answer.');
    const { plan } = last;
    let meter = new UsageMeter(plan.model, `${plan.label} · compact`, !!plan.key.plan);
    meter.ctx = { task: 'chat', run: this.name };
    this.#owed.push(meter);
    const settings = {
      maxRetries: 0,
      model: this.#model(plan, () => {
        const fb = plan.fallback;
        if (!fb) return;
        meter = new UsageMeter(fb.model, `${fb.label} · compact`, false);
        meter.ctx = { task: 'chat', run: this.name };
        this.#owed.push(meter);
      }),
      ...turnSettings(plan.model, { effort: this.#keptEffort(), out: 4000, plan: !!plan.key.plan }),
    };
    // The last turn's own prompt and one more message: the call reads all of it from the cache, so a
    // compaction pays only for the ask and its answer (a fresh prompt read 0 of 20-70k, 2026-11-19).
    const sent = this.#sent;
    const r = sent
      ? await generateText({
          ...settings,
          instructions: sent.instructions,
          messages: [...sent.messages, { role: 'user', content: SUMMARY_ASK }],
          // The tools the last call offered, none of them called: tools lead the prompt too.
          ...(Object.keys(sent.tools).length
            ? {
                tools: sent.tools,
                ...(sent.activeTools ? { activeTools: sent.activeTools } : {}),
                toolChoice: 'none' as const,
              }
            : {}),
        })
      : await generateText({ ...settings, prompt });
    meter.add(r.usage, { step: 'compact', cache: cacheCheckOf(r.providerMetadata) });
    return r.text;
  }

  /** The effort this turn runs at: the conversation's own (`lockedEffort`), kept with it. */
  #effort(plan: AgentTurnPlan): AssistantEffort {
    const r = lockedEffort(
      this.#get<{ model: string; effort: AssistantEffort }>('effort'),
      plan.model.id,
      plan.effort ?? 'default',
      !!plan.resetEffort,
    );
    if (r.keep) this.#put('effort', r.keep);
    return r.effort;
  }

  /** The effort the conversation's calls ran at, for its compaction. */
  #keptEffort(): AssistantEffort {
    return this.#get<{ effort: AssistantEffort }>('effort')?.effort ?? 'default';
  }

  /** The turn's model; on a ChatGPT plan with a fallback, Claude once the plan's limit is reached. */
  #model(plan: AgentTurnPlan, onSwitch: () => void) {
    const o = { ...(plan.fetch ? { fetch: plan.fetch } : {}), name: this.constructor.name };
    const model = aiModel(plan.model, plan.key, o);
    if (!plan.key.plan || !plan.fallback) return model;
    return planFallback(model, aiModel(plan.fallback.model, plan.fallback.key, o), onSwitch);
  }

  /** Never read: `beforeTurn` gives every turn its own model. */
  override getModel(): ThinkModel {
    return '@cf/none';
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    await this.#close();
    const plan = await this.plan(ctx);
    this.#last = { plan };
    // The person's Auto-compact, read each turn, so a change in Settings holds from the next message.
    this.session.compactAfter(plan.compactAt ?? this.compactAt());
    const opened = await openAiTools(plan.sources, {
      draft: async (d) => ({ card: this.#addCard('draft', d), note: CARD_NOTE }),
      wrote: async (w) => this.#addCard('write', w, w.result),
      ...plan.tools,
    });
    const free = !!plan.key.plan;
    const call = { task: 'chat', run: this.name };
    const main = new UsageMeter(plan.model, plan.label, free);
    main.ctx = call;
    const meters = [main, ...this.#owed];
    this.#owed = [];
    const advice = plan.advisor
      ? new UsageMeter(plan.advisor.model, plan.advisor.label, free)
      : undefined;
    if (advice) {
      advice.ctx = call;
      meters.push(advice);
    }
    let system = typeof plan.system === 'string' ? plan.system : plan.system(opened);
    this.#keepTitles(opened.info);
    this.#turn = {
      plan,
      system,
      tools: opened,
      main,
      ...(advice ? { advice } : {}),
      meters,
      steps: 0,
      capped: false,
      t0: Date.now(),
    };
    // Think adds the agent's own file tools (read, ls, find, grep, …) to every turn by itself.
    const files = createAITools({ workspace: this.workspace });
    const more = plan.more?.({
      opened,
      files,
      over: () => plan.left !== undefined && this.#spent() >= plan.left,
      meter: (model, label, f = free) => {
        const m = new UsageMeter(model, label, f);
        m.ctx = call;
        meters.push(m);
        return m;
      },
    });
    const advisor: ToolSet = {};
    if (plan.advisor)
      advisor.advisor = advisorTool({
        model: plan.advisor.model.id,
        maxUses: plan.advisor.maxUses,
        maxTokens: plan.advisor.maxTokens,
      });
    const shown = plan.screen ? this.#input?.screen : undefined;
    const screen: ToolSet = shown
      ? screenTool(shown, (c) => {
          this.#screenTable();
          this
            .sql`INSERT OR REPLACE INTO lumen_screens (id, label, moves, status, told, at) VALUES (${c.id}, ${c.label}, ${JSON.stringify(c.moves)}, 'sent', 1, ${Date.now()})`;
        })
      : {};
    if (shown) {
      system = `${system}\n\n${screenRules(shown)}`;
      this.#turn.system = system;
    }
    const tools: ToolSet = { ...opened.tools, ...more, ...advisor, ...screen };
    const turn = this.#turn;
    // A task's turn reads its brief and its own messages; any other turn, the messages of no task.
    const keys = turnKeys(ctx.messages);
    const newest = keys.findLast((k) => k !== null) ?? null;
    let kept: KeptTask | null = null;
    if (plan.task) {
      kept = this.#startTask(plan.task, newest);
      await this.#sink?.event({
        event: 'task',
        data: { id: plan.task.id, label: kept.label, state: 'open' },
      });
    }
    if (plan.title && this.#asked) {
      const label = plan.title.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
      this.#putLabel(this.#asked, label);
      await this.#sink?.event({ event: 'label', data: { label } });
    }
    const thread = threadOf(
      ctx.messages,
      this.#get<Record<string, string>>('task_keys') ?? {},
      plan.task?.id,
    );
    // Each lead stays on the message it went with, so earlier messages are sent as before and read
    // from the prompt cache; the newest says only what changed since the last (`stickyLeads`).
    const leadsAt = plan.task ? `leads:task:${plan.task.id}` : 'leads';
    const led = stickyLeads(
      thread,
      this.#get<SentLeads>(leadsAt) ?? { sent: {} },
      `${this.#news()}${this.#screenNews()}${plan.task ? '' : this.#taskNews()}${plan.lead ?? ''}`,
    );
    this.#put(leadsAt, led.kept);
    const first = led.messages.findIndex((m) => m.role === 'user');
    const sent =
      kept?.brief && first >= 0 ? leadAt(led.messages, first, `${kept.brief}\n\n`) : led.messages;
    this.#sent = { instructions: system, messages: sent, tools };
    this.#turnSent = this.#sent;
    return {
      model: this.#model(plan, () => {
        const fb = plan.fallback;
        if (!fb) return;
        // Claude answers the rest of the turn on the payer's key: its use is its own part.
        turn.main = new UsageMeter(fb.model, fb.label, false);
        turn.main.ctx = { task: 'chat', run: this.name };
        turn.meters.push(turn.main);
      }),
      instructions: system,
      messages: sent,
      tools,
      ...(plan.first ? { toolChoice: { type: 'tool', toolName: plan.first } } : {}),
      maxSteps: plan.maxSteps ?? MAX_STEPS,
      ...turnSettings(plan.model, {
        effort: this.#effort(plan),
        ...(plan.out ? { out: plan.out } : {}),
        plan: free,
      }),
    };
  }

  override beforeStep(ctx: PrepareStepContext): StepConfig | undefined {
    const step = this.#step(ctx);
    // What this call sends, as the model reads it: a compaction after it sends the same and one
    // more message, so it reads all of it from the cache.
    const was = this.#turnSent;
    if (was) {
      const s = step as
        | { instructions?: string; messages?: ModelMessage[]; activeTools?: string[] }
        | undefined;
      this.#sent = {
        instructions: s?.instructions ?? was.instructions,
        messages: s?.messages ?? (ctx.messages as ModelMessage[]),
        tools: was.tools,
        ...(s?.activeTools ? { activeTools: s.activeTools } : {}),
      };
    }
    return step;
  }

  #step(ctx: PrepareStepContext): StepConfig | undefined {
    const t = this.#turn;
    if (!t) return undefined;
    const steered = this.#steerInto(ctx);
    const messages = steered ? { messages: steered } : {};
    // The SDK's step result is a union that Omit narrows to shared keys; these exist on it.
    if (t.plan.left !== undefined && this.#spent() >= t.plan.left) {
      t.capped = true;
      const capped: Record<string, unknown> = {
        ...messages,
        activeTools: [],
        instructions: `${t.system}\n\n${CAP_NOTE}`,
      };
      return capped as StepConfig;
    }
    // The last call answers in words: past it the loop stops, so a tool call there would end the
    // answer on a tool's result with nothing said.
    if (ctx.stepNumber >= (t.plan.maxSteps ?? MAX_STEPS) - 1) {
      const last: Record<string, unknown> = {
        ...messages,
        activeTools: [],
        toolChoice: 'none',
        instructions: `${t.system}\n\n${LAST_STEP_NOTE}`,
      };
      return last as StepConfig;
    }
    // A forced first call is for the first step only; tools a search found join each step.
    const auto = t.plan.first && ctx.stepNumber > 0;
    if (!auto && !steered) return undefined;
    return {
      ...(auto ? { toolChoice: 'auto' } : {}),
      ...messages,
    } as StepConfig;
  }

  /**
   * The step's messages with every steer read so far in its place: waiting ones join at the end
   * now (told to the panel and kept for the chat's history), earlier ones where they joined.
   */
  #steerInto(ctx: PrepareStepContext): PrepareStepContext['messages'] | null {
    const sink = this.#sink;
    const asked = this.#asked;
    if (this.#steers.length && sink && asked) {
      const now = this.#steers.splice(0);
      const kept = this.#get<Record<string, SteerNote[]>>('steers') ?? {};
      kept[asked] = [
        ...(kept[asked] ?? []),
        ...now.map((s) => ({ step: ctx.stepNumber, text: s.text, at: s.at })),
      ];
      this.#put('steers', kept);
      for (const s of now) {
        this.#steered.push({ index: ctx.messages.length, text: s.text });
        void Promise.resolve(sink.event({ event: 'steered', data: s })).catch(() => undefined);
      }
    }
    if (!this.#steered.length) return null;
    const out = [...ctx.messages];
    for (const s of [...this.#steered].reverse())
      out.splice(s.index, 0, {
        role: 'user',
        content: [{ type: 'text', text: `${STEER_NOTE}\n\n${s.text}` }],
      });
    return out;
  }

  override onStepFinish(ctx: StepContext): void {
    const t = this.#turn;
    if (!t) return;
    t.steps += 1;
    const step = ctx as { providerMetadata?: unknown; stepNumber?: number };
    const p = t.main.add(ctx.usage, {
      step: step.stepNumber ?? t.steps - 1,
      cache: cacheCheckOf(step.providerMetadata),
    });
    t.context = p.in + p.out;
    // Claude's advisor bills apart from the step's own usage: its calls are listed one by one.
    const meta = (ctx as { providerMetadata?: { anthropic?: { iterations?: AdvisorIteration[] } } })
      .providerMetadata;
    for (const it of meta?.anthropic?.iterations ?? [])
      if (it.type === 'advisor_message' && t.advice)
        t.advice.addTokens({
          input_tokens: it.inputTokens ?? 0,
          output_tokens: it.outputTokens ?? 0,
          cache_read_input_tokens: it.cacheReadInputTokens ?? 0,
          cache_creation_input_tokens: it.cacheCreationInputTokens ?? 0,
        });
  }

  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    await this.#end(
      result.status === 'completed' ? 'ok' : result.status === 'aborted' ? 'stopped' : 'error',
    );
  }

  override onChatError(error: unknown): unknown {
    void this.#end('error');
    return error;
  }

  #spent() {
    return (this.#turn?.meters ?? []).reduce((a, m) => a + m.part().usd, 0);
  }

  async #end(outcome: AgentTurnEnd['outcome']) {
    const t = this.#turn;
    if (!t) return;
    this.#turn = null;
    await t.tools.close();
    const parts = t.meters.map((m) => m.part()).filter((p) => p.calls);
    this.#capped = t.capped;
    this.#put('usage', chatUsage([...this.usage().parts, ...parts], t.context));
    try {
      await this.settle({
        outcome,
        parts,
        ...(t.context ? { context: t.context } : {}),
        steps: t.steps,
        ...(t.changes ? { changes: t.changes } : {}),
        ms: Date.now() - t.t0,
        capped: t.capped,
      });
    } catch (err) {
      console.error(
        JSON.stringify({ event: 'agent_settle_error', error: String(err).slice(0, 500) }),
      );
    }
  }

  async #close() {
    const t = this.#turn;
    this.#turn = null;
    await t?.tools.close();
  }
}
