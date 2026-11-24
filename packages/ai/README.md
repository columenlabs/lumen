# @columenlabs/lumen-ai

Assistant and agent parts for apps on Cloudflare Workers. Serving an MCP server from a Worker, keeping only the read tools for a read-only caller, metering every tool call, and the server side of a chat assistant (`@columenlabs/lumen-ai/assistant`).

## Install

```sh
bun add @columenlabs/lumen-ai @columenlabs/lumen-ops @modelcontextprotocol/sdk
```

Pin every `@columenlabs/lumen-*` package to the same exact version. `@modelcontextprotocol/sdk` is a peer: the app's own copy builds the server.

## Serve an MCP server

Build one server per request for the caller you have already checked, then hand it the request. Each request stands alone (stateless Streamable HTTP, JSON responses), since a Worker keeps nothing between requests.

```ts
import { jsonResult, keepReadTools, meterTools, serveMcp } from '@columenlabs/lumen-ai';
import { setToolSink } from '@columenlabs/lumen-ops/tools';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

setToolSink(env.TOOL_CALLS); // once per isolate; tool calls are metered only when it is set

function build(person: string) {
  const mcp = new McpServer({ name: 'my-app', version: '1.0.0' });
  mcp.registerTool(
    'account_list',
    { description: 'Accounts and balances', annotations: { readOnlyHint: true } },
    async () => jsonResult(await accounts(person)),
  );
  return mcp;
}

app.all('/mcp', async (c) => {
  const server = meterTools(build(c.get('person')), { app: 'my-app' });
  if (c.get('viewOnly')) keepReadTools(server);
  return serveMcp(server, c.req.raw, { onRequest: ({ tool }) => c.set('tool', tool) });
});
```

## Exports

| Export | What it does |
|---|---|
| `serveMcp(server, request, opts?)` | Answers one MCP request and closes the server; `onRequest` hears the method and tool first |
| `jsonResult(value)` | A tool result holding one JSON value as text |
| `keepReadTools(server, isRead?)` | Removes every tool that writes; by default a tool is read-only when its `readOnlyHint` is set |
| `meterTools(server, opts)` | Wraps every registered tool so each call is one tool-call point: wall time, outcome, rows of a JSON list, input and output size |
| `registeredTools(server)` | Every tool on a server, by name |
| `mcpCallOf(body)` | The method and tool a JSON-RPC body asks for |

`meterTools` writes through `@columenlabs/lumen-ops/tools`; see its README for the columns.

## Versions

Every merge to `main` publishes the next patch of every Lumen package at once.

## A chat assistant

`@columenlabs/lumen-ai/assistant` is the server behind a chat side panel: Claude or OpenAI models on the app's own tiers, the app's tools from any MCP server, the web, drafts the person saves, hand off to a higher tier, advice, and a monthly spend cap per person. The panel and Settings sections are `@columenlabs/lumen-ui`'s; the shared types are `@columenlabs/lumen-ui-types/assistant`.

```ts
import {
  assistantRoutes,
  createAssistant,
  doSql,
  mcpServerTools,
  sqlAssistantStore,
} from '@columenlabs/lumen-ai/assistant';

const assistant = createAssistant({
  name: 'Helper',
  system: 'You help people with their notes. Use the notes tools for facts.',
  hideModel: true, // never names its model, provider or tier; asked, it is just "Helper"
  // pickTier: false, // the app picks each turn's tier (agentTurn input.tier); no tier menu in the panel and no hand-off: its pick is the only routing
  // Smallest first. The app names them; a person picks each tier's model and effort.
  tiers: [
    { id: 'fast', label: 'Fast', about: 'Quick lookups', model: 'claude-haiku-5-5' },
    { id: 'steady', label: 'Steady', about: 'Most work', model: 'claude-sonnet-5-5' },
    { id: 'deep', label: 'Deep', about: 'Hard judgement', model: 'claude-opus-5-5' },
  ],
  // A tier's `effort` is what it runs at when the person saved none. Each model lists the efforts
  // it takes (`ModelDef.efforts`); `effortFor(model, effort)` gives what is sent, and an effort a
  // model does not take is never sent. Every call logs one `ai.effort` line with the effort sent.
  groups: [
    { id: 'notes', label: 'Notes', about: 'Read and edit notes', tools: (caller) => mcpServerTools(() => notesServer(caller.id)) },
  ],
  web: { fetch: { blockHosts: ['app.example.com'] }, scrapeql: { url: 'https://scrapeql.example.com/mcp' } },
  store: sqlAssistantStore(doSql(ctx.storage.sql)), // or d1Sql(env.DB); { table } names another table
  sealer, // the app's own sealing: keys and chats are stored sealed
  // A provider's key when none is set in Settings.
  appKey: async (provider) => (provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY),
  // Bring your own AI, per caller (a feature flag, a person's plan): which own ways Settings offers
  // and the routes accept, whether their own key falls back to the shared one, and who finishes a
  // turn when a ChatGPT plan runs out ('shared': the same model on the app's key, shared spend).
  // ownWays: async (caller) => ({ openai: ['key', 'plan'] }),
  // ownFallback: async (caller) => true,
  // credits: (tier) => tier !== 'reviewer', // false: that tier runs on the app's key, never counted against allowance
  // planFallback: 'shared',
});
// A check the app always runs on its own key, whoever pays the person's answers:
// await assistant.complete(caller, { task: 'scope', system, prompt, payer: 'app' });

const routes = assistantRoutes(assistant, {
  base: '/api/assistant',
  caller: (req) => ({ id: personId(req), admin: isAdmin(req) }),
});
app.all('/api/assistant/*', (c) => routes(c.req.raw));
```

- **Providers.** A tier runs any model in `models` (Claude's and OpenAI's by default, `CLAUDE_MODELS`, `OPENAI_MODELS`): Claude through Anthropic's Messages API, OpenAI through the Responses API, with the same tools, drafts, Stop and caps. xAI's Grok models (`XAI_MODELS`) are opt in: an app that lists them gets an xAI row in Model providers (an API key, `xai-…`); they run on the same Responses client at `XAI_BASE_URL` (`https://api.x.ai/v1`). xAI has no public sign-in for other apps, so Grok takes a key only. A hand-off may cross providers. The advisor and prompt caching marks are Claude's only.
- **Keys.** Each provider has its own keys (`?provider=anthropic|openai|xai` on the key routes). An admin pastes the shared key everyone uses (`PUT /key`); it is tested with one free call before it is kept, then sealed, and no route returns it. A person may add their own (`PUT /my-key`), with one monthly cap on their own keys (`PUT /my-key/cap`). The cap counts what their own API keys spent this month on providers they can still pay with; a plan sign-in (ChatGPT) costs them nothing per call, so its calls count $0 (each own spend row records its `way`). Status gives that count as `spend.own_used`.
- **ChatGPT sign-in.** In place of their own OpenAI key a person may sign in with their ChatGPT plan (`POST /my-signin`, then `POST /my-signin/finish {url}`): the sign-in opens in a new tab and ends on `http://127.0.0.1:1455/auth/callback`, a page that does not load, whose address the person pastes back. The tokens are sealed as their own key and refreshed before they run out; answers on the plan count tokens and no dollars.
- **Who pays.** The person's pick (the shared keys by default) while it has a key for the tier's provider and money left this month under its cap (an admin sets the shared keys' cap per person, `PUT /app`), else the other; with neither the panel says why.
- **Tools.** Each group is Off, Read, Read + draft or Read + write per person. A tool is a read when its MCP `readOnlyHint` is set. On Read + draft a write only drafts a card, and runs as the person when they press Save, after access is checked again. A group with `readOnly: true` (read tools only) is offered Off or Read alone. Read + write is offered only for a group with `writes: true`: its writes run at once, and with `undo` set each one's line in the chat has Undo, which calls `undo(caller, { tool, args, result })`; the model is told what was undone. Cards drafted one after another show as one stack with Save all. Use `mcpServerTools` (an SDK `McpServer`), `mcpFetchTools` (a server served as a fetch handler, any SDK), `remoteMcpTools` or `plainTools`.
- **Web.** `fetch` is a plain GET from the Worker (10 s, 2 MB, never the app's own hosts or private addresses). ScrapeQL's own tools join over its MCP API once an admin pastes a Cloudflare Access service token (`PUT /web/scrapeql`). A Worker on ScrapeQL's own Cloudflare account passes its service binding instead, `scrapeql: { url: 'https://scrapeql/mcp', fetch: env.SCRAPEQL.fetch.bind(env.SCRAPEQL) }`: no token is stored, the tools are always on and Settings shows the link with a Test. Each web step carries `web` (`StepWeb`: a search's `query` and `results`, or the page it `read`), so the panel folds a search's results under its line and numbers each page read under the answer as Sources chips; the model marks facts with those numbers ([1]).
- **Web lookup (a subagent).** `web: { scrapeql, lookup: true }` swaps fetch and ScrapeQL's own tools for one tool, `web__lookup` (`webLookupTools` from `@columenlabs/lumen-ai/subagents`): given a question (and `urls` when the pages are known), it searches with ScrapeQL, has ScrapeQL's `ask` read the best pages (3 by default, `pages` up to 5) and answer in a few sentences each (`answerTokens`, default 300), and returns `{question, sources: [{url, title, answer}], failed}`: about a thousand tokens, never whole pages, so the assistant's context stays small. No model runs in the kit for it; ScrapeQL picks its own cheapest model. Its step carries `web.lookup` and `web.reads`, which the panel folds under a Looked up line and numbers as Sources chips. `fetch.blockHosts` still applies. Until ScrapeQL is reachable (no binding and no Access token saved yet), the web falls back to `fetch` and the lookup rule is left out, so turning lookup on never takes the web away.
- **Connectors (outside MCP servers).** `connectors: true` lets an admin add any MCP server over Streamable HTTP in Settings (`assistantAdminSections({ connectors: true })`, routes `POST /connectors`, `PUT|DELETE /connectors/:id`, `POST /connectors/:id/test`): a name, an address and up to ten headers it signs in with (an Access service token, an API key; sealed with the app's other settings, never returned, only their names). It is kept only when its test lists its tools, and that list is kept: a turn offers the tools without calling the server, as group `ext_<id>` (`ext_scrapeql__search`), at the access the admin gives it: Off, Read (the tools the server marks read-only) or Read + draft (the rest make a card the person saves or dismisses; nothing runs at once). The server is called only when a tool is, over one connection for the rest of the answer. A connector's tools go on the prompt with every other tool (see Tools: the whole list on every call). A connector's text is data, never instructions; its tool titles never become a step's words, and its tools that search or read a page (`search`, `scrape`, `extract`, `ask`, `screenshot`) carry `web` like the kit's own, so the panel shows their Sources. A connector's optional fields tell the model to leave them out unless it has a real value, so it does not make up ids.
- **Fetch first, a browser when turned away.** `web.escalate: { connector, tool, args? }` (e.g. `{ connector: 'scrapeql', tool: 'scrape' }`) sends a `fetch` the site turns away (401, 403, 429, 503, no answer, or an HTML page with almost no text or a bot check) to that connector's page-reading tool with only `{ url }` and `args`; the page comes back as the fetch's own answer (`via: "browser"`), so the model never retries by hand. Off while that connector is off. A failed step in a plain chat says why in plain words (`plainFailure`: the site turned it away, took too long, page not found), never the raw error.
- **Hand off and advice.** The `escalate` tool hands one task to a higher tier (the person sets next, any or only when asked); Anthropic's advisor tool lets a higher tier send a plan, at most two an answer. A hand-off gives up after `HAND_OFF_MS` (4 minutes) and the turn goes on without it.
- **Chats** run on the agent (`./agent`, `LumenAgent`, below): the app routes `POST /chat` and each chat's reads, cards and Undo to its own agent, and `assistantRoutes` answers `POST /chat` with 410 `moved`. Chats saved by the old turn loop stay readable (`GET /chats`, `GET|DELETE /chats/:id`) until `assistant.purge()` drops them 30 days after their last message.
- **Screen moves**: while the person's Settings ▸ Screen is Move (the default), the panel sends its page map (`AssistantMessage.screen`: routes, nav pages, Settings sections, cards on screen, rows to open) and `LumenAgent` gives the model a `screen` tool (`./agent` `screen.ts`). Each call's moves (go, settings, chart, open, point) are checked against the map, kept in the chat and streamed as a `screen` event; the panel runs them through `AssistantScreenProvider` (mounted by `LumenShell`) with an Undo chip, and their outcomes go back with the next message (`outcomes`). Nothing is saved by a move.
- **Background work** an app runs for a person (a score, a summary) is `assistant.complete(caller, { task, system, prompt, images?, maxTokens })`: one answer on the task's tier (`tasks`, so the person picks its model in Settings ▸ Models), no chat and no tools (`images`, base64 with their media type, are read with the prompt: a scanned page, a screenshot), billed to their payer and counted in their spend and allowance like a chat turn. `maxTokens` (default 1,000) goes up to `COMPLETE_MAX_TOKENS` (32,000, thinking included); the answer is streamed, so a long one keeps its connection, and `cut: true` says it stopped at the cap before it ended (the app can ask again, shorter, or continue). It throws `AssistantError` `not_connected`, `app_cap` or `own_cap` when nobody can pay, so the caller waits and tries later. It returns the answer's `usd`, `model`, `usage` (tokens in, cache reads, out, per model) and `payer` (`app` or `own`: who paid, so the app can show a cost on the person's own key as money and the rest as credits). `effort` sets how hard the model thinks on that one call (`low` to `max`; on an OpenAI or xAI model it is the request's reasoning effort), over what the person saved for the tier. `run: { id, title }` makes the calls that share an `id` one line of the person's usage history (every round of one rebuild); without it a task's calls that day share a line. The month's spend also adds up per task and model (`spend:YYYY-MM` `tasks`: answers, calls, tokens, cost and time, a chat answer as `chat`), so an app's admin page can show what each kind of work costs; `tag` counts one call under another name when a task does more than one kind of work (a first try, a repair). **Prompt cache:** a provider's cache reuses whole earlier messages, not text added inside the same message (OpenAI read 0% of a prompt that only gained a part, and 99.7% when the same words came as a new message). So a job of several steps (a study that asks for more pictures, then a build) passes `history`: the conversation so far as `{ role, text, images? }` messages, oldest first, ending with the model's answer, and `prompt` and `images` as the newest message; each call then pays only for what is new. `prompt` may also be a list of parts (Claude marks every part but the last), which helps only an exact repeat on OpenAI. OpenAI calls carry a cache key per person, task and run (a ChatGPT plan sign-in caches nothing without one).

**Call log:** every model call (chat steps, hand-offs, compaction, `complete`) writes one JSON line on the console, `{ event: 'ai.call', model, label, task, run, in, read, written, out, hit, usd, free }`: tokens in (cache included), cache reads and writes, out, the share read from cache (`hit`), the cost at list price, and `free` for a plan sign-in. Workers Logs keeps it, so an app sees each call's cache use with no wiring. `setCallLog(fn)` sends the records elsewhere; `setCallLog(null)` turns it off.
- **Images** an app makes for a person are `assistant.image(caller, { task, prompt, images?, size?, quality?, run? })`: one image on the payer's OpenAI key (`IMAGE_MODEL`, gpt-image-2; a ChatGPT plan sign-in cannot make one), from `images` when given (a reference, a sketch), billed and capped like `complete` at the model's list price per token. It returns the PNG as base64 with its `usd`. A chat tool that returns `image: { url, alt?, cost? }` shows as an image card in the panel (`StepItem.image`); `LumenAssistant` `imageTool` names that tool (its "Making the image" box while it runs, Make another) and `modes` adds composer toggles (Make an image) whose id goes with the message as `use`.
- **Usage history.** Each chat (`agentTurn` with `chat`) and each run of background work is one line of the person's month (`usage:YYYY-MM`, the newest 300): its title, first and last use, tokens, cost and its parts per tier and model. `GET /usage?month=YYYY-MM` returns it beside that month's spend and the months that have any; `LumenAssistant`'s footer shows this month's total and opens it (`UsageHistoryView`).

### Commands, `@` and `#`

The panel's composer lists what can follow three keys as they are typed. The kit's own entries are on for every app; an app only adds its own.

- **`/` commands.** Built in: `/compact` (summarise the chat), `/clear` (a new chat), `/model <tier>` (answer on another tier from now on) and `/escalate <task>` (hand one task to the next tier up). An app adds its own on the server with `commands`: the chat shows what the person typed and the model gets `prompt`, with `{args}` replaced by the words after the name (or what the function returns). An app's command wins a built-in's name.

  ```ts
  createAssistant({
    // ...
    commands: [
      { name: 'story', about: 'Find stories for a question', args: '<question>',
        prompt: 'Search my stories for: {args}. List the best three with why each fits.' },
      { name: 'prep', about: 'Prep for an interview', args: '<company>',
        prompt: async (company, caller) => prepPrompt(caller.id, company) },
    ],
  });
  ```

  A command that acts in the browser (opens a page, sets a filter) goes on the panel instead: `LumenAssistant` (or `useLumenAssistantDock`) takes `commands`, each `{ name, about, args?, options?, run }`; `run` returns text to send, or nothing when it acted itself, and `options` lists choices for its words as they are typed.
- **`#` a tier.** `#` lists the app's tiers; the pick is a chip and goes with that message only (`tier`). A higher tier takes it as a task in its own section of the chat; the same or a lower one answers it.
- **`@` a thing.** `@` lists what the person can point at, a group per source; each pick is a chip and goes with the message as a ref (`kind`, `label` and whatever finds it), which the model reads before the message. Standing sources go on the panel (`sources`); a page adds its own while it is shown:

  ```tsx
  import { useAssistantSource } from '@columenlabs/lumen-ui/assistant';

  useAssistantSource({
    id: 'page',
    label: 'On this page',
    items: (q) =>
      rows
        .filter((r) => r.title.toLowerCase().includes(q.toLowerCase()))
        .map((r) => ({ id: r.id, label: r.title, target: `card:${r.id}`, ref: { kind: 'story', label: r.title, id: r.id } })),
  });
  ```

  `target` lights the thing on screen while its row is hovered. A page's source replaces a standing one with the same `id`.

  Text the person highlights on the page is offered first under `@` (Selected text), with where it sits from the nearest `data-assistant-where` attribute. To hand a highlight over from the page, an Ask button calls `composeAssistant({ refs: [selectionRef({ text, where })], text: '' })` (or any refs and text): the panel opens with the chips in the composer, focused for the person to finish.

### Bearings

Each message the model gets starts with a few lines of bearings: the time now in the person's zone (the panel sends the browser's), UTC, how long since the chat's last message and the app's name. They go in the message, not the system prompt, so the prompt cache holds. A turn's lead (bearings, `plan.lead`, news) stays on the message it went with, so every earlier message is sent exactly as before and read from the prompt cache (a lead taken off the last message changed it, and that message and its tool steps were paid again: 0% read before, 97 to 99% after, on OpenAI). The newest lead says only what changed since the last (`stickyLeads`, `leadDelta`): one line when nothing did, the new and gone lines when some did, and the whole lead the first time, after compaction, or when the change is most of it. `/compact` in the panel summarizes the chat's older part at once (as past `compactAt()`). An app adds its own lines with `bearings`; each call gets 300 ms, and when it is late or throws its lines are left out.

**Prompt cache: always on.** Every model call the kit makes goes through `aiModel()`, which wraps the provider's model in one AI SDK middleware (`promptCache`). It sets Claude's breakpoints (after the system line, on the message before the newest ask, and after the newest block) and OpenAI's cache key (model and system line; on a ChatGPT plan also the conversation's first message, since a plan keeps one cached prompt per `session-id`). No caller passes a key or marks a message; `aiModel(model, key, { cache: false })` is the only way to turn it off. A compaction sends the last turn's own prompt plus one summarize message (`SUMMARY_ASK`), so it reads that prompt from the cache instead of paying for it again. A call that reads less than half of the previous call of its conversation (same key and first message, within 30 minutes) logs `ai.cache_miss` with the first message that changed (`changed`, `role`). Lint refuses `@ai-sdk/openai`, `@ai-sdk/anthropic`, `openai` and `@anthropic-ai/sdk` outside `agent/models.ts` (and `assistant/engine.ts`, for images and key checks only), so no call can skip it. A session keeps one reasoning effort, the one its first call asked for, while its model stays the same: a call at another effort reads nothing from the cache, so a plan's `effort` changes it only with `resetEffort: true`. Its compaction resends exactly what its last call sent (instructions, messages, the tools offered) plus the summary ask.

```ts
createAssistant({
  // ...
  app: 'Notes',
  timeZone: 'America/Los_Angeles', // when the browser sends none
  bearings: ({ now, at, span }) => `Next backup: ${at(nextBackup(now))} (in ${span(nextBackup(now) - now)})`,
});
```

An app with its own assistant loop builds the same block with `bearings({ timeZone, lastAt, app, extras })` and puts it before the message.

### Find: one question, one query

The standard way to search an app's records (Columen's canonical setup, 2026-10-28): every app that shows the assistant a collection gives it a find tool, never a list plus one-record reads. One call turns the question into one query that runs where the rows live (D1 or a Durable Object's SQLite). The model gets back only the matching rows and the fields it asked for, and makes the final call itself.

- **Filters** (tags, number and date ranges) are exact SQL.
- **Words** are matched by an FTS5 index (`porter unicode61`, so "egg" finds "eggs"): `any`, `all`, `none` (leave out: "no milk"), and `in` to say which fields to look in.
- **Meaning** comes from Vectorize, opt in per app: `like` ("something light for a hot day") asks the index for the nearest rows, and the same filters and words trim them.
- **Worked-out fields**: a number, date or tag field may be the app's own SQL over the row (`sql: 'json_array_length(t.steps)'`) instead of a column.
- **Counts**: the result carries `count` (all matches), `returned` and `same_name` (different rows that share a name), so the model says the right number. A search by meaning carries `nearest: true` and no `count`: its rows are the nearest few, not every row that fits, so the model never quotes them as a number of matches.

```ts
import { d1Sql, defineFind, findSql, findTool } from '@columenlabs/lumen-ai/assistant';

export const notesFind = defineFind({
  name: 'notes', label: 'note', table: 'notes', key: 'id',
  where: 'deleted = 0',          // the app's own SQL, always applied
  order: 'updated_at DESC',      // with no words to rank by
  fields: {
    title: { kind: 'text' },
    body: { kind: 'text', show: false },     // searchable, returned only when asked
    tags: { kind: 'text', json: true },      // a JSON column, returned parsed
    folder: { kind: 'tag' },                 // exact filter; its values are listed to the model
    updated_at: { kind: 'date' },            // updated_at_from, updated_at_to
  },
});

// In a group's tool source, per answer (a Durable Object passes doSql(ctx.storage.sql)):
plainTools([await findTool(notesFind, d1Sql(env.DB))]);
```

- `findTool` makes `<name>_find` with a flat input schema (every provider takes it) and reads each tag field's values once to list them. The assistant tells the model to put a whole question in one find call.
- `runFind(def, sql, query)` is the same query without the tool: bound parameters only, never model-written SQL. It gives up after 3 s.
- `findSql(def)` gives the index's SQL. `create` is an external-content FTS5 table plus triggers that keep it in step on every insert, update and delete, whoever writes. `fill` indexes the rows already there, and `drop` takes it all out. Put `create` and `fill` in a migration (D1) or a budgeted background step (a Durable Object), never on a request. Until the index exists, words fall back to a plain text match and the result says so, so code can ship before its migration.

Meaning, for the apps whose people ask loosely (a recipe book, a career log; not for exact records like card benefits):

```ts
import { meaningStep, vectorMeaning, workersEmbed } from '@columenlabs/lumen-ai/assistant';

// On the definition: what a row means, and the column every write moves.
meaning: { fields: ['title', 'body', 'tags'], changed: 'updated_at' },

const embed = workersEmbed(env.AI);              // bge-base-en-v1.5: a 768-dimension cosine index
await findTool(notesFind, d1Sql(env.DB), { meaning: vectorMeaning({ embed, index: env.NOTES_INDEX }) });

// Off the request path (waitUntil after a write and when the tool opens, an alarm, a queue):
ctx.waitUntil(meaningStep({ def: notesFind, sql: d1Sql(env.DB), embed, index: env.NOTES_INDEX, mark }));
```

- `meaningStep` embeds only the rows whose `changed` column moved past its bookmark (`mark`: get and put, kept by the app), at most 50 a step in one embedding call and one upsert, and takes rows the find hides (its `where`) out of the index. It resumes where it stopped and runs safely twice at once; `done` is false while rows are left.
- A person's own rows get a `namespace` each (`vectorMeaning` and `meaningStep` take one), so one index serves one app.
- When the index cannot answer in 3 s, `like` is left out, the rest of the find runs and the result says so.

## An agent on Cloudflare Think

`@columenlabs/lumen-ai/agent` runs one chat as a Cloudflare Think agent (`@cloudflare/think`, experimental) on the app's tiers, keys and tool groups. Think keeps the loop, the messages, streaming, resume and compaction; the kit adds the model on the payer's key, the tools at the person's access, the spend cap and the usage. It will replace `./assistant`'s own loop.

| Export | What it does |
|---|---|
| `LumenAgent` | An abstract Think agent. The app answers `plan(turn)` (model, key, effort, instructions, tool sources, money left) and hears `settle(end)` (outcome, usage parts, context size, time) when the turn ends |
| `aiModel(model, key, opts?)` | The AI SDK model for a tier on an API key, or on a ChatGPT plan sign-in (`key.plan`, through `planFetch`) |
| `planFetch(fetch?, name?)` | Rewrites Responses calls to a plan sign-in's rules: tools in one namespace, no output cap, a forced call as the only tool, every call streamed (a call that is not streamed, such as a hand-off or a compaction, gets back the one response it asked for) |
| `planFallback(primary, fallback, onSwitch)` | A plan's model that hands the call, and the rest of the turn, to `fallback` when the plan reaches its usage limit (a 429 or a usage code, before any output) |
| `turnSettings(model, opts)` | Output cap and effort as the provider takes them |
| `openAiTools(sources, opts)` | The app's tool groups as AI SDK tools: reads always, drafts and writes by access, results cut at 16k characters |
| `UsageMeter`, `tokenUsage(u)` | Prices each step's tokens (cache reads and writes, reasoning) into one usage part |

A ChatGPT plan sign-in is free to the app (`priced` with `free`). When the plan is used up for now, a turn with `fallback` (`agentTurn` sets the app's first Claude on the same payer's Anthropic key) answers on Claude instead of ending in the limit's error, its use its own part. Nothing here holds a key or a token: the app passes them per turn.

An app with an `Assistant` gets the whole plan from it: `assistant.agentTurn(caller, { message, tier?, context?, refs?, time_zone? })` returns `{ plan, settle }` with the person's tier and model on whoever pays, the tool groups at their access, the kit's rules, the bearings and the page before the message, `escalate` to a higher tier (its own usage part, inside the same cap) and Claude's advisor. `settle` adds the spend to the payer's month and reports the turn through `onStep`. It throws `AssistantError` when nobody can pay.

Drafts and writes are cards in the chat's own storage (`lumen_cards` in the agent's SQLite). A write the person's access only drafts makes an open card and changes nothing. `saveCard(id)` runs it through the app's `applyDraft`, and `dismissCard(id)` drops it. A write made at once is kept for `undoCard(id)` through the app's `undoWrite`. `cards()` lists the cards. The next answer is told how each card ended and what was undone. With an `Assistant`, `applyDraft` is `assistant.runDraft(caller, card)` and `undoWrite` is `assistant.undoChange(caller, card)`. Think compacts the chat past `COMPACT_AT` (150k tokens) on the last answer's model and key, and that spend is added to the next answer. An app sets its own with `createAssistant({ compactAt })` (give the agent's `compactAt()` the same number), and each person may pick another in Settings (Auto-compact, `AutoCompactField`, status `compact_at`); the agent applies it from the next message. The panel's context donut turns yellow at 75% of that point and red at it, and its pop-up (hover, focus or a tap) shows context used, turns, images and attachments, and the cache read share.

**Connectors.** There is one kind: the app's connectors (`createAssistant({ connectors: true })`, above), offered to a turn as groups `ext_<id>` through `plan.sources`. Think never merges its own MCP servers (`includeMcpTools` is false).

**Tools: the whole list on every call.** Every turn sends the model every tool it may use, in the same order, with no tool search (`plan.lazy` is ignored and kept only so older apps type-check). The reason is the prompt cache: a provider reads a prompt from its cache only as far as it matches an earlier one, and the tool list sits at the start. A list that never changes is paid in full once, then read at the cached price (5 to 10% of input) on every later call. A search that adds found tools changes that start, so everything after it, the whole chat included, is paid in full again, and each search is one more call that sends the whole context.

Measured 2026-11-15 on a ChatGPT plan (GPT-6.1 Terra, priced at its API rates: $1/M input, $0.05/M cached, $5/M output), with one app's real 30 tools (about 7.3k tokens) and its real 10.6k-character instructions, the same 5 turns each needing a tool not used before, from a cold cache:

| Way | Calls | Cache read | Output tokens | Cost per chat | Asks done |
|---|---|---|---|---|---|
| **Whole list (this kit)** | 10 | 89% | 252 | **$0.017** | 5/5 |
| Lumen's own search (found tools added later in the chat) | 13 | 66% | 318 | $0.034 | 5/5 |
| AI SDK `toolSearch` | 16 | 72% | 384 | $0.028 | 4/5 |
| AI SDK `toolSearch`, found tools added later | 15 | 68% | 397 | $0.028 | 4/5 |
| MiniSearch ranking through AI SDK `toolSearch` | 16 | 58% | 419 | $0.036 | 4/5 |

The searches start each turn smaller (about 3k tokens against 9.8k), but they cost more in the end. They miss the cache after each search and take 3 to 6 more calls. Keyword search also missed a tool once ("make the lid blue" never found the colour tool), and the chat then answered that it could not. Live chats agreed: with the whole list (63 tools, about 13k tokens), a chat's first call was about 17.8k input tokens and later calls read about 98% of it from cache.

This holds only while later calls read most of the prompt from cache: a turn's calls after its first should read 80% or more of their input. An app logs each call's input, cache read and tool calls, so it can count its sessions by the tools they use and see whether that still holds. If reads fall below that, or a list grows far past what a session uses, measure again before bringing a search back.

**Images.** `AskInput.images` (base64 PNG, JPEG, WebP or GIF; at most `ASSISTANT_IMAGES_MAX` (4) and `ASSISTANT_IMAGE_CHARS` together) go into the user message as file parts (`imageParts`), so the model sees them and the chat shows them again. `LumenAssistant images` lets the person paste (Cmd+V) or drop images on the box; the composer scales each to 1568 px on its long edge. An app's `POST /chat` passes `images` on in its `AskInput`. An image may carry a `name` (a file's name, "Pasted image", what a close-up shows): it is kept as the file part's `filename`, comes back on the chat's user item as `imageNames`, and Copy chat lists it ("Attached: drawing.png, Pasted image"). Images past the count or size are never dropped quietly: `imagesLeftOut` adds a line naming them to the message, so the assistant tells the person. A message with images or pointed-at things is never steered into a running answer (a steer carries words only): it waits in the queue and goes whole.

**The panel.** `LumenAssistant` reads a Think chat with no change. `ask(input, sink)` runs one answer and sends the panel's own events (`AssistantEvent`: the chat, the text, each tool line, cards, hand-off sections, advice, the use) to `sink`. The app's `POST /chat` returns `askResponse((sink) => chat.ask(input, sink), { signal, stop: () => chat.stop() })`, the same server-sent events `assistantRoutes` sends. `view()` gives a stored chat as the panel's items, and `usage()` gives the chat's use so far. A card's id is its tool call's, so the panel's Save, Dismiss and Undo go to `saveCard`, `dismissCard` and `undoCard`. The app keeps the list of chats, and each chat is its own agent, such as a facet of the person's store. `chunkEvents` and `itemsOf` are the mapping, for an app that streams some other way.

**Tool lines.** Each tool call shows as a line with the tool's own `title` (an MCP tool's `title`, a plain tool's `title`), kept in the chat's storage so a chat read back words its lines the same; a tool with no title shows its name. An app that keeps its insides off the screen overrides `plainSteps()` to return `true`: every line reads its tool's title, else a word for what it did (Look something up, Make a change, Draft a change), with no tool id, row count or error text (a failed line says `didn't work`), and a hand-off section reads Take a closer look with no tier or task. The details go to the app's log instead: `stepFailed({ tool, error, ms })` hears each failed call with its whole error (override it to log it with the chat's ids), and `onStep` carries `error` and `caller` on a failed tool or hand-off. `stepTitleOf(name, kind)` gives a line's title for an app's own card answers. **Step lines say what a call did** (`stepLine(c)`): override it to word each call as a verb and what it acted on, from the call's own arguments and answer (`c.input`, `c.output`): present tense while it runs (`state: 'running'`, sent again once the arguments are in), past tense with a short result when it answered (`'done'`), and "Couldn't …" when it failed (`'failed'`, which then shows no `didn't work`). Return `undefined` to keep the tool's title. A tool whose change lives in the app's page rather than on its server (what a list shows or hides) answers `apply` (or its result does): small JSON the step carries untouched as `StepItem.apply` (up to `STEP_APPLY_MAX` characters), so the app's panel applies it and puts it back when the step is undone. Wrap each thing the line names (a part, a file, a row) in `stepName(name)` and the chat draws it as a name token in the accent colour (`Moved ${stepName('Top Small')}: …`); the marks are invisible Unicode isolates, so logs and older chats show the plain name. The kit words its own web lookup (Looking up / Looked up the question). A finished line is kept with the chat, so a chat read back reads the same. In a plain chat a `tool_search` call kept in an older chat's history shows no line. **Lookups fold into one line** (`stepFold(c)`): read-only calls in a row (not failed, no change, no choices or image) fold into one line, in a task's card and in a plain turn, that says what was read in one sentence and opens to one row per group, with no times or counts per call. Override `stepFold(c)` to place a call: `group` is the row's label ("Guides"), `what` the thing it read ("Retries"), `one` / `many` word the group in the line with `{n}` and `{what}` ("the {what} guide", "{n} guides"), so three guide reads and eight reference reads read "Read 3 guides and the API reference" and open to "Guides  Retries · Backoff · Limits" and "API reference  8 lookups". Calls with no group say their own line, ×N when repeated. While a call in the fold runs, the line shows its present-tense line with a spinner. The group is kept with the chat like the line. A running call shows the app's `stepLine` from its first moment (called with no `input`), before its arguments are in; return `undefined` there to keep the tool's title.

**A write in progress.** A tool line starts (`step_start`) as soon as the model starts the call, while it is still writing the arguments. For a Read + write tool it carries `write: true`, and `useAssistantChat` marks that running step `writing` until its result lands or the answer ends, so an app can show what the tool changes as being changed now (a pending edit is not ready to accept while the model rewrites it).

**Steps.** One answer makes at most `plan.maxSteps` model calls (`MAX_STEPS`, 8). The last one runs with no tools and `LAST_STEP_NOTE`, so an answer always ends in words: what it found, and what is left when the task did not fit.

**Stop.** The panel's Stop calls the adapter's `stop(chatId)`; the app routes `POST /chats/:id/stop` to the agent's `stop()`, the answer ends on the server with what it said and made so far, and its stream ends with `stopped`. An app without the route falls back to dropping the stream after a few seconds; the answer then runs on (`waitUntil`) and its result is in the chat when it is opened again.

**Tasks inside a chat.** A plan may name a task (`plan.task: { id, label, brief }`): work the app runs in its own session on its own model inside the same chat, such as a hard edit. The task's turns read the app's `brief` (sent as first given) and the task's own messages only; the chat's other turns never read them and hear in one line how the task ended (`endTask(id, 'done' | 'dropped')`, with its last answer). Each side resends the same earlier messages turn after turn, so both stay in the prompt cache. The panel shows a task's turns as one block (`TaskItem`; the app's buttons in its header through `LumenAssistant` `taskActions`, its state through `taskState`), and while it is open a chip over the box sends the next message with `task: <id>` until the person steps out with its ×; the app's plan decides whether that message goes on the task. An app with `pickTier: false` has no hand-off tool: its pick of each turn's tier, and its tasks, are the only routing.

**Steer and queue.** While an answer runs, the panel's box stays open: Enter steers the message into the answer (`steer(message)` on the agent; the app routes `POST /chats/:id/steer` `{ message }` to it and answers `{ steered }`), Alt+Enter queues it for after. A steer joins at the answer's next step, after the tool it is on, with `STEER_NOTE` before it for the model; the panel shows it there marked Steered (event `steered`), and `view()` keeps it in place (`SteerNote`, under the message the answer is to). A steer the answer ends before reading comes back as `unsteered` and goes first in the queue. `plan.steer: false` turns it off for a model; an app without the route (404) shows Queue only. Queued messages each go as their own message when the answer before them ends; each has Steer now, Edit and Remove.

**Retry.** A turn that ended in an error shows a Retry icon (⟳) beside Copy, always visible, while no answer runs and someone can pay (`status.wait` unset; hidden otherwise, never disabled). It sends the turn's words, `@` parts, `#` tier and images again as a new message (`chat.retry(at, user, extra)` in `useAssistantChat`), marked Retry above the bubble; the old error turns grey (`retried` on the error item) and stops offering Retry. Nothing changes on the server: the retried message is an ordinary message.

```ts
class Chat extends LumenAgent<Env> {
  #settle?: (end: AgentTurnEnd) => Promise<void>;
  async plan(turn: TurnContext) {
    // this.input: what the person sent (message, page, refs, tier, time zone).
    // chat: this chat's id, so its use is one line of the person's usage history.
    const { plan, settle } = await assistant.agentTurn(caller, { ...(this.input ?? { message: '' }), chat: this.name });
    this.#settle = settle;
    return plan;
  }
  settle(end: AgentTurnEnd) { return this.#settle?.(end) ?? Promise.resolve(); }
  protected applyDraft(card: AgentCard) { return assistant.runDraft(caller, card); }
  protected undoWrite(card: AgentCard) { return assistant.undoChange(caller, card); }
}
```

## Workspaces: tabs over recipes, run again on demand

`@columenlabs/lumen-ai/workspaces` is the server the kit's `WorkspacesSection` and `WorkspacePage` call. A workspace is a person's page of tabs; each tab is a table over a **frame**: the rows one **recipe** pulled, the recipe itself and the person's hand edits. A recipe is one call to one of the product's read tools (`{kind: 'call', fn: 'jobs.list', args}`), so running it again needs no model. Nothing runs on a timer: ↻ on a tab runs its recipe, ↻ in the header runs every tab one after another, each within 15 s (`RUN_MS`); a failed run keeps the last rows and says why.

```ts
import { createWorkspaces, doSql, workspaceMigrations, workspaceRoutes } from '@columenlabs/lumen-ai/workspaces';

// In the store that holds the person's data (a Durable Object's SQLite, or D1 with d1Sql):
for (const q of workspaceMigrations({ spaces: 'app_ws_spaces', frames: 'app_ws_frames' })) sql.exec(q);
const store = createWorkspaces({
  db: doSql(sql),
  tables: { spaces: 'app_ws_spaces', frames: 'app_ws_frames' },
  run: (recipe, { owner, signal }) => callReadTool(owner, recipe, signal), // the product's own tools, as the person
});

// In the Worker, at the assistant's api:
const routes = workspaceRoutes({ base: '/api/assistant', owner: callerOf, store: () => store });
```

Budget: one frame is one row (at most 1.5 MB of rows, 10,000 rows, 50 columns), so a run writes one row; every read has a LIMIT (30 workspaces, 12 tabs each, 100 frames). Columns are typed from their values (number, date, text); a list of words, or short text from a small set, becomes a tags column (chips). The kit's `WorkspacesProvider` takes `recipes` to offer + New tab from a recipe in the tab bar.

### Web data and pushed datasets (no server code runs)

Three more ways rows reach a tab, all on a free Workers plan (no Dynamic Workers):

- **Fetch recipe** (`{kind: 'fetch', requests: [{url, method?, key?}], each?: {values}, rows?, pick?}`): declarative web reads the product runs on its server. `{field}` holes in a URL fill from each value of `each` (text fills `{value}`); `fetchCalls` expands them (at most `FETCH_CALLS`, 50 a run) and `fetchedRows` turns the answers into rows, the `each` value's fields first, then `pick`'s dotted paths (`current.temperature_2m`). A data key is named (`key`), never sent: the product adds it server side.
- **Browser script** (`{kind: 'script', runtime: 'browser', code, requests?}`): JavaScript that runs in the person's page. The kit's `runBrowserFrame` loads `<base>/sandbox` (this package's `SANDBOX_HTML`, served with `SANDBOX_CSP`: `connect-src 'none'`) in an iframe with `sandbox="allow-scripts"`, runs the code in a Web Worker there (stopped at `BROWSER_RUN_MS`, 30 s), and saves what it returns with `PUT /frames/:id/rows` (one write, the frame's caps checked). The code is the body of `async (fetched, hub) => rows`: `fetched` holds the answers to its `requests`, `hub.fetch(url, {key})` makes one more read through the product's proxy (`fetch` in `workspaceRoutes`, `POST <base>/fetch`). The server never runs it: `refresh` refuses it (409, open the tab), and `refreshAll` lists such tabs as `browser`.
- **Pushed dataset** (`store.pushFrame(owner, {name, rows, mode, by, key?})`): rows an outside agent wrangled (a CSV parsed by `parseCsv`, at most `CSV_BYTES` a call, the rest as `append` parts; with `key`, an appended row replaces the one with its key). Origin `harness`, no recipe; `by` names the agent and the tab's status bar reads "Pushed by Claude Code · 4 min ago". `frameTab(owner, workspace, {name, frame})` shows one in a tab (no run); `removeFrame` deletes one with its tabs.

`workspaceRoutes` lets `call`, `fetch` and browser `script` recipes through to the product's `allow`; server `sql` and `script` are refused.
