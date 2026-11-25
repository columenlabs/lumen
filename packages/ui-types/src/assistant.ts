/**
 * The assistant's shared shapes: what `@columenlabs/lumen-ai`'s assistant routes send and what
 * `@columenlabs/lumen-ui`'s assistant draws. A chat is a list of items (the person's messages, the
 * assistant's words, the tools it called, the drafts it made, the work it handed to a higher tier and
 * the advice it asked for); an answer streams as server-sent events that build those items.
 *
 * Product-neutral: the app names the assistant, its tiers and its tool groups.
 */
import type { IndicatorSpec } from './chart-formula';

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
export const ASSISTANT_PROVIDERS = ['anthropic', 'openai', 'xai'] as const;
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
  /** A hand-off part: how many times a higher tier was handed a task. */
  runs?: number;
  /** The model's id (`claude-sonnet-5-5`), so use can be counted per model and provider. */
  model?: string;
}

/** A chat's running use: the sum, each part, and the main model's last context size. */
export interface ChatUsage extends Omit<UsagePart, 'label'> {
  parts: UsagePart[];
  /** Tokens of the main model's last call (in and out): how full its context is. */
  context?: number;
}

/** Something the person pointed at with `@` (a page, a card, a row, a story): its label and how to find it. */
export interface AssistantRefNote {
  kind: string;
  label: string;
  [key: string]: unknown;
}

/**
 * A piece of the chat the person replies to: the text they selected and whose message it came
 * from. It shows above their message and goes to the model with it.
 */
export interface AssistantQuote {
  text: string;
  from: 'assistant' | 'user';
}

/** The longest quote a message carries; a longer selection is cut to it. */
export const ASSISTANT_QUOTE_MAX = 2000;

/**
 * A name inside a step line ("Moved Top Small: …"): wrap it with `stepName` and the chat draws it as a
 * name token. The marks are Unicode isolates (U+2068 … U+2069), so a log, a hover or an older chat that
 * does not draw them shows the plain name.
 */
export const stepName = (name: string): string =>
  `\u2068${name.replace(/[\u2068\u2069]/g, '')}\u2069`;

/** A step line cut into its plain text and its names (`stepName`), in order. */
export function stepLineParts(line: string): { text: string; name: boolean }[] {
  const out: { text: string; name: boolean }[] = [];
  for (const [i, text] of line.split(/[\u2068\u2069]/).entries())
    if (text) out.push({ text, name: i % 2 === 1 });
  return out;
}

/** A step line as plain text: its name marks taken out. */
export const stepLineText = (line: string): string => line.replace(/[\u2068\u2069]/g, '');

/** One tool call the assistant made. */
export interface StepItem {
  kind: 'step';
  id: string;
  /** The tool's name as the model called it (`group__tool`). */
  tool: string;
  /** The tool's title, or its name. */
  title: string;
  ok: boolean;
  /** How long it took; left out when unknown (a chat read back from storage keeps no times). */
  ms?: number;
  /** Rows in a list result, when it was one. */
  rows?: number;
  error?: string;
  /** A change it made at once (its group is on Read + write), with whether it can be undone. */
  write?: { undo: boolean; status: 'done' | 'undone' | 'failed'; error?: string };
  /** A web tool's call: what a search found, or the page it read. */
  web?: StepWeb;
  /** An image the tool made (its output's `image`): the panel shows it as a card. */
  image?: StepImage;
  /**
   * The answers the assistant offers to its own question (its output's `choices`): quick replies
   * under the turn while it is the chat's last, each a shortcut for typing that answer.
   */
  choices?: StepChoices;
  /**
   * What the app's own panel does with this call (its output's `apply`, or its result's): a small
   * JSON value (at most `STEP_APPLY_MAX` characters) passed through untouched, for a change that
   * lives in the app's page rather than on its server (what a list shows, a view to open).
   */
  apply?: unknown;
  /** Where this call sits when read-only calls in a row fold into one line (`StepFold`). */
  fold?: StepFold;
}

/**
 * A read-only call's place in a fold: calls in a row fold into one line that says what was read
 * ("Read 3 guides and the API reference") and opens to one row per `group` ("Guides  Retries ·
 * Backoff"). `group` is the row's label; `what` the thing read, when the call names one. `one` and
 * `many` word the group in the line, with `{n}` for how many calls and `{what}` for the thing read
 * ("the {what} guide", "{n} guides"); left out, the line names the group.
 */
export interface StepFold {
  group: string;
  what?: string;
  one?: string;
  many?: string;
}

/** The most characters a step's `apply` keeps as JSON; a larger one is left out. */
export const STEP_APPLY_MAX = 8000;

/**
 * Quick replies to the assistant's question. The question itself is the assistant's own text; each
 * option is an answer the person can send with one tap (or its number key), `suggested` the one the
 * assistant recommends. `multi` lets them tick several and send them together. Typing in the box
 * always works as well.
 */
export interface StepChoices {
  /** Each answer, a few words; `note` is shown after it, `on` ticks it at first when `multi`. */
  options: { label: string; note?: string; on?: boolean }[];
  /** The index of the recommended option. */
  suggested?: number;
  multi?: boolean;
}

/** The most options a question offers. */
export const CHOICES_MAX = 16;

/** An image a tool made: where the browser reads it, its words for a screen reader, and what it cost. */
export interface StepImage {
  /** A same-site path (`/api/…`) or an https address. */
  url: string;
  alt?: string;
  /** What it cost, as the app says it ("4 credits"). */
  cost?: string;
}

/** A page on the web: its address and, when known, its title. */
export interface WebLink {
  url: string;
  title?: string;
}

/**
 * What a web step did: a search (its words and the pages it found) or a read of one page. The
 * panel folds a search's results under its line and numbers each page read under the answer.
 */
export interface StepWeb {
  query?: string;
  results?: WebLink[];
  read?: WebLink;
  /** A read that failed: the page it could not open (the step's `error` says why). */
  tried?: WebLink;
  /** A lookup's pages, in the order it returned them: its question is `query`. */
  reads?: WebLink[];
  /** True for a lookup (one question answered from several pages). */
  lookup?: boolean;
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

/** Where a task inside a chat stands: open, done (the app took its result) or dropped. */
export type AssistantTaskState = 'open' | 'done' | 'dropped';

/**
 * A task inside a chat (`AgentTurnPlan.task`): a piece of work the app runs in its own session, on
 * its own model, reading the app's brief and the task's own messages, never the rest of the chat.
 */
export interface AssistantTask {
  id: string;
  /** What it works on, in a few words ("Lid · hard edit"). */
  label: string;
  state: AssistantTaskState;
}

/**
 * How a task's card looks: running, ready for the person, a result waiting for the person to look at
 * and decide (`review`: an eye, never a check that reads as already accepted), settled, failed,
 * waiting on an answer or stopped.
 */
export const TASK_TONES = ['live', 'ready', 'review', 'done', 'failed', 'ask', 'stopped'] as const;
export type AssistantTaskTone = (typeof TASK_TONES)[number];

/**
 * The app's header for a task's card (`LumenAssistant` `taskView`): what the work is (`title`), the
 * line under it (`detail`, what it works on, then `state`, where it stands), its tone, and `since`,
 * when the work started, for a running clock while it is live.
 */
export interface AssistantTaskView {
  tone: AssistantTaskTone;
  title: string;
  /** What it works on ("Wall mount plate"), muted. */
  detail?: string;
  /** Where it stands ("Built", "Waiting for you"), in the tone's colour after the detail. */
  state?: string;
  since?: number;
}

/** A task's messages in the chat: shown as one block, its state in the header. */
export interface TaskItem extends AssistantTask {
  kind: 'task';
  items: ChatItem[];
}

/**
 * One move of the assistant's `screen` tool, run in the person's browser: a page of the app, Settings
 * at a section (pulsing a row, never changing it), a symbol's chart (or up to 8 to compare), a row's
 * details in the view on screen, or a card pointed at.
 */
export type AssistantScreenMove =
  | { go: string }
  | { settings: string; row?: string }
  | { chart: string | string[]; indicators?: IndicatorSpec[] }
  | { open: string }
  | { point: string };

/** How a `screen` call ended in the browser: ran, failed (and why), waited for a tap, or undone. */
export const SCREEN_STATUSES = ['done', 'failed', 'waiting', 'undone'] as const;
export type AssistantScreenStatus = (typeof SCREEN_STATUSES)[number];

/** A screen call's outcome, sent back with the person's next message. */
export interface AssistantScreenOutcome {
  id: string;
  status: AssistantScreenStatus;
  /** Why it failed, or what the view on screen shows now. */
  text?: string;
}

/** What the browser can show, sent with each message while Screen is on. */
export interface AssistantScreenMap {
  /** The app's route patterns (`/items/$id`). */
  routes: string[];
  /** Named pages from the nav. */
  pages: { path: string; title: string; section?: string }[];
  /** Settings sections. */
  settings: { id: string; title: string }[];
  /** Cards on the page now. */
  cards: { id: string; title: string; kind?: string }[];
  /** Rows the view on screen can open by title (the first few). */
  rows?: string[];
}

/** Tokens past which a chat is summarized out of sight, unless the app or the person sets another. */
export const COMPACT_AT = 150_000;
/** The context sizes a person may pick for Auto-compact (Settings). */
export const COMPACT_CHOICES = [50_000, 75_000, 100_000, 125_000, 150_000] as const;

/** Whether the assistant may move the person's screen (Settings): never, or with an Undo. */
export const ASSISTANT_SCREEN = ['off', 'move'] as const;
export type AssistantScreenSetting = (typeof ASSISTANT_SCREEN)[number];

/** A `screen` call in the chat: what it put on screen and, once the browser says, how it ended. */
export interface ScreenItem {
  kind: 'screen';
  id: string;
  /** What the screen shows after it, in a few words. */
  label: string;
  moves: AssistantScreenMove[];
  outcome?: Omit<AssistantScreenOutcome, 'id'>;
}

export type ChatItem =
  | {
      kind: 'user';
      /** The turn's id (the stored message's, `u_…`): copies of the chat show it so a turn can be found again. */
      id?: string;
      text: string;
      at: number;
      /** The images sent with it, as `data:` addresses to show. */
      images?: string[];
      /** Each image's name, in the same order ('' for one sent without a name): copied chats list them. */
      imageNames?: string[];
      context?: string;
      refs?: AssistantRefNote[];
      /** The piece of the chat this message replies to. */
      quote?: AssistantQuote;
      tier?: string;
      /** Sent while an answer ran and read by it at its next step (Steer). */
      steered?: boolean;
      /** Sent again from a failed turn's Retry. */
      retried?: boolean;
      /** The turn's title, named before it ran (the app's `AgentTurnPlan.title`). */
      label?: string;
    }
  | { kind: 'text'; text: string }
  | StepItem
  | DraftItem
  | ScreenItem
  | HandOffItem
  | TaskItem
  | { kind: 'advice'; tier: string; label: string; error?: string }
  | { kind: 'compacted' }
  /**
   * The app asks whether the message above starts new work that a fresh chat would answer better
   * (`LumenAgent.offerFresh`); it was not answered or kept. Gone once the person chooses.
   */
  | { kind: 'fresh' }
  | { kind: 'stopped'; reason?: 'cap' | 'limit' }
  /** `retried`: its turn was sent again (Retry), so it no longer offers one. */
  | { kind: 'error'; text: string; code?: string; retried?: boolean };

/** A chat as the panel reads it. */
export interface AssistantChat {
  id: string;
  title: string;
  /** Last message, epoch ms. */
  at: number;
  items: ChatItem[];
  usage?: ChatUsage;
  /** The newest task still open in this chat: the composer offers to keep the next message on it. */
  task?: AssistantTask;
  /** An answer runs on the server now: a panel whose stream was cut reads the chat again until it ends. */
  running?: boolean;
}

/** One line of the chats list. */
export interface AssistantChatRow {
  id: string;
  title: string;
  at: number;
  /**
   * Where the chat was started: the app's id of a workspace, project or record. `LumenAssistant`
   * `chatScope` lists the current one's chats first and the rest behind a switch.
   */
  scope?: string;
}

/**
 * What an answer streams, one server-sent event each. `handoff: true` marks an event from inside
 * a higher tier's section.
 */
export type AssistantEvent =
  | { event: 'chat'; data: { id: string; title: string } }
  | { event: 'text'; data: { delta: string; handoff?: boolean } }
  | { event: 'text_end'; data: { handoff?: boolean } }
  | {
      event: 'step_start';
      /** `write`: the tool makes a change at once (its group is on Read + write). */
      data: {
        id: string;
        tool: string;
        title: string;
        write?: boolean;
        handoff?: boolean;
        /** Its place in a fold of read-only calls, once its arguments say (`StepItem.fold`). */
        fold?: StepFold;
      };
    }
  | { event: 'step'; data: StepItem & { handoff?: boolean } }
  | { event: 'draft'; data: DraftItem & { handoff?: boolean } }
  | { event: 'screen'; data: ScreenItem & { handoff?: boolean } }
  | { event: 'handoff'; data: Omit<HandOffItem, 'items' | 'usage'> }
  | { event: 'handoff_done'; data: { usage: UsagePart } }
  /** This answer runs inside a task: what follows lands in the task's block. */
  | { event: 'task'; data: AssistantTask }
  /** This answer's title, named before it runs: it lands on the message just sent (`label`). */
  | { event: 'label'; data: { label: string } }
  | { event: 'advice'; data: { tier: string; label: string } }
  | { event: 'advice_done'; data: { error?: string } }
  | { event: 'compacted'; data: Record<string, never> }
  | { event: 'fresh'; data: Record<string, never> }
  | { event: 'usage'; data: ChatUsage }
  | { event: 'stopped'; data: { reason?: 'cap' | 'limit' } }
  /** A message steered into the running answer was read by it here. */
  | { event: 'steered'; data: { text: string; at: number } }
  /** Steered messages the answer ended before reading: the panel queues them next. */
  | { event: 'unsteered'; data: { texts: string[] } }
  | { event: 'error'; data: { message: string; code?: string } }
  | { event: 'done'; data: { id: string; usage: ChatUsage } };

/** What the composer sends. */
/** The image types a message may carry. */
export const ASSISTANT_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
/** At most this many images go with one message. */
export const ASSISTANT_IMAGES_MAX = 4;
/** All of a message's images together, in base64 characters (rows stay under the store's 2 MB). */
export const ASSISTANT_IMAGE_CHARS = 1_400_000;

/** An image sent with a message (pasted or dropped in the composer), as base64 with no `data:` prefix. */
export interface AssistantImage {
  media_type: (typeof ASSISTANT_IMAGE_TYPES)[number];
  data: string;
  /** What the person calls it (a file's name, "Pasted image", a close-up's pick): copied chats list it. */
  name?: string;
}
/** The longest image name kept. */
export const ASSISTANT_IMAGE_NAME_MAX = 120;
/** Attachment names as a copied chat lists them: each name, else "image N". */
export function attachmentNames(
  names: readonly (string | undefined)[],
  count = names.length,
): string[] {
  return Array.from({ length: count }, (_, i) => names[i]?.trim() || `image ${i + 1}`);
}

export interface AssistantMessage {
  chat_id?: string;
  message: string;
  /** Images to look at with the message (an app's composer with `images` on). */
  images?: AssistantImage[];
  /** The page the person is on: a label and a short note of what it shows. */
  context?: { label: string; note?: unknown };
  refs?: AssistantRefNote[];
  /** The piece of the chat this message replies to (Reply on selected text). */
  quote?: AssistantQuote;
  /** A composer mode the person turned on for this message (`LumenAssistant` `modes`), by id. */
  use?: string;
  /** The tier the person picked for this message (`#`): a higher one takes it as a task, the same or a lower one answers it. */
  tier?: string;
  /** The browser's IANA zone, for the assistant's bearings (the time now where the person is). */
  time_zone?: string;
  /** What the browser can show, while Screen is on: the assistant gets its `screen` tool. */
  screen?: AssistantScreenMap;
  /** How earlier screen calls ended since the last message. */
  outcomes?: AssistantScreenOutcome[];
  /** The person chose to keep this message in this chat: the agent does not offer a fresh one. */
  stay?: boolean;
  /** The open task the composer keeps this message on (its chip); left out once the person steps out. */
  task?: string;
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
  /**
   * A person may sign in with their plan in place of their own key: `chatgpt` ends on an address
   * the person pastes back, `grok` is a device code they approve (nothing to paste).
   */
  signin?: AssistantSignin;
  /** The app's key: its state for admins; for others only whether one is set. */
  app: KeyState & { from_env?: boolean };
  /** The person's own API key. */
  own: KeyState;
  /** The person's plan sign-in (`signin` providers only). */
  plan?: KeyState;
  /** Which of their own runs when both are set: the one they picked, else the one set. */
  use?: AssistantOwnWay;
  /**
   * The own ways the app lets this person use here (the app's `ownWays`); left out, every way. An
   * empty list: none, so Settings shows no row of their own for this provider.
   */
  own_ways?: AssistantOwnWay[];
}

/** A provider's plan sign-in. */
export type AssistantSignin = 'chatgpt' | 'grok';

/** A started device-code sign-in (`grok`): the code to approve at `url`; never the device code. */
export interface AssistantDeviceSignin {
  url: string;
  code: string;
  /** ms */
  expires_at: number;
  /** Seconds between asks. */
  interval: number;
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
  via?: AssistantSignin;
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
  /** `free`: a job the app pays whatever the cap (it counts toward no one's cap). */
  rows: (UsagePart & {
    payer: AssistantPayer;
    free?: true;
    /** Of an own row: paid by an API key or a plan sign-in (a plan costs the person $0). */
    way?: AssistantOwnWay;
    /** The provider the row ran on, when the server could tell. */
    provider?: AssistantProvider;
    /**
     * Of a $0 row (a plan sign-in's calls): what its tokens would cost at the model's API rates,
     * an estimate. Left out when the model's price is unknown, and by older servers.
     */
    list_usd?: number;
  })[];
  /**
   * USD of this month's own spend that counts toward the own cap: key calls on providers the
   * person can still pay with; a plan sign-in's calls cost nothing. Left out by older servers.
   */
  own_used?: number;
}

/**
 * One line of a person's usage history: a chat, or a run of background work an app asked for
 * (`complete` with a `run`, such as every round of one rebuild). Its parts are per tier and model.
 */
export interface UsageEntry {
  /** `chat:<id>`, or `task:<task>:<run>`. */
  id: string;
  kind: 'chat' | 'task';
  /** The task's id (`rebuild`) when `kind` is `task`. */
  task?: string;
  title: string;
  /**
   * What the chat or run is, in the app's words (Chat, Edit, Rebuild): the first turn's
   * `AgentTurnInput.category`, a run's task label, or the app's `usageCategory`. Left out on lines
   * kept before categories were.
   */
  category?: string;
  /** First and last use, ms. */
  first: number;
  at: number;
  calls: number;
  in: number;
  read: number;
  out: number;
  usd: number;
  /** Of `usd`, what the person's own key or plan paid (left out when nothing, and before it was kept). */
  own_usd?: number;
  /** Calls the person's plan sign-in answered (free to them; left out when none, and before it was kept). */
  own_plan_calls?: number;
  /** Those plan calls at the models' API rates, an estimate (the plan itself charged $0). */
  own_plan_usd?: number;
  /** A run of one of the app's own tasks (`TaskDef.internal`), not something the person asked for. */
  internal?: true;
  /** Messages the person sent in the chat (left out when none, and before they were counted). */
  turns?: number;
  /** Images and picks (refs: parts, faces, rows) sent with those messages; left out when none. */
  images?: number;
  refs?: number;
  parts: UsagePart[];
}

/** One month of a person's use: the total, per tier and model, and each chat and run, newest first. */
export interface UsageHistory {
  month: string;
  /** Months with any history, newest first (this month always). */
  months: string[];
  usd: number;
  rows: SpendState['rows'];
  entries: UsageEntry[];
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
  /**
   * False when the app picks each turn's tier itself (`createAssistant` `pickTier: false`): the
   * panel shows no tier menu, `#` or /model. Left out, the person picks.
   */
  pick_tier?: boolean;
  /**
   * `app` when an admin picks each tier's model for everyone (`createAssistant` `modelsBy`):
   * `tiers` carries the admin's picks, Settings shows them only in the admin's Models section.
   */
  models_by?: 'app';
  models: AssistantModelRow[];
  tasks: { id: string; label: string; about: string; tier: string }[];
  groups: {
    id: string;
    label: string;
    about: string;
    access: AssistantAccess;
    /** Whether the group offers Read + draft (false for a group of read tools only). */
    drafts: boolean;
    /** Whether the group offers Read + write. */
    writes: boolean;
  }[];
  hand_off: HandOffPolicy;
  /** Tokens past which this person's chats compact: their pick, else the app's (`createAssistant` `compactAt`); unset, `COMPACT_AT`. */
  compact_at?: number;
  /** The tier asked for advice, or off. */
  advice: string;
  /** Whether the assistant may move the screen. */
  screen: AssistantScreenSetting;
  web: {
    fetch: boolean;
    /** Null when the app has no ScrapeQL; `bound` when it is reached over a service binding (no token). */
    scrapeql: (KeyState & { tools?: string[]; bound?: boolean }) | null;
  };
  /**
   * The app's connectors (outside MCP servers), for admins; absent for everyone else and in an
   * app that has none (`createAssistant` `connectors`).
   */
  connectors?: AssistantConnector[];
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
  /** One of `COMPACT_CHOICES`, or null for the app's own. */
  compact_at?: number | null;
  advice?: string;
  screen?: AssistantScreenSetting;
  access?: Record<string, AssistantAccess>;
  web?: { fetch?: boolean };
  pay?: AssistantPayer;
  /** Which of their own runs on each provider, their key or their plan. */
  own_use?: Partial<Record<AssistantProvider, AssistantOwnWay>>;
}

/** What an admin may give a connector: Off, Read (its read-only tools), or Read + draft (its other tools make a card). */
export const CONNECTOR_ACCESS = ['off', 'read', 'draft'] as const;
export type ConnectorAccess = (typeof CONNECTOR_ACCESS)[number];

/** One tool a connector offers, as its last test listed it. */
export interface AssistantConnectorTool {
  name: string;
  title?: string;
  /** Marked read-only by the server; the rest only ever draft. */
  read: boolean;
}

/**
 * An outside MCP server (Streamable HTTP) the assistant may use, set by an admin: its address, the
 * headers it signs in with (names only, values never leave the server), what the assistant may do
 * with it, and the tools its last test listed. Its tools stay off the model's prompt until the
 * assistant searches for them.
 */
export interface AssistantConnector {
  id: string;
  name: string;
  url: string;
  /** Names of the headers sent with each call; their values are write-only. */
  headers: string[];
  access: ConnectorAccess;
  tools: AssistantConnectorTool[];
  test: { at: number; ok: boolean; detail: string } | null;
}

/** What an admin sends to add or change a connector. Leave `headers` out to keep the ones saved. */
export interface AssistantConnectorInput {
  name: string;
  url: string;
  headers?: Record<string, string>;
  access?: ConnectorAccess;
}
