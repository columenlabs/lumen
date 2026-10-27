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
  AssistantWait,
  HandOffPolicy,
  KeyState,
  UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { type ChatgptTokens, refreshChatgpt, staleChatgpt } from './chatgpt';
import { PROVIDERS, keyHint } from './models';
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

export type SpendRow = UsagePart & { payer: AssistantPayer };
export interface SpendDoc {
  rows: SpendRow[];
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
      (await this.spend(id)).rows.filter((r) => r.payer === 'app').reduce((a, r) => a + r.usd, 0);
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
    return { total: (await this.appCap()) + granted * al.usd, used };
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
  async ownApiKey(id: string, provider: AssistantProvider) {
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
    return use === 'key' ? ((await key()) ?? (await plan())) : ((await plan()) ?? (await key()));
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

  /** Adds an answer's use to this month's spend, by label and payer. */
  async addSpend(id: string, payer: AssistantPayer, parts: UsagePart[]) {
    if (!parts.some((p) => p.calls)) return;
    await this.docs.update<SpendDoc>(id, `spend:${this.month()}`, (d) => {
      const rows = [...(d?.rows ?? [])];
      for (const p of parts) {
        if (!p.calls) continue;
        const i = rows.findIndex((r) => r.label === p.label && r.payer === payer);
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
          : { ...p, payer };
        if (i >= 0) rows[i] = row;
        else rows.push(row);
      }
      return { rows };
    });
    if (payer === 'app' && this.o.allowance?.period === 'once') {
      const usd = parts.reduce((a, p) => a + p.usd, 0);
      if (usd > 0)
        await this.setAllowance(id, (d) => ({ ...d, spent_usd: (d.spent_usd ?? 0) + usd }));
    }
  }

  /** The payer's key of each provider, those set, and which are plan sign-ins. */
  async keysOf(id: string, payer: AssistantPayer) {
    const ids = Object.keys(PROVIDERS) as AssistantProvider[];
    const found = await Promise.all(
      ids.map((p) =>
        payer === 'app'
          ? this.appApiKey(p).then((k) => (k ? { key: k.key, plan: false } : null))
          : this.ownApiKey(id, p),
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

  /** Who pays the person's next answer on `provider`'s model, or why nobody can. */
  async paying(
    id: string,
    provider: AssistantProvider,
  ): Promise<{ paying: Paying | null; wait: AssistantWait | null }> {
    const [person, appKeys, ownKeys, spend, ownCap] = await Promise.all([
      this.person(id),
      this.keysOf(id, 'app'),
      this.keysOf(id, 'own'),
      this.spend(id),
      this.ownCap(id),
    ]);
    const spent = (p: AssistantPayer) =>
      spend.rows.filter((r) => r.payer === p).reduce((a, r) => a + r.usd, 0);
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
            left: budget.total - budget.used,
          }
        : null,
      own: own
        ? {
            payer: 'own',
            apiKey: own,
            ...ownKeys,
            cap: ownCap,
            left: ownCap - spent('own'),
          }
        : null,
    };
    const first = person.pay ?? 'app';
    const order: AssistantPayer[] = first === 'own' ? ['own', 'app'] : ['app', 'own'];
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
