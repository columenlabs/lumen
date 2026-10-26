/**
 * The assistant's tools: the app's own, from any MCP server (in process, served as a fetch handler,
 * or remote) or plain functions. Each tool is a read or a write; the person sets each group of
 * tools Off, Read or Read + draft, and a write called while its group allows drafts only makes a
 * card in the chat. It runs when the person presses Save.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** One tool as the model sees it. `read` false is a write, which only ever drafts. */
export interface ToolDef {
  name: string;
  title?: string;
  description?: string;
  /** JSON Schema of its input (an object). */
  inputSchema: Record<string, unknown>;
  read: boolean;
}

/** Tools opened for one answer: what they are, how to call one, and how to let them go. */
export interface OpenTools {
  tools: ToolDef[];
  call(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}

/** Opens a set of tools for one answer (or one save). */
export type ToolSource = () => Promise<OpenTools>;

/** A tool that answered with an error: its text is what the model reads. */
export class ToolError extends Error {}

/** Waits for `work`, or fails after `ms` saying what timed out. */
export function withDeadline<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} took over ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

type Transport = Parameters<Client['connect']>[0];

/** An MCP client over `transport`: its tools, called as JSON. */
async function clientTools(
  connect: (client: Client) => Promise<void>,
  done: () => Promise<void> = async () => undefined,
): Promise<OpenTools> {
  const client = new Client({ name: 'lumen-assistant', version: '1.0.0' });
  await withDeadline('connecting to tools', 20_000, connect(client));
  const { tools } = await withDeadline('listing tools', 20_000, client.listTools());
  return {
    tools: tools.map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      ...(t.description ? { description: t.description } : {}),
      inputSchema: t.inputSchema as Record<string, unknown>,
      read: t.annotations?.readOnlyHint === true,
    })),
    async call(name, args) {
      const r = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      const first = (r.content as { type: string; text?: string }[] | undefined)?.find(
        (c) => c.type === 'text',
      );
      const text = first?.text ?? '';
      if (r.isError) throw new ToolError(text.slice(0, 500) || `${name} failed`);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    },
    async close() {
      await client.close().catch(() => undefined);
      await done().catch(() => undefined);
    },
  };
}

/**
 * An MCP server built for the caller and connected in process. A server connects once, so pass a
 * function that builds a new one. A tool is a read when its `readOnlyHint` is set.
 */
export function mcpServerTools(build: () => McpServer | Promise<McpServer>): ToolSource {
  return async () => {
    const server = await build();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    return clientTools(
      (c) => c.connect(b as Transport),
      () => server.close(),
    );
  };
}

/**
 * An MCP server the app serves as a fetch handler (`(Request) => Response`), called in process
 * without a network hop. Use it for a server built on another MCP SDK.
 */
export function mcpFetchTools(
  handler: (req: Request) => Promise<Response>,
  url = 'https://assistant.local/mcp',
): ToolSource {
  return () =>
    clientTools((c) =>
      c.connect(
        new StreamableHTTPClientTransport(new URL(url), {
          fetch: (input, init) => handler(new Request(input, init)),
        }) as Transport,
      ),
    );
}

/** A remote MCP server over Streamable HTTP, with the headers it needs (an Access service token). */
export function remoteMcpTools(o: {
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}): ToolSource {
  return () =>
    clientTools((c) =>
      c.connect(
        new StreamableHTTPClientTransport(new URL(o.url), {
          requestInit: { headers: o.headers ?? {} },
          ...(o.fetch ? { fetch: o.fetch } : {}),
        }) as Transport,
      ),
    );
}

/** A tool written as a plain function. */
export interface PlainTool extends ToolDef {
  run(args: unknown): Promise<unknown>;
}

/** Plain functions as tools, no MCP server needed. */
export function plainTools(tools: PlainTool[]): ToolSource {
  return async () => ({
    tools: tools.map(({ run: _run, ...t }) => t),
    async call(name, args) {
      const t = tools.find((x) => x.name === name);
      if (!t) throw new ToolError(`No tool ${name}`);
      return t.run(args);
    },
    close: async () => undefined,
  });
}

/** A tool name the model may use: letters, digits, `_` and `-`, at most 64. */
export function toolName(group: string, name: string) {
  return `${group}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** Rows in a list result: an array, or the first array field of an object. */
export function rowCount(v: unknown): number | undefined {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object')
    for (const x of Object.values(v)) if (Array.isArray(x)) return x.length;
  return undefined;
}
