/**
 * Connectors: MCP servers a person adds to their chat (a URL, signed in with the server's own
 * OAuth through Think's MCP client). Each is a tool group like the app's own, at the access the
 * app gives it: Read keeps the tools the server marks read-only, Read + draft turns the rest into
 * cards, Read + write runs them at once. A server's text is untrusted data, never instructions.
 */
import type { AssistantAccess } from '@columenlabs/lumen-ui-types/assistant';
import { type OpenTools, ToolError, type ToolSource, withDeadline } from '../assistant/tools';

/** A connector's tool group: `mcp_` and its id. */
export const CONNECTOR_GROUP = 'mcp_';
export const connectorGroup = (id: string) => `${CONNECTOR_GROUP}${id}`;

/** One connector the app opens for a turn, at the access the person gave it. */
export interface ConnectorAt {
  id: string;
  access: AssistantAccess;
}

/** A connector as the app's settings list it. */
export interface AgentConnector {
  id: string;
  name: string;
  url: string;
  state: string;
  /** Where the person signs in, while the server asks for it. */
  authUrl?: string;
  error?: string;
  /** Its tools, and how many are marked read-only. */
  tools: number;
  reads: number;
}

interface McpTool {
  name: string;
  serverId: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  annotations?: { readOnlyHint?: boolean; title?: string };
}

/** The part of Think's MCP client a connector needs. */
export interface ConnectorClient {
  listTools(): McpTool[];
  callTool(p: { serverId: string; name: string; arguments: Record<string, unknown> }): Promise<{
    content?: unknown;
    isError?: boolean;
  }>;
}

/** What a connector's call answered: its text as JSON when it parses, else the text. */
export function connectorResult(r: { content?: unknown; isError?: boolean }, name: string) {
  const parts = (r.content as { type: string; text?: string }[] | undefined) ?? [];
  const text = parts
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
  if (r.isError) throw new ToolError(text.slice(0, 500) || `${name} failed`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** One connector's tools as a source: listed from the client's catalog, called through it. */
export function connectorSource(mcp: ConnectorClient, serverId: string): ToolSource {
  return async (): Promise<OpenTools> => ({
    tools: mcp
      .listTools()
      .filter((t) => t.serverId === serverId)
      .map((t) => {
        const title = t.title ?? t.annotations?.title;
        return {
          name: t.name,
          ...(title ? { title } : {}),
          ...(t.description ? { description: t.description } : {}),
          inputSchema: (t.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
          read: t.annotations?.readOnlyHint === true,
        };
      }),
    call: async (name, args) =>
      connectorResult(
        await withDeadline(
          `${name}`,
          60_000,
          mcp.callTool({
            serverId,
            name,
            arguments: (args ?? {}) as Record<string, unknown>,
          }),
        ),
        name,
      ),
    close: async () => undefined,
  });
}

/** A connector's id from its name: a letter first, then letters, digits and `_`, at most 24. */
export function connectorId(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (!id) throw new Error('Give the connector a name.');
  return /^[a-z]/.test(id) ? id : `c_${id}`.slice(0, 24);
}

/** A connector's address must be https (localhost only while developing). */
export function checkConnectorUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('That is not a web address.');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
    throw new Error('A connector needs an https address.');
  if (u.username || u.password) throw new Error('Leave sign-in details out of the address.');
  return u;
}
