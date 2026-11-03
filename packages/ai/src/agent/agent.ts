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
import type { AssistantEffort, UsagePart } from '@columenlabs/lumen-ui-types/assistant';
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
import { type ModelKey, aiModel, turnSettings } from './models';
import { LAZY_AT, type LazyTools, TOOL_SEARCH, lazyTools } from './search';
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
  /** Dollars the payer has left; at or past it the model gets no more tools. */
  left?: number;
  /** Most model calls in one answer; 8. */
  maxSteps?: number;
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

/** The messages with `lead` put before the newest message the person wrote. */
export function withLead(messages: ModelMessage[], lead: string | undefined): ModelMessage[] {
  if (!lead) return messages;
  let i = messages.length - 1;
  while (i >= 0 && messages[i]?.role !== 'user') i -= 1;
  const m = messages[i];
  if (!m || m.role !== 'user') return messages;
  const content =
    typeof m.content === 'string'
      ? `${lead}${m.content}`
      : [{ type: 'text' as const, text: lead }, ...m.content];
  return [...messages.slice(0, i), { ...m, content }, ...messages.slice(i + 1)];
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
    const id = `card_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    this
      .sql`INSERT INTO lumen_cards (id, kind, grp, tool, args, result, status, at) VALUES (${id}, ${kind}, ${d.group}, ${d.tool}, ${JSON.stringify(d.args ?? null)}, ${result === undefined ? null : JSON.stringify(result).slice(0, 20_000)}, ${kind === 'draft' ? 'open' : 'done'}, ${Date.now()})`;
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

  /** Think compacts the chat past `COMPACT_AT` tokens, on the last turn's model and key. */
  override configureSession(session: Session) {
    return session
      .onCompaction(createCompactFunction({ summarize: (prompt) => this.#summarize(prompt) }))
      .compactAfter(COMPACT_AT);
  }

  async #summarize(prompt: string): Promise<string> {
    const last = this.#last;
    if (!last) throw new Error('No model to compact with until the next answer.');
    const { plan } = last;
    const meter = new UsageMeter(plan.model, `${plan.label} · compact`, !!plan.key.plan);
    this.#owed.push(meter);
    const r = await generateText({
      model: aiModel(plan.model, plan.key, {
        ...(plan.fetch ? { fetch: plan.fetch } : {}),
        name: this.constructor.name,
      }),
      prompt,
      ...turnSettings(plan.model, { effort: 'default', out: 4000, plan: !!plan.key.plan }),
    });
    meter.add(r.usage);
    return r.text;
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
    const main = new UsageMeter(plan.model, plan.label, free);
    const meters = [main, ...this.#owed];
    this.#owed = [];
    const advice = plan.advisor
      ? new UsageMeter(plan.advisor.model, plan.advisor.label, free)
      : undefined;
    if (advice) meters.push(advice);
    let system = typeof plan.system === 'string' ? plan.system : plan.system(opened);
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
      over: () => plan.left !== undefined && this.#spent() >= plan.left,
      meter: (model, label, f = free) => {
        const m = new UsageMeter(model, label, f);
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
    const tools: ToolSet = { ...opened.tools, ...more, ...advisor };
    let lazy: LazyTools | undefined;
    if (Object.keys(tools).length > (plan.lazy?.at ?? LAZY_AT)) {
      const groups = new Map(opened.info.map((i) => [i.name, i.group]));
      const core = plan.lazy?.core ?? [
        ...opened.info.filter((i) => i.find).map((i) => i.name),
        ...Object.keys(more ?? {}),
        ...Object.keys(advisor),
      ];
      if (plan.first && !core.includes(plan.first)) core.push(plan.first);
      lazy = lazyTools(tools, core, (n) => groups.get(n) ?? 'other');
      tools[TOOL_SEARCH] = lazy.search;
      system = `${system}\n\n${lazy.catalog}`;
      this.#turn.system = system;
      this.#turn.lazy = lazy;
    }
    return {
      model: aiModel(plan.model, plan.key, {
        ...(plan.fetch ? { fetch: plan.fetch } : {}),
        name: this.constructor.name,
      }),
      instructions: system,
      messages: withLead(ctx.messages, `${this.#news()}${plan.lead ?? ''}`),
      tools,
      ...(lazy ? { activeTools: lazy.active() } : {}),
      ...(plan.first ? { toolChoice: { type: 'tool', toolName: plan.first } } : {}),
      maxSteps: plan.maxSteps ?? 8,
      ...turnSettings(plan.model, {
        effort: plan.effort ?? 'default',
        ...(plan.out ? { out: plan.out } : {}),
        plan: free,
      }),
    };
  }

  override beforeStep(ctx: PrepareStepContext): StepConfig | undefined {
    const t = this.#turn;
    if (!t) return undefined;
    // The SDK's step result is a union that Omit narrows to shared keys; these exist on it.
    if (t.plan.left !== undefined && this.#spent() >= t.plan.left) {
      t.capped = true;
      return { activeTools: [], instructions: `${t.system}\n\n${CAP_NOTE}` } as StepConfig;
    }
    // A forced first call is for the first step only; tools a search found join each step.
    const auto = t.plan.first && ctx.stepNumber > 0;
    if (!auto && !t.lazy) return undefined;
    return {
      ...(auto ? { toolChoice: 'auto' } : {}),
      ...(t.lazy ? { activeTools: t.lazy.active() } : {}),
    } as StepConfig;
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
    try {
      await this.settle({
        outcome,
        parts: t.meters.map((m) => m.part()).filter((p) => p.calls),
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
