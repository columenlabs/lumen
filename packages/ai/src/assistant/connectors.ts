/**
 * The app's connectors: outside MCP servers (Streamable HTTP) an admin adds in Settings with a name,
 * an address and the headers it signs in with (an Access service token, an API key). Each is a tool
 * group, `ext_<id>`, at the access the admin gives it: Read keeps the tools the server marks
 * read-only, Read + draft turns the rest into cards the person saves.
 *
 * Lazy by design: a test lists the server's tools once and keeps that catalog, so a turn offers
 * them without calling the server, and the model sees none of them until it searches
 * (`tool_search`); the server is only called when a tool is. A server's text is data, never
 * instructions.
 */
import type {
  AssistantConnector,
  AssistantConnectorInput,
  ConnectorAccess,
} from '@columenlabs/lumen-ui-types/assistant';
import { CONNECTOR_ACCESS } from '@columenlabs/lumen-ui-types/assistant';
import { checkConnectorUrl } from '../agent/connectors';
import type { KeyTest } from './state';
import { type OpenTools, type ToolDef, type ToolSource, remoteMcpTools } from './tools';

/** A connector's tool group: `ext_` and its id. */
export const APP_CONNECTOR_GROUP = 'ext_';
export const appConnectorGroup = (id: string) => `${APP_CONNECTOR_GROUP}${id}`;

/** Connectors an app may keep. */
export const CONNECTORS_MAX = 20;
/** Tools kept from one server; past it the rest are left out. */
const TOOLS_MAX = 100;
const HEADERS_MAX = 10;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;

/** One connector as stored (sealed with the app's other settings). */
export interface ConnectorDoc {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  access: ConnectorAccess;
  /** The tools its last good test listed. */
  catalog: ToolDef[];
  test: KeyTest | null;
  saved_at: number;
}

export interface ConnectorsDoc {
  list: ConnectorDoc[];
}

/** A connector as Settings shows it: header names, never their values. */
export function connectorView(d: ConnectorDoc): AssistantConnector {
  return {
    id: d.id,
    name: d.name,
    url: d.url,
    headers: Object.keys(d.headers),
    access: d.access,
    tools: d.catalog.map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      read: t.read,
    })),
    test: d.test,
  };
}

/** What an admin sent, checked: throws an Error whose text says what to fix. */
export function connectorInput(b: Record<string, unknown>): AssistantConnectorInput {
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
  if (!name) throw new Error('Give the connector a name.');
  const url = typeof b.url === 'string' ? b.url.trim() : '';
  checkConnectorUrl(url);
  const out: AssistantConnectorInput = { name, url };
  if (b.headers !== undefined) {
    if (!b.headers || typeof b.headers !== 'object' || Array.isArray(b.headers))
      throw new Error('headers is an object of names and values.');
    const entries = Object.entries(b.headers as Record<string, unknown>);
    if (entries.length > HEADERS_MAX) throw new Error(`At most ${HEADERS_MAX} headers.`);
    const headers: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (!HEADER_NAME.test(k)) throw new Error(`"${k.slice(0, 40)}" is not a header name.`);
      if (typeof v !== 'string' || !v || v.length > 4000 || /[\r\n]/.test(v))
        throw new Error(`Give ${k} a value on one line.`);
      headers[k] = v;
    }
    out.headers = headers;
  }
  if (b.access !== undefined) {
    const a = CONNECTOR_ACCESS.find((x) => x === b.access);
    if (!a) throw new Error(`access is ${CONNECTOR_ACCESS.join(', ')}.`);
    out.access = a;
  }
  return out;
}

/** A server's tool, kept short: its text reaches the model only once it searches for it. */
function kept(t: ToolDef): ToolDef {
  return {
    name: t.name.slice(0, 64),
    ...(t.title ? { title: t.title.slice(0, 80) } : {}),
    ...(t.description ? { description: t.description.slice(0, 2000) } : {}),
    inputSchema: t.inputSchema ?? { type: 'object' },
    read: t.read,
  };
}

/**
 * Calls the server once: lists its tools. Never throws: a failed test says why (the server's own
 * text stays in the log, never on screen).
 */
export async function testConnector(
  url: string,
  headers: Record<string, string>,
  f?: typeof fetch,
): Promise<{ test: KeyTest; catalog: ToolDef[] }> {
  const at = Date.now();
  let open: OpenTools | undefined;
  try {
    open = await remoteMcpTools({ url, headers, ...(f ? { fetch: f } : {}) })();
    const catalog = open.tools.slice(0, TOOLS_MAX).map(kept);
    const n = catalog.length;
    const reads = catalog.filter((t) => t.read).length;
    return {
      test: {
        ok: true,
        at,
        detail: `Answered with ${n} tool${n === 1 ? '' : 's'}${n ? `, ${reads} read-only` : ''}.`,
      },
      catalog,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'assistant_connector_test',
        url,
        error: String((err as Error)?.message ?? err).slice(0, 500),
      }),
    );
    // The SDK's HTTP error carries the status as its code.
    const code = (err as { code?: unknown })?.code;
    const said = `${typeof code === 'number' ? code : ''} ${String((err as Error)?.message ?? '')}`;
    return {
      test: {
        ok: false,
        at,
        detail: /\b40[13]\b/.test(said)
          ? 'The server refused these headers.'
          : 'The server could not be reached, or it is not an MCP server.',
      },
      catalog: [],
    };
  } finally {
    await open?.close().catch(() => undefined);
  }
}

const OPTIONAL = 'Optional: leave it out unless you have a real value; never make one up.';

/**
 * A tool whose optional fields say so in their descriptions: a model tends to fill every field it
 * sees, and an invented id (a sign-in, a session) makes the server fail the call.
 */
function optionalSaid(t: ToolDef): ToolDef {
  const s = t.inputSchema as { properties?: Record<string, unknown>; required?: unknown };
  if (!s?.properties || typeof s.properties !== 'object') return t;
  const required = new Set(Array.isArray(s.required) ? s.required : []);
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.properties)) {
    const p = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    properties[k] =
      p && !required.has(k)
        ? {
            ...p,
            description:
              typeof p.description === 'string' ? `${p.description} ${OPTIONAL}` : OPTIONAL,
          }
        : v;
  }
  return { ...t, inputSchema: { ...s, properties } };
}

/**
 * A connector's tools from its kept catalog: opening them calls nothing. The server is reached on
 * the first call, and that one connection serves the rest of the answer.
 */
export function catalogTools(d: ConnectorDoc, f?: typeof fetch): ToolSource {
  return async () => {
    let live: Promise<OpenTools> | null = null;
    const remote = remoteMcpTools({ url: d.url, headers: d.headers, ...(f ? { fetch: f } : {}) });
    return {
      tools: d.catalog.map(optionalSaid),
      call: async (name, args) => {
        live ??= remote();
        try {
          return await (await live).call(name, args);
        } catch (err) {
          // A connection that never opened is tried again on the next call.
          if (live && !(await live.then(() => true).catch(() => false))) live = null;
          throw err;
        }
      },
      close: async () => {
        if (live) await (await live.catch(() => null))?.close();
      },
    };
  };
}
