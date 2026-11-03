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
 */
import type { AssistantEffort, UsagePart } from '@columenlabs/lumen-ui-types/assistant';
import type { ModelDef } from '../assistant/models';
import { type ModelKey, aiModel, turnSettings } from './models';
import { type AiToolsOptions, type OpenedTools, type SourceAt, openAiTools } from './tools';
import { UsageMeter } from './usage';

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
  /** The app's instructions and the kit's rules, joined. */
  system: string;
  /** The tool groups at the person's access. */
  sources: SourceAt[];
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
  parts: UsagePart[];
  /** Tokens in the main model's last call: how full its context is. */
  context?: number;
  ms: number;
  /** The spend cap stopped tool use in this answer. */
  capped: boolean;
}

const CAP_NOTE =
  'The spend cap for this month is reached: answer now from what you have, in a sentence or two. You can call no more tools.';

export abstract class LumenAgent<Env = unknown> extends Think<Env> {
  /** The turn the app runs now, or null between turns. */
  abstract plan(turn: TurnContext): Promise<AgentTurnPlan>;
  /** A turn ended: record its spend and how it went. Errors here are logged, never shown. */
  abstract settle(end: AgentTurnEnd): Promise<void>;

  #turn: {
    plan: AgentTurnPlan;
    tools: OpenedTools;
    meter: UsageMeter;
    context?: number;
    capped: boolean;
    t0: number;
  } | null = null;

  /** Never read: `beforeTurn` gives every turn its own model. */
  override getModel(): ThinkModel {
    return '@cf/none';
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    await this.#close();
    const plan = await this.plan(ctx);
    const tools = await openAiTools(plan.sources, plan.tools ?? {});
    const free = !!plan.key.plan;
    this.#turn = {
      plan,
      tools,
      meter: new UsageMeter(plan.model, plan.label, free),
      capped: false,
      t0: Date.now(),
    };
    return {
      model: aiModel(plan.model, plan.key, {
        ...(plan.fetch ? { fetch: plan.fetch } : {}),
        name: this.constructor.name,
      }),
      instructions: plan.system,
      tools: tools.tools,
      maxSteps: plan.maxSteps ?? 8,
      ...turnSettings(plan.model, {
        effort: plan.effort ?? 'default',
        ...(plan.out ? { out: plan.out } : {}),
        plan: free,
      }),
    };
  }

  override beforeStep(_ctx: PrepareStepContext): StepConfig | undefined {
    const t = this.#turn;
    if (!t || t.plan.left === undefined) return undefined;
    if (t.meter.part().usd < t.plan.left) return undefined;
    t.capped = true;
    // The SDK's step result is a union that Omit narrows to shared keys; these two exist on it.
    return { activeTools: [], instructions: `${t.plan.system}\n\n${CAP_NOTE}` } as StepConfig;
  }

  override onStepFinish(ctx: StepContext): void {
    const t = this.#turn;
    if (!t) return;
    const p = t.meter.add(ctx.usage);
    t.context = p.in + p.out;
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

  async #end(outcome: AgentTurnEnd['outcome']) {
    const t = this.#turn;
    if (!t) return;
    this.#turn = null;
    await t.tools.close();
    try {
      await this.settle({
        outcome,
        parts: [t.meter.part()],
        ...(t.context ? { context: t.context } : {}),
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
