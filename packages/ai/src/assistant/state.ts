/**
 * The assistant's settings, keys and spend, as stored documents.
 *
 *   app      (the app's scope)   the cap per person on the app's key
 *   key      (the app's scope)   the app's Anthropic key, tested before it is kept, sealed
 *   scrapeql (the app's scope)   ScrapeQL's Access service token, tested before it is kept, sealed
 *   settings (a person's scope)  their tiers, start tiers, hand off, advice, tool access, web, payer
 *   key      (a person's scope)  their own Anthropic key and its monthly cap, sealed
 *   spend:YYYY-MM                what each tier cost them this month, by payer
 *
 * Who pays: the person's pick (the app's key by default) while it has money left this month, else
 * the other; with neither the assistant waits and says why.
 */
import type {
  AssistantAccess,
  AssistantEffort,
  AssistantPayer,
  AssistantWait,
  HandOffPolicy,
  KeyState,
  UsagePart,
} from '@columenlabs/lumen-ui-types/assistant';
import { keyHint } from './models';
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
  /** USD a month: the person's own key only. */
  cap_usd?: number;
}

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
}

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
  return {
    set: true,
    hint: keyHint(secret(d)),
    saved_at: d.saved_at,
    ...(d.test ? { test: d.test } : {}),
  } satisfies KeyState;
}

export interface Paying {
  payer: AssistantPayer;
  apiKey: string;
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
      appKey?: () => Promise<string | null | undefined>;
    },
  ) {}

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

  appKey() {
    return this.docs.read<KeyDoc>(APP_SCOPE, 'key');
  }
  /** The app's key: the stored one, else the app's fallback (a Worker secret). */
  async appApiKey(): Promise<{ key: string; fromEnv: boolean } | null> {
    const d = await this.appKey();
    if (d) return { key: d.api_key, fromEnv: false };
    const env = await this.o.appKey?.();
    return env ? { key: env, fromEnv: true } : null;
  }
  ownKey(id: string) {
    return this.docs.read<KeyDoc>(id, 'key');
  }
  scrapeql() {
    return this.docs.read<TokenDoc>(APP_SCOPE, 'scrapeql');
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
  }

  /** Who pays the person's next answer, or why nobody can. */
  async paying(id: string): Promise<{ paying: Paying | null; wait: AssistantWait | null }> {
    const [person, app, own, spend, appCap] = await Promise.all([
      this.person(id),
      this.appApiKey(),
      this.ownKey(id),
      this.spend(id),
      this.appCap(),
    ]);
    const spent = (p: AssistantPayer) =>
      spend.rows.filter((r) => r.payer === p).reduce((a, r) => a + r.usd, 0);
    const sources: Record<AssistantPayer, Paying | null> = {
      app: app ? { payer: 'app', apiKey: app.key, cap: appCap, left: appCap - spent('app') } : null,
      own: own
        ? {
            payer: 'own',
            apiKey: own.api_key,
            cap: own.cap_usd ?? this.o.defaultCap,
            left: (own.cap_usd ?? this.o.defaultCap) - spent('own'),
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

export const WAIT_TEXT: Record<AssistantWait, string> = {
  not_connected: 'No Claude key is set: an admin adds one in Settings ▸ Model providers.',
  app_cap:
    "You reached this month's cap on the app's key. Add your own key, or wait for next month.",
  own_cap: 'Your own key reached its monthly cap: raise it in Settings ▸ Spend.',
};
