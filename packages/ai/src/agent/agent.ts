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

import { anthropic } from '@ai-sdk/anthropic';
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
  type ChatUsage,
  type UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { createCompactFunction } from 'agents/sessions';
import { type ModelMessage, type ToolSet, generateText } from 'ai';
import type { ModelDef } from '../assistant/models';
import {
  type AgentConnector,
  CONNECTOR_GROUP,
  type ConnectorAt,
  type ConnectorClient,
  checkConnectorUrl,
  connectorGroup,
  connectorId,
  connectorSource,
} from './connectors';
import { type ModelKey, aiModel, cachedTurn, planFallback, turnSettings } from './models';
import {
  type ScreenCall,
  screenMapOf,
  screenNews,
  screenOutcomesOf,
  screenRules,
  screenTool,
} from './screen';
import { LAZY_AT, type LazyTools, TOOL_SEARCH, lazyTools, usedTools } from './search';
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
  /** The person's connectors to open, at the access they gave each. */
  connectors?: ConnectorAt[];
  /** Past `at` tools (`LAZY_AT`) the model starts with `core` and `tool_search` only. */
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
  /**
   * A message sent while the answer runs joins it at its next step (Steer); on unless `false`,
   * for a model that should not read a new message between its calls. Refused steers are queued.
   */
  steer?: boolean;
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
export const COMPACT_AT = 150_000;

const CARD_NOTE =
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

interface CardRow {
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

const cardOf = (r: CardRow): AgentCard => ({
  id: r.id,
  kind: r.kind as AgentCard['kind'],
  group: r.grp,
  tool: r.tool,
  args: JSON.parse(r.args),
  ...(r.result === null ? {} : { result: JSON.parse(r.result) }),
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

/** The message at `i` (one the person wrote) with `lead` put before what it says. */
function leadAt(messages: ModelMessage[], i: number, lead: string): ModelMessage[] {
  const m = messages[i];
  if (!m || m.role !== 'user') return messages;
  const content =
    typeof m.content === 'string'
      ? `${lead}${m.content}`
      : [{ type: 'text' as const, text: lead }, ...m.content];
  return [...messages.slice(0, i), { ...m, content }, ...messages.slice(i + 1)];
}

/** One message the person sent, with the page, refs and tier the composer added. */
export interface AskInput {
  message: string;
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
 * and no more than `ASSISTANT_IMAGE_CHARS` of base64 together; the rest are left out.
 */
export function imageParts(images: unknown): { type: 'file'; mediaType: string; url: string }[] {
  if (!Array.isArray(images)) return [];
  const out: { type: 'file'; mediaType: string; url: string }[] = [];
  let chars = 0;
  for (const i of images.slice(0, ASSISTANT_IMAGES_MAX) as Partial<AssistantImage>[]) {
    const type = ASSISTANT_IMAGE_TYPES.find((t) => t === i?.media_type);
    if (!type || typeof i?.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(i.data)) continue;
    if (chars + i.data.length > ASSISTANT_IMAGE_CHARS) break;
    chars += i.data.length;
    out.push({ type: 'file', mediaType: type, url: `data:${type};base64,${i.data}` });
  }
  return out;
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

interface AdvisorIteration {
  type?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

interface Running {
  plan: AgentTurnPlan;
  system: string;
  tools: OpenedTools;
  main: UsageMeter;
  advice?: UsageMeter;
  meters: UsageMeter[];
  context?: number;
  steps: number;
  capped: boolean;
  lazy?: LazyTools;
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

  /** Connectors' tools join a turn through `plan.connectors`, at the person's access. */
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
    };
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
    return {
      id,
      title: this.#get<string>('title') ?? '',
      at: this.#get<number>('at') ?? 0,
      items: itemsOf(
        await this.getMessages(),
        this.cards(),
        this.#screens(),
        this.#get<Record<string, SteerNote[]>>('steers') ?? {},
        this.#names(),
      ),
      usage: this.usage(),
    };
  }

  /** Stops the answer running now; what was said so far is kept. */
  stop(): void {
    this.cancelAllChats();
  }

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
  async ask(input: AskInput, sink: AskSink): Promise<void> {
    const at = Date.now();
    this.#capped = false;
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
    const userId = `u_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    this.#sink = sink;
    this.#asked = userId;
    this.#steers = [];
    this.#steered = [];
    // The images go in the message's parts; the turn's plan reads the rest.
    const { images: _images, ...asked } = input;
    this.#input = { ...asked, ...(map ? { screen: map } : {}) };
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
            ...imageParts(input.images),
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
          data: { message: String((err as Error)?.message ?? err).slice(0, 500) },
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
    await sink.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
  }

  #capped = false;
  /** The last turn's model and key, for compaction between turns. */
  #last: { plan: AgentTurnPlan } | null = null;
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
    const id = d.call ?? `card_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    this
      .sql`INSERT OR REPLACE INTO lumen_cards (id, kind, grp, tool, args, result, status, at) VALUES (${id}, ${kind}, ${d.group}, ${d.tool}, ${JSON.stringify(d.args ?? null)}, ${result === undefined ? null : JSON.stringify(result).slice(0, 20_000)}, ${kind === 'draft' ? 'open' : 'done'}, ${Date.now()})`;
    return id;
  }

  #card(id: string): AgentCard | null {
    this.#cards();
    const [r] = this.sql<CardRow>`SELECT * FROM lumen_cards WHERE id = ${id} LIMIT 1`;
    return r ? cardOf(r) : null;
  }

  #setCard(id: string, status: AgentCard['status'], o: { result?: unknown; error?: string } = {}) {
    this
      .sql`UPDATE lumen_cards SET status = ${status}, result = COALESCE(${o.result === undefined ? null : JSON.stringify(o.result).slice(0, 20_000)}, result), error = ${o.error ?? null}, told = 0 WHERE id = ${id}`;
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

  #connectorClient(): ConnectorClient {
    return {
      listTools: () => this.getMcpServers().tools as ReturnType<ConnectorClient['listTools']>,
      callTool: (p) => this.mcp.callTool(p) as ReturnType<ConnectorClient['callTool']>,
    };
  }

  /** The person's connectors, with their state and tool counts. */
  connectors(): AgentConnector[] {
    const { servers, tools } = this.getMcpServers();
    return Object.entries(servers).map(([id, s]) => {
      const own = tools.filter((t) => t.serverId === id);
      return {
        id,
        name: s.name,
        url: s.server_url,
        state: s.state,
        ...(s.auth_url ? { authUrl: s.auth_url } : {}),
        ...(s.error ? { error: s.error.slice(0, 300) } : {}),
        tools: own.length,
        reads: own.filter((t) => t.annotations?.readOnlyHint === true).length,
      };
    });
  }

  /** Adds a connector by its https address; the answer says where to sign in when it asks. */
  async addConnector(
    name: string,
    url: string,
    o: { callbackHost?: string; callbackPath?: string } = {},
  ): Promise<AgentConnector> {
    const u = checkConnectorUrl(url);
    const id = connectorId(name);
    await this.addMcpServer(name.slice(0, 60), u.href, { id, ...o });
    const c = this.connectors().find((x) => x.id === id);
    if (!c) throw new Error('The connector did not stay.');
    return c;
  }

  /** Removes a connector and its sign-in. */
  async removeConnector(id: string): Promise<void> {
    await this.removeMcpServer(id);
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
      const server = c.group.startsWith(CONNECTOR_GROUP)
        ? c.group.slice(CONNECTOR_GROUP.length)
        : null;
      const result = server
        ? await (await connectorSource(this.#connectorClient(), server)()).call(c.tool, c.args)
        : await this.applyDraft(c);
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
    const r = await generateText({
      maxRetries: 0,
      model: this.#model(plan, () => {
        const fb = plan.fallback;
        if (!fb) return;
        meter = new UsageMeter(fb.model, `${fb.label} · compact`, false);
        meter.ctx = { task: 'chat', run: this.name };
        this.#owed.push(meter);
      }),
      prompt,
      ...turnSettings(plan.model, { effort: 'default', out: 4000, plan: !!plan.key.plan }),
    });
    meter.add(r.usage);
    return r.text;
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
    const linked = (plan.connectors ?? []).filter((c) => c.access !== 'off');
    if (linked.length) await this.mcp.waitForConnections({ timeout: 1500 }).catch(() => undefined);
    const client = this.#connectorClient();
    const sources = [
      ...plan.sources,
      ...linked.map((c) => ({
        group: connectorGroup(c.id),
        access: c.access,
        source: connectorSource(client, c.id),
        writes: true,
      })),
    ];
    const opened = await openAiTools(sources, {
      draft: async (d) => ({ card: this.#addCard('draft', d), note: CARD_NOTE }),
      // A connector's change cannot be taken back, so it gets no Undo card.
      wrote: async (w) =>
        w.group.startsWith(CONNECTOR_GROUP) ? undefined : this.#addCard('write', w, w.result),
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
    const more = plan.more?.({
      opened,
      files: createAITools({ workspace: this.workspace }),
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
      advisor.advisor = anthropic.tools.advisor_20260301({
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
    let lazy: LazyTools | undefined;
    // A lazy group's tools (a connector's) are always found first; past `at` tools, all but the core.
    const offPrompt = new Set(opened.info.filter((i) => i.lazy).map((i) => i.name));
    const many = Object.keys(tools).length > (plan.lazy?.at ?? LAZY_AT);
    if (many || offPrompt.size) {
      const groups = new Map(opened.info.map((i) => [i.name, i.group]));
      const core = (
        plan.lazy?.core ??
        (many
          ? [
              ...opened.info.filter((i) => i.find).map((i) => i.name),
              ...Object.keys(more ?? {}),
              ...Object.keys(advisor),
              ...Object.keys(screen),
            ]
          : Object.keys(tools))
      ).filter((n) => !offPrompt.has(n));
      if (plan.first && !core.includes(plan.first)) core.push(plan.first);
      lazy = lazyTools(
        tools,
        core,
        (n) => groups.get(n) ?? 'other',
        usedTools(ctx.messages),
        opened.labels,
      );
      tools[TOOL_SEARCH] = lazy.search;
      system = `${system}\n\n${lazy.catalog}`;
      this.#turn.system = system;
      this.#turn.lazy = lazy;
    }
    const turn = this.#turn;
    // The lead goes before the newest message only. Kept on every earlier message it grew the chat
    // by a whole lead (an app's page, often thousands of tokens) each turn.
    const cached = cachedTurn(
      system,
      withLead(ctx.messages, `${this.#news()}${this.#screenNews()}${plan.lead ?? ''}`),
    );
    return {
      model: this.#model(plan, () => {
        const fb = plan.fallback;
        if (!fb) return;
        // Claude answers the rest of the turn on the payer's key: its use is its own part.
        turn.main = new UsageMeter(fb.model, fb.label, false);
        turn.main.ctx = { task: 'chat', run: this.name };
        turn.meters.push(turn.main);
      }),
      // Think types instructions as a string; the SDK it hands them to takes a system message too.
      instructions: cached.instructions as unknown as string,
      messages: cached.messages,
      tools,
      ...(lazy ? { activeTools: lazy.active() } : {}),
      ...(plan.first ? { toolChoice: { type: 'tool', toolName: plan.first } } : {}),
      maxSteps: plan.maxSteps ?? MAX_STEPS,
      ...turnSettings(plan.model, {
        effort: plan.effort ?? 'default',
        ...(plan.out ? { out: plan.out } : {}),
        plan: free,
        cacheKey: this.name,
      }),
    };
  }

  override beforeStep(ctx: PrepareStepContext): StepConfig | undefined {
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
    if (!auto && !t.lazy && !steered) return undefined;
    return {
      ...(auto ? { toolChoice: 'auto' } : {}),
      ...(t.lazy ? { activeTools: t.lazy.active() } : {}),
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
    const p = t.main.add(ctx.usage);
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
