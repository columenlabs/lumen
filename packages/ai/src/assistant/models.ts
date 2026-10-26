/**
 * Models and tiers. The app names its tiers (smallest first) and the model each runs by default; a
 * person may pick another model and effort per tier. Prices are the providers' list prices per
 * million tokens, so every answer's cost is known as it runs.
 */
import type { AssistantEffort, UsagePart } from '@columenlabs/lumen-ui-types/assistant';

/** A model a tier can run, with its list price per million tokens (input, output, cache reads). */
export interface ModelDef {
  id: string;
  label: string;
  /** The heading pickers list it under (its provider). */
  group: string;
  in: number;
  out: number;
  read: number;
}

/** Claude models, smallest first (an advisor is never weaker than the model it advises). */
export const CLAUDE_MODELS: ModelDef[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    group: 'Claude',
    in: 0.1,
    out: 0.5,
    read: 0.01,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    group: 'Claude',
    in: 2,
    out: 10,
    read: 0.2,
  },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', group: 'Claude', in: 4, out: 20, read: 0.2 },
];

/** A tier as the app defines it. `out` caps each model call's output tokens. */
export interface TierDef {
  id: string;
  label: string;
  about: string;
  model: string;
  out?: number;
}

/** A task a person picks a starting tier for (the chat panel, a drafting job, a schedule). */
export interface TaskDef {
  id: string;
  label: string;
  about: string;
  tier: string;
}

/** Output tokens per model call when a tier sets none. */
export const DEFAULT_OUT = 16_000;

/** Token use of one reply, as the provider reports it. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Tokens in (cache reads and writes included) and out of one reply, and its cost at list price. */
export function priced(model: ModelDef, usage: TokenUsage) {
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  return {
    in: usage.input_tokens + written + read,
    out: usage.output_tokens,
    read,
    usd:
      (usage.input_tokens * model.in +
        written * model.in * 1.25 +
        read * model.read +
        usage.output_tokens * model.out) /
      1e6,
  };
}

/** The running use of one tier in one answer. */
export class Meter {
  calls = 0;
  in = 0;
  read = 0;
  out = 0;
  usd = 0;
  constructor(
    readonly model: ModelDef,
    readonly label: string,
  ) {}
  add(usage: TokenUsage) {
    const p = priced(this.model, usage);
    this.calls += 1;
    this.in += p.in;
    this.read += p.read;
    this.out += p.out;
    this.usd += p.usd;
  }
  part(): UsagePart {
    const { label, calls, read, out, usd } = this;
    return { label, calls, in: this.in, read, out, usd };
  }
}

/** The request's effort setting: nothing at the model's own default. */
export function effortParams(effort: AssistantEffort) {
  return effort === 'default' ? {} : { output_config: { effort } };
}

/** `sk-ant-api03-…7Qx2`: never more of a key than its start and last four. */
export const keyHint = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;
