/**
 * The assistant's settings, keys and spend, as stored documents.
 *
 *   app      (the app's scope)   the cap per person on the app's keys
 *   key      (the app's scope)   the app's Anthropic key, tested before it is kept, sealed
 *   key:<p>  (the app's scope)   the app's key of another provider (`key:openai`), the same
 *   scrapeql (the app's scope)   ScrapeQL's Access service token, tested before it is kept, sealed
 *   settings (a person's scope)  their tiers, start tiers, hand off, advice, tool access, web, payer,
 *                                and the monthly cap on their own keys
 *   key, key:<p> (a person's)    their own key of each provider, sealed; OpenAI's may be a ChatGPT
 *                                plan sign-in, refreshed before it runs out
 *   signin:<p>   (a person's)    the app's sign-in registration for them, kept across sign-outs
 *   spend:YYYY-MM                what each tier cost them this month, by payer
 *   allowance    (a person's)    grants of more allowance, their newest request, and (when it is
 *                                once for good) what they spent on the app's keys in all
 *   allowance_requests (the app's)  every request, newest first, for approvers
 *
 * Who pays: the person's pick (the app's keys by default) while it has a key for the provider the
 * tier runs on and money left this month, else the other; with neither the assistant waits and says
 * why. A cap covers every provider of its payer.
 */
import type {
  AllowanceRequest,
  AssistantAccess,
  AssistantEffort,
  AssistantOwnWay,
  AssistantPayer,
  AssistantProvider,
  AssistantScreenSetting,
  AssistantWait,
  HandOffPolicy,
  KeyState,
  UsageEntry,
  UsageHistory,
  UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { type ChatgptTokens, refreshChatgpt, staleChatgpt } from './chatgpt';
import { ALL_MODELS, PROVIDERS, XAI_MODELS, keyHint } from './models';
import { APP_SCOPE, type Docs } from './store';

export interface KeyTest {
  at: number;
  ok: boolean;
  detail: string;
}

export interface KeyDoc {
  api_key: string;
  saved_at: number;
  test: KeyTest | null;
  /** USD a month: a person's own Anthropic key before the cap moved to their settings. */
  cap_usd?: number;
  /** A ChatGPT plan sign-in in place of an API key (`api_key` is then its access token). */
  chatgpt?: ChatgptTokens;
}

/** Where a provider's key is kept: `key` for Anthropic, `key:<provider>` for the rest. */
export const keyDocName = (provider: AssistantProvider) =>
  provider === 'anthropic' ? 'key' : `key:${provider}`;

/** Where a person's plan sign-in is kept, beside their key (before 2026-10-27 it replaced the key). */
export const planDocName = (provider: AssistantProvider) => `plan:${provider}`;

export interface TokenDoc {
  client_id: string;
  client_secret: string;
  saved_at: number;
  test: KeyTest | null;
}

export interface AppDoc {
  /** USD each person may spend a month on the app's key. */
  cap_usd?: number;
}

export interface PersonDoc {
  tier?: string;
  tiers?: Record<string, { model: string; effort: AssistantEffort }>;
  tasks?: Record<string, string>;
  hand_off?: HandOffPolicy;
  advice?: string;
  /** Whether the assistant may move the screen; Move when unset. */
  screen?: AssistantScreenSetting;
  access?: Record<string, AssistantAccess>;
  web?: boolean;
  pay?: AssistantPayer;
  /** USD a month on their own keys. */
  own_cap?: number;
  /** Which of their own runs on a provider when both a key and a plan are set. */
  own_use?: Partial<Record<AssistantProvider, AssistantOwnWay>>;
}

/** How the app counts allowance on its shared keys (`createAssistant` `allowance`). */
export interface AllowanceConfig {
  /** USD one unit buys. */
  usd: number;
  /** `month`: the cap resets each month, grants count in their month; `once`: one balance for good. */
  period: 'month' | 'once';
  /** Units each person starts with (once); a month's cap is the admin's cap in Settings. */
  starter: number;
  /** Units a month for one person (their plan, an override); nothing falls back to the admin's cap. */
  cap?: (id: string) => number | null | undefined | Promise<number | null | undefined>;
}

export interface AllowanceDoc {
  grants: { at: number; amount: number; by: string; request?: string }[];
  /** USD spent on the app's keys in all (counted only when the allowance is once for good). */
  spent_usd?: number;
  request?: AllowanceRequest;
}

export interface RequestsDoc {
  rows: AllowanceRequest[];
}

/** Requests kept for approvers: the newest this many. */
const REQUESTS_KEPT = 300;

/** `free`: run on the app's key for a job the app does not count against the person's allowance
 *  (`AssistantOptions.credits`). Kept apart so the admin still sees what it cost. */
export type SpendRow = UsagePart & {
  payer: AssistantPayer;
  free?: true;
  /** Of an own row: paid by the person's API key or their plan sign-in (a plan costs them $0). */
  way?: AssistantOwnWay;
};

const KNOWN_MODELS = [...ALL_MODELS, ...XAI_MODELS];

/** The provider a part ran on: by its model id, else by the model's name at the end of its label. */
export function providerOfPart(p: UsagePart): AssistantProvider | undefined {
  const m =
    KNOWN_MODELS.find((x) => x.id === p.model) ??
    KNOWN_MODELS.find((x) => p.label === x.label || p.label.endsWith(` · ${x.label}`));
  return m?.provider;
}

/** Spend rows with the provider each ran on, so a page can tell a removed key's spend apart. */
export function withProvider<R extends UsagePart>(rows: R[]) {
  return rows.map((r) => {
    const provider = providerOfPart(r);
    return provider ? { ...r, provider } : r;
  });
}

/** USD of `parts` the person's own API keys paid: a provider signed in with a plan costs $0. */
export function ownKeyUsd(
  paying: { payer: AssistantPayer; plans: Paying['plans'] },
  parts: UsagePart[],
) {
  if (paying.payer !== 'own') return 0;
  return parts
    .filter((p) => {
      const prov = providerOfPart(p);
      return !(prov && paying.plans[prov]);
    })
    .reduce((a, p) => a + p.usd, 0);
}

/** Calls in `parts` a plan sign-in of the person's answered (their own payer, a plan provider). */
export function ownPlanCalls(
  paying: { payer: AssistantPayer; plans: Paying['plans'] },
  parts: UsagePart[],
) {
  if (paying.payer !== 'own') return 0;
  return parts
    .filter((p) => {
      const prov = providerOfPart(p);
      return !!(prov && paying.plans[prov]);
    })
    .reduce((a, p) => a + p.calls, 0);
}

/**
 * What counts toward the person's own cap: own rows paid by an API key (a plan sign-in costs
 * nothing per call), on a provider they can still pay with. A row from before ways were recorded
 * counts unless its provider has no own way left (an old key since removed).
 */
export function ownCapUsed(rows: SpendRow[], usable: Partial<Record<AssistantProvider, unknown>>) {
  return rows
    .filter((r) => r.payer === 'own' && !r.free && r.way !== 'plan')
    .filter((r) => {
      const prov = providerOfPart(r);
      return !prov || !!usable[prov];
    })
    .reduce((a, r) => a + r.usd, 0);
}

/** The ways of their own a person may pay with, per provider; a provider left out has none. */
export type OwnWays = Partial<Record<AssistantProvider, AssistantOwnWay[]>>;

/** How `paying` may choose: the app's limits on a person's own keys, and one payer only. */
export interface PayingRules {
  /** The own ways this person may use (`AssistantOptions.ownWays`); left out, every way. */
  ways?: OwnWays;
  /** False: a person who pays with their own key first never moves to the shared key. */
  fallback?: boolean;
  /** Only this payer: an app's own check always runs on the shared key (`complete({ payer })`). */
  only?: AssistantPayer;
  /** The app's key, not counted against the person's allowance and never stopped by it. */
  free?: boolean;
}
/**
 * One task's use of one model this month: what a kind of work cost (a chat answer, a background
 * task), beside `rows`, which stay per tier and payer.
 */
export interface TaskSpend {
  /** The task's id (`chat`, or a `complete` call's `tag` or `task`). */
  task: string;
  /** The model's id. */
  model: string;
  /** Answers: chat turns, or `complete` calls. */
  runs: number;
  /** Model calls. */
  calls: number;
  in: number;
  read: number;
  out: number;
  usd: number;
  /** Time the answers took in all, in ms (`ms / runs` is the average). */
  ms: number;
}
export interface SpendDoc {
  rows: SpendRow[];
  /** Per task and model, counted since the kit began tagging (older spend is only in `rows`). */
  tasks?: TaskSpend[];
}

/** Chats and runs kept in one month's usage history: the newest this many. */
export const USAGE_KEPT = 300;
/** Months of usage history offered (`usage:YYYY-MM` documents are listed this far back). */
const USAGE_MONTHS = 24;

export interface UsageDoc {
  entries: UsageEntry[];
}

/** Adds `more` to `parts`, merged by label (the model kept from the first). */
export function mergeParts(parts: UsagePart[], more: UsagePart[]) {
  const out = parts.map((p) => ({ ...p }));
  for (const p of more) {
    if (!p.calls) continue;
    const prev = out.find((r) => r.label === p.label);
    if (!prev) out.push({ ...p });
    else {
      prev.calls += p.calls;
      prev.in += p.in;
      prev.read += p.read;
      prev.out += p.out;
      prev.usd += p.usd;
      if (p.runs) prev.runs = (prev.runs ?? 0) + p.runs;
      if (!prev.model && p.model) prev.model = p.model;
    }
  }
  return out;
}

/** USD a month when nobody set a cap. */
export const DEFAULT_CAP = 10;

/** `2026-10` in the app's time zone. */
export function monthIn(timeZone: string, at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(at)
    .slice(0, 7);
}

export function keyState(d: KeyDoc | TokenDoc | null, secret: (d: KeyDoc | TokenDoc) => string) {
  if (!d) return { set: false } satisfies KeyState;
  const plan = 'chatgpt' in d ? d.chatgpt : undefined;
  return {
    set: true,
    hint: plan ? (plan.email ?? 'ChatGPT plan') : keyHint(secret(d)),
    ...(plan ? { via: 'chatgpt' as const } : {}),
    saved_at: d.saved_at,
    ...(d.test ? { test: d.test } : {}),
  } satisfies KeyState;
}

export interface Paying {
  payer: AssistantPayer;
  /** The key of the provider asked for. */
  apiKey: string;
  /** The payer's key of every provider it has one for (a hand-off may run on another). */
  keys: Partial<Record<AssistantProvider, string>>;
  /** Providers whose key is a plan sign-in: their use costs the payer nothing. */
  plans: Partial<Record<AssistantProvider, boolean>>;
  /** USD left this month under the payer's cap. */
  left: number;
  cap: number;
}

export class State {
  constructor(
    readonly docs: Docs,
    private readonly o: {
      timeZone: string;
      defaultCap: number;
      appKey?: (provider: AssistantProvider) => Promise<string | null | undefined>;
      fetch?: typeof fetch;
      allowance?: AllowanceConfig;
    },
  ) {}

  /** The same state over other documents (a request's `Docs.cached`). */
  withDocs(docs: Docs) {
    return new State(docs, this.o);
  }

  get allowanceConfig() {
    return this.o.allowance;
  }

  allowance(id: string) {
    return this.docs.read<AllowanceDoc>(id, 'allowance').then((d) => d ?? { grants: [] });
  }
  setAllowance(id: string, change: (d: AllowanceDoc) => AllowanceDoc) {
    return this.docs.update<AllowanceDoc>(id, 'allowance', (d) => change(d ?? { grants: [] }));
  }
  requests() {
    return this.docs
      .read<RequestsDoc>(APP_SCOPE, 'allowance_requests')
      .then((d) => d ?? { rows: [] });
  }
  /** Adds or replaces one request in the approvers' list. */
  putRequest(r: AllowanceRequest) {
    return this.docs.update<RequestsDoc>(APP_SCOPE, 'allowance_requests', (d) => ({
      rows: [r, ...(d?.rows ?? []).filter((x) => x.id !== r.id)].slice(0, REQUESTS_KEPT),
    }));
  }

  /**
   * USD the person has on the app's keys for the period and USD used: the admin's monthly cap plus
   * this month's grants, or (once for good) the starter and every grant against all spend.
   */
  async appBudget(id: string, spentThisMonth?: number): Promise<{ total: number; used: number }> {
    const al = this.o.allowance;
    const used =
      spentThisMonth ??
      (await this.spend(id)).rows
        .filter((r) => r.payer === 'app' && !r.free)
        .reduce((a, r) => a + r.usd, 0);
    if (!al) return { total: await this.appCap(), used };
    const d = await this.allowance(id);
    if (al.period === 'once') {
      const units = al.starter + d.grants.reduce((a, g) => a + g.amount, 0);
      return { total: units * al.usd, used: d.spent_usd ?? 0 };
    }
    const month = this.month();
    const granted = d.grants
      .filter((g) => monthIn(this.o.timeZone, new Date(g.at)) === month)
      .reduce((a, g) => a + g.amount, 0);
    return { total: (await this.capFor(id)) + granted * al.usd, used };
  }

  /** USD a month this person may spend on the app's keys: their own cap when the app names one,
   *  else the admin's. A cap that cannot be read falls back too, so an answer never waits on it. */
  async capFor(id: string) {
    const al = this.o.allowance;
    const own = al?.cap ? await Promise.resolve(al.cap(id)).catch(() => null) : null;
    return typeof own === 'number' && own >= 0 ? own * al!.usd : this.appCap();
  }

  /** USD a month when nobody set a cap. */
  get defaultCap() {
    return this.o.defaultCap;
  }

  month() {
    return monthIn(this.o.timeZone);
  }

  person(id: string) {
    return this.docs.read<PersonDoc>(id, 'settings').then((d) => d ?? {});
  }
  setPerson(id: string, change: (d: PersonDoc) => PersonDoc) {
    return this.docs.update<PersonDoc>(id, 'settings', (d) => change(d ?? {}));
  }

  app() {
    return this.docs.read<AppDoc>(APP_SCOPE, 'app').then((d) => d ?? {});
  }
  setApp(change: (d: AppDoc) => AppDoc) {
    return this.docs.update<AppDoc>(APP_SCOPE, 'app', (d) => change(d ?? {}));
  }

  appKey(provider: AssistantProvider) {
    return this.docs.read<KeyDoc>(APP_SCOPE, keyDocName(provider));
  }
  /** The app's key: the stored one, else the app's fallback (a Worker secret). */
  async appApiKey(provider: AssistantProvider): Promise<{ key: string; fromEnv: boolean } | null> {
    const d = await this.appKey(provider);
    if (d) return { key: d.api_key, fromEnv: false };
    const env = await this.o.appKey?.(provider);
    return env ? { key: env, fromEnv: true } : null;
  }
  /** The person's own API key (a key doc that holds a plan sign-in is their plan). */
  async ownKey(id: string, provider: AssistantProvider) {
    const d = await this.docs.read<KeyDoc>(id, keyDocName(provider));
    return d && !d.chatgpt ? d : null;
  }
  /** The person's plan sign-in and the doc it is kept in (the key's, for a sign-in from before). */
  async ownPlan(id: string, provider: AssistantProvider) {
    for (const name of [planDocName(provider), keyDocName(provider)]) {
      const doc = await this.docs.read<KeyDoc>(id, name);
      if (doc?.chatgpt) return { doc: doc as KeyDoc & { chatgpt: ChatgptTokens }, name };
    }
    return null;
  }
  /** Which of their own runs: the one they picked while it is set, else the plan, else the key. */
  async ownUse(id: string, provider: AssistantProvider): Promise<AssistantOwnWay | null> {
    const [p, key, plan] = await Promise.all([
      this.person(id),
      this.ownKey(id, provider),
      this.ownPlan(id, provider),
    ]);
    const use = p.own_use?.[provider];
    if (use === 'key' && key) return 'key';
    if (use === 'plan' && plan) return 'plan';
    return plan ? 'plan' : key ? 'key' : null;
  }
  /** The plan's access token, refreshed first when it is about to run out; null once it fails. */
  async planToken(id: string, provider: AssistantProvider) {
    const found = await this.ownPlan(id, provider);
    if (!found) return null;
    const { doc: d, name } = found;
    if (!staleChatgpt(d.chatgpt)) return d.chatgpt.access_token;
    try {
      const t = await refreshChatgpt(d.chatgpt, this.o.fetch ?? fetch);
      await this.docs.write<KeyDoc>(id, name, { ...d, api_key: t.access_token, chatgpt: t });
      return t.access_token;
    } catch (err) {
      await this.docs.write<KeyDoc>(id, name, {
        ...d,
        test: { at: Date.now(), ok: false, detail: (err as Error).message },
      });
      return null;
    }
  }
  /** The person's own key or plan, the one in use first, the other when that one fails. */
  async ownApiKey(id: string, provider: AssistantProvider, ways?: OwnWays) {
    const allowed = ways ? (ways[provider] ?? []) : null;
    if (allowed && !allowed.length) return null;
    const use = await this.ownUse(id, provider);
    if (!use) return null;
    const key = async () => {
      const d = await this.ownKey(id, provider);
      return d ? { key: d.api_key, plan: false } : null;
    };
    const plan = async () => {
      const t = await this.planToken(id, provider);
      return t ? { key: t, plan: true } : null;
    };
    const may = (w: AssistantOwnWay) => !allowed || allowed.includes(w);
    const tryKey = async () => (may('key') ? key() : null);
    const tryPlan = async () => (may('plan') ? plan() : null);
    return use === 'key'
      ? ((await tryKey()) ?? (await tryPlan()))
      : ((await tryPlan()) ?? (await tryKey()));
  }
  /** USD a month on the person's own keys. */
  async ownCap(id: string) {
    const p = await this.person(id);
    if (p.own_cap !== undefined) return p.own_cap;
    return (await this.ownKey(id, 'anthropic'))?.cap_usd ?? this.o.defaultCap;
  }
  scrapeql() {
    return this.docs.read<TokenDoc>(APP_SCOPE, 'scrapeql');
  }
  /** The last test of ScrapeQL over the app's service binding (no token to keep it beside). */
  scrapeqlLink() {
    return this.docs.read<{ test: KeyTest }>(APP_SCOPE, 'scrapeql:link');
  }

  async appCap() {
    return (await this.app()).cap_usd ?? this.o.defaultCap;
  }

  spend(id: string, month = this.month()) {
    return this.docs.read<SpendDoc>(id, `spend:${month}`).then((d) => d ?? { rows: [] });
  }

  /**
   * Adds an answer's use to this month's spend, by label and payer. `at` names the task the answer
   * was for and how long it took, so the month also adds up per task and model (`tasks`).
   */
  async addSpend(
    id: string,
    payer: AssistantPayer,
    parts: UsagePart[],
    at?: { task: string; ms?: number },
    free = false,
    plans?: Partial<Record<AssistantProvider, boolean>>,
  ) {
    if (!parts.some((p) => p.calls)) return;
    // Which own way paid each part: a plan sign-in or a key, by the part's provider.
    const wayOf = (p: UsagePart): AssistantOwnWay | undefined => {
      if (payer !== 'own' || !plans) return undefined;
      const prov = providerOfPart(p);
      return prov && plans[prov] ? 'plan' : 'key';
    };
    await this.docs.update<SpendDoc>(id, `spend:${this.month()}`, (d) => {
      const rows = [...(d?.rows ?? [])];
      const tasks = [...(d?.tasks ?? [])];
      if (at) {
        // The answer and its time count once, on its first model.
        let first = true;
        for (const p of parts) {
          if (!p.calls) continue;
          const model = p.model ?? p.label;
          const i = tasks.findIndex((t) => t.task === at.task && t.model === model);
          const prev = i >= 0 ? tasks[i] : undefined;
          const row: TaskSpend = {
            task: at.task,
            model,
            runs: (prev?.runs ?? 0) + (first ? 1 : 0),
            calls: (prev?.calls ?? 0) + p.calls,
            in: (prev?.in ?? 0) + p.in,
            read: (prev?.read ?? 0) + p.read,
            out: (prev?.out ?? 0) + p.out,
            usd: (prev?.usd ?? 0) + p.usd,
            ms: (prev?.ms ?? 0) + (first ? (at.ms ?? 0) : 0),
          };
          first = false;
          if (i >= 0) tasks[i] = row;
          else tasks.push(row);
        }
      }
      for (const p of parts) {
        if (!p.calls) continue;
        const way = wayOf(p);
        const i = rows.findIndex(
          (r) => r.label === p.label && r.payer === payer && !!r.free === free && r.way === way,
        );
        const prev = i >= 0 ? rows[i] : undefined;
        const row: SpendRow = prev
          ? {
              ...prev,
              calls: prev.calls + p.calls,
              in: prev.in + p.in,
              read: prev.read + p.read,
              out: prev.out + p.out,
              usd: prev.usd + p.usd,
            }
          : { ...p, payer, ...(free ? { free: true as const } : {}), ...(way ? { way } : {}) };
        if (i >= 0) rows[i] = row;
        else rows.push(row);
      }
      return tasks.length ? { rows, tasks } : { rows };
    });
    if (payer === 'app' && !free && this.o.allowance?.period === 'once') {
      const usd = parts.reduce((a, p) => a + p.usd, 0);
      if (usd > 0)
        await this.setAllowance(id, (d) => ({ ...d, spent_usd: (d.spent_usd ?? 0) + usd }));
    }
  }

  /**
   * Adds one answer's use to a chat or run in this month's history (`usage:YYYY-MM`): one entry a
   * chat or run, its parts merged, the newest `USAGE_KEPT` kept. `title` names a new entry only;
   * `own_usd` is what of this answer the person's own key or plan paid, added to the entry's;
   * `own_plan_calls` the calls their plan sign-in answered (free to them, so counted, not priced).
   */
  async addUsage(
    id: string,
    e: {
      id: string;
      kind: UsageEntry['kind'];
      task?: string;
      title: string;
      own_usd?: number;
      own_plan_calls?: number;
    },
    parts: UsagePart[],
  ) {
    if (!parts.some((p) => p.calls)) return;
    const now = Date.now();
    await this.docs.update<UsageDoc>(id, `usage:${this.month()}`, (d) => {
      const entries = [...(d?.entries ?? [])];
      const i = entries.findIndex((x) => x.id === e.id);
      const prev = i >= 0 ? entries.splice(i, 1)[0] : undefined;
      const merged = mergeParts(prev?.parts ?? [], parts);
      const sum = (k: 'calls' | 'in' | 'read' | 'out' | 'usd') =>
        merged.reduce((a, p) => a + p[k], 0);
      const own = (prev?.own_usd ?? 0) + (e.own_usd ?? 0);
      const plan = (prev?.own_plan_calls ?? 0) + (e.own_plan_calls ?? 0);
      entries.unshift({
        id: e.id,
        kind: e.kind,
        ...(e.task ? { task: e.task } : {}),
        title: prev?.title || e.title.slice(0, 120),
        first: prev?.first ?? now,
        at: now,
        calls: sum('calls'),
        in: sum('in'),
        read: sum('read'),
        out: sum('out'),
        usd: sum('usd'),
        ...(own > 0 ? { own_usd: own } : {}),
        ...(plan > 0 ? { own_plan_calls: plan } : {}),
        parts: merged,
      });
      return { entries: entries.slice(0, USAGE_KEPT) };
    });
  }

  /** One month's history (this month by default) beside its spend, and the months that have one. */
  async usage(id: string, month = this.month()): Promise<UsageHistory> {
    const [doc, spend, listed] = await Promise.all([
      this.docs.read<UsageDoc>(id, `usage:${month}`),
      this.spend(id, month),
      this.docs.list(id, 'usage:', USAGE_MONTHS),
    ]);
    const months = [...new Set([this.month(), ...listed.map((r) => r.key.slice(6))])].sort((a, b) =>
      b.localeCompare(a),
    );
    return {
      month,
      months,
      usd: spend.rows.reduce((a, r) => a + r.usd, 0),
      rows: withProvider(spend.rows),
      entries: doc?.entries ?? [],
    };
  }

  /** The payer's key of each provider, those set, and which are plan sign-ins. */
  async keysOf(id: string, payer: AssistantPayer, ways?: OwnWays) {
    const ids = Object.keys(PROVIDERS) as AssistantProvider[];
    const found = await Promise.all(
      ids.map((p) =>
        payer === 'app'
          ? this.appApiKey(p).then((k) => (k ? { key: k.key, plan: false } : null))
          : this.ownApiKey(id, p, ways),
      ),
    );
    const keys: Partial<Record<AssistantProvider, string>> = {};
    const plans: Partial<Record<AssistantProvider, boolean>> = {};
    ids.forEach((p, i) => {
      const k = found[i];
      if (k) keys[p] = k.key;
      if (k?.plan) plans[p] = true;
    });
    return { keys, plans };
  }

  /** USD of this month's own spend that counts toward the person's own cap (`ownCapUsed`). */
  async ownUsed(id: string, ways?: OwnWays) {
    const [{ keys }, spend] = await Promise.all([this.keysOf(id, 'own', ways), this.spend(id)]);
    return ownCapUsed(spend.rows, keys);
  }

  /** Who pays the person's next answer on `provider`'s model, or why nobody can. */
  async paying(
    id: string,
    provider: AssistantProvider,
    rules: PayingRules = {},
  ): Promise<{ paying: Paying | null; wait: AssistantWait | null }> {
    const [person, appKeys, ownKeys, spend, ownCap] = await Promise.all([
      this.person(id),
      this.keysOf(id, 'app'),
      this.keysOf(id, 'own', rules.ways),
      this.spend(id),
      this.ownCap(id),
    ]);
    const spent = (p: AssistantPayer) =>
      spend.rows.filter((r) => r.payer === p && !r.free).reduce((a, r) => a + r.usd, 0);
    const budget = await this.appBudget(id, spent('app'));
    const app = appKeys.keys[provider];
    const own = ownKeys.keys[provider];
    const sources: Record<AssistantPayer, Paying | null> = {
      app: app
        ? {
            payer: 'app',
            apiKey: app,
            ...appKeys,
            cap: budget.total,
            // A free job runs on the app's key whatever the person's allowance holds.
            left: rules.free ? Number.POSITIVE_INFINITY : budget.total - budget.used,
          }
        : null,
      own: own
        ? {
            payer: 'own',
            apiKey: own,
            ...ownKeys,
            cap: ownCap,
            left: ownCap - ownCapUsed(spend.rows, ownKeys.keys),
          }
        : null,
    };
    const first = rules.only ?? person.pay ?? 'app';
    const order: AssistantPayer[] = rules.only
      ? [rules.only]
      : first === 'own'
        ? rules.fallback === false && sources.own
          ? ['own']
          : ['own', 'app']
        : ['app', 'own'];
    if (rules.only) sources[rules.only === 'app' ? 'own' : 'app'] = null;
    for (const p of order) {
      const s = sources[p];
      if (s && s.left > 0) return { paying: s, wait: null };
    }
    if (!sources.app && !sources.own) return { paying: null, wait: 'not_connected' };
    // Both at their caps, or only one set and at its cap: name the one the person pays with first.
    const capped = sources[first] ? first : first === 'own' ? 'app' : 'own';
    return { paying: null, wait: capped === 'own' ? 'own_cap' : 'app_cap' };
  }
}

export function waitText(wait: AssistantWait, provider: AssistantProvider, canRequest = false) {
  const label = PROVIDERS[provider].label;
  if (wait === 'not_connected')
    return `No ${label} key is set: add one in Settings ▸ Model providers, or pick another model in Settings ▸ Models.`;
  if (wait === 'app_cap')
    return canRequest
      ? 'You used your allowance on the shared keys. Request more in Settings, or add your own key.'
      : "You reached this month's cap on the shared keys. Add your own key, or wait for next month.";
  return 'Your own keys reached their monthly cap: raise it in Settings ▸ Model providers.';
}
