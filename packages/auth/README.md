# @columenlabs/lumen-auth

Lumen's sign-in checks for Workers behind Cloudflare Access: verify the token Access signs on every request, in the Worker, so a route stays closed even when the Access application is misconfigured or a request reached the Worker another way. No dependencies: Web Crypto and `fetch`, so it runs in a Worker, Bun or Node.

- Docs: https://lumen.columenlabs.com/docs/
- For agents: https://lumen.columenlabs.com/llms.txt
- Source: https://github.com/columenlabs/lumen (`packages/auth`). MIT.

## Install

```bash
bun add @columenlabs/lumen-auth
```

Pin it to the same exact version as the other Lumen packages.

## Verify an Access token

```ts
import { AccessVerifier, accessToken } from '@columenlabs/lumen-auth';

// One per isolate: the team's signing keys are fetched once and kept an hour.
const access = new AccessVerifier({
  teamDomain: 'myteam.cloudflareaccess.com',
  aud: [env.ACCESS_AUD],            // one application's AUD tag, or several (one Worker, several hosts)
});

const who = await access.verify(accessToken(request));
if (!who) return new Response('Not found', { status: 404 });
who.email;         // the person, when a person signed in
who.serviceToken;  // the service token's client ID, when a service token signed in
who.sub;           // Access's subject id
```

`verify` returns `null` for a missing, malformed, expired or wrongly signed token, a token for another application (`aud`) or another team (`iss`). Only RS256 is accepted. A key id it has not seen fetches the keys again.

| Export | |
|---|---|
| `AccessVerifier(config, fetch?, now?)` | `verify(token)` → `AccessIdentity` or `null`. `fetch` and `now` are for tests |
| `AccessConfig` | `{ teamDomain, aud }` |
| `AccessIdentity` | `{ sub, email?, serviceToken? }` |
| `accessToken(request)` | The request's `Cf-Access-Jwt-Assertion`, if any |
| `ACCESS_HEADER` | `'cf-access-jwt-assertion'` |

Who Access lets in stays Access's policy; what each person may do stays the app's own. This package only proves the request came through Access.

## Versions

0.x: any minor may break things until 1.0. Every merge to Lumen's `main` publishes the next patch of every Lumen package; see the [releases](https://github.com/columenlabs/lumen/releases).
