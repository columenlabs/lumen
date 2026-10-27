/**
 * The assistant's shared shapes: what `@columenlabs/lumen-ai`'s assistant routes send and what
 * `@columenlabs/lumen-ui`'s assistant draws. A chat is a list of items (the person's messages, the
 * assistant's words, the tools it called, the drafts it made, the work it handed to a higher tier and
 * the advice it asked for); an answer streams as server-sent events that build those items.
 *
 * Product-neutral: the app names the assistant, its tiers and its tool groups.
 */

/** How hard a tier's model thinks; `default` sends nothing, so the model's own default applies. */
export const ASSISTANT_EFFORTS = ['default', 'low', 'medium', 'high', 'max'] as const;
export type AssistantEffort = (typeof ASSISTANT_EFFORTS)[number];

/** What the assistant may do with a group of tools: nothing, read, read and draft changes, or read and make them at once. */
export const ASSISTANT_ACCESS = ['off', 'read', 'draft', 'write'] as const;
export type AssistantAccess = (typeof ASSISTANT_ACCESS)[number];

/**
 * When the assistant hands a task to a higher tier on its own: `next` the next tier up (a higher one
 * only when the person names it), `any` any higher tier, `ask` only when the person asks.
 */
export const HAND_OFF_POLICIES = ['next', 'any', 'ask'] as const;
export type HandOffPolicy = (typeof HAND_OFF_POLICIES)[number];

/** Why a higher tier was called in. */
export const HAND_OFF_WHYS = ['asked', 'judgement', 'stuck', 'check_failed'] as const;
export type HandOffWhy = (typeof HAND_OFF_WHYS)[number];

/** Whose models a tier runs, each with its own keys. */
export const ASSISTANT_PROVIDERS = ['anthropic', 'openai'] as const;
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number];

/** Who pays for a person's answers: the app's key (under the cap an admin sets) or their own key. */
export const ASSISTANT_PAYERS = ['app', 'own'] as const;
export type AssistantPayer = (typeof ASSISTANT_PAYERS)[number];

/** Why the assistant cannot answer now. */
export type AssistantWait = 'not_connected' | 'app_cap' | 'own_cap';

/** Tokens and cost of one part of a chat: a tier, or a tier's advice. */
export interface UsagePart {
  label: string;
  calls: number;
  /** Tokens in, cache reads and writes included. */
  in: number;
  /** Of `in`, read from the prompt cache. */
  read: number;
  out: number;
  usd: number;
}

/** A chat's running use: the sum, each part, and the main model's last context size. */
export interface ChatUsage extends Omit<UsagePart, 'label'> {
  parts: UsagePart[];
  /** Tokens of the main model's last call (in and out): how full its context is. */
  context?: number;
}

/** Something the person pointed at with `#` (a page, a card, a row, a story): its label and how to find it. */
export interface AssistantRefNote {
  kind: string;
  label: string;
  [key: string]: unknown;
}

/** One tool call the assistant made. */
export interface StepItem {
  kind: 'step';
  id: string;
  /** The tool's name as the model called it (`group__tool`). */
  tool: string;
  /** The tool's title, or its name. */
  title: string;
  ok: boolean;
  ms: number;
  /** Rows in a list result, when it was one. */
  rows?: number;
  error?: string;
  /** A change it made at once (its group is on Read + write), with whether it can be undone. */
  write?: { undo: boolean; status: 'done' | 'undone' | 'failed'; error?: string };
}

/** A change the assistant drafted: nothing happens until the person presses Save. */
export interface DraftItem {
  kind: 'draft';
  id: string;
  tool: string;
  title: string;
  /** The arguments it would run with. */
  args: unknown;
  status: 'open' | 'saved' | 'dismissed' | 'failed';
  /** What the save returned, or why it failed. */
  result?: unknown;
  error?: string;
}

/** A task handed to a higher tier: its own section of the chat, with why it was called in. */
export interface HandOffItem {
  kind: 'handoff';
  tier: string;
  label: string;
  task: string;
  why: HandOffWhy;
  items: ChatItem[];
  usage?: UsagePart;
}

export type ChatItem =
  | {
      kind: 'user';
      text: string;
      at: number;
      context?: string;
      refs?: AssistantRefNote[];
      tier?: string;
    }
  | { kind: 'text'; text: string }
  | StepItem
  | DraftItem
  | HandOffItem
  | { kind: 'advice'; tier: string; label: string; error?: string }
  | { kind: 'compacted' }
  | { kind: 'stopped'; reason?: 'cap' }
  | { kind: 'error'; text: string; code?: string };

/** A chat as the panel reads it. */
export interface AssistantChat {
  id: string;
  title: string;
  /** Last message, epoch ms. */
  at: number;
  items: ChatItem[];
  usage?: ChatUsage;
}

/** One line of the chats list. */
export interface AssistantChatRow {
  id: string;
  title: string;
  at: number;
}

/**
 * What an answer streams, one server-sent event each. `handoff: true` marks an event from inside
 * a higher tier's section.
 */
export type AssistantEvent =
  | { event: 'chat'; data: { id: string; title: string } }
  | { event: 'text'; data: { delta: string; handoff?: boolean } }
  | { event: 'text_end'; data: { handoff?: boolean } }
  | { event: 'step_start'; data: { id: string; tool: string; title: string; handoff?: boolean } }
  | { event: 'step'; data: StepItem & { handoff?: boolean } }
  | { event: 'draft'; data: DraftItem & { handoff?: boolean } }
  | { event: 'handoff'; data: Omit<HandOffItem, 'items' | 'usage'> }
  | { event: 'handoff_done'; data: { usage: UsagePart } }
  | { event: 'advice'; data: { tier: string; label: string } }
  | { event: 'advice_done'; data: { error?: string } }
  | { event: 'compacted'; data: Record<string, never> }
  | { event: 'usage'; data: ChatUsage }
  | { event: 'stopped'; data: { reason?: 'cap' } }
  | { event: 'error'; data: { message: string; code?: string } }
  | { event: 'done'; data: { id: string; usage: ChatUsage } };

/** What the composer sends. */
export interface AssistantMessage {
  chat_id?: string;
  message: string;
  /** The page the person is on: a label and a short note of what it shows. */
  context?: { label: string; note?: unknown };
  refs?: AssistantRefNote[];
  /** The tier the person picked for this message (`@`): a higher one takes it as a task, the same or a lower one answers it. */
  tier?: string;
  /** The browser's IANA zone, for the assistant's bearings (the time now where the person is). */
  time_zone?: string;
}

/** A tier as the person set it, with what it runs. */
export interface AssistantTierRow {
  id: string;
  label: string;
  about: string;
  model: string;
  model_label: string;
  provider: AssistantProvider;
  effort: AssistantEffort;
}

/** A model a tier can pick, under its provider's heading. */
export interface AssistantModelRow {
  id: string;
  label: string;
  group: string;
  provider: AssistantProvider;
}

/** One provider's keys as Settings shows them: the app's (admins see its state) and the person's. */
export interface AssistantProviderRow {
  id: AssistantProvider;
  label: string;
  /** How its keys start (`sk-ant-`). */
  prefix: string;
  /** Where a person makes a key. */
  keys_url: string;
  /** A person may sign in with their plan in place of their own key (`chatgpt`). */
  signin?: 'chatgpt';
  /** The app's key: its state for admins; for others only whether one is set. */
  app: KeyState & { from_env?: boolean };
  /** The person's own API key. */
  own: KeyState;
  /** The person's plan sign-in (`signin` providers only). */
  plan?: KeyState;
  /** Which of their own runs when both are set: the one they picked, else the one set. */
  use?: AssistantOwnWay;
}

/** A person's own way to a provider: their API key or their plan sign-in. */
export const ASSISTANT_OWN_WAYS = ['key', 'plan'] as const;
export type AssistantOwnWay = (typeof ASSISTANT_OWN_WAYS)[number];

/** A sealed key as Settings shows it: never the key, only its last characters and last check. */
export interface KeyState {
  set: boolean;
  /** `sk-ant-…7Qx2`, or the signed-in account's email */
  hint?: string;
  /** Set when it is a plan sign-in, not a key. */
  via?: 'chatgpt';
  saved_at?: number;
  test?: { at: number; ok: boolean; detail: string };
}

/** This month's spend of one person, per tier and advice. */
export interface SpendState {
  month: string;
  usd: number;
  /** The cap of the payer now in use, USD a month. */
  cap: number | null;
  payer: AssistantPayer | null;
  rows: (UsagePart & { payer: AssistantPayer })[];
}

/** What an app's allowance on its shared keys is counted in: credits, or dollars. */
export interface AllowanceUnit {
  /** `credit`. */
  one: string;
  /** `credits`. */
  many: string;
  /** USD one unit buys at list price (0.01 for a credit worth a cent). */
  usd: number;
}

/** A person's ask for more allowance, and what an approver did with it. */
export interface AllowanceRequest {
  id: string;
  /** The person's id. */
  person: string;
  /** What approvers see them as (their email or name). */
  who: string;
  /** Units asked for. */
  amount: number;
  why: string;
  at: number;
  status: 'open' | 'granted' | 'declined';
  /** Units granted (an approver may give less or more than asked). */
  granted?: number;
  decided_at?: number;
  decided_by?: string;
}

/**
 * A person's allowance on the app's shared keys, in the app's unit: what they have for the period
 * (a month, or once for good), what they used and what is left, and their newest request.
 */
export interface AllowanceState {
  unit: AllowanceUnit;
  period: 'month' | 'once';
  total: number;
  used: number;
  left: number;
  /** Their newest request; an open one blocks another. */
  request: AllowanceRequest | null;
  /** Amounts the Request more form offers. */
  amounts: number[];
  /** The caller may grant or decline requests. */
  approver: boolean;
  /** Open requests waiting on an approver (approvers only). */
  waiting?: number;
}

/** Everything the assistant's settings sections show, for one person. */
export interface AssistantStatus {
  name: string;
  /** The app's slash commands (the composer adds its own: /compact, /clear, /model, /escalate). */
  commands?: { name: string; about: string; args?: string }[];
  /** Null when the assistant can answer now. */
  wait: AssistantWait | null;
  /** The provider the wait is about: the one the person's tier runs on. */
  wait_provider?: AssistantProvider;
  admin: boolean;
  tier: string;
  tiers: AssistantTierRow[];
  models: AssistantModelRow[];
  tasks: { id: string; label: string; about: string; tier: string }[];
  groups: {
    id: string;
    label: string;
    about: string;
    access: AssistantAccess;
    drafts: boolean;
    /** Whether the group offers Read + write. */
    writes: boolean;
  }[];
  hand_off: HandOffPolicy;
  /** The tier asked for advice, or off. */
  advice: string;
  web: {
    fetch: boolean;
    /** Null when the app has no ScrapeQL; `bound` when it is reached over a service binding (no token). */
    scrapeql: (KeyState & { tools?: string[]; bound?: boolean }) | null;
  };
  /** The providers the app's models run on, each with its keys. */
  providers: AssistantProviderRow[];
  /** USD a month: what each person may spend on the app's keys, and on their own keys. */
  caps: { app: number; own: number };
  pay: AssistantPayer;
  spend: SpendState;
  /** Set when the app counts an allowance on its shared keys (`createAssistant` `allowance`). */
  allowance?: AllowanceState;
}

/** What a person may change (PUT /settings): any subset. */
export interface AssistantSettingsPatch {
  tier?: string;
  tiers?: Record<string, { model?: string; effort?: AssistantEffort }>;
  tasks?: Record<string, string>;
  hand_off?: HandOffPolicy;
  advice?: string;
  access?: Record<string, AssistantAccess>;
  web?: { fetch?: boolean };
  pay?: AssistantPayer;
  /** Which of their own runs on each provider, their key or their plan. */
  own_use?: Partial<Record<AssistantProvider, AssistantOwnWay>>;
}
