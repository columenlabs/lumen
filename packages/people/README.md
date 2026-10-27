# @columenlabs/lumen-people

Lumen's people, access and invites, server side: who may sign in, what each person may do in each part of an app, invites with a single-use link that expires, and an audit log of every change. It pairs with the People screens in `@columenlabs/lumen-ui/people`. No dependencies beyond `@columenlabs/lumen-ui-types`: Web Crypto, `Request` and `Response`, so it runs in a Worker, a Durable Object, Bun or Node.

- Source: https://github.com/columenlabs/lumen (`packages/people`). MIT.

## Install

```bash
bun add @columenlabs/lumen-people @columenlabs/lumen-ui-types
```

Pin both to the same exact version as the other Lumen packages.

## Scopes and levels

A scope is anything access is given on: an app, or a construct inside one (a folder, a collection). Each has its own ordered levels, lowest first (`None, View, Edit, Admin` when it names none). A person holds one level per scope; no grant is the lowest. Admins hold the top level everywhere; disabled people and expired invites hold the lowest.

```ts
import type { Scope } from '@columenlabs/lumen-ui-types/people';

export const SCOPES: Scope[] = [
  { id: 'tools', name: 'Tools' },
  { id: 'recipes', name: 'Recipes' },
  { id: 'collections', name: 'Collections', parent: 'recipes', resourceLabel: 'Collection' },
];
```

## The service

```ts
import { can, createPeople, doSql, sqlStore } from '@columenlabs/lumen-people';

// In a Durable Object, so the admin floor check and its write never interleave:
const people = createPeople({
  store: sqlStore(doSql(ctx.storage.sql)),   // or sqlStore(d1Sql(env.DB))
  scopes: SCOPES,
  fixedAdmins: ['owner@example.com'],        // always an active admin
  inviteDays: 7,
});

const person = await people.seen('a@example.com');   // on each sign-in: null = refuse
can(person, SCOPES[0], 'view', SCOPES);              // the one check a route makes
```

The rules it keeps:

- One active admin always; the built-in admins can never lose it.
- Only an admin invites, changes access or removes; refusals are logged too.
- An invite link is single use; only its SHA-256 hash is stored. Resend makes a new link and restarts the clock, revoke kills it. An invite past its life is refused at sign-in until resent.
- Every change is one audit event (who, what, when, from where), kept a year.

## The routes

```ts
import { peopleRoutes } from '@columenlabs/lumen-people/routes';

const routes = peopleRoutes({
  base: '/api/people',
  people: () => people,                                 // or a Durable Object stub
  actor: (req) => ({ email, admin, via: 'app' }),       // your verified caller
  scopes: SCOPES,
  appName: 'Example',
  link: (token) => `https://app.example.com/invite/${token}`,
  mailer: () => myMailer,                               // optional: (msg) => { ok, detail }
  onRemove: async (person) => { /* delete their data */ },
});

app.all('/api/people/*', (c) => routes(c.req.raw));
```

Without a mailer every invite returns its link to copy by hand; a failed send never undoes an invite.
