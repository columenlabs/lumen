/**
 * Tasks (in Lumen for
 * every app): a background thing a person started that ends with a result (a
 * Search, a Sweep, a backfill, a sync). Every app shows them in the header's Tasks list; the engines
 * keep their own internals and only report here.
 */

export const TASK_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type TaskState = (typeof TASK_STATES)[number];
export interface Task {
  id: string;
  /** The app it runs on (the product's id for it); the list names it when tasks come from several. */
  app: string;
  /** What kind of work (`sweep`, `tune`, `runner_job`, `backfill`, `search`). */
  kind: string;
  /** `Tune · Holy Grail`: never amounts or accounts. */
  title: string;
  /** The page with the result, a whole address (the app's own host). */
  link: string | null;
  state: TaskState;
  /** Progress, in `unit` (`164` of `256` combos); null when the engine does not count. */
  done: number | null;
  total: number | null;
  unit: string | null;
  /** One line on the result once done (`120 months · 4.1M rows`). */
  summary: string | null;
  /** Why it failed or was cancelled. */
  error: string | null;
  /** Whether Cancel works for it. */
  cancellable: boolean;
  /** ISO-8601. */
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** When the person saw it ended (opened the Tasks list); null while new. */
  seen_at: string | null;
}

/** `GET /api/tasks`: the last 7 days, newest first. */
export interface TaskList {
  tasks: Task[];
  /** Queued or running. */
  active: number;
  /** Ended and not seen yet. */
  unseen: number;
}

export const isActive = (t: Pick<Task, 'state'>) => t.state === 'queued' || t.state === 'running';
