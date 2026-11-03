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
  type StepConfig,
  type StepContext,
  Think,
  type ThinkModel,
  type TurnConfig,
  type TurnContext,
} from '@cloudflare/think';
import type { AssistantEffort, UsagePart } from '@columenlabs/lumen-ui-types/assistant';
import type { ModelMessage, ToolSet } from 'ai';
import type { ModelDef } from '../assistant/models';
import { type ModelKey, aiModel, turnSettings } from './models';
import { type AiToolsOptions, type OpenedTools, type SourceAt, openAiTools } from './tools';
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
  t0: number;
}

export abstract class LumenAgent<Env = unknown> extends Think<Env> {
  /** The turn the app runs now. Throw to refuse it (no key, no money); the error is shown. */
  abstract plan(turn: TurnContext): Promise<AgentTurnPlan>;
  /** A turn ended: record its spend and how it went. Errors here are logged, never shown. */
  abstract settle(end: AgentTurnEnd): Promise<void>;

  #turn: Running | null = null;

  /** Never read: `beforeTurn` gives every turn its own model. */
  override getModel(): ThinkModel {
    return '@cf/none';
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    await this.#close();
    const plan = await this.plan(ctx);
    const opened = await openAiTools(plan.sources, plan.tools ?? {});
    const free = !!plan.key.plan;
    const main = new UsageMeter(plan.model, plan.label, free);
    const meters = [main];
    const advice = plan.advisor
      ? new UsageMeter(plan.advisor.model, plan.advisor.label, free)
      : undefined;
    if (advice) meters.push(advice);
    const system = typeof plan.system === 'string' ? plan.system : plan.system(opened);
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
    return {
      model: aiModel(plan.model, plan.key, {
        ...(plan.fetch ? { fetch: plan.fetch } : {}),
        name: this.constructor.name,
      }),
      instructions: system,
      messages: withLead(ctx.messages, plan.lead),
      tools: { ...opened.tools, ...more, ...advisor },
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
    // A forced first call is for the first step only.
    if (t.plan.first && ctx.stepNumber > 0) return { toolChoice: 'auto' } as StepConfig;
    return undefined;
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
