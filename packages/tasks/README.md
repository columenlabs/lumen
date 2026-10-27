# @columenlabs/lumen-tasks

Lumen's background jobs, server side: a ledger of the work a person started (a search, a sync, a backfill) with its state, progress and result, cooperative cancel, a reaper that fails anything stuck, and the routes the header Tasks list calls. It pairs with `TasksProvider`, `TasksButton` and `useTaskFor` in `@columenlabs/lumen-ui`, which show a ring while something runs, a dot for ended unseen tasks and a toast with Open when one ends. No dependencies beyond `@columenlabs/lumen-ui-types`: `Request`, `Response` and any SQLite, so it runs in a Worker, a Durable Object, Bun or Node.

- Source: https://github.com/columenlabs/lumen (`packages/tasks`). MIT.

## Install

```bash
bun add @columenlabs/lumen-tasks @columenlabs/lumen-ui-types
```

Pin both to the same exact version as the other Lumen packages.

## The ledger

```ts
import { createTasks, doSql } from '@columenlabs/lumen-tasks';

const tasks = createTasks({
  db: doSql(ctx.storage.sql),        // or d1Sql(env.DB)
  onEnd: async (t) => { /* email or push for long ones */ },
});
```

Nothing runs in the ledger. The work runs where its data is (a Durable Object's alarm, a queue, a runner elsewhere) and reports:

```ts
const t = await tasks.start({
  owner, app: 'jobs', kind: 'search', title: 'Search · Remote roles',
  link: '/feed', ref: search.id, total: 3, unit: 'sources',
});
for (const [i, source] of sources.entries()) {
  if ((await tasks.progress(t.id, { done: i })).stop) return; // cancelled or reaped
  await source.run();
}
await tasks.finish(t.id, { state: 'done', summary: '14 new jobs' });
```

- **Cancel is cooperative.** It ends the task at once; the engine's next `progress` answers `stop: true`. Pass `cancellable: false` for work that cannot stop.
- **Nothing stays running.** A task open past `limitMinutes` (15) is failed on the next read; no cron needed.
- **Kept 7 days** (`keepDays`), newest first, 100 at most in a list.
- `byRef(owner, kind, ref)` finds the newest task for one piece of work, so an engine refuses a second run while one is open.

## The routes

```ts
import { taskRoutes } from '@columenlabs/lumen-tasks';

const routes = taskRoutes({ base: '/api/tasks', tasks: () => tasks, owner: (req) => callerId(req) });
app.all('/api/tasks/*', (c) => routes(c.req.raw));
```

`GET /`, `GET /:id`, `POST /seen`, `POST /clear`, `POST /:id/clear`, `POST /:id/cancel`. Writes must be same-origin JSON. `tasks` may return a stub that forwards to a Durable Object holding the ledger (`TasksApi`).
