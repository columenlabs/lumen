# @columenlabs/lumen-person

Lumen's one store per person: a Durable Object whose SQLite holds every app's tables for that person. Each app is a module that owns its tables (`<module>_*`), its migrations and its wake time, so app code stays apart while one person's data joins in one SQL query, one backup and one delete. No dependencies: it runs in a Worker with `nodejs_compat` (for `AsyncLocalStorage`) and any Durable Object with SQLite storage.

- Source: https://github.com/columenlabs/lumen (`packages/person`). MIT.

## Install

```bash
bun add @columenlabs/lumen-person
```

Pin it to the same exact version as the other Lumen packages.

## A store and its modules

```ts
import { DurableObject } from 'cloudflare:workers';
import { PersonObject, type PersonModule, personModule } from '@columenlabs/lumen-person';

const notes: PersonModule<Env> = {
  name: 'notes',
  migrations: [
    'CREATE TABLE notes_items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, at INTEGER NOT NULL)',
  ],
  async call(ctx, method, args) {
    if (method === 'add') {
      ctx.sql.exec('INSERT INTO notes_items (title, at) VALUES (?, ?)', (args as { title: string }).title, Date.now());
      await ctx.wakeAt(Date.now() + 60_000);
      return { ok: true };
    }
    throw new Error(`no ${method}`);
  },
  async wake(ctx) {
    // small steps: stop by ctx.deadline and ask for the next time
  },
};

export class PersonStore extends DurableObject<Env> {
  private readonly person = new PersonObject(this.ctx, { modules: [notes], extra: this.env });
  call(owner: string, module: string, method: string, args?: unknown) {
    return this.person.call(owner, module, method, args);
  }
  alarm() {
    return this.person.alarm();
  }
}

// In the Worker
const mine = personModule(env.PERSON, email, 'notes');
await mine.call('add', { title: 'Buy saw blades' });
```

The first call names the person and claims the store; a later call for anyone else is refused (403).

## Row budgets: no loop can spend the account's day

Cloudflare's free plan allows an account 5M Durable Objects rows read and 100k rows written a day, across every object. Past either, every SQL call in every object throws until 00:00 UTC. Every store is bounded (`budget` in its deps, `RowBudget` in `./budget` for any other object):

| Bound | Default | Past it |
|---|---|---|
| One call | 100k rows read, 20k written | its next statement throws; the call answers 503 |
| One wake | 200k read, 20k written | the same, for that wake |
| The store's UTC day | 600k read, 12k written | calls answer 503 until 00:00 UTC |
| `background` share of the day | 0.6 | wakes wait for the next day (spread over its first half hour); calls keep working |

Counts are the cursors' own `rowsRead` and `rowsWritten`, what Cloudflare bills. `onLimit` hears each level once a day (alert someone there). `_object.budget` reads today's totals and `_object.brake {level: 'background' | 'stop' | 'ok', until?}` sets a brake from outside, for when the whole account nears its cap; both answer on a spent day. A request that needs more than one call's budget (an import, a rebuild) is a background job in small wakes, never one request.

## Rules it keeps

- **Migrations fail per module.** Each module migrates on its first call or wake, each step in one transaction. A step that throws leaves only that module answering 503 for a minute before it tries again; every other module keeps working. Never edit or reorder a released step: add one.
- **One alarm for every module.** `_wakes` keeps each module's next time and the store's alarm is the earliest. Each wake gets `ctx.deadline` (30 s by default, `wakeMs`) to stop by and set its next time. A wake that throws is tried again in 1 minute, doubling to an hour.
- **Waiting is shared, work is not.** While one call awaits the network (a fetch, a model) other calls run. Only synchronous work holds the store, so keep heavy parsing out of it.
- **Calls stay in place.** Code running in a person's store that calls the same person through `personCall` runs in place instead of a new request.

## Backup, restore, delete

The store's own module `_object` (or `personModule(...).own(method)` for one module):

| Method | Does |
| --- | --- |
| `dump` | Every module's tables as stored (sealed values stay sealed), with each module's migration level |
| `dumpModule {module}` | One module's tables |
| `loadModule {module, dump, prefix?}` | Replaces one module's tables from a dump. With `prefix`, tables named without it (`items`) load into `<module>_items`, so rows move in from an older store |
| `load` | Replaces every module's tables from a whole dump |
| `wipeModule {module}` | Empties one module's tables and its wake |
| `wipe` | Deletes the whole store (every table, key and the alarm) |
| `counts` | Rows per table, migration levels and any module whose migration is failing |

## Moving rows in from an older store

An app that kept its own Durable Object moves into the person's store a page at a time, so no step holds either store for long:

- The old store answers `exportRows(sql, table, after)`: rows after a rowid bookmark, at most 500 rows and about 4 MB a page (at least one row, so a big blob still moves), bytes as `{b64}`.
- The module's wake writes each page with `importRows(sql, table, page)` inside `ctx.transaction`, keeps the bookmark and asks to wake again. Rows keep their rowids, so a page sent twice changes nothing.
- When every table is across, `rowStats` on both sides (rows and highest rowid per table) must match before the app reads from the new store. Stop the old store's alarm and writes while it moves; a table whose stats differ goes again.
- An old store that held many people's rows in one table moves each person's part: `exportRows(sql, table, after, { where: { sql: 'scope = ?', args: [email] } })` and `rowStats(sql, tables, where)` with the same filter.

Point-in-time recovery (`ctx.storage.getBookmarkForTime`) restores the whole store, every module at once. Restore one module from its dump instead, and keep PITR for the whole store.

Virtual tables (an FTS5 word index from `@columenlabs/lumen-ai`'s `findSql`) are not copied: their triggers fill them as rows load, and a rebuild runs after.
