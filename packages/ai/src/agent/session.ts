/**
 * `LumenSession`: one chat (or any session: an edit, a long job's steps) run inside a host Durable
 * Object that holds many of them at once, such as one object per person. Each session has its own
 * messages, cards, screen calls and prompt-cache key, kept in the host's SQLite under its id, so
 * sessions never read each other's history and never wait for each other: a turn is almost all
 * waiting on the model, and the object serves the other sessions meanwhile.
 *
 * It is `LumenAgent` without Think (which runs one conversation per object): the same `plan` and
 * `settle`, the same cards, tasks, steers, screen, leads and usage, and its own turn
 * loop on the AI SDK. A turn runs in the host, not in the request that asked: when the person
 * leaves, the answer goes on and is kept, and the panel reads it back. Every turn stops at the
 * host's turn limit (`turnLimitMs`) and keeps what it made.
 *
 *   class Person extends DurableObject {
 *     #sessions = new LumenSessions((id) => new MyChat(this.#host, id));
 *     ask(id, input, sink) { return this.#sessions.get(id).ask(input, sink); }
 *   }
 */

import { anthropic } from '@ai-sdk/anthropic';
import { Workspace } from '@cloudflare/computer';
import { createAITools } from '@cloudflare/computer/tools/ai-sdk';
import {
  type AssistantChat,
  type AssistantScreenOutcome,
  type AssistantTask,
  COMPACT_AT,
  type ChatUsage,
} from '@columenlabs/lumen-ui-types/assistant';
import {
  type ModelMessage,
  type PrepareStepFunction,
  type ToolSet,
  type UIMessage,
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
} from 'ai';
import {
  type AdvisorIteration,
  type AgentCard,
  type AgentTurnEnd,
  type AgentTurnPlan,
  type AskInput,
  type AskSink,
  CAP_NOTE,
  CARD_NOTE,
  COMPACT_COMMAND,
  type CardRow,
  LAST_STEP_NOTE,
  MAX_STEPS,
  type Running,
  STEER_NOTE,
  type SentLeads,
  cardNews,
  cardOf,
  chatUsage,
  imageParts,
  leadAt,
  quoteLead,
  quoteOf,
  stickyLeads,
} from './agent';
import {
  aiModel,
  cachedTurn,
  planFallback,
  planTools,
  prefixCacheKey,
  turnSettings,
} from './models';
import {
  type ScreenCall,
  screenMapOf,
  screenNews,
  screenOutcomesOf,
  screenRules,
  screenTool,
} from './screen';
import {
  LAZY_AT,
  type LazyTools,
  TOOL_SEARCH,
  deferredTools,
  lazyTools,
  usedTools,
} from './search';
import {
  type AskMeta,
  type SteerNote,
  type StepCall,
  type StepNames,
  chunkEvents,
  itemsOf,
  shownTitle,
} from './stream';
import {
  type KeptTask,
  TASKS_KEPT,
  openTask,
  taskBlocks,
  taskNews,
  threadOf,
  turnKeys,
} from './tasks';
import { openAiTools } from './tools';
import { UsageMeter } from './usage';

/** The longest one turn of any session runs before it stops and keeps what it made (5 minutes). */
export const TURN_LIMIT_MS = 5 * 60_000;

/** How long a model call may think before its first output: a long reasoning fits (3 minutes). */
const FIRST_OUTPUT_MS = 3 * 60_000;
/** How long a model call may go quiet once it has started answering (1 minute). */
const QUIET_MS = 60_000;
/** What the person reads when a model call went quiet. */
const QUIET_TEXT =
  'The model stopped answering, so this turn ended. Send your message again to retry.';

/** Messages kept whole after a compaction: the newest turns stay as they were. */
const KEEP_AFTER_COMPACT = 6;

/** A value SQLite hands back or takes (the Workers runtime's `SessionSqlValue`). */
export type SessionSqlValue = ArrayBuffer | string | number | null;

/** The part of a Durable Object's SQLite (`ctx.storage.sql`) a session uses. */
export interface SessionSql {
  exec<T extends Record<string, SessionSqlValue>>(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): T[] };
}

/** What a session needs from the object that holds it. */
export interface SessionHost {
  /** The host's SQLite (`ctx.storage.sql`). */
  sql: SessionSql;
  /** The host's storage, for the sessions' files. */
  storage: ConstructorParameters<typeof Workspace>[0]['storage'];
  /** Keeps the host awake while a turn runs past the request that asked (`ctx.waitUntil`). */
  waitUntil?(p: Promise<unknown>): void;
}

/** What a turn's plan reads: the session's messages as the model will get them. */
export interface SessionTurn {
  messages: ModelMessage[];
  /** This turn carries on one a restart cut off. */
  continuation?: boolean;
}

/** A turn's settings, as `beforeTurn` gives them (an app may change them before the call). */
export interface SessionTurnConfig {
  model: ReturnType<typeof aiModel>;
  instructions: ReturnType<typeof cachedTurn>['instructions'];
  messages: ModelMessage[];
  tools: ToolSet;
  activeTools?: string[];
  toolChoice?: { type: 'tool'; toolName: string };
  maxSteps: number;
  maxOutputTokens?: number;
  providerOptions: ReturnType<typeof turnSettings>['providerOptions'];
}

type StepContext = Parameters<PrepareStepFunction<ToolSet>>[0];

/** A session's list entry: its id, title and last activity. */
export interface SessionEntry {
  id: string;
  title: string;
  at: number;
}

let tabled = new WeakSet<SessionSql>();

/** The sessions' tables, made once per object: every row names its session. */
function tables(sql: SessionSql) {
  if (tabled.has(sql)) return;
  sql.exec(
    'CREATE TABLE IF NOT EXISTS lumen_s_kv (session TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (session, k))',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS lumen_s_msgs (session TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (session, seq))',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS lumen_s_cards (session TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, grp TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, result TEXT, status TEXT NOT NULL, error TEXT, told INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (session, id))',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS lumen_s_screens (session TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL, moves TEXT NOT NULL, status TEXT NOT NULL, text TEXT, told INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL, PRIMARY KEY (session, id))',
  );
  tabled.add(sql);
}

/** For a host whose storage was wiped (tests of a fresh object): its tables are made again. */
export function forgetSessionTables() {
  tabled = new WeakSet();
}

/** The host's sessions, newest first (at most `limit`, 500 the most). */
export function listSessions(sql: SessionSql, limit = 100): SessionEntry[] {
  tables(sql);
  const rows = sql
    .exec<{ session: string; v: string }>(
      "SELECT session, v FROM lumen_s_kv WHERE k = 'at' ORDER BY CAST(v AS INTEGER) DESC LIMIT ?",
      Math.min(500, Math.max(1, limit)),
    )
    .toArray();
  if (!rows.length) return [];
  const titles = new Map(
    sql
      .exec<{ session: string; v: string }>(
        `SELECT session, v FROM lumen_s_kv WHERE k = 'title' AND session IN (${rows.map(() => '?').join(',')})`,
        ...rows.map((r) => r.session),
      )
      .toArray()
      .map((r) => [r.session, JSON.parse(r.v) as string]),
  );
  return rows.map((r) => ({
    id: r.session,
    title: titles.get(r.session) ?? '',
    at: Number(JSON.parse(r.v)),
  }));
}

/** Drops a session and everything it kept (its files too, when the host gives a workspace). */
export function dropSession(sql: SessionSql, id: string) {
  tables(sql);
  for (const t of ['lumen_s_kv', 'lumen_s_msgs', 'lumen_s_cards', 'lumen_s_screens'])
    sql.exec(`DELETE FROM ${t} WHERE session = ?`, id);
}

/** Sessions whose last turn was cut off (a deploy or restart), oldest first. */
export function cutSessions(sql: SessionSql): string[] {
  tables(sql);
  return sql
    .exec<{ session: string }>("SELECT session FROM lumen_s_kv WHERE k = 'running' LIMIT 50")
    .toArray()
    .map((r) => r.session);
}

/** The host's live sessions: one object per id, made on first use. */
export class LumenSessions<S extends LumenSession> {
  #live = new Map<string, S>();
  constructor(private readonly make: (id: string) => S) {}

  get(id: string): S {
    let s = this.#live.get(id);
    if (!s) {
      s = this.make(id);
      this.#live.set(id, s);
    }
    return s;
  }

  /** The sessions answering now. */
  running(): string[] {
    return [...this.#live.values()].filter((s) => s.running).map((s) => s.name);
  }

  /** Forgets an idle session's object (its rows stay); a running one is kept. */
  release(id: string) {
    if (!this.#live.get(id)?.running) this.#live.delete(id);
  }
}

export abstract class LumenSession {
  /** The session's id. */
  readonly name: string;
  #sql: SessionSql;

  constructor(
    protected readonly host: SessionHost,
    id: string,
  ) {
    this.name = id;
    this.#sql = host.sql;
    tables(host.sql);
  }

  /** The turn the app runs now. Throw to refuse it (no key, no money); the error is shown. */
  abstract plan(turn: SessionTurn): Promise<AgentTurnPlan>;
  /** A turn ended: record its spend and how it went. Errors here are logged, never shown. */
  abstract settle(end: AgentTurnEnd): Promise<void>;

  /** Saves a draft: runs its write as the person. The result is shown and told to the model. */
  protected applyDraft(_card: AgentCard): Promise<unknown> {
    return Promise.reject(new Error('Saving a card is not set up here.'));
  }
  /** Takes back a write made at once (Undo). */
  protected undoWrite(_card: AgentCard): Promise<void> {
    return Promise.reject(new Error('This change cannot be undone here.'));
  }

  /** The longest one turn runs; past it the turn stops and keeps what it made. */
  protected turnLimitMs(): number {
    return TURN_LIMIT_MS;
  }

  #turn: Running | null = null;
  #input: AskInput | null = null;
  #sink: AskSink | null = null;
  #asked: string | null = null;
  #steers: { text: string; at: number }[] = [];
  #steered: { index: number; text: string }[] = [];
  #abort: AbortController | null = null;
  #busy = false;

  /** An answer runs in this session now. */
  get running(): boolean {
    return this.#busy;
  }

  /** What the person sent with the message this turn answers (page, refs, tier, zone). */
  protected get input(): AskInput | null {
    return this.#input;
  }

  // ── Storage, all under this session's id ────────────────────────────────────────────────

  protected sql<T extends Record<string, SessionSqlValue>>(
    query: string,
    ...args: SessionSqlValue[]
  ): T[] {
    return this.#sql.exec<T>(query, ...args).toArray();
  }

  #get<T>(k: string): T | null {
    const [r] = this.sql<{ v: string }>(
      'SELECT v FROM lumen_s_kv WHERE session = ? AND k = ? LIMIT 1',
      this.name,
      k,
    );
    return r ? (JSON.parse(r.v) as T) : null;
  }

  #put(k: string, v: unknown) {
    this.sql(
      'INSERT OR REPLACE INTO lumen_s_kv (session, k, v) VALUES (?, ?, ?)',
      this.name,
      k,
      JSON.stringify(v),
    );
  }

  #del(k: string) {
    this.sql('DELETE FROM lumen_s_kv WHERE session = ? AND k = ?', this.name, k);
  }

  /** The session's messages, oldest first (as the panel and the model read them). */
  get messages(): UIMessage[] {
    return this.sql<{ json: string }>(
      'SELECT json FROM lumen_s_msgs WHERE session = ? ORDER BY seq',
      this.name,
    ).map((r) => JSON.parse(r.json) as UIMessage);
  }

  #seqOf(): number {
    const [r] = this.sql<{ n: number | null }>(
      'SELECT MAX(seq) AS n FROM lumen_s_msgs WHERE session = ?',
      this.name,
    );
    return (r?.n ?? 0) + 1;
  }

  #append(m: UIMessage) {
    this.sql(
      'INSERT INTO lumen_s_msgs (session, seq, id, json) VALUES (?, ?, ?, ?)',
      this.name,
      this.#seqOf(),
      m.id,
      JSON.stringify(m),
    );
  }

  /** The session's files, shared by every session of the host (each keeps to `fileRoot`). */
  #ws: Workspace | null = null;
  protected get workspace(): Workspace {
    this.#ws ??= new Workspace({ storage: this.host.storage, sessionId: this.name });
    return this.#ws;
  }

  /** Where this session's files live; its file tools see this folder as `/`. */
  protected get fileRoot(): string {
    return `/s/${this.name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }

  // ── The app's wording hooks (as LumenAgent's) ───────────────────────────────────────────

  protected async offerFresh(_input: AskInput): Promise<boolean> {
    return false;
  }

  protected plainSteps(): boolean {
    return false;
  }

  protected stepLine(c: StepCall): string | undefined {
    if (c.tool !== 'web__lookup') return undefined;
    const q = (c.input as { question?: unknown } | null)?.question;
    const question = typeof q === 'string' ? q.trim() : '';
    if (!question) return undefined;
    return c.state === 'running'
      ? `Looking up ${question}`
      : c.state === 'failed'
        ? `Couldn't look up ${question}`
        : `Looked up ${question}`;
  }

  protected stepFailed(_f: { tool: string; error: string; ms: number }): void {}

  protected stepTitleOf(name: string, kind?: 'read' | 'draft' | 'write'): string {
    return shownTitle(name, this.#names(), kind);
  }

  #names(): StepNames {
    return {
      plain: this.plainSteps(),
      titleOf: (n) =>
        this.#turn?.tools.info.find((i) => i.name === n)?.title ??
        this.#get<Record<string, string>>('titles')?.[n],
      lineOf: (c) => {
        if (c.state === 'running') return this.stepLine(c);
        const kept = this.#get<string>(`line:${c.id}`);
        if (kept) return kept;
        const line = this.stepLine(c);
        if (line) this.#put(`line:${c.id}`, line.slice(0, 200));
        return line;
      },
    };
  }

  #keepTitles(info: { name: string; title?: string }[]) {
    const titles = this.#get<Record<string, string>>('titles') ?? {};
    let changed = false;
    for (const i of info)
      if (i.title && titles[i.name] !== i.title) {
        titles[i.name] = i.title.slice(0, 80);
        changed = true;
      }
    if (changed) this.#put('titles', titles);
  }

  // ── Reading the session ─────────────────────────────────────────────────────────────────

  usage(): ChatUsage {
    return this.#get<ChatUsage>('usage') ?? chatUsage([]);
  }

  /** The session's title (its first message, unless the app named it). */
  title(): string {
    return this.#get<string>('title') ?? '';
  }

  /** Names the session (a Rebuild, an edit): shown in lists instead of its first message. */
  setTitle(title: string) {
    this.#put('title', title.replace(/\s+/g, ' ').trim().slice(0, 80));
    if (this.#get<number>('at') === null) this.#put('at', Date.now());
  }

  async view(id = this.name): Promise<AssistantChat & { running?: boolean }> {
    const open = openTask(this.#tasks());
    return {
      id,
      title: this.title(),
      at: this.#get<number>('at') ?? 0,
      items: taskBlocks(
        itemsOf(
          this.messages,
          this.cards(),
          this.#screens(),
          this.#get<Record<string, SteerNote[]>>('steers') ?? {},
          this.#names(),
          this.#get<Record<string, string>>('task_of') ?? {},
        ),
        this.#tasks(),
      ),
      usage: this.usage(),
      ...(open ? { task: open } : {}),
      ...(this.#busy ? { running: true } : {}),
    };
  }

  // ── Tasks (as LumenAgent's) ─────────────────────────────────────────────────────────────

  #tasks(): Record<string, KeptTask> {
    return this.#get<Record<string, KeptTask>>('tasks') ?? {};
  }

  chatTasks(): Record<string, AssistantTask> {
    return Object.fromEntries(
      Object.entries(this.#tasks()).map(([id, t]) => [id, { id, label: t.label, state: t.state }]),
    );
  }

  endTask(id: string, state: 'done' | 'dropped'): AssistantTask | null {
    const tasks = this.#tasks();
    const t = tasks[id];
    if (!t) return null;
    if (t.state === 'open') {
      const taskOf = this.#get<Record<string, string>>('task_of') ?? {};
      let last = '';
      let mine = false;
      for (const m of this.messages) {
        if (m.role === 'user') mine = taskOf[m.id] === id;
        else if (m.role === 'assistant' && mine) {
          const said = m.parts
            .map((p) => (p.type === 'text' ? p.text : ''))
            .join('')
            .trim();
          if (said) last = said;
        }
      }
      tasks[id] = { ...t, state, told: false, ...(last ? { last } : {}) };
      this.#put('tasks', tasks);
    }
    const now = tasks[id] as KeptTask;
    return { id, label: now.label, state: now.state };
  }

  #startTask(task: NonNullable<AgentTurnPlan['task']>, key: string | null): KeptTask {
    const tasks = this.#tasks();
    const was = tasks[task.id];
    const t: KeptTask = was
      ? { ...was, label: task.label, state: 'open', at: Date.now() }
      : { label: task.label, brief: task.brief, state: 'open', at: Date.now() };
    tasks[task.id] = t;
    const ids = Object.keys(tasks).sort(
      (a, b) => (tasks[a] as KeptTask).at - (tasks[b] as KeptTask).at,
    );
    for (const id of ids.slice(0, Math.max(0, ids.length - TASKS_KEPT))) delete tasks[id];
    this.#put('tasks', tasks);
    if (this.#asked) {
      const taskOf = this.#get<Record<string, string>>('task_of') ?? {};
      taskOf[this.#asked] = task.id;
      this.#put('task_of', taskOf);
    }
    if (key) {
      const byKey = this.#get<Record<string, string>>('task_keys') ?? {};
      byKey[key] = task.id;
      this.#put('task_keys', byKey);
    }
    return t;
  }

  #taskNews(): string {
    const tasks = this.#tasks();
    const ended = Object.entries(tasks).filter(([, t]) => t.state !== 'open' && t.told === false);
    if (!ended.length) return '';
    for (const [id, t] of ended) tasks[id] = { ...t, told: true };
    this.#put('tasks', tasks);
    return taskNews(ended);
  }

  // ── Stop and steer ──────────────────────────────────────────────────────────────────────

  #stopping = false;

  /** Stops the answer running now: what was said and made so far is kept. */
  stop(): void {
    if (!this.#busy) return;
    this.#stopping = true;
    this.#abort?.abort(new Error('stopped'));
  }

  steer(message: string): { steered: boolean } {
    const text = message.trim();
    const t = this.#turn;
    if (!text || !t || !this.#sink || t.plan.steer === false) return { steered: false };
    this.#steers.push({ text: text.slice(0, 20_000), at: Date.now() });
    return { steered: true };
  }

  // ── Cards ───────────────────────────────────────────────────────────────────────────────

  #addCard(
    kind: AgentCard['kind'],
    d: { call?: string; group: string; tool: string; args?: unknown },
    result?: unknown,
  ) {
    const id = d.call ?? `card_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    this.sql(
      'INSERT OR REPLACE INTO lumen_s_cards (session, id, kind, grp, tool, args, result, status, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      this.name,
      id,
      kind,
      d.group,
      d.tool,
      JSON.stringify(d.args ?? null),
      result === undefined ? null : JSON.stringify(result).slice(0, 20_000),
      kind === 'draft' ? 'open' : 'done',
      Date.now(),
    );
    return id;
  }

  #card(id: string): AgentCard | null {
    const [r] = this.sql<CardRow & Record<string, SessionSqlValue>>(
      'SELECT * FROM lumen_s_cards WHERE session = ? AND id = ? LIMIT 1',
      this.name,
      id,
    );
    return r ? cardOf(r) : null;
  }

  #setCard(id: string, status: AgentCard['status'], o: { result?: unknown; error?: string } = {}) {
    this.sql(
      'UPDATE lumen_s_cards SET status = ?, result = COALESCE(?, result), error = ?, told = 0 WHERE session = ? AND id = ?',
      status,
      o.result === undefined ? null : JSON.stringify(o.result).slice(0, 20_000),
      o.error ?? null,
      this.name,
      id,
    );
  }

  cards(): AgentCard[] {
    return this.sql<CardRow & Record<string, SessionSqlValue>>(
      'SELECT * FROM lumen_s_cards WHERE session = ? ORDER BY at DESC LIMIT 200',
      this.name,
    )
      .map(cardOf)
      .reverse();
  }

  async saveCard(id: string): Promise<AgentCard> {
    const c = this.#card(id);
    if (!c || c.kind !== 'draft') throw new Error('That card is gone.');
    if (c.status !== 'open') throw new Error(`That card is already ${c.status}.`);
    try {
      const result = await this.applyDraft(c);
      this.#setCard(id, 'saved', { result });
    } catch (err) {
      this.#setCard(id, 'failed', { error: String((err as Error)?.message ?? err).slice(0, 300) });
    }
    return this.#card(id) as AgentCard;
  }

  dismissCard(id: string): AgentCard {
    const c = this.#card(id);
    if (!c || c.kind !== 'draft') throw new Error('That card is gone.');
    if (c.status !== 'open') throw new Error(`That card is already ${c.status}.`);
    this.#setCard(id, 'dismissed');
    return this.#card(id) as AgentCard;
  }

  async undoCard(id: string): Promise<AgentCard> {
    const c = this.#card(id);
    if (!c || c.kind !== 'write') throw new Error('That change is gone.');
    if (c.status === 'undone') throw new Error('That change is already undone.');
    await this.undoWrite(c);
    this.#setCard(id, 'undone');
    return this.#card(id) as AgentCard;
  }

  #news(): string {
    const rows = this.sql<CardRow & Record<string, SessionSqlValue>>(
      "SELECT * FROM lumen_s_cards WHERE session = ? AND told = 0 AND status IN ('saved', 'dismissed', 'failed', 'undone') ORDER BY at LIMIT 50",
      this.name,
    );
    if (!rows.length) return '';
    for (const r of rows)
      this.sql('UPDATE lumen_s_cards SET told = 1 WHERE session = ? AND id = ?', this.name, r.id);
    return cardNews(rows.map(cardOf));
  }

  // ── Screen calls ────────────────────────────────────────────────────────────────────────

  #screenRows(where: string) {
    return this.sql<{
      id: string;
      label: string;
      moves: string;
      status: string;
      text: string | null;
    }>(
      `SELECT id, label, moves, status, text FROM lumen_s_screens WHERE session = ? ${where}`,
      this.name,
    ).map((r) => ({
      id: r.id,
      label: r.label,
      moves: JSON.parse(r.moves),
      status: r.status as ScreenCall['status'],
      ...(r.text ? { text: r.text } : {}),
    }));
  }

  #screens(): Map<string, ScreenCall> {
    return new Map(this.#screenRows('ORDER BY at DESC LIMIT 200').map((c) => [c.id, c]));
  }

  #outcomes(list: AssistantScreenOutcome[]) {
    for (const o of list)
      this.sql(
        "UPDATE lumen_s_screens SET status = ?, text = ?, told = 0 WHERE session = ? AND id = ? AND (status != ? OR COALESCE(text, '') != ?)",
        o.status,
        o.text ?? null,
        this.name,
        o.id,
        o.status,
        o.text ?? '',
      );
  }

  #screenNews(): string {
    const rows = this.#screenRows('AND told = 0 ORDER BY at LIMIT 20');
    if (!rows.length) return '';
    for (const r of rows)
      this.sql('UPDATE lumen_s_screens SET told = 1 WHERE session = ? AND id = ?', this.name, r.id);
    return screenNews(rows);
  }

  // ── Compaction ──────────────────────────────────────────────────────────────────────────

  /** Past this many tokens the session's older part is summarized (`COMPACT_AT` by default). */
  protected compactAt(): number {
    return COMPACT_AT;
  }

  #last: { plan: AgentTurnPlan } | null = null;
  #owed: UsageMeter[] = [];

  /** The messages the model reads: a summary in place of what was compacted, then the rest. */
  async #modelMessages(): Promise<ModelMessage[]> {
    const c = this.#get<{ upto: number; summary: string }>('compact');
    const rows = this.sql<{ seq: number; json: string }>(
      'SELECT seq, json FROM lumen_s_msgs WHERE session = ? AND seq > ? ORDER BY seq',
      this.name,
      c?.upto ?? 0,
    );
    const ui = rows.map((r) => JSON.parse(r.json) as UIMessage);
    const out = await convertToModelMessages(ui, { ignoreIncompleteToolCalls: true });
    return c
      ? [
          {
            role: 'user',
            content: [{ type: 'text', text: `Summary of this chat so far:\n${c.summary}` }],
          },
          ...out,
        ]
      : out;
  }

  /** Summarizes the older part of the session, keeping the newest messages as they are. */
  async #compact(): Promise<boolean> {
    const was = this.#get<{ upto: number; summary: string }>('compact');
    const rows = this.sql<{ seq: number; json: string }>(
      'SELECT seq, json FROM lumen_s_msgs WHERE session = ? AND seq > ? ORDER BY seq',
      this.name,
      was?.upto ?? 0,
    );
    if (rows.length <= KEEP_AFTER_COMPACT) return false;
    let cut = rows.length - KEEP_AFTER_COMPACT;
    // The kept part starts at a message the person wrote, so no answer is left without its ask.
    while (
      cut > 0 &&
      (JSON.parse((rows[cut] as { json: string }).json) as UIMessage).role !== 'user'
    )
      cut -= 1;
    if (cut <= 0) return false;
    const older = rows.slice(0, cut).map((r) => JSON.parse(r.json) as UIMessage);
    const text = older
      .map(
        (m) =>
          `${m.role}: ${m.parts
            .map((p) =>
              p.type === 'text' ? p.text : p.type.startsWith('tool-') ? `[${p.type.slice(5)}]` : '',
            )
            .filter(Boolean)
            .join(' ')}`,
      )
      .join('\n')
      .slice(-200_000);
    const summary = await this.#summarize(
      `${was ? `Earlier summary:\n${was.summary}\n\n` : ''}Summarize this conversation so the assistant can carry on from it: the person's goals, what was decided and made, names and numbers, and what is still open. Plain prose, at most 600 words.\n\n${text}`,
    );
    this.#put('compact', { upto: (rows[cut - 1] as { seq: number }).seq, summary });
    return true;
  }

  async #summarize(prompt: string): Promise<string> {
    const last = this.#last;
    if (!last) throw new Error('No model to compact with until the next answer.');
    const { plan } = last;
    let meter = new UsageMeter(plan.model, `${plan.label} · compact`, !!plan.key.plan);
    meter.ctx = { task: 'chat', run: this.name };
    this.#owed.push(meter);
    const r = await generateText({
      maxRetries: 0,
      model: this.#model(plan, () => {
        const fb = plan.fallback;
        if (!fb) return;
        meter = new UsageMeter(fb.model, `${fb.label} · compact`, false);
        meter.ctx = { task: 'chat', run: this.name };
        this.#owed.push(meter);
      }),
      prompt,
      abortSignal: AbortSignal.timeout(120_000),
      ...turnSettings(plan.model, { effort: 'default', out: 4000, plan: !!plan.key.plan }),
    });
    meter.add(r.usage);
    return r.text;
  }

  #model(plan: AgentTurnPlan, onSwitch: () => void) {
    const o = { ...(plan.fetch ? { fetch: plan.fetch } : {}), name: this.constructor.name };
    const model = aiModel(plan.model, plan.key, o);
    if (!plan.key.plan || !plan.fallback) return model;
    return planFallback(model, aiModel(plan.fallback.model, plan.fallback.key, o), onSwitch);
  }

  // ── A turn ──────────────────────────────────────────────────────────────────────────────

  #capped = false;

  /**
   * One answer to `input`, its events sent to `sink` in the panel's words. The answer runs in the
   * host: if the sink goes away (the person left), it goes on, and its result is kept.
   */
  async ask(input: AskInput, sink: AskSink): Promise<void> {
    const at = Date.now();
    const out = detachable(sink);
    if (this.#busy) {
      await out.event({ event: 'error', data: { message: 'An answer is still running here.' } });
      await out.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
      return;
    }
    let title = this.#get<string>('title');
    if (!title) {
      title = input.message.replace(/\s+/g, ' ').trim().slice(0, 60);
      this.#put('title', title);
    }
    this.#put('at', at);
    await out.event({ event: 'chat', data: { id: this.name, title } });
    if (input.message.trim() === COMPACT_COMMAND) {
      await this.#compactNow(input, out);
      await out.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
      return;
    }
    if (!input.stay && (await this.offerFresh(input).catch(() => false))) {
      await out.event({ event: 'fresh', data: {} });
      await out.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
      return;
    }
    this.#outcomes(screenOutcomesOf(input.outcomes));
    const quote = quoteOf(input.quote);
    const meta: AskMeta = {
      at,
      ...(input.context ? { context: { label: input.context.label } } : {}),
      ...(input.refs?.length ? { refs: input.refs } : {}),
      ...(quote ? { quote } : {}),
      ...(input.tier ? { tier: input.tier } : {}),
    };
    const map = screenMapOf(input.screen);
    const userId = `u_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const { images: _images, ...asked } = input;
    const pictures = imageParts(input.images);
    this.#append({
      id: userId,
      role: 'user',
      parts: [
        ...(quote ? [{ type: 'text' as const, text: quoteLead(quote) }] : []),
        { type: 'text', text: input.message },
        ...pictures,
      ],
      metadata: meta,
    } as UIMessage);
    const kept: AskInput = {
      ...asked,
      ...(map ? { screen: map } : {}),
      ...(pictures.length ? { image_count: pictures.length } : {}),
    };
    if (!map) kept.screen = undefined;
    // Kept until the turn ends: a restart finds it and carries the turn on (`resume`).
    this.#put('running', { input: kept, asked: userId, at });
    await this.#run(kept, userId, out, false);
  }

  /** Carries on a turn a restart cut off: the person's message is kept, the answer starts again. */
  async resume(sink?: AskSink): Promise<boolean> {
    const r = this.#get<{ input: AskInput; asked: string; at: number; tries?: number }>('running');
    if (!r || this.#busy) return false;
    if ((r.tries ?? 0) >= 1 || Date.now() - r.at > 2 * this.turnLimitMs()) {
      this.#del('running');
      return false;
    }
    this.#put('running', { ...r, tries: (r.tries ?? 0) + 1 });
    await this.#run(r.input, r.asked, detachable(sink ?? { event: () => undefined }), true);
    return true;
  }

  async #run(input: AskInput, userId: string, out: Detachable, continuation: boolean) {
    this.#busy = true;
    this.#capped = false;
    this.#sink = out;
    this.#stopping = false;
    this.#asked = userId;
    this.#steers = [];
    this.#steered = [];
    this.#input = input;
    const abort = new AbortController();
    this.#abort = abort;
    const limit = setTimeout(() => abort.abort(new Error('turn limit')), this.turnLimitMs());
    let failed = false;
    let outcome: AgentTurnEnd['outcome'] = 'ok';
    const work = (async () => {
      try {
        const history = await this.#modelMessages();
        const config = await this.beforeTurn({
          messages: history,
          ...(continuation ? { continuation } : {}),
        });
        const toEvents = chunkEvents({
          ...(this.#last?.plan.advisor ? { advisor: this.#last.plan.advisor.label } : {}),
          cards: () => new Map(this.cards().map((c) => [c.id, c])),
          screens: () => this.#screens(),
          kindOf: (n) => this.#turn?.tools.info.find((i) => i.name === n)?.kind,
          names: this.#names(),
          failed: (f) => this.stepFailed(f),
        });
        const result = streamText({
          model: config.model,
          instructions: config.instructions,
          messages: config.messages,
          tools: config.tools,
          ...(config.activeTools ? { activeTools: config.activeTools } : {}),
          ...(config.toolChoice ? { toolChoice: config.toolChoice } : {}),
          stopWhen: stepCountIs(config.maxSteps),
          ...(config.maxOutputTokens ? { maxOutputTokens: config.maxOutputTokens } : {}),
          providerOptions: config.providerOptions,
          maxRetries: 0,
          abortSignal: abort.signal,
          // A model call that goes quiet ends the turn with an error instead of holding it to the
          // turn's limit: the SDK's own timeouts, the first output allowing for a long reasoning.
          timeout: { firstChunkMs: FIRST_OUTPUT_MS, chunkMs: QUIET_MS },
          prepareStep: (e) => this.beforeStep(e) as never,
          onStepFinish: (e) => this.onStepFinish(e as never),
        });
        let saved = false;
        const stream = result.toUIMessageStream({
          generateMessageId: () => `a_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
          onError: (err) => {
            failed = true;
            if ((err as Error)?.name === 'TimeoutError') return QUIET_TEXT;
            return String((err as Error)?.message ?? err).slice(0, 500);
          },
          onFinish: ({ responseMessage }) => {
            if (responseMessage.parts.length) this.#append(responseMessage);
            saved = true;
          },
        });
        for await (const chunk of stream as AsyncIterable<{ type: string; [k: string]: unknown }>) {
          if (chunk.type === 'error') {
            failed = true;
            await out.event({
              event: 'error',
              data: { message: String(chunk.errorText ?? 'The answer failed.').slice(0, 500) },
            });
            continue;
          }
          for (const e of toEvents(chunk)) await out.event(e);
        }
        if (!saved) failed = true;
      } catch (err) {
        failed = true;
        await out.event({
          event: 'error',
          data: { message: String((err as Error)?.message ?? err).slice(0, 500) },
        });
      }
    })();
    this.host.waitUntil?.(work);
    try {
      await work;
    } finally {
      clearTimeout(limit);
      const timedOut = abort.signal.aborted && !this.#stopping;
      outcome = this.#stopping || timedOut ? 'stopped' : failed ? 'error' : 'ok';
      await this.#end(outcome);
      this.#del('running');
      this.#input = null;
      this.#sink = null;
      this.#asked = null;
      this.#steered = [];
      this.#abort = null;
      this.#busy = false;
      const unread = this.#steers.splice(0).map((s) => s.text);
      if (unread.length) await out.event({ event: 'unsteered', data: { texts: unread } });
      if (this.#capped) await out.event({ event: 'stopped', data: { reason: 'cap' } });
      else if (timedOut) await out.event({ event: 'stopped', data: { reason: 'limit' } });
      else if (this.#stopping) await out.event({ event: 'stopped', data: {} });
      this.#stopping = false;
      // Past the app's compaction point the older part is summarized now, off the answer's time.
      const used = this.usage().context ?? 0;
      if (used > (this.#last?.plan.compactAt ?? this.compactAt()))
        await this.#compact().catch((err) =>
          console.error(
            JSON.stringify({
              event: 'session_compact_failed',
              session: this.name,
              error: String(err).slice(0, 300),
            }),
          ),
        );
      await out.event({ event: 'done', data: { id: this.name, usage: this.usage() } });
    }
  }

  async #compactNow(input: AskInput, sink: AskSink): Promise<void> {
    try {
      if (!this.#last) {
        this.#input = { ...input, message: '' };
        try {
          this.#last = { plan: await this.plan({ messages: [] }) };
        } finally {
          this.#input = null;
        }
      }
      const r = await this.#compact();
      if (r) await sink.event({ event: 'compacted', data: {} });
      else
        await sink.event({
          event: 'text',
          data: { delta: 'This chat is already short: nothing to compact yet.' },
        });
    } catch (err) {
      console.error(JSON.stringify({ event: 'assistant_compact_failed', error: String(err) }));
      await sink.event({
        event: 'error',
        data: { message: 'The chat could not be compacted. Try again, or start a new chat.' },
      });
    }
  }

  /** The turn's settings from the app's plan: an app overrides it to add to them. */
  protected async beforeTurn(ctx: SessionTurn): Promise<SessionTurnConfig> {
    await this.#close();
    const plan = await this.plan(ctx);
    this.#last = { plan };
    const opened = await openAiTools(plan.sources, {
      draft: async (d) => ({ card: this.#addCard('draft', d), note: CARD_NOTE }),
      wrote: async (w) => this.#addCard('write', w, w.result),
      ...plan.tools,
    });
    const free = !!plan.key.plan;
    const call = { task: 'chat', run: this.name };
    const main = new UsageMeter(plan.model, plan.label, free);
    main.ctx = call;
    const meters = [main, ...this.#owed];
    this.#owed = [];
    const advice = plan.advisor
      ? new UsageMeter(plan.advisor.model, plan.advisor.label, free)
      : undefined;
    if (advice) {
      advice.ctx = call;
      meters.push(advice);
    }
    let system = typeof plan.system === 'string' ? plan.system : plan.system(opened);
    this.#keepTitles(opened.info);
    this.#turn = {
      plan,
      system,
      tools: opened,
      main,
      ...(advice ? { advice } : {}),
      meters,
      steps: 0,
      capped: false,
      t0: Date.now(),
    };
    // The session's own file tools, kept to its folder (read, ls, find, grep and the rest).
    const files = createAITools({ workspace: this.workspace, root: this.fileRoot });
    const more = plan.more?.({
      opened,
      files,
      over: () => plan.left !== undefined && this.#spent() >= plan.left,
      meter: (model, label, f = free) => {
        const m = new UsageMeter(model, label, f);
        m.ctx = call;
        meters.push(m);
        return m;
      },
    });
    const advisor: ToolSet = {};
    if (plan.advisor)
      advisor.advisor = anthropic.tools.advisor_20260301({
        model: plan.advisor.model.id,
        maxUses: plan.advisor.maxUses,
        maxTokens: plan.advisor.maxTokens,
      });
    const shown = plan.screen ? this.#input?.screen : undefined;
    const screen: ToolSet = shown
      ? screenTool(shown, (c) => {
          this.sql(
            "INSERT OR REPLACE INTO lumen_s_screens (session, id, label, moves, status, told, at) VALUES (?, ?, ?, ?, 'sent', 1, ?)",
            this.name,
            c.id,
            c.label,
            JSON.stringify(c.moves),
            Date.now(),
          );
        })
      : {};
    if (shown) {
      system = `${system}\n\n${screenRules(shown)}`;
      this.#turn.system = system;
    }
    const tools: ToolSet = { ...files, ...opened.tools, ...more, ...advisor, ...screen };
    let lazy: LazyTools | undefined;
    const offPrompt = new Set(opened.info.filter((i) => i.lazy).map((i) => i.name));
    const many = Object.keys(tools).length > (plan.lazy?.at ?? LAZY_AT);
    if (many || offPrompt.size) {
      const groups = new Map(opened.info.map((i) => [i.name, i.group]));
      const core = (
        plan.lazy?.core ??
        (many
          ? [
              ...opened.info.filter((i) => i.find).map((i) => i.name),
              ...Object.keys(more ?? {}),
              ...Object.keys(advisor),
              ...Object.keys(screen),
            ]
          : Object.keys(tools))
      ).filter((n) => !offPrompt.has(n));
      for (const n of Object.keys(files)) if (!core.includes(n)) core.push(n);
      if (plan.first && !core.includes(plan.first)) core.push(plan.first);
      // A plan model that refused OpenAI's own search takes the assistant's (planTools).
      if (
        plan.model.provider === 'openai' &&
        (!plan.key.plan || planTools(plan.model.id) !== 'additional')
      ) {
        // OpenAI loads a found tool at the end of the conversation, so the cached start stays put.
        const all = deferredTools(tools, core);
        for (const k of Object.keys(tools)) delete tools[k];
        Object.assign(tools, all);
      } else {
        lazy = lazyTools(
          tools,
          core,
          (n) => groups.get(n) ?? 'other',
          usedTools(ctx.messages),
          opened.labels,
        );
        tools[TOOL_SEARCH] = lazy.search;
        system = `${system}\n\n${lazy.catalog}`;
        this.#turn.system = system;
        this.#turn.lazy = lazy;
      }
    }
    const turn = this.#turn;
    const keys = turnKeys(ctx.messages);
    const newest = keys.findLast((k) => k !== null) ?? null;
    let kept: KeptTask | null = null;
    if (plan.task) {
      kept = this.#startTask(plan.task, newest);
      await this.#sink?.event({
        event: 'task',
        data: { id: plan.task.id, label: kept.label, state: 'open' },
      });
    }
    const thread = threadOf(
      ctx.messages,
      this.#get<Record<string, string>>('task_keys') ?? {},
      plan.task?.id,
    );
    const leadsAt = plan.task ? `leads:task:${plan.task.id}` : 'leads';
    const led = stickyLeads(
      thread,
      this.#get<SentLeads>(leadsAt) ?? { sent: {} },
      `${this.#news()}${this.#screenNews()}${plan.task ? '' : this.#taskNews()}${plan.lead ?? ''}`,
    );
    this.#put(leadsAt, led.kept);
    const first = led.messages.findIndex((m) => m.role === 'user');
    const sent =
      kept?.brief && first >= 0 ? leadAt(led.messages, first, `${kept.brief}\n\n`) : led.messages;
    const cached = cachedTurn(system, sent);
    return {
      model: this.#model(plan, () => {
        const fb = plan.fallback;
        if (!fb) return;
        turn.main = new UsageMeter(fb.model, fb.label, false);
        turn.main.ctx = { task: 'chat', run: this.name };
        turn.meters.push(turn.main);
      }),
      instructions: cached.instructions,
      messages: cached.messages,
      tools,
      ...(lazy ? { activeTools: lazy.active() } : {}),
      ...(plan.first ? { toolChoice: { type: 'tool' as const, toolName: plan.first } } : {}),
      maxSteps: plan.maxSteps ?? MAX_STEPS,
      ...turnSettings(plan.model, {
        effort: plan.effort ?? 'default',
        ...(plan.out ? { out: plan.out } : {}),
        plan: free,
        // Named for how the prompt starts, so each session's turns read their own cache. On a ChatGPT
        // plan the key is also the request's `session-id`, and a plan keeps one cached prompt per
        // session-id: the last request's. Sessions that share it (every session with the same model and
        // system line) take it from each other, and a call that follows another session's read 0 of its
        // own unchanged start (live 2026-11-15: each call read exactly the previous request on the id).
        // So on a plan the key names this session too, as OpenAI's own client does (one per thread).
        cacheKey: free
          ? prefixCacheKey(plan.model.id, system, this.name)
          : prefixCacheKey(plan.model.id, system),
      }),
    };
  }

  /** Each model call's settings: the cap, the last call in words, steers and found tools. */
  protected beforeStep(ctx: StepContext): Record<string, unknown> | undefined {
    const t = this.#turn;
    if (!t) return undefined;
    const steered = this.#steerInto(ctx);
    const messages = steered ? { messages: steered } : {};
    if (t.plan.left !== undefined && this.#spent() >= t.plan.left) {
      t.capped = true;
      return { ...messages, activeTools: [], instructions: `${t.system}\n\n${CAP_NOTE}` };
    }
    if (ctx.stepNumber >= (t.plan.maxSteps ?? MAX_STEPS) - 1)
      return {
        ...messages,
        activeTools: [],
        toolChoice: 'none',
        instructions: `${t.system}\n\n${LAST_STEP_NOTE}`,
      };
    const auto = t.plan.first && ctx.stepNumber > 0;
    if (!auto && !t.lazy && !steered) return undefined;
    return {
      ...(auto ? { toolChoice: 'auto' } : {}),
      ...(t.lazy ? { activeTools: t.lazy.active() } : {}),
      ...messages,
    };
  }

  #steerInto(ctx: StepContext): ModelMessage[] | null {
    const sink = this.#sink;
    const asked = this.#asked;
    if (this.#steers.length && sink && asked) {
      const now = this.#steers.splice(0);
      const kept = this.#get<Record<string, SteerNote[]>>('steers') ?? {};
      kept[asked] = [
        ...(kept[asked] ?? []),
        ...now.map((s) => ({ step: ctx.stepNumber, text: s.text, at: s.at })),
      ];
      this.#put('steers', kept);
      for (const s of now) {
        this.#steered.push({ index: ctx.messages.length, text: s.text });
        void Promise.resolve(sink.event({ event: 'steered', data: s })).catch(() => undefined);
      }
    }
    if (!this.#steered.length) return null;
    const out = [...ctx.messages];
    for (const s of [...this.#steered].reverse())
      out.splice(s.index, 0, {
        role: 'user',
        content: [{ type: 'text', text: `${STEER_NOTE}\n\n${s.text}` }],
      });
    return out;
  }

  /** A model call ended: its use is counted. An app may add to it (and call this). */
  protected onStepFinish(ctx: {
    usage: Parameters<UsageMeter['add']>[0];
    providerMetadata?: unknown;
  }): void {
    const t = this.#turn;
    if (!t) return;
    t.steps += 1;
    const p = t.main.add(ctx.usage);
    t.context = p.in + p.out;
    const meta = ctx.providerMetadata as
      | { anthropic?: { iterations?: AdvisorIteration[] } }
      | undefined;
    for (const it of meta?.anthropic?.iterations ?? [])
      if (it.type === 'advisor_message' && t.advice)
        t.advice.addTokens({
          input_tokens: it.inputTokens ?? 0,
          output_tokens: it.outputTokens ?? 0,
          cache_read_input_tokens: it.cacheReadInputTokens ?? 0,
          cache_creation_input_tokens: it.cacheCreationInputTokens ?? 0,
        });
  }

  #spent() {
    return (this.#turn?.meters ?? []).reduce((a, m) => a + m.part().usd, 0);
  }

  async #end(outcome: AgentTurnEnd['outcome']) {
    const t = this.#turn;
    if (!t) return;
    this.#turn = null;
    await t.tools.close();
    const parts = t.meters.map((m) => m.part()).filter((p) => p.calls);
    this.#capped = t.capped;
    this.#put('usage', chatUsage([...this.usage().parts, ...parts], t.context));
    try {
      await this.settle({
        outcome,
        parts,
        ...(t.context ? { context: t.context } : {}),
        steps: t.steps,
        ms: Date.now() - t.t0,
        capped: t.capped,
      });
    } catch (err) {
      console.error(
        JSON.stringify({ event: 'agent_settle_error', error: String(err).slice(0, 500) }),
      );
    }
  }

  async #close() {
    const t = this.#turn;
    this.#turn = null;
    await t?.tools.close();
  }
}

type Detachable = AskSink & { readonly gone: boolean };

/** A sink that stops sending once the caller is gone (the page closed), so the answer goes on. */
function detachable(sink: AskSink): Detachable {
  let gone = false;
  return {
    get gone() {
      return gone;
    },
    async event(e) {
      if (gone) return;
      try {
        await sink.event(e);
      } catch {
        gone = true;
      }
    },
  };
}
