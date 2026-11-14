/** An AI SDK step's usage as the kit's tokens and list-price cost. */
import type { UsagePart } from '@columenlabs/lumen-ui-types/assistant';
import type { LanguageModelUsage } from 'ai';
import { type ModelDef, type TokenUsage, priced } from '../assistant/models';

/**
 * One call's usage in the kit's terms. Input splits into plain, cache writes and cache reads where
 * the provider says (Claude reports all three; OpenAI reports reads, its writes cost nothing extra).
 * A field a provider leaves out counts as 0.
 */
export function tokenUsage(u: LanguageModelUsage) {
  const d = u.inputTokenDetails;
  const read = d?.cacheReadTokens ?? 0;
  const written = d?.cacheWriteTokens ?? 0;
  const plain = d?.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - read - written);
  return {
    input_tokens: plain,
    output_tokens: u.outputTokens ?? 0,
    cache_creation_input_tokens: written,
    cache_read_input_tokens: read,
  };
}

/** A running part of an answer (a tier, its advice): calls, tokens and dollars. `free` on a plan. */
export class UsageMeter {
  private p: UsagePart;
  constructor(
    readonly model: ModelDef,
    label: string,
    private readonly free = false,
  ) {
    this.p = { label, calls: 0, in: 0, read: 0, out: 0, usd: 0, model: model.id };
  }
  add(u: LanguageModelUsage) {
    return this.addTokens(tokenUsage(u));
  }
  /** Tokens a provider reports apart from the step's usage (Claude's advisor calls). */
  addTokens(u: TokenUsage) {
    const t = priced(this.model, u);
    this.p.calls += 1;
    this.p.in += t.in;
    this.p.read += t.read;
    this.p.out += t.out;
    if (!this.free) this.p.usd += t.usd;
    return t;
  }
  /** Marks this part as one hand-off to a higher tier; parts of the same label add up their runs. */
  handOff() {
    this.p.runs = 1;
    return this;
  }
  part(): UsagePart {
    return { ...this.p };
  }
}
