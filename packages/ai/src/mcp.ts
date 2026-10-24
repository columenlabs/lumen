/**
 * Serving an MCP server from a Worker: one stateless Streamable HTTP request at a time (a Worker
 * keeps nothing between requests), plus the small pieces every app's server repeats: a JSON
 * result, keeping only the read tools for a read-only caller, and metering every tool call.
 */
import { meterToolCall } from '@columenlabs/lumen-ops/tools';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/** A tool result holding one JSON value as text, what most tools return. */
export function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

/** What one JSON-RPC request asks for, for a request log: its method and, for a call, the tool. */
export function mcpCallOf(body: unknown): { method?: string; tool?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const b = body as { method?: unknown; params?: { name?: unknown } };
  return {
    method: typeof b.method === 'string' ? b.method : undefined,
    tool: typeof b.params?.name === 'string' ? b.params.name : undefined,
  };
}

export interface ServeMcpOptions {
  /** Told what the request asks for before it runs (the method, and the tool for a call). */
  onRequest?: (call: { method?: string; tool?: string }) => void;
}

/**
 * Answers one MCP request with `server`, built for this caller, then closes it. JSON responses, no
 * session: each request stands alone. The caller is already checked.
 */
export async function serveMcp(
  server: McpServer,
  request: Request,
  opts: ServeMcpOptions = {},
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const body = await request
      .clone()
      .json()
      .catch(() => undefined);
    opts.onRequest?.(mcpCallOf(body));
    return await transport.handleRequest(
      request,
      body === undefined ? undefined : { parsedBody: body },
    );
  } finally {
    // JSON-response mode has fully answered by now.
    void server.close();
  }
}

/** Every tool registered on `server`, by name. */
export function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
}

/** A tool marked read-only (`readOnlyHint`), the default test for `keepReadTools`. */
export const readOnlyHint = (_name: string, tool: RegisteredTool) =>
  tool.annotations?.readOnlyHint === true;

/** Removes every tool `isRead` says writes, for a caller who may only read. Returns `server`. */
export function keepReadTools(
  server: McpServer,
  isRead: (name: string, tool: RegisteredTool) => boolean = readOnlyHint,
): McpServer {
  for (const [name, tool] of Object.entries(registeredTools(server))) {
    if (!isRead(name, tool)) tool.remove();
  }
  return server;
}

export interface MeterToolsOptions {
  /** The app, or the part of it, the server belongs to. */
  app: string;
  /** Who is calling: `mcp` for an outside client, or the app's own word (an assistant). */
  source?: string;
  /** The turn or run the calls belong to. */
  run?: string;
  /** A short error kind for a throw; default `error`. */
  errorKind?: (err: unknown) => string;
}

/**
 * Wraps every tool registered on `server` so each call is one tool-call point (lumen-ops/tools):
 * its wall time, rows when the result is a JSON list, the size of its input and output, and
 * whether it failed. Call it after the tools are registered. Returns `server`.
 */
export function meterTools(server: McpServer, opts: MeterToolsOptions): McpServer {
  for (const [name, tool] of Object.entries(registeredTools(server))) {
    const handler = tool.handler as (...args: unknown[]) => unknown;
    tool.handler = (async (...args: unknown[]) => {
      const point = {
        app: opts.app,
        tool: name,
        kind: 'call',
        source: opts.source ?? 'mcp',
        run: opts.run,
      };
      const bytesIn = args.length > 1 ? JSON.stringify(args[0] ?? null).length : 0;
      const t0 = performance.now();
      try {
        const out = (await handler(...args)) as {
          isError?: boolean;
          content?: { text?: string }[];
        };
        const text = out?.content?.[0]?.text ?? '';
        let rows: number | undefined;
        try {
          const v = JSON.parse(text);
          if (Array.isArray(v)) rows = v.length;
        } catch {}
        meterToolCall({
          ...point,
          ok: !out?.isError,
          ms: performance.now() - t0,
          ...(out?.isError ? { error: 'tool_error' } : {}),
          rows,
          bytesIn,
          bytesOut: text.length,
        });
        return out;
      } catch (err) {
        meterToolCall({
          ...point,
          ok: false,
          ms: performance.now() - t0,
          error: opts.errorKind?.(err) ?? 'error',
          bytesIn,
        });
        throw err;
      }
    }) as RegisteredTool['handler'];
  }
  return server;
}
