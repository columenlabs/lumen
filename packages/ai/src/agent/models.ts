/**
 * The kit's models as AI SDK language models, so a Think agent (or any `streamText` call) runs on
 * the same tiers, keys and sign-ins as the assistant: Claude on an API key, OpenAI on an API key or
 * a person's ChatGPT plan sign-in.
 */
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { AssistantEffort } from '@columenlabs/lumen-ui-types/assistant';
import {
  type JSONValue,
  type LanguageModel,
  type LanguageModelMiddleware,
  type ModelMessage,
  type ToolSet,
  wrapLanguageModel,
} from 'ai';
import { Stream } from 'openai/core/streaming';
import { type ModelDef, XAI_BASE_URL } from '../assistant/models';
import { backoffFetch } from './backoff';

/** The one `instructions` line a plan request carries; the system prompt goes in a developer item. */
const PLAN_INSTRUCTIONS = 'Follow the developer message.';

/** Models a ChatGPT plan refused `prompt_cache_options` for ("not supported on this model"). */
const noCacheTtl = new Set<string>();

/** Claude's advisor tool: provider imports live here only, beside `aiModel`. */
export const advisorTool = (
  o: Parameters<typeof anthropic.tools.advisor_20260301>[0],
): ToolSet[string] => anthropic.tools.advisor_20260301(o) as ToolSet[string];

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
  /** `false` sends the call with no prompt cache. The one way to turn it off; it is on otherwise. */
  cache?: false;
}

/**
 * A ChatGPT plan sign-in takes function tools only inside one namespace and no output cap, and a
 * forced call is the one tool offered with any call required (developers.openai.com/siwc, Preview
 * limitations). It also keeps nothing (`store: false`, so earlier reasoning rides along encrypted)
 * and requires an `instructions` field, as the assistant's own OpenAI loop sends it (the
 * AI SDK's request without these came back 400 Bad Request on a plan, 2026-11-04). A plan also
 * answers only streamed requests ("Stream must be set to true", 400): a call that is not streamed
 * (`generateText`: a hand-off, a compaction) is sent streamed and its events are put back together
 * into the one response it asked for. This fetch rewrites each Responses request to those rules, so
 * the AI SDK's OpenAI provider runs on a plan unchanged.
 */
export function planFetch(base: typeof fetch = fetch, name = 'Assistant'): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/responses') || typeof init?.body !== 'string') return base(input, init);
    const { max_output_tokens: _cap, ...parsed } = JSON.parse(init.body) as Record<string, unknown>;
    let body = parsed;
    body.store = false;
    const include = Array.isArray(body.include) ? (body.include as string[]) : [];
    if (!include.includes('reasoning.encrypted_content'))
      body.include = [...include, 'reasoning.encrypted_content'];
    // System and developer messages (and any instructions) become one developer item at the start of
    // the input, and `instructions` one fixed line. A plan requires `instructions`, but gpt-6.2-sol on
    // a plan never reads it from the prompt cache, while it reads a developer item (plan, 2026-11-18:
    // a 10k-token prompt read 0% four calls running as instructions, 99% from the second call as a
    // developer item; gpt-6.1-terra read the same either way).
    const items = Array.isArray(body.input) ? (body.input as Record<string, unknown>[]) : [];
    const lead = items.filter((m) => m.role === 'system' || m.role === 'developer');
    const said = lead.map((m) => textOf(m.content)).filter(Boolean);
    if (
      typeof body.instructions === 'string' &&
      body.instructions &&
      body.instructions !== PLAN_INSTRUCTIONS
    )
      said.unshift(body.instructions);
    body.instructions = PLAN_INSTRUCTIONS;
    if (said.length || lead.length)
      body.input = [
        ...(said.length
          ? [{ role: 'developer', content: [{ type: 'input_text', text: said.join('\n\n') }] }]
          : []),
        ...items.filter((m) => !lead.includes(m)),
      ];
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
    const ns = (list: unknown[]) => ({
      type: 'namespace',
      name: 'app',
      description: `${name}'s tools`,
      tools: list,
    });
    if (fns.length) body.tools = [...rest, ns(fns)];
    const model = String(body.model ?? '');
    const streamed = body.stream === true;
    body.stream = true;
    // ChatGPT keeps a plan's prompt cache by the request's `session-id` header, not the body's
    // `prompt_cache_key` (OpenAI's own Codex client: "ChatGPT derives cache affinity from the
    // Responses session-id header", codex-rs/core/src/client.rs). Without it each call of a plan
    // went to a fresh cache and read 0 (live 2026-11-14), while the same calls on a key read 92%.
    const headers = new Headers(init?.headers);
    if (typeof body.prompt_cache_key === 'string' && !headers.has('session-id')) {
      headers.set('session-id', body.prompt_cache_key);
      headers.set('thread-id', body.prompt_cache_key);
    }
    // A plan wrote nothing to its cache (cache_write_tokens 0, live 2026-11-14): ask for the default
    // 30-minute cache in so many words, and ask again without it if the plan refuses the field.
    if (
      typeof body.prompt_cache_key === 'string' &&
      !noCacheTtl.has(model) &&
      !body.prompt_cache_options
    )
      body.prompt_cache_options = { ttl: '30m' };
    // The request's shape, one line a call: every field but the token, each text as its length and a
    // short hash, never its words. Two calls' lines side by side show what one changed (the prompt
    // cache reads a request only as far as it matches an earlier one).
    console.log(
      JSON.stringify({ event: 'assistant_plan_request', ...requestShape(body, headers) }),
    );
    let res = await base(input, { ...init, headers, body: JSON.stringify(body) });
    // A plan refuses some fields on some models. Each 400 that names one drops that field for the
    // model (kept for this isolate) and asks again, whichever order the refusals come in, so one
    // refusal never leaves the person with an error: a field the model refused is never sent again.
    for (let tries = 0; res.status === 400 && tries < 3; tries++) {
      const text = await res.clone().text();
      if (body.prompt_cache_options && /prompt_cache_options/i.test(text)) {
        noCacheTtl.add(model);
        body = { ...body, prompt_cache_options: undefined };
      } else break;
      console.error(
        JSON.stringify({
          event: 'assistant_plan_retry',
          model,
          status: 400,
          body: text.slice(0, 300),
        }),
      );
      res = await base(input, { ...init, headers, body: JSON.stringify(body) });
    }
    // A refusal is logged with OpenAI's own reason; the person sees a plain sentence.
    if (!res.ok)
      console.error(
        JSON.stringify({
          event: 'assistant_plan_refused',
          status: res.status,
          body: (await res.clone().text()).slice(0, 500),
        }),
      );
    if (!res.ok || !res.body) return res;
    // The plan's own usage numbers, as it sent them (cache reads included), one line a call.
    const [mine, theirs] = res.body.tee();
    void logPlanUsage(theirs, String(body.model ?? ''), typeof body.prompt_cache_key === 'string');
    const seen = new Response(mine, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    return streamed ? seen : whole(seen, init?.signal);
  };
}

/**
 * Reads a plan's streamed answer for its final usage and logs it as sent (`assistant_plan_usage`):
 * whether a plan reads its prompt from the cache shows in its own numbers. Never throws.
 */
async function logPlanUsage(stream: ReadableStream<Uint8Array>, model: string, keyed: boolean) {
  try {
    const reader = stream.getReader();
    const text = new TextDecoder();
    let buf = '';
    let usage: unknown;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += text.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:') || !line.includes('"usage"')) continue;
        const e = JSON.parse(line.slice(5)) as { type?: string; response?: { usage?: unknown } };
        if (e.type === 'response.completed' || e.type === 'response.incomplete')
          usage = e.response?.usage;
      }
    }
    if (usage) console.log(JSON.stringify({ event: 'assistant_plan_usage', model, keyed, usage }));
  } catch {
    // A log line is never worth a failed answer.
  }
}

/**
 * A streamed Responses answer as the one JSON response a request that was not streamed expects:
 * the final `response.completed` (or `response.incomplete`), with the items from each
 * `response.output_item.done` when the final event leaves its output empty. A failed answer comes
 * back as an error response with OpenAI's own error, so the caller fails as it would have.
 */
async function whole(res: Response, signal?: AbortSignal | null): Promise<Response> {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  const failed = (error: unknown) =>
    new Response(JSON.stringify({ error: error ?? { message: 'The answer failed.' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  const items: unknown[] = [];
  let done: Record<string, unknown> | undefined;
  try {
    const events = Stream.fromSSEResponse<{ type?: string; item?: unknown; response?: unknown }>(
      res,
      controller,
    );
    for await (const e of events) {
      if (e.type === 'response.output_item.done' && e.item) items.push(e.item);
      else if (e.type === 'response.completed' || e.type === 'response.incomplete')
        done = e.response as Record<string, unknown>;
      else if (e.type === 'response.failed')
        return failed((e.response as { error?: unknown } | undefined)?.error);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    const e = err as { error?: unknown; message?: string };
    return failed(e.error ?? { message: e.message ?? String(err) });
  }
  if (!done) return failed({ message: 'The answer ended before it was complete.' });
  const output = Array.isArray(done.output) && done.output.length ? done.output : items;
  return new Response(JSON.stringify({ ...done, output }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A message's text, whether a string or a list of text parts. */
/** A short, stable hash of a value as JSON: equal values give equal hashes. */
function shapeHash(v: unknown): string {
  const of = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < of.length; i++) h = Math.imul(h ^ of.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}:${of.length}`;
}

/**
 * A plan request with every field kept but its texts: each one as `hash:length`, and each input
 * item as its role or type with its parts. The headers are named, the session id hashed, the
 * token left out.
 */
function requestShape(body: Record<string, unknown>, headers: Headers) {
  const items = Array.isArray(body.input) ? (body.input as Record<string, unknown>[]) : [];
  const part = (c: Record<string, unknown>) => {
    const { type, ...rest } = c;
    return `${String(type)}=${shapeHash(rest)}`;
  };
  const { input: _i, instructions, tools, ...rest } = body;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest))
    fields[k] = typeof v === 'string' && v.length > 80 ? shapeHash(v) : v;
  return {
    headers: [...headers.keys()].filter((k) => k !== 'authorization').sort(),
    session: shapeHash(headers.get('session-id') ?? ''),
    fields,
    instructions: shapeHash(instructions),
    tools: shapeHash(tools),
    input: items.map((m) => {
      const head = String(m.role ?? m.type);
      const c = m.content;
      if (Array.isArray(c))
        return `${head}[${(c as Record<string, unknown>[]).map(part).join(' ')}]`;
      const { role: _r, type: _t, ...other } = m;
      return `${head}=${shapeHash(c ?? other)}`;
    }),
  };
}

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

/** The AI SDK model a tier runs: its provider's client on the payer's key, its prompt cached. */
export function aiModel(model: ModelDef, key: ModelKey, o: AiModelOptions = {}): LanguageModel {
  // Every provider call backs off the same way on a limit or overload (backoff.ts).
  const f = backoffFetch(o.fetch ?? fetch);
  const base =
    model.provider === 'anthropic'
      ? createAnthropic({ apiKey: key.apiKey, fetch: f })(model.id)
      : model.provider === 'xai'
        ? createOpenAI({ apiKey: key.apiKey, baseURL: XAI_BASE_URL, fetch: f }).responses(model.id)
        : createOpenAI({
            apiKey: key.apiKey,
            fetch: key.plan ? planFetch(f, o.name) : f,
          }).responses(model.id);
  if (o.cache === false) return base;
  return wrapLanguageModel({ model: base, middleware: promptCache(model, !!key.plan) });
}

/** What a compaction asks the model, after the conversation itself. */
export const SUMMARY_ASK =
  "Summarize this conversation so the assistant can carry on from it: the person's goals, what was decided and made, names and numbers, and what is still open. Plain prose, at most 600 words. Answer with the summary only.";

/** A turn's prompt as it was sent: its system line, its messages and its tools. */
export interface SentPrompt {
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
}

/** The cache mark Claude reads: a breakpoint after the block it is set on. */
/** One message of a prompt as a provider receives it (the AI SDK's own type, through middleware). */
type LanguageModelV4Message = Parameters<
  NonNullable<LanguageModelMiddleware['transformParams']>
>[0]['params']['prompt'][number];

const CLAUDE_CACHE: { cacheControl: { type: 'ephemeral' } } = {
  cacheControl: { type: 'ephemeral' },
};

/**
 * OpenAI's prompt cache key: calls with the same key go to the same cache, so a long prompt's start
 * is read from it instead of paid again. A ChatGPT plan sign-in caches nothing without one. At most
 * 64 characters.
 */
export const promptCacheKey = (key: string) => key.slice(0, 64);

/**
 * A cache key named for what a prompt starts with, not for one chat or run: a new chat or run that
 * starts the same way reads that start from the cache (a key per chat read 0 of a new chat's
 * 5.9k-token start; one key for the start read 99.7%, our key, 2026-11-14). The key only routes;
 * what is read is still only the exact same start.
 */
export function prefixCacheKey(...parts: (string | undefined)[]): string {
  const of = parts.filter(Boolean).join('\u0000');
  let h = 0x811c9dc5;
  let g = 0x01000193;
  for (let i = 0; i < of.length; i++) {
    h = Math.imul(h ^ of.charCodeAt(i), 0x01000193);
    g = Math.imul(g ^ of.charCodeAt(i), 0x85ebca6b);
  }
  return `lumen-${(h >>> 0).toString(36)}${(g >>> 0).toString(36)}`;
}

/** A prompt message's words (its pictures and files count by their kind only). */
function wordsOf(m: LanguageModelV4Message | undefined): string {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  return m.content
    .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : `[${p.type}]`))
    .join('\n');
}

/** A prompt message with Claude's breakpoint on it, and on no other of its fields. */
const marked = (m: LanguageModelV4Message): LanguageModelV4Message => ({
  ...m,
  providerOptions: {
    ...m.providerOptions,
    anthropic: { ...m.providerOptions?.anthropic, ...CLAUDE_CACHE },
  },
});

/** The same message with any breakpoint a caller set taken off, so the cache owns all of them. */
function unmarked(m: LanguageModelV4Message): LanguageModelV4Message {
  const a = m.providerOptions?.anthropic;
  if (!a || !('cacheControl' in a)) return m;
  const { cacheControl: _c, ...rest } = a;
  return { ...m, providerOptions: { ...m.providerOptions, anthropic: rest } };
}

/**
 * The prompt cache, on every call `aiModel` makes (Bikram, 2026-11-19: caching is implicit, and
 * only `cache: false` turns it off). No caller passes a key or marks a message:
 * - Claude: a breakpoint after the system line (tools and instructions), one on the message before
 *   the newest person's message (the conversation so far, so the next turn reads it), and the
 *   request's own after the newest block (a turn's later steps read the earlier ones).
 * - OpenAI: the cache key, named for the model and the system line, so every conversation that
 *   starts the same way shares that start. On a ChatGPT plan the key is also the request's
 *   `session-id`, and a plan keeps one cached prompt per id (the last request's), so there the key
 *   also names the conversation by its first message: two conversations never take each other's.
 * A key the caller set itself (`providerOptions.openai.promptCacheKey`) is kept.
 */
export function promptCache(model: ModelDef, plan: boolean): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => {
      const prompt = params.prompt.map(unmarked);
      const system = prompt
        .filter((m) => m.role === 'system')
        .map(wordsOf)
        .join('\n\n');
      const first = prompt.find((m) => m.role !== 'system');
      let newest = prompt.length - 1;
      while (newest >= 0 && prompt[newest]?.role !== 'user') newest -= 1;
      const lastSystem = prompt.findLastIndex((m) => m.role === 'system');
      const marks = prompt.map((m, n) =>
        n === lastSystem || (n === newest - 1 && n > lastSystem) ? marked(m) : m,
      );
      const openai = { ...params.providerOptions?.openai };
      if (typeof openai.promptCacheKey !== 'string')
        openai.promptCacheKey = promptCacheKey(
          plan
            ? prefixCacheKey(model.id, system, wordsOf(first))
            : prefixCacheKey(model.id, system),
        );
      return {
        ...params,
        prompt: marks,
        providerOptions: {
          ...params.providerOptions,
          anthropic: { ...params.providerOptions?.anthropic, ...CLAUDE_CACHE },
          openai,
        },
      };
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      const r = await doGenerate();
      await watchCache(model, params, r.usage);
      return r;
    },
    wrapStream: async ({ doStream, params }) => {
      const r = await doStream();
      return {
        ...r,
        stream: r.stream.pipeThrough(
          new TransformStream({
            async transform(part, ctl) {
              if (part.type === 'finish') await watchCache(model, params, part.usage);
              ctl.enqueue(part);
            },
          }),
        ),
      };
    },
  };
}

/** A call's settings as a middleware receives them. */
type CallParams = Parameters<NonNullable<LanguageModelMiddleware['transformParams']>>[0]['params'];
/** What a call reports it used, as a provider gives it. */
type CallUsage = {
  inputTokens: { total: number | undefined; cacheRead: number | undefined };
};

/** The last call of each conversation (cache key and first message) in this isolate: its messages' hashes, size and time. */
const lastOnKey = new Map<string, { hashes: string[]; in: number; at: number }>();
/** How many keys are remembered, oldest dropped first. */
const KEYS_KEPT = 200;
/** How long after a call a later one on its key should still read it (OpenAI keeps 5 to 60 min). */
const WATCH_MS = 30 * 60_000;

/** A message's hash by what the model reads: its role and content, not the cache marks on it. */
async function hashOf(m: LanguageModelV4Message): Promise<string> {
  const read = JSON.stringify({ role: m.role, content: m.content });
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(read));
  return [...new Uint8Array(d).slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Misses are never silent: a call that reads less than half of the previous call of its
 * conversation (same key and first message, within `WATCH_MS`) logs `ai.cache_miss`, with the first message that differs from that call
 * (`changed`, or none when the new prompt only adds to it, which points at the provider's side).
 */
async function watchCache(model: ModelDef, params: CallParams, usage: CallUsage): Promise<void> {
  try {
    const key = params.providerOptions?.openai?.promptCacheKey;
    if (typeof key !== 'string') return;
    const hashes = await Promise.all(params.prompt.map(hashOf));
    // One conversation: the same key and the same first message (a compaction starts a new one).
    const first = params.prompt.findIndex((m) => m.role !== 'system');
    const id = `${key}:${first >= 0 ? hashes[first] : ''}`;
    const total = usage.inputTokens.total ?? 0;
    const read = usage.inputTokens.cacheRead ?? 0;
    const was = lastOnKey.get(id);
    const at = Date.now();
    if (was && at - was.at < WATCH_MS && read < was.in / 2) {
      let same = 0;
      while (same < was.hashes.length && hashes[same] === was.hashes[same]) same += 1;
      console.log(
        JSON.stringify({
          event: 'ai.cache_miss',
          model: model.id,
          key,
          in: total,
          read,
          before: was.in,
          gapS: Math.round((at - was.at) / 1000),
          messages: hashes.length,
          ...(same < was.hashes.length
            ? { changed: same, role: params.prompt[same]?.role ?? 'none' }
            : {}),
        }),
      );
    }
    lastOnKey.delete(id);
    lastOnKey.set(id, { hashes, in: total, at });
    if (lastOnKey.size > KEYS_KEPT) lastOnKey.delete(lastOnKey.keys().next().value as string);
  } catch {}
}

/** A tier's effort and output cap as a call's settings (the prompt cache is `aiModel`'s own). */
export function turnSettings(
  model: ModelDef,
  o: { effort: AssistantEffort; out?: number; plan?: boolean },
): { maxOutputTokens?: number; providerOptions: Record<string, Record<string, JSONValue>> } {
  const out = o.plan || !o.out ? {} : { maxOutputTokens: o.out };
  const anthropic: Record<string, JSONValue> = {};
  // A plan keeps nothing, so earlier turns go back as items, not references to stored ones.
  const openai: Record<string, JSONValue> = o.plan ? { store: false } : {};
  if (o.effort !== 'default') {
    if (model.provider === 'anthropic') anthropic.effort = o.effort;
    else openai.reasoningEffort = o.effort;
  }
  return {
    ...out,
    providerOptions: {
      ...(Object.keys(anthropic).length ? { anthropic } : {}),
      ...(Object.keys(openai).length ? { openai } : {}),
    },
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
