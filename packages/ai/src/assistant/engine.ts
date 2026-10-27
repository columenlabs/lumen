/**
 * The assistant: one turn loop for any app, ported from a production assistant.
 *
 * A turn streams the model's words and runs its tool calls until it answers (at most `MAX_ROUNDS`
 * rounds). A write tool only drafts: a card the person saves or dismisses. Stop aborts the model
 * and any running tool at once and keeps what was said. Past `COMPACT_AT` tokens (or on
 * `/compact`) the history sent to the model becomes a short summary; the screen keeps every message.
 *
 * Hand off: an `escalate` tool hands one task to a higher tier with the same tools, in its own
 * section of the chat, and its memo goes back. Advice: Anthropic's advisor tool lets a higher tier
 * read the chat and send a plan (it runs nothing), at most `ADVICE_MAX` an answer (Claude only).
 *
 * Providers: a tier runs a Claude model (Anthropic's Messages API) or an OpenAI model (the
 * Responses API), each on its payer's key of that provider. A hand-off may cross providers.
 *
 * Spend: every call is priced at list price as it runs; past what its payer has left this month the
 * model must answer from what it has.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import type {
  AllowanceRequest,
  AllowanceState,
  AllowanceUnit,
  AssistantAccess,
  AssistantChat,
  AssistantChatRow,
  AssistantEffort,
  AssistantMessage,
  AssistantProvider,
  AssistantStatus,
  ChatItem,
  ChatUsage,
  DraftItem,
  HandOffItem,
  HandOffPolicy,
  HandOffWhy,
  StepItem,
  UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { HAND_OFF_WHYS } from '@columenlabs/lumen-ui-types/assistant';
import OpenAI from 'openai';
import {
  CHATGPT_REDIRECT,
  type ChatgptRegistration,
  SigninError,
  finishChatgpt,
  startChatgpt,
  testChatgpt,
} from './chatgpt';
import {
  ALL_MODELS,
  DEFAULT_OUT,
  Meter,
  type ModelDef,
  PROVIDERS,
  type TaskDef,
  type TierDef,
  effortParams,
} from './models';
import {
  DEFAULT_CAP,
  type KeyDoc,
  type Paying,
  State,
  keyDocName,
  keyState,
  waitText,
} from './state';
import { type AssistantStore, Docs, type Sealer } from './store';
import {
  type OpenTools,
  type ToolDef,
  ToolError,
  type ToolSource,
  rowCount,
  toolName,
  withDeadline,
} from './tools';
import { type AccessToken, type WebFetchOptions, scrapeqlTools, webFetchTools } from './web';

/** An app's slash command (`/story <words>`). */
export interface AssistantCommandDef {
  /** Typed after the slash, letters, digits and `-`: `story`. */
  name: string;
  /** One line in the list. */
  about: string;
  /** What follows the name, shown in the list (`<words>`). Without it, picking it sends it. */
  args?: string;
  /** What the model is asked: `{args}` is the words after the name. */
  prompt: string | ((args: string, caller: Caller) => string | Promise<string>);
}

/** Who is asking: their id (the store's scope for their things) and whether they are an admin. */
export interface Caller {
  id: string;
  admin: boolean;
  /** What approvers see a request from them as: their email or name. */
  label?: string;
}

/**
 * How an app counts allowance on its shared keys, and how a person asks for more. The kit holds
 * the ledger and the forms; the app picks the unit, the size, who approves and how they hear.
 */
export interface AllowanceOptions {
  /** What it is counted in; dollars by default. */
  unit?: AllowanceUnit;
  /** `month` (default): the admin's monthly cap plus grants made that month; `once`: one balance. */
  period?: 'month' | 'once';
  /**
   * Units: each person's balance to start (once), or the monthly cap before an admin sets one
   * (month).
   */
  starter?: number;
  /** Amounts the Request more form offers. */
  amounts?: number[];
  /** Who may grant or decline requests; admins by default. */
  approver?: (caller: Caller) => boolean;
  /** Hears each request and each decision: tell the approvers, then the person. */
  notify?: (n: AllowanceNotice) => void | Promise<void>;
}

/** A request made, or decided. */
export interface AllowanceNotice {
  kind: 'requested' | 'granted' | 'declined';
  request: AllowanceRequest;
  unit: AllowanceUnit;
}

const DOLLARS: AllowanceUnit = { one: 'dollar', many: 'dollars', usd: 1 };
const round2 = (n: number) => Math.round(n * 100) / 100;
/** A request may ask for at most this many times the starter or monthly cap. */
const REQUEST_MAX_TIMES = 100;

/** A change a write tool made at once, as `undo` gets it. */
export interface AssistantWrite {
  /** The tool's own name (not the `group__tool` the model calls). */
  tool: string;
  args: unknown;
  /** What the tool returned. */
  result: unknown;
}

/** A group of the app's tools the person sets Off, Read, Read + draft or Read + write. */
export interface ToolGroup {
  id: string;
  label: string;
  about: string;
  /** Where a person starts: `read` by default. */
  access?: AssistantAccess;
  /**
   * Offers Read + write: its write tools then run at once, without a card, each with Undo in the
   * chat when `undo` is set. Off by default, so a group only drafts.
   */
  writes?: boolean;
  /** Takes back one change a write made at once (Undo on its line in the chat). */
  undo?: (caller: Caller, write: AssistantWrite) => Promise<void>;
  tools: (caller: Caller) => ToolSource | ToolSource[];
}

/** What one step or answer was, for the app's meter: shapes only, never content. */
export type StepRecord =
  | {
      kind: 'tool';
      tool: string;
      ok: boolean;
      ms: number;
      rows?: number;
      error?: string;
      tier: string;
      handoff: boolean;
    }
  | { kind: 'draft'; tool: string; tier: string; handoff: boolean }
  | {
      kind: 'turn';
      outcome: 'ok' | 'stopped' | 'error';
      ms: number;
      tier: string;
      end_tier: string;
      handoffs: number;
      advice: number;
      steps: number;
      calls: number;
      in: number;
      out: number;
      usd: number;
    };

export interface AssistantOptions {
  /** What people call it ("Sage"): the panel, Settings and the model's own name. */
  name: string;
  /** The app's instructions: what it is, what its tools are for. */
  system: string | ((caller: Caller) => string | Promise<string>);
  /**
   * The app's slash commands, listed in the composer when the person types `/`. A message
   * `/name words` is sent to the model as `prompt` with `{args}` replaced by the words (or what the
   * function returns); the chat shows what the person typed.
   */
  commands?: AssistantCommandDef[];
  /** The app's tiers, smallest first. */
  tiers: TierDef[];
  /** Tasks a person picks a starting tier for; the chat on the smallest tier by default. */
  tasks?: TaskDef[];
  /** Models a tier may run; every model the kit knows (Claude's and OpenAI's) by default. */
  models?: ModelDef[];
  groups?: ToolGroup[];
  web?: {
    /** `fetch` options, or false for no fetch. */
    fetch?: WebFetchOptions | false;
    /** ScrapeQL's MCP address; its tools join once an admin adds the Access token. */
    scrapeql?: { url: string };
  };
  store: AssistantStore;
  sealer?: Sealer;
  /** The app's key of a provider when none is stored in Settings (a Worker secret). */
  appKey?: (provider: AssistantProvider) => Promise<string | null | undefined>;
  /** USD a person may spend a month when nobody set a cap; 10 (or `allowance.starter`). */
  defaultCap?: number;
  /** An allowance on the shared keys a person can ask to raise (Request more). */
  allowance?: AllowanceOptions;
  /** Months and dates in this zone; UTC by default. */
  timeZone?: string;
  /** Chats are deleted this many days after their last message (`purge`); 30. */
  keepDays?: number;
  /** The fetch the model providers and ScrapeQL calls go through. */
  fetch?: typeof fetch;
  onStep?: (s: StepRecord) => void | Promise<void>;
}

/** A turn's failure the person can act on. */
export class AssistantError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const MAX_ROUNDS = 8;
const COMPACT_AT = 150_000;
/** A tool result handed to the model is cut past this (about 4,000 tokens). */
const RESULT_CHARS = 16_000;
const MEMO_CHARS = 8000;
const ADVICE_MAX = 2;
const ADVICE_TOKENS = 2048;
const ADVISOR_BETA = 'advisor-tool-2026-03-01';
/** What later turns remember of a turn's tool results. */
const RAN_CHARS = 1500;
const RAN_TOTAL = 6000;
const CHATS_LISTED = 200;

const WHY_TEXT: Record<HandOffWhy, string> = {
  asked: 'you asked',
  judgement: 'judgement',
  stuck: 'stuck',
  check_failed: 'check failed',
};

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** A chat as stored: what the screen shows, what the model is sent, and what it was told. */
interface ChatDoc {
  title: string;
  items: ChatItem[];
  history: Turn[];
  usage?: ChatUsage;
  /** Draft ids whose outcome the model has been told, and writes undone it has been told of. */
  told?: string[];
  /** What each write made at once ran with and returned, by its step id: what Undo needs. */
  writes?: Record<string, AssistantWrite & { group: string }>;
}

type Emit = (event: string, data: unknown) => void;

/** The payer's client of each provider it has a key for. */
interface Clients {
  anthropic?: Anthropic;
  openai?: OpenAI;
  /** The OpenAI key is a ChatGPT plan sign-in: the plan's request rules apply, and it costs nothing. */
  openaiPlan?: boolean;
}

interface Session {
  tier: TierDef;
  model: ModelDef;
  effort: AssistantEffort;
  meter: Meter;
}

/** What one loop runs with, whichever provider runs it. Tools and the opening messages are in
 * Anthropic's shapes; the OpenAI loop maps them to the Responses API's. */
interface LoopArgs {
  session: Session;
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  sink: ChatItem[];
  emit: Emit;
  called: () => void;
  tool: (use: Anthropic.ToolUseBlock) => Promise<Anthropic.ToolResultBlockParam>;
  context?: (tokens: number) => void;
  signal?: AbortSignal | undefined;
  over: () => string | null;
  first?: Anthropic.ToolChoice;
  advisor?: { session: Session; asked: number };
}

/** One tool the model may call: where it came from, and whether a write drafts or runs at once. */
interface Fn {
  group: string;
  def: ToolDef;
  draft: boolean;
  write: boolean;
  open: OpenTools;
}

/** What a turn ran, for the history later turns are sent. */
interface Ran {
  tool: string;
  result: string;
}

const NO_USAGE: ChatUsage = { calls: 0, in: 0, read: 0, out: 0, usd: 0, parts: [] };

function addUsage(u: ChatUsage, parts: UsagePart[]): ChatUsage {
  const out = { ...u, parts: u.parts.map((p) => ({ ...p })) };
  for (const p of parts) {
    if (!p.calls) continue;
    out.calls += p.calls;
    out.in += p.in;
    out.read += p.read;
    out.out += p.out;
    out.usd += p.usd;
    const prev = out.parts.find((x) => x.label === p.label);
    if (prev) {
      prev.calls += p.calls;
      prev.in += p.in;
      prev.read += p.read;
      prev.out += p.out;
      prev.usd += p.usd;
    } else out.parts.push({ ...p });
  }
  return out;
}

function withCacheMark(m: Anthropic.MessageParam): Anthropic.MessageParam {
  const blocks: Anthropic.ContentBlockParam[] =
    typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [...m.content];
  const last = blocks[blocks.length - 1];
  if (!last || last.type === 'thinking' || last.type === 'redacted_thinking') return m;
  blocks[blocks.length - 1] = { ...last, cache_control: { type: 'ephemeral' } } as typeof last;
  return { ...m, content: blocks };
}

/** A tool's result, or Stop's abort as soon as it comes. */
function untilStopped<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((done, fail) => {
    const stop = () => fail(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    work.then(done, fail).finally(() => signal.removeEventListener('abort', stop));
  });
}

const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;

/** Every tool line in a chat, those in hand-off sections included. */
function stepsOf(items: ChatItem[]): StepItem[] {
  return items.flatMap((i) =>
    i.kind === 'step' ? [i] : i.kind === 'handoff' ? stepsOf(i.items) : [],
  );
}

/** Every draft in a chat, those in hand-off sections included. */
function draftsOf(items: ChatItem[]): DraftItem[] {
  return items.flatMap((i) =>
    i.kind === 'draft' ? [i] : i.kind === 'handoff' ? draftsOf(i.items) : [],
  );
}

/** A short line of what an error was, never an upstream body. */
function shownError(err: unknown): { message: string; code: string } {
  if (err instanceof AssistantError) return { message: err.message, code: err.code };
  const api =
    err instanceof Anthropic.APIError
      ? { who: 'Claude', status: err.status }
      : err instanceof OpenAI.APIError
        ? { who: 'OpenAI', status: err.status }
        : null;
  if (api) {
    const { who, status } = api;
    if (status === 401) return { message: `The ${who} key was refused.`, code: 'key_refused' };
    if (status === 429)
      return {
        message: `${who} is busy or the key hit its rate limit. Try again shortly.`,
        code: 'rate_limited',
      };
    if (status === 529 || (status ?? 0) >= 500)
      return { message: `${who} is overloaded. Try again shortly.`, code: 'overloaded' };
    return { message: `${who} refused the request (${status ?? 'error'}).`, code: 'model_error' };
  }
  return { message: 'Something went wrong while answering.', code: 'internal' };
}

const isApiError = (err: unknown) =>
  err instanceof Anthropic.APIError || err instanceof OpenAI.APIError;

export class Assistant {
  readonly name: string;
  readonly tiers: TierDef[];
  readonly tasks: TaskDef[];
  readonly models: ModelDef[];
  readonly state: State;
  private readonly groups: ToolGroup[];

  constructor(private readonly o: AssistantOptions) {
    if (!o.tiers.length) throw new Error('An assistant needs at least one tier');
    this.name = o.name;
    this.tiers = o.tiers;
    this.models = o.models ?? ALL_MODELS;
    this.tasks = o.tasks ?? [
      { id: 'chat', label: 'Chat', about: 'The side panel', tier: (o.tiers[0] as TierDef).id },
    ];
    this.groups = o.groups ?? [];
    const al = o.allowance;
    const unit = al?.unit ?? DOLLARS;
    this.state = new State(new Docs(o.store, o.sealer), {
      timeZone: o.timeZone ?? 'UTC',
      defaultCap:
        o.defaultCap ??
        (al?.starter !== undefined && al.period !== 'once' ? al.starter * unit.usd : DEFAULT_CAP),
      ...(o.appKey ? { appKey: o.appKey } : {}),
      ...(o.fetch ? { fetch: o.fetch } : {}),
      ...(al
        ? {
            allowance: {
              usd: unit.usd,
              period: al.period ?? 'month',
              starter: al.starter ?? DEFAULT_CAP / unit.usd,
            },
          }
        : {}),
    });
  }

  private anthropic(apiKey: string) {
    const f = this.o.fetch;
    return new Anthropic({ apiKey, maxRetries: 1, ...(f ? { fetch: f } : {}) });
  }
  private openai(apiKey: string, plan = false) {
    const f = this.o.fetch;
    // A plan sign-in's calls are not retried: a usage limit is final for now.
    return new OpenAI({ apiKey, maxRetries: plan ? 0 : 1, ...(f ? { fetch: f } : {}) });
  }
  private clients(paying: Pick<Paying, 'keys' | 'plans'>): Clients {
    const { keys, plans } = paying;
    return {
      ...(keys.anthropic ? { anthropic: this.anthropic(keys.anthropic) } : {}),
      ...(keys.openai
        ? { openai: this.openai(keys.openai, !!plans.openai), openaiPlan: !!plans.openai }
        : {}),
    };
  }
  /** The providers the app's models run on, in the order the models list them. */
  get providers(): AssistantProvider[] {
    return [...new Set(this.models.map((m) => m.provider))];
  }

  private tierById(id: string | undefined) {
    return this.tiers.find((t) => t.id === id);
  }
  private above(main: TierDef) {
    return this.tiers.slice(this.tiers.indexOf(main) + 1);
  }
  private modelById(id: string | undefined) {
    return this.models.find((m) => m.id === id);
  }

  /** The person's model and effort for a tier, or the tier's own when unset or gone. */
  private async pick(caller: Caller, tier: TierDef) {
    const saved = (await this.state.person(caller.id)).tiers?.[tier.id];
    const model =
      this.modelById(saved?.model) ?? this.modelById(tier.model) ?? (this.models[0] as ModelDef);
    return { model, effort: saved?.effort ?? ('default' as AssistantEffort) };
  }

  private async session(caller: Caller, tier: TierDef, label?: string): Promise<Session> {
    const { model, effort } = await this.pick(caller, tier);
    return {
      tier,
      model,
      effort,
      meter: new Meter(model, label ?? `${tier.label} · ${model.label}`),
    };
  }

  /** The tier the person's chat runs on: their pick, else the chat task's start tier. */
  private async mainTier(caller: Caller, task = 'chat') {
    const p = await this.state.person(caller.id);
    const startId = p.tasks?.[task] ?? this.tasks.find((t) => t.id === task)?.tier;
    return (
      this.tierById(task === 'chat' ? (p.tier ?? startId) : startId) ?? (this.tiers[0] as TierDef)
    );
  }

  private access(p: { access?: Record<string, AssistantAccess> }, g: ToolGroup) {
    const a = p.access?.[g.id] ?? g.access ?? 'read';
    return a === 'write' && !g.writes ? 'draft' : a;
  }

  private groupById(id: string) {
    return this.groups.find((g) => g.id === id);
  }

  // ---------------------------------------------------------------- status and settings

  async status(caller: Caller): Promise<AssistantStatus> {
    const main = await this.mainTier(caller);
    const mainModel = (await this.pick(caller, main)).model;
    const [p, providers, scrapeql, spend, appCap, ownCap, { paying, wait }] = await Promise.all([
      this.state.person(caller.id),
      Promise.all(
        this.providers.map(async (id) => {
          const [doc, key, own] = await Promise.all([
            this.state.appKey(id),
            this.state.appApiKey(id),
            this.state.ownKey(caller.id, id),
          ]);
          const app = caller.admin
            ? keyState(doc, (d) => (d as { api_key: string }).api_key)
            : { set: !!key };
          return {
            id,
            label: PROVIDERS[id].label,
            prefix: PROVIDERS[id].prefix,
            keys_url: PROVIDERS[id].keysUrl,
            ...(PROVIDERS[id].signin ? { signin: PROVIDERS[id].signin } : {}),
            app: { ...app, ...(key?.fromEnv ? { from_env: true } : {}) },
            own: keyState(own, (d) => (d as { api_key: string }).api_key),
          };
        }),
      ),
      this.o.web?.scrapeql ? this.state.scrapeql() : Promise.resolve(null),
      this.state.spend(caller.id),
      this.state.appCap(),
      this.state.ownCap(caller.id),
      this.state.paying(caller.id, mainModel.provider),
    ]);
    const tiers = await Promise.all(
      this.tiers.map(async (t) => {
        const { model, effort } = await this.pick(caller, t);
        return {
          id: t.id,
          label: t.label,
          about: t.about,
          model: model.id,
          model_label: model.label,
          provider: model.provider,
          effort,
        };
      }),
    );
    return {
      name: this.name,
      commands: (this.o.commands ?? []).map((c) => ({
        name: c.name,
        about: c.about,
        ...(c.args ? { args: c.args } : {}),
      })),
      wait,
      ...(wait ? { wait_provider: mainModel.provider } : {}),
      admin: caller.admin,
      tier: main.id,
      tiers,
      models: this.models.map((m) => ({
        id: m.id,
        label: m.label,
        group: m.group,
        provider: m.provider,
      })),
      tasks: this.tasks.map((t) => ({
        id: t.id,
        label: t.label,
        about: t.about,
        tier: this.tierById(p.tasks?.[t.id])?.id ?? t.tier,
      })),
      groups: this.groups.map((g) => ({
        id: g.id,
        label: g.label,
        about: g.about,
        access: this.access(p, g),
        drafts: true,
        writes: !!g.writes,
      })),
      hand_off: p.hand_off ?? 'next',
      advice: p.advice && (p.advice === 'off' || this.tierById(p.advice)) ? p.advice : 'off',
      web: {
        fetch: p.web ?? true,
        scrapeql: this.o.web?.scrapeql
          ? caller.admin
            ? keyState(scrapeql, (d) => (d as { client_id: string }).client_id)
            : { set: !!scrapeql }
          : null,
      },
      providers,
      caps: { app: appCap, own: ownCap },
      pay: p.pay ?? 'app',
      spend: {
        month: this.state.month(),
        usd: spend.rows.reduce((a, r) => a + r.usd, 0),
        cap: paying?.cap ?? null,
        payer: paying?.payer ?? null,
        rows: spend.rows,
      },
      ...(this.o.allowance ? { allowance: await this.allowanceState(caller) } : {}),
    };
  }

  // ---------------------------------------------------------------- allowance

  private get unit() {
    return this.o.allowance?.unit ?? DOLLARS;
  }

  private approver(caller: Caller) {
    return this.o.allowance?.approver ? this.o.allowance.approver(caller) : caller.admin;
  }

  /** The person's allowance in the app's unit, and their newest request. */
  async allowanceState(caller: Caller): Promise<AllowanceState> {
    const al = this.o.allowance ?? {};
    const u = this.unit;
    const [budget, doc, approver] = await Promise.all([
      this.state.appBudget(caller.id),
      this.state.allowance(caller.id),
      this.approver(caller),
    ]);
    const total = round2(budget.total / u.usd);
    const used = round2(budget.used / u.usd);
    const base =
      this.state.allowanceConfig?.period === 'once'
        ? (this.state.allowanceConfig?.starter ?? total)
        : (await this.state.appCap()) / u.usd;
    const waiting = approver
      ? (await this.state.requests()).rows.filter((r) => r.status === 'open').length
      : undefined;
    return {
      unit: u,
      period: al.period ?? 'month',
      total,
      used,
      left: round2(Math.max(0, total - used)),
      request: doc.request ?? null,
      amounts: al.amounts ?? [...new Set([base, base * 3].map((n) => Math.max(1, Math.round(n))))],
      approver,
      ...(waiting !== undefined ? { waiting } : {}),
    };
  }

  private notify(kind: AllowanceNotice['kind'], request: AllowanceRequest) {
    const n = this.o.allowance?.notify;
    if (!n) return;
    // A notice that fails is logged; the request or decision stands.
    return Promise.resolve(n({ kind, request, unit: this.unit })).catch((err: unknown) =>
      console.error(
        JSON.stringify({ event: 'assistant_allowance_notify_failed', kind, error: String(err) }),
      ),
    );
  }

  /** Asks the approvers for more; one open request at a time. */
  async requestMore(caller: Caller, amount: number, why: string): Promise<AllowanceRequest> {
    if (!this.o.allowance)
      throw new AssistantError('This app has no allowance to raise.', 'not_found', 404);
    const s = await this.allowanceState(caller);
    if (s.request?.status === 'open')
      throw new AssistantError('Your last request is still waiting.', 'open_request', 409);
    const max = Math.max(...s.amounts, 1) * REQUEST_MAX_TIMES;
    if (!(amount > 0) || amount > max)
      throw new AssistantError(`Ask for 1 to ${max} ${this.unit.many}.`, 'bad_amount');
    const request: AllowanceRequest = {
      id: `ar_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      person: caller.id,
      who: caller.label ?? caller.id,
      amount: round2(amount),
      why: why.slice(0, 500),
      at: Date.now(),
      status: 'open',
    };
    await this.state.setAllowance(caller.id, (d) => ({ ...d, request }));
    await this.state.putRequest(request);
    await this.notify('requested', request);
    return request;
  }

  /** Approvers: every request, newest first. */
  async allowanceRequests(caller: Caller): Promise<AllowanceRequest[]> {
    if (!(await this.approver(caller)))
      throw new AssistantError('Only an approver can see requests.', 'forbidden', 403);
    return (await this.state.requests()).rows;
  }

  /** Approvers: grants (any amount, the asked one by default) or declines an open request. */
  async decideRequest(
    caller: Caller,
    id: string,
    action: 'grant' | 'decline',
    amount?: number,
  ): Promise<AllowanceRequest> {
    if (!(await this.approver(caller)))
      throw new AssistantError('Only an approver can decide requests.', 'forbidden', 403);
    const r = (await this.state.requests()).rows.find((x) => x.id === id);
    if (!r) throw new AssistantError('That request is gone.', 'not_found', 404);
    if (r.status !== 'open')
      throw new AssistantError('That request was already decided.', 'decided', 409);
    const granted = action === 'grant' ? round2(amount ?? r.amount) : undefined;
    if (granted !== undefined && !(granted > 0))
      throw new AssistantError(`Grant more than 0 ${this.unit.many}.`, 'bad_amount');
    const done: AllowanceRequest = {
      ...r,
      status: action === 'grant' ? 'granted' : 'declined',
      ...(granted !== undefined ? { granted } : {}),
      decided_at: Date.now(),
      decided_by: caller.label ?? caller.id,
    };
    await this.state.setAllowance(r.person, (d) => ({
      ...d,
      grants:
        granted !== undefined
          ? [...d.grants, { at: Date.now(), amount: granted, by: caller.id, request: r.id }]
          : d.grants,
      ...(d.request?.id === r.id ? { request: done } : {}),
    }));
    await this.state.putRequest(done);
    await this.notify(action === 'grant' ? 'granted' : 'declined', done);
    return done;
  }

  // ---------------------------------------------------------------- chats

  async listChats(caller: Caller): Promise<AssistantChatRow[]> {
    const rows = await this.state.docs.list(caller.id, 'chat:', CHATS_LISTED);
    return rows.map((r) => ({ id: r.key.slice(5), title: r.meta ?? '', at: r.at }));
  }

  async readChat(caller: Caller, id: string): Promise<AssistantChat | null> {
    const d = await this.state.docs.read<ChatDoc & { at?: number }>(caller.id, `chat:${id}`);
    if (!d) return null;
    return {
      id,
      title: d.title,
      at: d.at ?? Date.now(),
      items: d.items,
      ...(d.usage ? { usage: d.usage } : {}),
    };
  }

  removeChat(caller: Caller, id: string) {
    return this.state.docs.remove(caller.id, `chat:${id}`);
  }

  /** Deletes chats past `keepDays` since their last message; run it once a day. */
  purge() {
    return this.o.store.purge('chat:', Date.now() - (this.o.keepDays ?? 30) * 86_400_000);
  }

  private writeChat(caller: Caller, id: string, doc: ChatDoc) {
    return this.state.docs.write(caller.id, `chat:${id}`, { ...doc, at: Date.now() }, doc.title);
  }

  // ---------------------------------------------------------------- tools

  /** Opens the tools the person allows: each group's, then the web's. */
  private async openTools(
    caller: Caller,
    p: { access?: Record<string, AssistantAccess>; web?: boolean },
  ) {
    const opened: { group: string; access: AssistantAccess; open: OpenTools }[] = [];
    const sources: { group: string; access: AssistantAccess; source: ToolSource }[] = [];
    for (const g of this.groups) {
      const access = this.access(p, g);
      if (access === 'off') continue;
      const s = g.tools(caller);
      for (const source of Array.isArray(s) ? s : [s])
        sources.push({ group: g.id, access, source });
    }
    if (p.web ?? true) {
      if (this.o.web?.fetch !== false)
        sources.push({
          group: 'web',
          access: 'read',
          source: webFetchTools(this.o.web?.fetch || {}),
        });
      const sq = this.o.web?.scrapeql ? await this.state.scrapeql() : null;
      if (sq && this.o.web?.scrapeql)
        sources.push({
          group: 'web',
          access: 'read',
          source: scrapeqlTools(this.o.web.scrapeql.url, sq, this.o.fetch),
        });
    }
    const results = await Promise.allSettled(sources.map((s) => s.source()));
    results.forEach((r, i) => {
      const s = sources[i];
      if (r.status === 'fulfilled' && s)
        opened.push({ group: s.group, access: s.access, open: r.value });
    });
    const fns = new Map<string, Fn>();
    for (const o of opened)
      for (const def of o.open.tools) {
        if (!def.read && o.access !== 'draft' && o.access !== 'write') continue;
        // Read + write on a group that offers no writes drafts.
        const write = !def.read && o.access === 'write' && !!this.groupById(o.group)?.writes;
        fns.set(toolName(o.group, def.name), {
          group: o.group,
          def,
          draft: !def.read && !write,
          write,
          open: o.open,
        });
      }
    return {
      fns,
      failed: results.filter((r) => r.status === 'rejected').length,
      close: () => Promise.all(opened.map((o) => o.open.close().catch(() => undefined))),
    };
  }

  private toolsFor(fns: Map<string, Fn>): Anthropic.Tool[] {
    return [...fns.entries()].map(([name, f]) => ({
      name,
      description:
        `${f.draft ? "DRAFT ONLY: this call changes nothing. It puts a card on the person's screen that they Save or Dismiss. " : f.write ? 'WRITES AT ONCE: this call makes the change now; the person can undo it. ' : ''}${f.def.title ? `${f.def.title}. ` : ''}${f.def.description ?? ''}`.slice(
          0,
          4000,
        ),
      input_schema: { type: 'object', ...f.def.inputSchema } as Anthropic.Tool.InputSchema,
    }));
  }

  // ---------------------------------------------------------------- the turn

  /** One answer as server-sent events. Abort `signal` to stop it. */
  turnStream(
    caller: Caller,
    req: AssistantMessage,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        ctl = c;
      },
      cancel: () => {
        closed = true;
      },
    });
    const emit: Emit = (event, data) => {
      if (closed) return;
      try {
        ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        closed = true;
      }
    };
    void this.turn(caller, req, emit, signal).finally(() => {
      if (closed) return;
      closed = true;
      try {
        ctl.close();
      } catch {}
    });
    return stream;
  }

  async turn(caller: Caller, req: AssistantMessage, emit: Emit, signal?: AbortSignal) {
    const t0 = performance.now();
    const message = req.message.trim();
    const chatId = req.chat_id ?? newId('ac');
    const prev = req.chat_id
      ? await this.state.docs.read<ChatDoc>(caller.id, `chat:${req.chat_id}`)
      : null;
    if (req.chat_id && !prev) {
      emit('error', { message: 'That chat is gone.', code: 'not_found' });
      return;
    }
    const doc: ChatDoc = prev ?? {
      title: message.replace(/\s+/g, ' ').slice(0, 60),
      items: [],
      history: [],
    };
    const compactOnly = message === '/compact';
    const asked = await this.expand(caller, message);
    if (!compactOnly)
      doc.items.push({
        kind: 'user',
        text: message,
        at: Date.now(),
        ...(req.context?.label ? { context: req.context.label } : {}),
        ...(req.refs?.length ? { refs: req.refs } : {}),
        ...(req.tier ? { tier: req.tier } : {}),
      });
    const start = doc.items.length;
    emit('chat', { id: chatId, title: doc.title });

    // `tier` on a message: a higher one takes it as a task in its own section (handTo below); the
    // same or a lower one answers it as the main tier, for this message only.
    const picked = await this.mainTier(caller);
    const lower =
      req.tier && !this.above(picked).some((t) => t.id === req.tier)
        ? this.tierById(req.tier)
        : undefined;
    const main = await this.session(caller, lower ?? picked);
    const { paying, wait } = await this.state.paying(caller.id, main.model.provider);
    if (!paying) {
      const code = wait ?? 'not_connected';
      const text = waitText(code, main.model.provider, !!this.o.allowance);
      doc.items.push({ kind: 'error', text, code });
      await this.writeChat(caller, chatId, doc);
      emit('error', { message: text, code });
      emit('done', { id: chatId, usage: doc.usage ?? NO_USAGE });
      return;
    }
    const p = await this.state.person(caller.id);
    const policy: HandOffPolicy = p.hand_off ?? 'next';
    const advisor = await this.advisorFor(caller, p.advice, main);
    const clients = this.clients(paying);
    const live: Meter[] = [main.meter, ...(advisor ? [advisor.session.meter] : [])];
    const before = doc.usage ?? NO_USAGE;
    let context = before.context;
    const spent = (): ChatUsage => ({
      ...addUsage(
        before,
        live.map((m) => m.part()),
      ),
      ...(context ? { context } : {}),
    });
    let limited = false;
    const over = () => {
      if (live.reduce((a, m) => a + m.usd, 0) < paying.left) return null;
      limited = true;
      return 'The spend cap for this month is reached: answer now from what you have, in a sentence or two. You can call no more tools.';
    };
    const handTo = req.tier ? this.above(main.tier).find((t) => t.id === req.tier) : undefined;
    const tools = await this.openTools(caller, p);
    const runs: Ran[] = [];
    doc.writes ??= {};
    const counts = { steps: 0, handoffs: 0, advice: 0, end: main.tier, writes: doc.writes };
    let outcome: 'ok' | 'stopped' | 'error' = 'ok';
    try {
      const appSystem =
        typeof this.o.system === 'string' ? this.o.system : await this.o.system(caller);
      const kitRules = this.rules(main, policy, advisor, tools.fns, tools.failed);
      const system: Anthropic.TextBlockParam[] = [
        { type: 'text', text: appSystem },
        { type: 'text', text: kitRules, cache_control: { type: 'ephemeral' } },
      ];
      const subSystem: Anthropic.TextBlockParam[] = [
        { type: 'text', text: appSystem },
        {
          type: 'text',
          text: this.rules(null, policy, null, tools.fns, tools.failed),
          cache_control: { type: 'ephemeral' },
        },
      ];

      if (compactOnly || (before.context ?? 0) > COMPACT_AT) {
        const did = await this.compact(clients, main, doc, emit);
        if (did) context = undefined;
        if (compactOnly) {
          if (!did) {
            const text = 'Nothing to compact yet.';
            doc.items.push({ kind: 'text', text });
            emit('text', { delta: text });
            emit('text_end', {});
          }
          doc.usage = spent();
          await this.writeChat(caller, chatId, doc);
          await this.state.addSpend(
            caller.id,
            paying.payer,
            live.map((m) => m.part()),
          );
          emit('done', { id: chatId, usage: doc.usage });
          return;
        }
      }

      const page =
        this.cardNews(doc) +
        (req.refs?.length
          ? `The person points at: ${JSON.stringify(req.refs).slice(0, 16000)}\n\n`
          : '') +
        (req.context
          ? `Page: ${req.context.label}${req.context.note === undefined ? '' : `\n${JSON.stringify(req.context.note).slice(0, 4000)}`}\n\n`
          : '');
      const lead = handTo
        ? `The person handed this message to ${handTo.label}: call escalate {tier: "${handTo.id}", why: "asked"} now, its task the message with every fact from this chat it needs, then answer from its memo.\n\n`
        : '';
      const messages: Anthropic.MessageParam[] = [
        ...doc.history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: `${page}${lead}${asked}` },
      ];
      const escalateTool = this.escalateTool(main.tier);
      let answer = await this.loop({
        clients,
        session: main,
        system,
        tools: [...this.toolsFor(tools.fns), ...(escalateTool ? [escalateTool] : [])],
        messages,
        sink: doc.items,
        emit,
        signal,
        over,
        ...(handTo && escalateTool ? { first: { type: 'tool', name: 'escalate' } as const } : {}),
        ...(advisor ? { advisor } : {}),
        context: (n) => {
          context = n;
        },
        called: () => emit('usage', spent()),
        tool: (use) =>
          use.name === 'escalate'
            ? this.handOff(use, {
                caller,
                clients,
                message: asked,
                handTo,
                page,
                policy,
                main,
                live,
                sink: doc.items,
                emit,
                spent,
                system: subSystem,
                tools: tools.fns,
                runs,
                counts,
                signal,
                over,
              })
            : this.runTool(use, tools.fns, doc.items, emit, runs, counts, main, false, signal),
      });
      if (limited) {
        doc.items.push({ kind: 'stopped', reason: 'cap' });
        emit('stopped', { reason: 'cap' });
      }
      if (!answer) {
        answer = 'I could not finish that. Try a narrower question.';
        doc.items.push({ kind: 'text', text: answer });
        emit('text', { delta: answer });
        emit('text_end', {});
      }
      doc.history.push({ role: 'user', content: `${page}${asked}` });
      doc.history.push({ role: 'assistant', content: this.remember(answer, runs) });
    } catch (err) {
      if (signal?.aborted) {
        outcome = 'stopped';
        doc.items.push({ kind: 'stopped' });
        const said = doc.items
          .slice(start)
          .filter((i): i is Extract<ChatItem, { kind: 'text' }> => i.kind === 'text')
          .map((i) => i.text)
          .join('\n\n');
        if (!compactOnly) {
          doc.history.push({ role: 'user', content: asked });
          doc.history.push({ role: 'assistant', content: said || '(stopped before answering)' });
        }
      } else {
        outcome = 'error';
        const shown = shownError(err);
        if (!(err instanceof AssistantError) && !isApiError(err))
          console.error(
            JSON.stringify({
              event: 'assistant_error',
              error: String((err as Error)?.stack ?? err).slice(0, 2000),
            }),
          );
        doc.items.push({ kind: 'error', text: shown.message, code: shown.code });
        emit('error', shown);
      }
    } finally {
      await tools.close();
    }
    doc.usage = spent();
    await this.writeChat(caller, chatId, doc).catch(() => undefined);
    await this.state
      .addSpend(
        caller.id,
        paying.payer,
        live.map((m) => m.part()),
      )
      .catch(() => undefined);
    if (outcome !== 'stopped') emit('done', { id: chatId, usage: doc.usage });
    const total = live.reduce(
      (a, m) => ({
        calls: a.calls + m.calls,
        in: a.in + m.in,
        out: a.out + m.out,
        usd: a.usd + m.usd,
      }),
      { calls: 0, in: 0, out: 0, usd: 0 },
    );
    await Promise.resolve(
      this.o.onStep?.({
        kind: 'turn',
        outcome,
        ms: Math.round(performance.now() - t0),
        tier: main.tier.id,
        end_tier: counts.end.id,
        handoffs: counts.handoffs,
        advice: counts.advice,
        steps: counts.steps,
        ...total,
      }),
    ).catch(() => undefined);
  }

  /** What the kit adds to the app's instructions: tools, drafts, hand off, advice, limits. */
  private rules(
    main: Session | null,
    policy: HandOffPolicy,
    advisor: { session: Session } | null,
    fns: Map<string, Fn>,
    failed: number,
  ) {
    const lines = [
      `You are ${this.name}. Today is ${new Date().toISOString().slice(0, 10)}.`,
      'Answer in short plain sentences. Use the tools for facts; never guess a number a tool can give you. Call several tools at once when they do not depend on each other.',
      'A tool marked DRAFT ONLY makes a card the person saves or dismisses; it changes nothing by itself. Say what the card will do; never claim it is done. The next message tells you how each card ended.',
      'A tool marked WRITES AT ONCE makes its change when you call it; the person can undo it from the chat. Change only what they asked for, and say what you changed.',
    ];
    if (!fns.size)
      lines.push('No tools are on now: the person can turn them on in Settings ▸ Tools.');
    if (failed)
      lines.push(`${failed} tool source${failed === 1 ? '' : 's'} could not be reached this turn.`);
    if ([...fns.values()].some((f) => f.group === 'web'))
      lines.push(
        'Web: use web__fetch first for APIs and plain pages; the browser tools only for pages that need JavaScript or after a fetch fails.',
      );
    if (main) {
      const reach = this.above(main.tier);
      if (reach.length) {
        const own = policy === 'any' ? reach : policy === 'next' ? reach.slice(0, 1) : [];
        lines.push(
          `Tiers: you run on ${main.tier.label}. The escalate tool hands one task to a higher tier (${reach.map((t) => t.label).join(' or ')}) with the same tools; it works in its own section of the chat and returns a memo. It costs more than answering yourself.`,
          `Call it when the person names a tier or says "go deeper"${own.length ? `, and on your own (${own.map((t) => t.label).join(' or ')}) when the question needs judgement across many results (why "judgement"), after two of your tool calls failed (why "stuck"), or when a fix of a check still fails (why "check_failed")` : ''}. Lookups you answer yourself.`,
          'Its task must carry every fact from this chat it needs: it does not see the chat. Then answer from its memo in your own short words.',
        );
      }
      if (advisor)
        lines.push(
          `Advisor: the advisor tool (no input) asks ${advisor.session.tier.label} to read this chat and send you a plan; it runs no tools. Call it before a question that needs judgement or after a tool failed, then do the work yourself. At most ${ADVICE_MAX} times an answer. Ask the advisor before you escalate.`,
        );
    }
    return lines.join('\n\n');
  }

  /** The advisor for this answer, or null when off. Never weaker than the model it advises. */
  private async advisorFor(caller: Caller, setting: string | undefined, main: Session) {
    const tier = setting && setting !== 'off' ? this.tierById(setting) : undefined;
    if (!tier || main.model.provider !== 'anthropic') return null;
    const rank = (m: ModelDef) => this.models.indexOf(m);
    let session = await this.session(caller, tier);
    // Anthropic's advisor tool runs a Claude model: another provider's tier advises nothing.
    if (session.model.provider !== 'anthropic') session = { ...main };
    if (rank(session.model) < rank(main.model))
      session = { ...main, meter: new Meter(main.model, '') };
    session.meter = new Meter(session.model, `${session.tier.label} · advice`);
    return { session, asked: 0 };
  }

  private escalateTool(main: TierDef): Anthropic.Tool | null {
    const reach = this.above(main);
    if (!reach.length) return null;
    return {
      name: 'escalate',
      description:
        'Hands one task to a higher tier with the same tools. It works in its own section and returns a memo of at most 200 words.',
      input_schema: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: reach.map((t) => t.id) },
          why: { type: 'string', enum: [...HAND_OFF_WHYS] },
          task: {
            type: 'string',
            description: 'The task, with every fact from the chat it needs.',
          },
        },
        required: ['tier', 'why', 'task'],
      },
    };
  }

  /** What the model is asked: an app command's prompt, else the message as typed. */
  private async expand(caller: Caller, message: string) {
    const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(message);
    const c = m && this.o.commands?.find((x) => x.name === m[1]);
    if (!c) return message;
    const args = (m?.[2] ?? '').trim();
    return typeof c.prompt === 'function'
      ? c.prompt(args, caller)
      : c.prompt.replaceAll('{args}', args);
  }

  /** The tiers the person's message asks for by name ("go deeper" is the next one up). */
  private askedFor(message: string, main: TierDef) {
    const reach = this.above(main);
    const asked = new Set<string>();
    for (const t of reach)
      if (
        new RegExp(`\\b(${t.id}|${t.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i').test(
          message,
        )
      )
        asked.add(t.id);
    if (/\b(deeper|escalate)\b/i.test(message) && reach[0]) asked.add(reach[0].id);
    return asked;
  }

  private async handOff(
    use: Anthropic.ToolUseBlock,
    c: {
      caller: Caller;
      clients: Clients;
      message: string;
      handTo?: TierDef;
      page: string;
      policy: HandOffPolicy;
      main: Session;
      live: Meter[];
      sink: ChatItem[];
      emit: Emit;
      spent: () => ChatUsage;
      system: Anthropic.TextBlockParam[];
      tools: Map<string, Fn>;
      runs: Ran[];
      counts: { steps: number; handoffs: number; advice: number; end: TierDef };
      signal?: AbortSignal;
      over: () => string | null;
    },
  ): Promise<Anthropic.ToolResultBlockParam> {
    const reply = (content: string, is_error = false): Anthropic.ToolResultBlockParam => ({
      type: 'tool_result',
      tool_use_id: use.id,
      content,
      is_error,
    });
    const input = (use.input ?? {}) as { tier?: unknown; why?: unknown; task?: unknown };
    const reach = this.above(c.main.tier);
    const tier = reach.find((t) => t.id === input.tier);
    const why = HAND_OFF_WHYS.find((w) => w === input.why);
    const task = typeof input.task === 'string' ? input.task.trim() : '';
    if (!tier || !why || !task)
      return reply(
        `Give {tier: ${reach.map((t) => `"${t.id}"`).join(' | ')}, why: ${HAND_OFF_WHYS.map((w) => `"${w}"`).join(' | ')}, task}.`,
        true,
      );
    const asked = this.askedFor(c.message, c.main.tier);
    if (c.handTo) asked.add(c.handTo.id);
    const own = c.policy === 'any' ? reach : c.policy === 'next' ? reach.slice(0, 1) : [];
    const may = new Set([...own.map((t) => t.id), ...asked]);
    if (!may.has(tier.id))
      return reply(
        may.size
          ? `Not ${tier.id} now: you may call ${[...may].join(' or ')}.`
          : 'The person has not asked for a higher tier: answer yourself.',
        true,
      );
    if (c.over())
      return reply('No money left for a higher tier this answer: answer yourself.', true);
    const sub = await this.session(c.caller, tier);
    if (!c.clients[sub.model.provider])
      return reply(
        `${tier.label} runs on ${PROVIDERS[sub.model.provider].label} and no ${PROVIDERS[sub.model.provider].label} key is set for whoever pays this answer: answer yourself.`,
        true,
      );
    c.live.push(sub.meter);
    c.counts.handoffs += 1;
    if (this.tiers.indexOf(tier) > this.tiers.indexOf(c.counts.end)) c.counts.end = tier;
    const item: HandOffItem = {
      kind: 'handoff',
      tier: tier.id,
      label: sub.meter.label,
      task: task.replace(/\s+/g, ' ').slice(0, 200),
      why: asked.has(tier.id) ? 'asked' : why,
      items: [],
    };
    c.sink.push(item);
    c.emit('handoff', {
      kind: 'handoff',
      tier: item.tier,
      label: item.label,
      task: item.task,
      why: item.why,
    });
    const inside: Emit = (event, data) => c.emit(event, { ...(data as object), handoff: true });
    let memo = '';
    let failed: string | undefined;
    try {
      memo = await this.loop({
        clients: c.clients,
        session: sub,
        system: c.system,
        tools: this.toolsFor(c.tools),
        messages: [
          {
            role: 'user',
            content: `${c.page}The person asked: ${c.message}\n\n${this.name} handed you this task (${WHY_TEXT[item.why]}): ${task}\n\nWork it out with the tools, then end with a memo for ${this.name} of at most 200 words: the answer and the facts it rests on. ${this.name} answers the person.`,
          },
        ],
        sink: item.items,
        emit: inside,
        signal: c.signal,
        over: c.over,
        called: () => c.emit('usage', c.spent()),
        tool: (u) =>
          this.runTool(u, c.tools, item.items, inside, c.runs, c.counts, sub, true, c.signal),
      });
    } catch (err) {
      if (c.signal?.aborted) throw err;
      const shown = shownError(err);
      failed = shown.message;
      item.items.push({ kind: 'error', text: failed, code: shown.code });
      inside('error', shown);
    } finally {
      item.usage = sub.meter.part();
      c.emit('handoff_done', { usage: item.usage });
    }
    return failed
      ? reply(`${item.label} failed: ${failed}`, true)
      : reply(`Memo from ${item.label}:\n${memo.slice(0, MEMO_CHARS)}`);
  }

  /** One tool call: a draft card for a write, else the call itself, timed. */
  private async runTool(
    use: Anthropic.ToolUseBlock,
    fns: Map<string, Fn>,
    sink: ChatItem[],
    emit: Emit,
    runs: Ran[],
    counts: { steps: number; writes?: NonNullable<ChatDoc['writes']> },
    session: Session,
    handoff: boolean,
    signal?: AbortSignal,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const reply = (content: string, is_error = false): Anthropic.ToolResultBlockParam => ({
      type: 'tool_result',
      tool_use_id: use.id,
      content,
      is_error,
    });
    const f = fns.get(use.name);
    if (!f) return reply(`No tool ${use.name}.`, true);
    const title = f.def.title ?? f.def.name;
    if (f.draft) {
      const item: DraftItem = {
        kind: 'draft',
        id: newId('d'),
        tool: use.name,
        title,
        args: use.input,
        status: 'open',
      };
      sink.push(item);
      emit('draft', item);
      await Promise.resolve(
        this.o.onStep?.({ kind: 'draft', tool: use.name, tier: session.tier.id, handoff }),
      ).catch(() => undefined);
      return reply(
        `Drafted: a "${title}" card is on the person's screen. Nothing changed until they press Save.`,
      );
    }
    const id = newId('s');
    emit('step_start', { id, tool: use.name, title });
    const t0 = performance.now();
    let out: string;
    let ok = true;
    let error: string | undefined;
    let rows: number | undefined;
    try {
      const result = await untilStopped(
        withDeadline(title, 60_000, f.open.call(f.def.name, use.input)),
        signal,
      );
      if (f.write && counts.writes)
        counts.writes[id] = { group: f.group, tool: f.def.name, args: use.input, result };
      rows = rowCount(result);
      out = typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err) {
      if (signal?.aborted) throw err;
      ok = false;
      error =
        err instanceof ToolError || err instanceof Error ? err.message.slice(0, 300) : 'failed';
      out = error;
    }
    const ms = Math.round(performance.now() - t0);
    const item: StepItem = {
      kind: 'step',
      id,
      tool: use.name,
      title,
      ok,
      ms,
      ...(rows !== undefined ? { rows } : {}),
      ...(error ? { error } : {}),
      ...(f.write && ok
        ? { write: { undo: !!this.groupById(f.group)?.undo, status: 'done' as const } }
        : {}),
    };
    sink.push(item);
    emit('step', item);
    counts.steps += 1;
    runs.push({ tool: use.name, result: out.slice(0, RAN_CHARS) });
    await Promise.resolve(
      this.o.onStep?.({
        kind: 'tool',
        tool: use.name,
        ok,
        ms,
        ...(rows !== undefined ? { rows } : {}),
        ...(error ? { error } : {}),
        tier: session.tier.id,
        handoff,
      }),
    ).catch(() => undefined);
    const cut =
      out.length > RESULT_CHARS ? `${out.slice(0, RESULT_CHARS)} …(cut: ask for less)` : out;
    return reply(cut, !ok);
  }

  /** Model calls and tool rounds until the model answers; returns its words. */
  private loop(o: LoopArgs & { clients: Clients }): Promise<string> {
    const { provider } = o.session.model;
    const label = PROVIDERS[provider].label;
    if (provider === 'openai') {
      if (!o.clients.openai)
        throw new AssistantError(`No ${label} key is set for this answer.`, 'not_connected');
      return this.loopOpenAI({ ...o, client: o.clients.openai, plan: !!o.clients.openaiPlan });
    }
    if (!o.clients.anthropic)
      throw new AssistantError(`No ${label} key is set for this answer.`, 'not_connected');
    return this.loopClaude({ ...o, client: o.clients.anthropic });
  }

  /** The loop on OpenAI's Responses API: the same tools, Stop, caps and rounds as Claude's. */
  private async loopOpenAI(o: LoopArgs & { client: OpenAI; plan: boolean }): Promise<string> {
    const { client, session, tools, sink, emit, signal, plan } = o;
    const instructions = o.system.map((b) => b.text).join('\n\n');
    const fnTools: OpenAI.Responses.FunctionTool[] = tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description ?? null,
      parameters: t.input_schema as Record<string, unknown>,
      strict: false,
    }));
    // The chat so far is plain text turns; this answer's calls are appended as OpenAI items.
    const input: OpenAI.Responses.ResponseInputItem[] = o.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : m.content
              .map((b) => (b.type === 'text' ? b.text : ''))
              .filter(Boolean)
              .join('\n'),
    }));
    let answer = '';
    let force:
      | OpenAI.Responses.ToolChoiceOptions
      | OpenAI.Responses.ToolChoiceFunction
      | undefined = o.first?.type === 'tool' ? { type: 'function', name: o.first.name } : undefined;
    // A plan sign-in takes function tools only inside a namespace and no output cap.
    const sent = (only?: string) => {
      const fns = only ? fnTools.filter((t) => t.name === only) : fnTools;
      if (!plan) return { tools: fns, max_output_tokens: session.tier.out ?? DEFAULT_OUT };
      return {
        tools: [
          {
            type: 'namespace',
            name: 'app',
            description: `${this.name}'s tools`,
            tools: fns.map(({ strict: _, ...t }) => t),
          } as OpenAI.Responses.NamespaceTool,
        ],
      };
    };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      signal?.throwIfAborted();
      const effort = session.effort === 'default' ? undefined : session.effort;
      // On a plan a forced call is the one tool offered, with any call required.
      const only = plan && typeof force === 'object' ? force.name : undefined;
      const choice = only ? 'required' : force;
      // The raw event stream, not the SDK's accumulator: a plan sign-in's backend sends event types
      // the SDK does not know and its accumulator throws on them. The final response rides on the
      // completed, incomplete or failed event; every other event but text deltas is skipped.
      let partial = '';
      const res = await (async () => {
        const stream = await client.responses.create(
          {
            model: session.model.id,
            instructions,
            input,
            ...sent(only),
            store: false,
            stream: true,
            include: ['reasoning.encrypted_content'],
            ...(effort ? { reasoning: { effort } } : {}),
            ...(choice ? { tool_choice: choice } : {}),
          } as OpenAI.Responses.ResponseCreateParamsStreaming,
          signal ? { signal } : {},
        );
        let done: OpenAI.Responses.Response | undefined;
        for await (const e of stream as AsyncIterable<{ type: string } & Record<string, unknown>>) {
          if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') {
            partial += e.delta;
            emit('text', { delta: e.delta });
          } else if (
            e.type === 'response.completed' ||
            e.type === 'response.incomplete' ||
            e.type === 'response.failed'
          ) {
            done = e.response as OpenAI.Responses.Response;
          } else if (e.type === 'error') {
            throw new AssistantError('OpenAI could not finish the answer.', 'upstream');
          }
        }
        if (!done) throw new AssistantError('OpenAI ended the answer early.', 'upstream');
        return done;
      })().catch((err: unknown) => {
        if (signal?.aborted && partial) sink.push({ kind: 'text', text: partial });
        throw err;
      });
      if (res.status === 'failed') {
        if (partial) sink.push({ kind: 'text', text: partial });
        const code = res.error?.code ?? '';
        throw new AssistantError(
          /usage_limit/.test(code)
            ? 'Your ChatGPT plan reached its usage limit for now: try again later, or pick another model.'
            : 'OpenAI could not finish the answer.',
          'upstream',
        );
      }
      const u = res.usage;
      if (u) {
        const read = u.input_tokens_details?.cached_tokens ?? 0;
        const written = u.input_tokens_details?.cache_write_tokens ?? 0;
        session.meter.add(
          {
            input_tokens: Math.max(0, u.input_tokens - read - written),
            output_tokens: u.output_tokens,
            cache_read_input_tokens: read,
            cache_creation_input_tokens: written,
          },
          plan,
        );
        o.context?.(u.input_tokens + u.output_tokens);
      }
      o.called();
      const cut = res.incomplete_details?.reason === 'max_output_tokens' ? ' …(cut)' : '';
      if (cut) emit('text', { delta: cut });
      // Raw events carry no `output_text`: the words are the output messages' text parts.
      const words = (res.output as OpenAI.Responses.ResponseOutputItem[])
        .flatMap((b) => (b.type === 'message' ? b.content : []))
        .map((c) => (c.type === 'output_text' ? c.text : ''))
        .join('');
      const text = words + cut;
      if (text) {
        answer += (answer ? '\n\n' : '') + text;
        sink.push({ kind: 'text', text });
        emit('text_end', {});
      }
      // Reasoning, words and calls go back as they came, so the model keeps its own thread.
      input.push(...(res.output as OpenAI.Responses.ResponseInputItem[]));
      const calls = (res.output as OpenAI.Responses.ResponseOutputItem[]).filter(
        (b): b is OpenAI.Responses.ResponseFunctionToolCall => b.type === 'function_call',
      );
      if (calls.length === 0) break;
      const results = await Promise.all(
        calls.map((c) => {
          let args: unknown = {};
          try {
            args = c.arguments ? JSON.parse(c.arguments) : {};
          } catch {}
          const use: Anthropic.ToolUseBlock = {
            type: 'tool_use',
            id: c.call_id,
            name: c.name,
            input: args,
          } as Anthropic.ToolUseBlock;
          return untilStopped(o.tool(use), signal);
        }),
      );
      for (const r of results) {
        const body = typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '');
        input.push({
          type: 'function_call_output',
          call_id: r.tool_use_id,
          output: r.is_error ? `Error: ${body}` : body,
        });
      }
      force = undefined;
      const limit = o.over();
      const last = round === MAX_ROUNDS - 2;
      if (limit || last) {
        input.push({
          role: 'user',
          content: limit ?? 'No more tool calls: answer now from what you have.',
        });
        force = 'none';
      }
    }
    return answer;
  }

  /** The loop on Anthropic's Messages API, with the advisor and prompt caching. */
  private async loopClaude(o: LoopArgs & { client: Anthropic }): Promise<string> {
    const { client, session, system, tools, messages, sink, emit, signal } = o;
    let answer = '';
    let force: Anthropic.ToolChoice | undefined = o.first;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      signal?.throwIfAborted();
      // The system prompt and tools are one cached prefix; the chat so far a second breakpoint.
      const sent = messages.map((m, i) => (i === messages.length - 1 ? withCacheMark(m) : m));
      const params = {
        model: session.model.id,
        max_tokens: session.tier.out ?? DEFAULT_OUT,
        ...effortParams(session.effort),
        system,
        tools,
        messages: sent,
        ...(force ? { tool_choice: force } : {}),
      } as Anthropic.MessageCreateParams;
      const adv = o.advisor;
      // A forced tool choice may not come with the advisor; the beta header stays while it is on.
      const advise =
        adv && adv.asked < ADVICE_MAX && force?.type !== 'tool' && force?.type !== 'any';
      const stream = adv
        ? (client.beta.messages.stream(
            {
              ...params,
              tools: [
                ...tools,
                ...(advise
                  ? [
                      {
                        type: 'advisor_20260301',
                        name: 'advisor',
                        model: adv.session.model.id,
                        max_tokens: ADVICE_TOKENS,
                        caching: { type: 'ephemeral', ttl: '5m' },
                      },
                    ]
                  : []),
              ],
              betas: [ADVISOR_BETA],
            } as unknown as Parameters<typeof client.beta.messages.stream>[0],
            { signal },
          ) as unknown as MessageStream)
        : client.messages.stream(params as Anthropic.MessageStreamParams, signal ? { signal } : {});
      let partial = '';
      stream.on('text', (delta) => {
        partial += delta;
        emit('text', { delta });
      });
      if (adv)
        stream.on('streamEvent', (e) => {
          if (e.type !== 'content_block_start') return;
          const b = e.content_block as unknown as {
            type: string;
            name?: string;
            content?: { type: string; error_code?: string };
          };
          const label = adv.session.meter.label;
          if (b.type === 'server_tool_use' && b.name === 'advisor') {
            adv.asked += 1;
            emit('advice', { tier: adv.session.tier.id, label });
          } else if (b.type === 'advisor_tool_result') {
            const error =
              b.content?.type === 'advisor_tool_result_error'
                ? (b.content.error_code ?? 'error')
                : undefined;
            sink.push({
              kind: 'advice',
              tier: adv.session.tier.id,
              label,
              ...(error ? { error } : {}),
            });
            emit('advice_done', error ? { error } : {});
          }
        });
      const msg = await stream.finalMessage().catch((err: unknown) => {
        if (signal?.aborted && partial) sink.push({ kind: 'text', text: partial });
        throw err;
      });
      session.meter.add(msg.usage);
      if (adv)
        for (const it of (msg.usage as { iterations?: { type: string }[] }).iterations ?? [])
          if (it.type === 'advisor_message')
            adv.session.meter.add(it as unknown as Anthropic.Usage);
      o.context?.(
        msg.usage.input_tokens +
          (msg.usage.cache_read_input_tokens ?? 0) +
          (msg.usage.cache_creation_input_tokens ?? 0) +
          msg.usage.output_tokens,
      );
      o.called();
      const cut = msg.stop_reason === 'max_tokens' ? ' …(cut)' : '';
      if (cut) emit('text', { delta: cut });
      const text =
        msg.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('') + cut;
      if (text) {
        answer += (answer ? '\n\n' : '') + text;
        sink.push({ kind: 'text', text });
        emit('text_end', {});
      }
      messages.push({ role: 'assistant', content: msg.content });
      if ((msg.stop_reason as string) === 'pause_turn') continue;
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || uses.length === 0) break;
      const results: (Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam)[] =
        await Promise.all(uses.map((use) => untilStopped(o.tool(use), signal)));
      if (force === o.first) force = undefined;
      const limit = o.over();
      if (limit) {
        results.push({ type: 'text', text: limit });
        force = { type: 'none' };
      } else if (round === MAX_ROUNDS - 2) {
        results.push({ type: 'text', text: 'No more tool calls: answer now from what you have.' });
        force = { type: 'none' };
      }
      messages.push({ role: 'user', content: results });
    }
    return answer;
  }

  /** Swaps the history for a short summary. False with nothing to compact. */
  private async compact(clients: Clients, s: Session, doc: ChatDoc, emit: Emit) {
    if (doc.history.length < 2) return false;
    const system = `Summarise this chat between a person and ${this.name}, their assistant, so ${this.name} can carry on from the summary alone. Keep what the person wants, the facts and numbers found, decisions made and cards drafted or saved, and anything still open. Plain bullets, at most 400 words. No preamble.`;
    const chat = doc.history
      .map((t) => `${t.role === 'user' ? 'Person' : this.name}: ${t.content}`)
      .join('\n\n');
    let summary = '';
    if (s.model.provider === 'openai' && clients.openai) {
      const res = await clients.openai.responses.create({
        model: s.model.id,
        instructions: system,
        input: chat,
        store: false,
        max_output_tokens: 1500,
      });
      const u = res.usage;
      if (u)
        s.meter.add({
          input_tokens: u.input_tokens - (u.input_tokens_details?.cached_tokens ?? 0),
          output_tokens: u.output_tokens,
          cache_read_input_tokens: u.input_tokens_details?.cached_tokens ?? 0,
        });
      summary = res.output_text ?? '';
    } else if (clients.anthropic) {
      const msg = await clients.anthropic.messages.create({
        model: s.model.id,
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: chat }],
      });
      s.meter.add(msg.usage);
      summary = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    } else return false;
    doc.history = [
      { role: 'user', content: `Summary of our chat so far (compacted):\n${summary}` },
      { role: 'assistant', content: 'Noted. I carry on from this summary.' },
    ];
    doc.items.push({ kind: 'compacted' });
    emit('compacted', {});
    return true;
  }

  /** How the person's cards ended since the last answer, once each. */
  private cardNews(doc: ChatDoc) {
    const told = new Set(doc.told ?? []);
    const news = draftsOf(doc.items).filter((d) => d.status !== 'open' && !told.has(d.id));
    const undone = stepsOf(doc.items).filter(
      (x) => x.write?.status === 'undone' && !told.has(x.id),
    );
    if (!news.length && !undone.length) return '';
    doc.told = [...told, ...news.map((d) => d.id), ...undone.map((x) => x.id)];
    const back = undone.length
      ? `The person undid these changes you made: ${undone.map((x) => `${x.title} ${JSON.stringify(doc.writes?.[x.id]?.args ?? {}).slice(0, 300)}`).join('; ')}. Do not make them again unless asked.\n\n`
      : '';
    if (!news.length) return back;
    return `${back}Cards since your last answer:\n${news
      .map(
        (d) =>
          `- ${d.title} ${JSON.stringify(d.args).slice(0, 300)}: ${d.status}${d.error ? ` (${d.error})` : ''}${d.result !== undefined ? ` → ${JSON.stringify(d.result).slice(0, 300)}` : ''}`,
      )
      .join('\n')}\n\n`;
  }

  /** The answer as later turns remember it: with what its tools returned, cut. */
  private remember(answer: string, runs: Ran[]) {
    if (!runs.length) return answer;
    let left = RAN_TOTAL;
    const lines: string[] = [];
    for (const r of runs) {
      if (left <= 0) break;
      const line = `- ${r.tool} → ${r.result.slice(0, Math.min(RAN_CHARS, left))}`;
      left -= line.length;
      lines.push(line);
    }
    return `${answer}\n\n[Tools I used and what they returned]\n${lines.join('\n')}`;
  }

  // ---------------------------------------------------------------- keys

  /** Starts a person's ChatGPT plan sign-in: the address to open in a new tab. */
  async startSignin(caller: Caller, provider: AssistantProvider) {
    if (PROVIDERS[provider].signin !== 'chatgpt')
      throw new AssistantError(`${PROVIDERS[provider].label} has no sign-in.`, 'no_signin', 404);
    const name = `signin:${provider}`;
    const { url, reg } = await startChatgpt(
      await this.state.docs.read<ChatgptRegistration>(caller.id, name),
      this.name,
    );
    await this.state.docs.write(caller.id, name, reg);
    return { url, redirect: CHATGPT_REDIRECT };
  }

  /** Finishes it from the address it ended on; the plan then stands in for the person's own key. */
  async finishSignin(caller: Caller, provider: AssistantProvider, pasted: string) {
    const name = `signin:${provider}`;
    try {
      const { tokens, reg } = await finishChatgpt(
        await this.state.docs.read<ChatgptRegistration>(caller.id, name),
        pasted,
        this.o.fetch ?? fetch,
      );
      await this.state.docs.write(caller.id, name, reg);
      const test = await testChatgpt(tokens, this.o.fetch ?? fetch);
      await this.state.docs.write<KeyDoc>(caller.id, keyDocName(provider), {
        api_key: tokens.access_token,
        saved_at: Date.now(),
        test,
        chatgpt: tokens,
      });
    } catch (err) {
      if (err instanceof SigninError) throw new AssistantError(err.message, 'signin_failed');
      throw err;
    }
  }

  /** Tests a person's own key, refreshing a plan sign-in first. */
  async testOwn(caller: Caller, provider: AssistantProvider) {
    const d = await this.state.ownKey(caller.id, provider);
    if (!d) return null;
    if (!d.chatgpt) return this.testKey(provider, d.api_key);
    const fresh = await this.state.ownApiKey(caller.id, provider);
    const now = await this.state.ownKey(caller.id, provider);
    if (!fresh || !now?.chatgpt)
      return now?.test ?? { ok: false, detail: 'Sign in again.', at: Date.now() };
    return testChatgpt(now.chatgpt, this.o.fetch ?? fetch);
  }

  /** One free call (reading a model) that says whether the provider takes the key. */
  async testKey(
    provider: AssistantProvider,
    apiKey: string,
  ): Promise<{ ok: boolean; detail: string; at: number }> {
    const at = Date.now();
    const model = this.models.find((m) => m.provider === provider);
    const label = PROVIDERS[provider].label;
    if (!model) return { ok: false, detail: `This app runs no ${label} models.`, at };
    try {
      if (provider === 'openai') await this.openai(apiKey).models.retrieve(model.id);
      else await this.anthropic(apiKey).models.retrieve(model.id);
      return { ok: true, detail: `${label} took the key.`, at };
    } catch (err) {
      return { ok: false, detail: shownError(err).message, at };
    }
  }

  /** Lists ScrapeQL's tools with the token: works or why not. */
  async testScrapeql(token: AccessToken): Promise<{ ok: boolean; detail: string; at: number }> {
    const at = Date.now();
    const url = this.o.web?.scrapeql?.url;
    if (!url) return { ok: false, detail: 'ScrapeQL is not set up in this app.', at };
    try {
      const open = await scrapeqlTools(url, token, this.o.fetch)();
      const n = open.tools.length;
      await open.close();
      return { ok: true, detail: `ScrapeQL answered with ${n} tool${n === 1 ? '' : 's'}.`, at };
    } catch {
      return { ok: false, detail: 'ScrapeQL refused the token or could not be reached.', at };
    }
  }

  // ---------------------------------------------------------------- drafts

  /** Saves (runs, as the person) or dismisses a drafted card. Access is checked again first. */
  async settleDraft(caller: Caller, chatId: string, draftId: string, action: 'save' | 'dismiss') {
    const doc = await this.state.docs.read<ChatDoc>(caller.id, `chat:${chatId}`);
    if (!doc) throw new AssistantError('That chat is gone.', 'not_found', 404);
    const d = draftsOf(doc.items).find((x) => x.id === draftId);
    if (!d) throw new AssistantError('That card is gone.', 'not_found', 404);
    if (d.status !== 'open')
      throw new AssistantError(`That card is already ${d.status}.`, 'settled', 409);
    if (action === 'dismiss') d.status = 'dismissed';
    else {
      const p = await this.state.person(caller.id);
      const tools = await this.openTools(caller, p);
      try {
        const f = tools.fns.get(d.tool);
        if (!f || f.def.read) {
          d.status = 'failed';
          d.error = 'Its tools are no longer on Read + draft or Read + write in Settings ▸ Tools.';
        } else {
          try {
            d.result = await withDeadline(d.title, 60_000, f.open.call(f.def.name, d.args));
            d.status = 'saved';
          } catch (err) {
            d.status = 'failed';
            d.error = err instanceof Error ? err.message.slice(0, 300) : 'failed';
          }
        }
      } finally {
        await tools.close();
      }
    }
    await this.writeChat(caller, chatId, doc);
    return d;
  }

  /** Takes back one change a write made at once, through its group's `undo`. */
  async undoWrite(caller: Caller, chatId: string, stepId: string) {
    const doc = await this.state.docs.read<ChatDoc>(caller.id, `chat:${chatId}`);
    if (!doc) throw new AssistantError('That chat is gone.', 'not_found', 404);
    const step = stepsOf(doc.items).find((x) => x.id === stepId);
    const w = doc.writes?.[stepId];
    if (!step?.write || !w) throw new AssistantError('That change is gone.', 'not_found', 404);
    if (step.write.status === 'undone')
      throw new AssistantError('That change is already undone.', 'settled', 409);
    const g = this.groupById(w.group);
    if (!g?.undo) throw new AssistantError('That change cannot be undone here.', 'no_undo', 400);
    try {
      await withDeadline(`Undo ${step.title}`, 60_000, g.undo(caller, w));
      step.write = { ...step.write, status: 'undone' };
    } catch (err) {
      throw new AssistantError(
        err instanceof Error ? err.message.slice(0, 300) : 'Undo failed.',
        'undo_failed',
        502,
      );
    }
    await this.writeChat(caller, chatId, doc);
    return step;
  }
}

export function createAssistant(o: AssistantOptions) {
  return new Assistant(o);
}
