/**
 * The kit's tool sources (MCP servers, plain functions) as an AI SDK tool set, with the person's
 * access applied: Off leaves a group out, Read keeps its reads, Read + draft adds its writes as
 * drafts (a card the person saves; nothing changes), Read + write runs writes at once.
 */
import type { AssistantAccess } from '@columenlabs/lumen-ui-types/assistant';
import { type JSONSchema7, type ToolSet, jsonSchema, tool } from 'ai';
import { type OpenTools, type ToolDef, type ToolSource, toolName } from '../assistant/tools';

/** A group's tools to open for one answer, at the person's access. */
export interface SourceAt {
  group: string;
  access: AssistantAccess;
  source: ToolSource;
  /** The group runs writes at once on Read + write; else a write drafts. */
  writes?: boolean;
}

/** A write the model asked for while its group drafts: the card's content. */
export interface DraftCall {
  group: string;
  tool: string;
  args: unknown;
}

export interface AiToolsOptions {
  /** A draft's card was made: return what the model is told (its id, "a card is on screen"). */
  draft?: (d: DraftCall) => Promise<unknown>;
  /** Every call's outcome, for the app's meter: shapes only. */
  called?: (c: { group: string; tool: string; ok: boolean; ms: number }) => void;
  /** A result handed to the model is cut past this many characters. */
  maxChars?: number;
}

/** One tool offered this answer, as the instructions describe the set. */
export interface ToolInfo {
  name: string;
  group: string;
  kind: 'read' | 'draft' | 'write';
  find: boolean;
}

/** Tools open for one answer, as the AI SDK's set, and how to let them go. */
export interface OpenedTools {
  tools: ToolSet;
  /** Names of the reads, for a lazy loader's catalog or `activeTools`. */
  reads: string[];
  /** Each tool offered: its name, group, kind and whether it is an app's find. */
  info: ToolInfo[];
  failed: number;
  close(): Promise<void>;
}

const withoutMeta = (schema: Record<string, unknown>) => {
  const { $schema: _, ...rest } = schema;
  return { type: 'object', ...rest };
};

function describe(def: ToolDef, kind: 'read' | 'draft' | 'write') {
  const lead =
    kind === 'draft'
      ? "DRAFT ONLY: this call changes nothing. It puts a card on the person's screen that they Save or Dismiss. "
      : kind === 'write'
        ? 'WRITES AT ONCE: this call makes the change now; the person can undo it. '
        : '';
  return `${lead}${def.title ? `${def.title}. ` : ''}${def.description ?? ''}`.slice(0, 4000);
}

/** Opens every source at once; one that fails is counted and left out. */
export async function openAiTools(
  sources: SourceAt[],
  o: AiToolsOptions = {},
): Promise<OpenedTools> {
  const live = sources.filter((s) => s.access !== 'off');
  const results = await Promise.allSettled(live.map((s) => s.source()));
  const opened: { s: SourceAt; open: OpenTools }[] = [];
  results.forEach((r, i) => {
    const s = live[i];
    if (r.status === 'fulfilled' && s) opened.push({ s, open: r.value });
  });
  const max = o.maxChars ?? 16_000;
  const tools: ToolSet = {};
  const reads: string[] = [];
  const info: ToolInfo[] = [];
  for (const { s, open } of opened)
    for (const def of open.tools) {
      const canWrite = s.access === 'draft' || s.access === 'write';
      if (!def.read && !canWrite) continue;
      const kind = def.read ? 'read' : s.access === 'write' && s.writes ? 'write' : 'draft';
      if (kind === 'draft' && !o.draft) continue;
      const name = toolName(s.group, def.name);
      if (kind === 'read') reads.push(name);
      info.push({ name, group: s.group, kind, find: !!def.find });
      tools[name] = tool({
        description: describe(def, kind),
        inputSchema: jsonSchema(withoutMeta(def.inputSchema) as JSONSchema7),
        execute: async (args: unknown) => {
          if (kind === 'draft') return o.draft?.({ group: s.group, tool: def.name, args });
          const t0 = Date.now();
          try {
            const out = await open.call(def.name, args);
            o.called?.({ group: s.group, tool: def.name, ok: true, ms: Date.now() - t0 });
            const text = typeof out === 'string' ? out : JSON.stringify(out);
            return text.length > max ? `${text.slice(0, max)} …(cut)` : out;
          } catch (err) {
            o.called?.({ group: s.group, tool: def.name, ok: false, ms: Date.now() - t0 });
            return { error: String((err as Error)?.message ?? err).slice(0, 500) };
          }
        },
      });
    }
  return {
    tools,
    reads,
    info,
    failed: results.filter((r) => r.status === 'rejected').length,
    close: async () => {
      await Promise.all(opened.map((x) => x.open.close().catch(() => undefined)));
    },
  };
}
