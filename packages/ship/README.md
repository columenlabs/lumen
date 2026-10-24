# @columenlabs/lumen-ship

Lumen's shipping kit: one release command that writes each release's notes with Claude, the changelog What's new reads, and the lint guards every Lumen app runs. Bash plus a small TypeScript reader, no framework.

- Docs: https://lumen.columenlabs.com/docs/
- For agents: https://lumen.columenlabs.com/llms.txt
- Source: https://github.com/columenlabs/lumen (`packages/ship`). MIT.

## Install

```bash
bun add -d @columenlabs/lumen-ship
```

Pin it to the same exact version as the other Lumen packages. The command needs `bash`, `git`, `gh` (with REST access to the repo), `jq` and `curl`.

## Releases

`lumen-ship release` cuts a repo's GitHub releases. Run it from the repo root, on each merge to `main` (a CI job) or by hand.

| Command | What it does |
|---|---|
| `lumen-ship release` | One patch release at `main` once `cadence.every` merges landed since the newest `v*` tag, or on the first merge `cadence.days` days after it. `FORCE=1` cuts it now |
| `lumen-ship release minor` | Tags `main` as the next minor. Its notes are the hand-written `docs/releases/v<major>.<minor>.0.md`, which must be on `main` |
| `lumen-ship release notes` | Sets the newest minor's notes from its file again |
| `lumen-ship release tag v1.2.3` | Makes the release of a tag that already exists (for a publish job that tags first). `REDO=1` writes its notes again |

`DRY_RUN=1` prints what it would do and creates nothing.

### Notes

Claude writes each release's notes from the merged pull requests since the tag before (commits stand in where there are none), from your prompt. A reply is published only when whole: anything cut short, refused or failed is asked again, at most 3 times, then the release fails. Without `ANTHROPIC_API_KEY` the notes are GitHub's own list of pull requests.

Set `LUMEN_FORBIDDEN_NAMES` (a regex alternation, `A|B`) in a public repo: notes that name one are asked again and never published, and the pull request list shows numbers only.

### Changelog for What's new

With `changelog.path` set, each release's Key takeaways are also committed to `main` as JSON, newest first, and the tag goes on that commit, so the release deploys its own notes. Each takeaway bullet opens with tags: type tags (`[Feature]`, `[Improvement]`, `[Fix]`, `[Performance]`, `[Security]`) become its chips, and tags listed in `changelog.apps` become its `apps`. Ask for them in your prompt:

```md
- [Fix] [Console] **Exports finish**: ...
```

```json
[{ "tag": "v0.3.2", "published_at": "2026-10-24T18:00:00Z",
   "takeaways": [{ "text": "**Exports finish**: ...", "types": ["fix"], "apps": ["console"] }] }]
```

Serve it to `WhatsNew` (`LumenShell`'s `releases` prop) with the reader:

```ts
import { RELEASES_HEADERS, listReleases, type Release } from '@columenlabs/lumen-ship/releases';
import changelog from './changelog.json';

app.get('/api/releases', (c) =>
  c.json(
    { releases: listReleases(changelog as Release[], {
        limit: c.req.query('limit'),
        before: c.req.query('before'),
        canSee: (apps) => apps.some((a) => mayOpen(c, a)),   // optional
      }) },
    200,
    RELEASES_HEADERS,
  ),
);
```

`listReleases` pages newest first (`limit` 1 to 50, 20 by default; `before` an ISO time) and, with `canSee`, keeps a takeaway about some apps only for people who may open one of them.

### `lumen-ship.json`

At the repo root (or the path in `LUMEN_SHIP_CONFIG`):

```json
{
  "repo": "owner/name",
  "notes": { "prompt": ".github/release-prompt.md", "model": "claude-sonnet-5-5", "maxTokens": 16000 },
  "changelog": { "path": "src/changelog.json", "apps": { "console": "console", "api": "api" } },
  "promote": "release",
  "cadence": { "every": 10, "days": 7 }
}
```

| Key | |
|---|---|
| `repo` | The GitHub repo the releases go on. Required |
| `notes.prompt` | A file with the prompt; `{tag}` becomes the release's tag. Required |
| `notes.model`, `notes.maxTokens` | The model and its output limit (the model thinks first, so keep it large) |
| `changelog.path` | Where the What's new JSON lives on `main`; left out, no changelog |
| `changelog.apps` | Tag (lower case) → app id, for takeaways about one app |
| `promote` | A branch fast-forwarded to each new release (a production deploy branch, say) |
| `cadence.every`, `cadence.days` | When a patch is due. `RELEASE_EVERY` overrides `every` |

## Lint guards

```bash
lumen-ship check kit-neutral [paths]   # no name from LUMEN_FORBIDDEN_NAMES (default: src package.json README.md)
lumen-ship check suppressions          # a useExhaustiveDependencies suppression needs a reason of 3+ words
lumen-ship check settings-copy         # a Settings section description is one plain line of 64 characters or less
lumen-ship check magic-numbers         # hard-coded px/rem class values may only go down
```

Run each from a package folder in its `lint` script. `magic-numbers` reads the repo's `scripts/magic-numbers.baseline` (or `LUMEN_SHIP_BASELINE`): one `<folder> <count>` a line, lowered in the change that removes one.

## Versions

0.x: any minor may break things until 1.0. Every merge to Lumen's `main` publishes the next patch of every Lumen package; see the [releases](https://github.com/columenlabs/lumen/releases).
