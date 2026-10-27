/**
 * The HTTP routes the header Tasks list calls (`TasksProvider` in `@columenlabs/lumen-ui`), as one
 * fetch handler on Web `Request`/`Response`, so it mounts in any router:
 *
 *   app.all('/api/tasks/*', (c) => tasks(c.req.raw));        // Hono
 *
 *   GET  /            the caller's list (last 7 days, newest first)
 *   GET  /:id         one task
 *   POST /seen        marks every ended task seen
 *   POST /clear       drops every ended task;  POST /:id/clear  drops one
 *   POST /:id/cancel  cancels one
 *
 * Every call needs a caller; writes must be same-origin JSON, since a signed-in browser session is
 * a cookie and a foreign page's form or fetch must not reach the ledger.
 */
import type { Task, TaskList } from '@columenlabs/lumen-ui-types/tasks';
import type { Tasks } from './store';

type Awaitable<T> = T | Promise<T>;
/** The ledger calls the routes make: the ledger itself, or a stub that forwards to it (a Durable
 *  Object that holds it). */
export interface TasksApi {
  list(owner: string): Awaitable<TaskList>;
  read(owner: string, id: string): Awaitable<Task | null>;
  cancel(owner: string, id: string): Awaitable<Task | null>;
  seen(owner: string): Awaitable<void>;
  clear(owner: string, id?: string): Awaitable<void>;
}

export interface TaskRoutesOptions {
  /** Where the routes are mounted (`/api/tasks`). */
  base: string;
  /** The ledger for this request. */
  tasks: (req: Request) => Awaitable<TasksApi | Tasks>;
  /** The verified caller's owner id (the same one the engines `start` with), or null (403). */
  owner: (req: Request) => Awaitable<string | null>;
}

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (error: string, status: number) => json({ error }, status);

export function taskRoutes(opts: TaskRoutesOptions): (req: Request) => Promise<Response> {
  const base = opts.base.replace(/\/$/, '');
  return async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(base)) return fail('not_found', 404);
    const parts = url.pathname
      .slice(base.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const owner = await opts.owner(req);
    if (!owner) return fail('forbidden', 403);
    if (req.method === 'POST') {
      if (req.headers.get('origin') !== url.origin) return fail('forbidden_origin', 403);
      if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
        return fail('json_only', 415);
    }
    const tasks = await opts.tasks(req);
    const [a, b] = parts;
    if (req.method === 'GET') {
      if (parts.length === 0) return json(await tasks.list(owner));
      if (parts.length === 1 && a) {
        const t = await tasks.read(owner, a);
        return t ? json({ task: t }) : fail('not_found', 404);
      }
    }
    if (req.method === 'POST') {
      if (parts.length === 1 && a === 'seen') {
        await tasks.seen(owner);
        return json({ ok: true });
      }
      if (parts.length === 1 && a === 'clear') {
        await tasks.clear(owner);
        return json({ ok: true });
      }
      if (parts.length === 2 && a && b === 'clear') {
        await tasks.clear(owner, a);
        return json({ ok: true });
      }
      if (parts.length === 2 && a && b === 'cancel') {
        const t = await tasks.cancel(owner, a);
        return t ? json({ task: t }) : fail('not_found', 404);
      }
    }
    return fail('not_found', 404);
  };
}
