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
 * limitations). It also keeps nothing (`store: false`, so earlier reasoning rides along encrypted)
 * and takes the system prompt as `instructions`, as the assistant's own OpenAI loop sends it (the
 * AI SDK's request without these came back 400 Bad Request on a plan, 2026-11-04). This fetch
 * rewrites each Responses request to those rules, so the AI SDK's OpenAI provider runs on a plan
 * unchanged.
 */
export function planFetch(base: typeof fetch = fetch, name = 'Assistant'): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/responses') || typeof init?.body !== 'string') return base(input, init);
    const { max_output_tokens: _cap, ...body } = JSON.parse(init.body) as Record<string, unknown>;
    body.store = false;
    const include = Array.isArray(body.include) ? (body.include as string[]) : [];
    if (!include.includes('reasoning.encrypted_content'))
      body.include = [...include, 'reasoning.encrypted_content'];
    // System and developer messages become the request's instructions.
    const items = Array.isArray(body.input) ? (body.input as Record<string, unknown>[]) : [];
    const lead = items.filter((m) => m.role === 'system' || m.role === 'developer');
    if (lead.length) {
      const said = lead.map((m) => textOf(m.content)).filter(Boolean);
      if (typeof body.instructions === 'string' && body.instructions)
        said.unshift(body.instructions);
      body.instructions = said.join('\n\n');
      body.input = items.filter((m) => !lead.includes(m));
    }
    let tools =
      (body.tools as { type: string; name?: string; strict?: boolean }[] | undefined) ?? [];
    const choice = body.tool_choice as { type?: string; name?: string } | string | undefined;
    if (choice && typeof choice === 'object' && choice.type === 'function' && choice.name) {
      tools = tools.filter((t) => t.name === choice.name);
      body.tool_choice = 'required';
    }
    // Each function as the assistant's own loop sends it: no `strict`, no JSON Schema dialect tag.
    const fns = tools
      .filter((t) => t.type === 'function')
      .map(({ strict: _, ...t }) => {
        const p = (t as { parameters?: Record<string, unknown> }).parameters;
        if (!p || !('$schema' in p)) return t;
        const { $schema: _s, ...parameters } = p;
        return { ...t, parameters };
      });
    const rest = tools.filter((t) => t.type !== 'function');
    if (fns.length)
      body.tools = [
        ...rest,
        { type: 'namespace', name: 'app', description: `${name}'s tools`, tools: fns },
      ];
    const res = await base(input, { ...init, body: JSON.stringify(body) });
    // A refusal is logged with OpenAI's own reason; the person sees a plain sentence.
    if (!res.ok)
      console.error(
        JSON.stringify({
          event: 'assistant_plan_refused',
          status: res.status,
          body: (await res.clone().text()).slice(0, 500),
        }),
      );
    return res;
  };
}

/** A message's text, whether a string or a list of text parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) =>
      p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
        ? (p as { text: string }).text
        : '',
    )
    .filter(Boolean)
    .join('\n');
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

/**
 * Claude's prompt cache: one breakpoint on the request, which Claude moves to the newest block on
 * each call, so a turn's later steps and the next turn read the tools, instructions and chat so
 * far from cache (a tenth of the input price) instead of paying for them again. Sent whatever the
 * tier's provider, so a plan's fallback to Claude caches too; other providers ignore it.
 */
const CLAUDE_CACHE: Record<string, JSONValue> = { cacheControl: { type: 'ephemeral' } };

/** A tier's effort and output cap as a turn's settings, with Claude's prompt cache on. */
export function turnSettings(
  model: ModelDef,
  o: { effort: AssistantEffort; out?: number; plan?: boolean },
): { maxOutputTokens?: number; providerOptions: Record<string, Record<string, JSONValue>> } {
  const out = o.plan || !o.out ? {} : { maxOutputTokens: o.out };
  const anthropic: Record<string, JSONValue> = { ...CLAUDE_CACHE };
  // A plan keeps nothing, so earlier turns go back as items, not references to stored ones.
  const openai: Record<string, JSONValue> = o.plan ? { store: false } : {};
  if (o.effort !== 'default') {
    if (model.provider === 'anthropic') anthropic.effort = o.effort;
    else openai.reasoningEffort = o.effort;
  }
  return {
    ...out,
    providerOptions: { anthropic, ...(Object.keys(openai).length ? { openai } : {}) },
  };
}

/** A model as the AI SDK calls it: its two entry points, whatever the spec version. */
interface CallableModel {
  specificationVersion: string;
  provider: string;
  modelId: string;
  supportedUrls: unknown;
  doGenerate(o: unknown): PromiseLike<unknown>;
  doStream(o: unknown): PromiseLike<{ stream: ReadableStream<{ type: string; error?: unknown }> }>;
}

/** A ChatGPT plan used up for now: a 429 or a usage code, thrown or sent before any output. */
export function planLimited(err: unknown): boolean {
  const e = err as {
    statusCode?: number;
    status?: number;
    message?: string;
    responseBody?: string;
    code?: string;
  };
  if (!e) return false;
  if (e.statusCode === 429 || e.status === 429) return true;
  const text = `${e.code ?? ''} ${e.message ?? ''} ${e.responseBody ?? ''} ${typeof err === 'string' ? err : ''}`;
  return /usage_limit|usage limit|usage_unavailable|insufficient_quota/i.test(text);
}

/** Parts that come before an answer starts; an error among them means nothing was said yet. */
const PREAMBLE = new Set(['stream-start', 'response-metadata']);

/**
 * `primary` until its ChatGPT plan reaches its usage limit, then `fallback` for that call and
 * every later one on this model (the rest of the turn). The limit shows either as a thrown error
 * or as an error part before any output; once output has started nothing is swapped. `onSwitch`
 * runs once, at the swap.
 */
export function planFallback(
  primary: LanguageModel,
  fallback: LanguageModel,
  onSwitch: () => void,
): LanguageModel {
  const p = primary as unknown as CallableModel;
  const f = fallback as unknown as CallableModel;
  let on = p;
  const swap = () => {
    if (on === f) return;
    on = f;
    onSwitch();
  };
  const model: CallableModel = {
    specificationVersion: p.specificationVersion,
    provider: p.provider,
    modelId: p.modelId,
    get supportedUrls() {
      return on.supportedUrls;
    },
    async doGenerate(o) {
      if (on === f) return f.doGenerate(o);
      try {
        return await p.doGenerate(o);
      } catch (err) {
        if (!planLimited(err)) throw err;
        swap();
        return f.doGenerate(o);
      }
    },
    async doStream(o) {
      if (on === f) return f.doStream(o);
      let r: Awaited<ReturnType<CallableModel['doStream']>>;
      try {
        r = await p.doStream(o);
      } catch (err) {
        if (!planLimited(err)) throw err;
        swap();
        return f.doStream(o);
      }
      // Hold the preamble until the first real part shows whether the plan answered.
      const reader = r.stream.getReader();
      const held: { type: string; error?: unknown }[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'error' && planLimited(value.error)) {
          await reader.cancel().catch(() => undefined);
          swap();
          return f.doStream(o);
        }
        held.push(value);
        if (!PREAMBLE.has(value.type)) break;
      }
      const stream = new ReadableStream<{ type: string; error?: unknown }>({
        start(c) {
          for (const v of held) c.enqueue(v);
        },
        async pull(c) {
          const { done, value } = await reader.read();
          if (done) c.close();
          else c.enqueue(value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return { ...r, stream };
    },
  };
  return model as unknown as LanguageModel;
}
