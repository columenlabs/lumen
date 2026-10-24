# @columenlabs/lumen-ai

Assistant and agent parts for apps on Cloudflare Workers. Today: serving an MCP server from a Worker, keeping only the read tools for a read-only caller, and metering every tool call. A product-neutral assistant joins later.

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
