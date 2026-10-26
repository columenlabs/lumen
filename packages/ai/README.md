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
  // Smallest first. The app names them; a person picks each tier's model and effort.
  tiers: [
    { id: 'fast', label: 'Fast', about: 'Quick lookups', model: 'claude-haiku-5-5' },
    { id: 'steady', label: 'Steady', about: 'Most work', model: 'claude-sonnet-5-5' },
    { id: 'deep', label: 'Deep', about: 'Hard judgement', model: 'claude-opus-5-5' },
  ],
  groups: [
    { id: 'notes', label: 'Notes', about: 'Read and edit notes', tools: (caller) => mcpServerTools(() => notesServer(caller.id)) },
  ],
  web: { fetch: { blockHosts: ['app.example.com'] }, scrapeql: { url: 'https://scrapeql.example.com/mcp' } },
  store: sqlAssistantStore(doSql(ctx.storage.sql)), // or d1Sql(env.DB)
  sealer, // the app's own sealing: keys and chats are stored sealed
  // A provider's key when none is set in Settings.
  appKey: async (provider) => (provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY),
});

const routes = assistantRoutes(assistant, {
  base: '/api/assistant',
  caller: (req) => ({ id: personId(req), admin: isAdmin(req) }),
});
app.all('/api/assistant/*', (c) => routes(c.req.raw));
```

- **Providers.** A tier runs any model in `models` (Claude's and OpenAI's by default, `CLAUDE_MODELS`, `OPENAI_MODELS`): Claude through Anthropic's Messages API, OpenAI through the Responses API, with the same tools, drafts, Stop and caps. A hand-off may cross providers. The advisor and prompt caching marks are Claude's only.
- **Keys.** Each provider has its own keys (`?provider=anthropic|openai` on the key routes). An admin pastes the shared key everyone uses (`PUT /key`); it is tested with one free call before it is kept, then sealed, and no route returns it. A person may add their own (`PUT /my-key`), with one monthly cap on their own keys (`PUT /my-key/cap`).
- **ChatGPT sign-in.** In place of their own OpenAI key a person may sign in with their ChatGPT plan (`POST /my-signin`, then `POST /my-signin/finish {url}`): the sign-in opens in a new tab and ends on `http://127.0.0.1:1455/auth/callback`, a page that does not load, whose address the person pastes back. The tokens are sealed as their own key and refreshed before they run out; answers on the plan count tokens and no dollars.
- **Who pays.** The person's pick (the shared keys by default) while it has a key for the tier's provider and money left this month under its cap (an admin sets the shared keys' cap per person, `PUT /app`), else the other; with neither the panel says why.
- **Tools.** Each group is Off, Read, Read + draft or Read + write per person. A tool is a read when its MCP `readOnlyHint` is set. On Read + draft a write only drafts a card, and runs as the person when they press Save, after access is checked again. Read + write is offered only for a group with `writes: true`: its writes run at once, and with `undo` set each one's line in the chat has Undo, which calls `undo(caller, { tool, args, result })` (`POST /chats/:id/writes/:step/undo`); the model is told what was undone. Cards drafted one after another show as one stack with Save all. Use `mcpServerTools` (an SDK `McpServer`), `mcpFetchTools` (a server served as a fetch handler, any SDK), `remoteMcpTools` or `plainTools`.
- **Web.** `fetch` is a plain GET from the Worker (10 s, 2 MB, never the app's own hosts or private addresses). ScrapeQL's own tools join over its MCP API once an admin pastes a Cloudflare Access service token (`PUT /web/scrapeql`).
- **Hand off and advice.** The `escalate` tool hands one task to a higher tier (the person sets next, any or only when asked); Anthropic's advisor tool lets a higher tier send a plan, at most two an answer.
- **Chats** stream as server-sent events (`POST /chat`); closing the request stops the answer and keeps what was said. Past 150k tokens, or on `/compact`, the history sent to the model becomes a summary. Run `assistant.purge()` once a day to drop chats 30 days after their last message.

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
- **`@` a tier.** `@` lists the app's tiers; the pick is a chip and goes with that message only (`tier`). A higher tier takes it as a task in its own section of the chat; the same or a lower one answers it.
- **`#` a thing.** `#` lists what the person can point at, a group per source; each pick is a chip and goes with the message as a ref (`kind`, `label` and whatever finds it), which the model reads before the message. Standing sources go on the panel (`sources`); a page adds its own while it is shown:

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

  Text the person highlights on the page is offered first under `#` (Selected text), with where it sits from the nearest `data-assistant-where` attribute. To hand a highlight over from the page, an Ask button calls `composeAssistant({ refs: [selectionRef({ text, where })], text: '' })` (or any refs and text): the panel opens with the chips in the composer, focused for the person to finish.
