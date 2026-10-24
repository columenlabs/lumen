/**
 * The tool-call meter: every tool an assistant or an agent calls (an MCP tool, a function, a script
 * in a sandbox, a web read) is one Analytics Engine point, with how long it took, how it ended and
 * a hash of the code it ran, so slow, failing and repeated calls can be found and made first class.
 *
 * A point holds names, numbers and hashes only: never the arguments, the result or the person.
 */
import type { PointSink } from './points';

export interface ToolCallPoint {
  /** The app, or the part of it, the call ran in. */
  app: string;
  /** The tool or function called (`trade.portfolio_list`), or a name for the script. */
  tool: string;
  /** How it was called: call, script, sql, web, or your own. */
  kind: string;
  ok: boolean;
  /** Wall time of the call, ms. */
  ms: number;
  /** A short error kind when it failed (`bad_args`, `timeout`), never the message. */
  error?: string;
  /** The code the call ran (a script's source, a query); only its hash is written. */
  code?: string;
  /** Who started it: chat, brief, job, or your own. */
  source?: string;
  /** The model size or tier that made the call, never a model's name if the app keeps it private. */
  tier?: string;
  /** The turn or run the call belongs to, an id the app makes (not a person's). */
  run?: string;
  /** Rows the call returned. */
  rows?: number;
  /** Bytes of the call's input and output. */
  bytesIn?: number;
  bytesOut?: number;
  /** Tokens, when the call itself ran a model. */
  tokensIn?: number;
  tokensOut?: number;
}

let sink: PointSink | undefined;

/** The entry point sets the dataset once per isolate. */
export function setToolSink(s: PointSink | undefined) {
  sink = s;
}

const fnv = (s: string, seed: number) => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** A 64-bit hash of the code with its whitespace folded: the same script hashes the same. */
export function codeHash(code: string): string {
  const s = code.replace(/\s+/g, ' ').trim();
  return fnv(s, 2166136261) + fnv(s, 0x9e3779b9);
}

const cap = (s: string, n = 96) => (s.length > n ? s.slice(0, n) : s);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Column order is the contract with whoever reads the dataset back: index1 app; blobs app, tool,
 * kind, outcome, error, code hash, source, tier, run; doubles ms, rows, bytes in, bytes out,
 * tokens in, tokens out.
 */
export function meterToolCall(p: ToolCallPoint) {
  if (!sink) return;
  try {
    sink.writeDataPoint({
      indexes: [cap(p.app)],
      blobs: [
        cap(p.app),
        cap(p.tool, 128),
        cap(p.kind),
        p.ok ? 'ok' : 'error',
        cap(p.error ?? ''),
        p.code ? codeHash(p.code) : '',
        cap(p.source ?? ''),
        cap(p.tier ?? ''),
        cap(p.run ?? ''),
      ],
      doubles: [
        num(p.ms),
        num(p.rows),
        num(p.bytesIn),
        num(p.bytesOut),
        num(p.tokensIn),
        num(p.tokensOut),
      ],
    });
  } catch (err) {
    console.error('meterToolCall', err);
  }
}

/** Runs one tool call and meters it: the wall time, and `error` as the kind when it throws. */
export async function meteredCall<T>(
  p: Omit<ToolCallPoint, 'ok' | 'ms'>,
  fn: () => Promise<T>,
  errorKind: (err: unknown) => string = () => 'error',
): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await fn();
    meterToolCall({ ...p, ok: true, ms: performance.now() - t0 });
    return out;
  } catch (err) {
    meterToolCall({ ...p, ok: false, ms: performance.now() - t0, error: errorKind(err) });
    throw err;
  }
}
