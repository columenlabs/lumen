/**
 * Tasks inside a chat (`AgentTurnPlan.task`): a piece of work the app runs in its own session, on
 * its own model, inside the same chat. A task's turns read the app's brief and the task's own
 * messages only; the chat's other turns never read a task's messages, and hear how it ended in one
 * line. Each side sends the same earlier messages turn after turn, so both stay in the prompt cache.
 */
import type {
  AssistantTask,
  AssistantTaskState,
  ChatItem,
} from '@columenlabs/lumen-ui-types/assistant';
import type { ModelMessage } from 'ai';

/** A task as the chat keeps it. */
export interface KeptTask {
  label: string;
  /** The app's brief, as first sent: sent again exactly so the task's turns read it from the cache. */
  brief: string;
  state: AssistantTaskState;
  at: number;
  /** The chat's other side heard how it ended. */
  told?: boolean;
  /** The task's last answer, for that note. */
  last?: string;
}

/** Tasks a chat keeps; the oldest go first. */
export const TASKS_KEPT = 40;
/** Turn labels (`AgentTurnPlan.title`) kept per chat, newest first: older turns draw as before. */
export const LABELS_KEPT = 200;
/** A turn label's most characters. */
export const LABEL_MAX = 120;

/** A task's last answer as the chat's note quotes it, at most this long. */
const NOTE_CHARS = 600;

function textOf(m: ModelMessage): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content.map((p) => (p.type === 'text' ? p.text : p.type)).join('\n');
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * A key for each message the person wrote: its words' hash and how many earlier ones had the same
 * words. It stays the same turn after turn, whatever messages come before it.
 */
export function turnKeys(messages: ModelMessage[]): (string | null)[] {
  const seen = new Map<string, number>();
  return messages.map((m) => {
    if (m.role !== 'user') return null;
    const h = hash(textOf(m));
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return `${h}#${n}`;
  });
}

/**
 * The messages one side of the chat reads: a task's turns (each message the person wrote for it and
 * what answered it), or with no task every turn that belongs to none. Messages before the first
 * thing the person wrote (a compaction summary) go to the chat's own side.
 */
export function threadOf(
  messages: ModelMessage[],
  taskOfKey: Record<string, string>,
  task: string | undefined,
): ModelMessage[] {
  const keys = turnKeys(messages);
  let owner: string | undefined;
  return messages.filter((_, i) => {
    const k = keys[i];
    if (k) owner = taskOfKey[k];
    return owner === task;
  });
}

/** The chat's items with each task's turns in its block; a task's later turn joins its block when nothing came between. */
export function taskBlocks(
  items: (ChatItem & { _task?: string })[],
  tasks: Record<string, KeptTask>,
): ChatItem[] {
  const out: ChatItem[] = [];
  let open: (ChatItem & { kind: 'task' }) | null = null;
  let inTask: string | undefined;
  for (const raw of items) {
    const { _task, ...item } = raw as ChatItem & { _task?: string };
    if (item.kind === 'user' && !item.steered) {
      inTask = _task && tasks[_task] ? _task : undefined;
      if (inTask && open?.id === inTask && out.at(-1) === open) {
        open.items.push(item as ChatItem);
        continue;
      }
      out.push(item as ChatItem);
      open = null;
      if (inTask) {
        const t = tasks[inTask] as KeptTask;
        open = { kind: 'task', id: inTask, label: t.label, state: t.state, items: [] };
        out.push(open);
      }
      continue;
    }
    if (open && inTask) open.items.push(item as ChatItem);
    else out.push(item as ChatItem);
  }
  return out;
}

/** The newest task still open. */
export function openTask(tasks: Record<string, KeptTask>): AssistantTask | undefined {
  const [id, t] =
    Object.entries(tasks)
      .filter(([, t]) => t.state === 'open')
      .sort((a, b) => b[1].at - a[1].at)[0] ?? [];
  return id && t ? { id, label: t.label, state: t.state } : undefined;
}

/** How tasks the chat has not heard about ended, as its note. */
export function taskNews(ended: [string, KeptTask][]): string {
  if (!ended.length) return '';
  const lines = ended.map(([, t]) => {
    const how = t.state === 'done' ? 'its result was kept' : 'it was dropped';
    const said = t.last ? ` Its last answer: "${t.last.slice(0, NOTE_CHARS)}"` : '';
    return `- ${t.label}: done in its own session; ${how}.${said}`;
  });
  return `Tasks that ran in their own session since your last answer:\n${lines.join('\n')}\n\n`;
}
