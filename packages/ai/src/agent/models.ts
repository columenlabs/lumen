/**
 * The kit's models as AI SDK language models, so a Think agent (or any `streamText` call) runs on
 * the same tiers, keys and sign-ins as the assistant: Claude on an API key, OpenAI on an API key or
 * a person's ChatGPT plan sign-in.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { AssistantEffort } from '@columenlabs/lumen-ui-types/assistant';
import type { JSONValue, LanguageModel } from 'ai';
import type { ModelDef } from '../assistant/models';

/** The key a model runs on. `plan`: an OpenAI access token from a ChatGPT plan sign-in. */
export interface ModelKey {
  apiKey: string;
  plan?: boolean;
}

export interface AiModelOptions {
  /** The fetch provider calls go through (a Worker's own, a metered one). */
  fetch?: typeof fetch;
  /** What a plan sign-in's tool namespace is described as (the assistant's name). */
  name?: string;
}

/**
 * A ChatGPT plan sign-in takes function tools only inside one namespace and no output cap, and a
 * forced call is the one tool offered with any call required (developers.openai.com/siwc, Preview
 * limitations). This fetch rewrites each Responses request to those rules, so the AI SDK's OpenAI
 * provider runs on a plan unchanged.
 */
export function planFetch(base: typeof fetch = fetch, name = 'Assistant'): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/responses') || typeof init?.body !== 'string') return base(input, init);
    const { max_output_tokens: _cap, ...body } = JSON.parse(init.body) as Record<string, unknown>;
    let tools =
      (body.tools as { type: string; name?: string; strict?: boolean }[] | undefined) ?? [];
    const choice = body.tool_choice as { type?: string; name?: string } | string | undefined;
    if (choice && typeof choice === 'object' && choice.type === 'function' && choice.name) {
      tools = tools.filter((t) => t.name === choice.name);
      body.tool_choice = 'required';
    }
    const fns = tools.filter((t) => t.type === 'function').map(({ strict: _, ...t }) => t);
    const rest = tools.filter((t) => t.type !== 'function');
    if (fns.length)
      body.tools = [
        ...rest,
        { type: 'namespace', name: 'app', description: `${name}'s tools`, tools: fns },
      ];
    return base(input, { ...init, body: JSON.stringify(body) });
  };
}

/** The AI SDK model a tier runs: its provider's client on the payer's key. */
export function aiModel(model: ModelDef, key: ModelKey, o: AiModelOptions = {}): LanguageModel {
  if (model.provider === 'anthropic')
    return createAnthropic({ apiKey: key.apiKey, ...(o.fetch ? { fetch: o.fetch } : {}) })(
      model.id,
    );
  const f = key.plan ? planFetch(o.fetch, o.name) : o.fetch;
  return createOpenAI({ apiKey: key.apiKey, ...(f ? { fetch: f } : {}) }).responses(model.id);
}

/** A tier's effort and output cap as a turn's settings; nothing at the model's own default. */
export function turnSettings(
  model: ModelDef,
  o: { effort: AssistantEffort; out?: number; plan?: boolean },
): { maxOutputTokens?: number; providerOptions?: Record<string, Record<string, JSONValue>> } {
  const out = o.plan || !o.out ? {} : { maxOutputTokens: o.out };
  if (o.effort === 'default') return out;
  return model.provider === 'anthropic'
    ? { ...out, providerOptions: { anthropic: { effort: o.effort } } }
    : { ...out, providerOptions: { openai: { reasoningEffort: o.effort } } };
}
