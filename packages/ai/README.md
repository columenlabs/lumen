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

`@columenlabs/lumen-ai/assistant` is the server behind a chat side panel: Claude on the app's own tiers, the app's tools from any MCP server, the web, drafts the person saves, hand off to a higher tier, advice, and a monthly spend cap per person. The panel and Settings sections are `@columenlabs/lumen-ui`'s; the shared types are `@columenlabs/lumen-ui-types/assistant`.

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
  appKey: async () => env.ANTHROPIC_API_KEY, // when no key is set in Settings
});

const routes = assistantRoutes(assistant, {
  base: '/api/assistant',
  caller: (req) => ({ id: personId(req), admin: isAdmin(req) }),
});
app.all('/api/assistant/*', (c) => routes(c.req.raw));
```

- **Keys.** An admin pastes the app's Claude key (`PUT /key`); it is tested with one free call before it is kept, then sealed, and no route returns it. A person may add their own (`PUT /my-key`) with its own monthly cap.
- **Who pays.** The person's pick (the app's key by default) while it has money left this month under its cap (an admin sets the app key's cap per person, `PUT /app`), else the other; with neither the panel says why.
- **Tools.** Each group is Off, Read or Read + draft per person. A tool is a read when its MCP `readOnlyHint` is set; a write only drafts a card, and runs as the person when they press Save, after access is checked again. Use `mcpServerTools` (an SDK `McpServer`), `mcpFetchTools` (a server served as a fetch handler, any SDK), `remoteMcpTools` or `plainTools`.
- **Web.** `fetch` is a plain GET from the Worker (10 s, 2 MB, never the app's own hosts or private addresses). ScrapeQL's own tools join over its MCP API once an admin pastes a Cloudflare Access service token (`PUT /web/scrapeql`).
- **Hand off and advice.** The `escalate` tool hands one task to a higher tier (the person sets next, any or only when asked); Anthropic's advisor tool lets a higher tier send a plan, at most two an answer.
- **Chats** stream as server-sent events (`POST /chat`); closing the request stops the answer and keeps what was said. Past 150k tokens, or on `/compact`, the history sent to the model becomes a summary. Run `assistant.purge()` once a day to drop chats 30 days after their last message.
