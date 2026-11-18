/**
 * An answer from a `LumenAgent` as the panel's server-sent events, the stream the panel reads. The app's route finds the
 * person's chat (a facet of their store, or its own agent) and hands `ask` here.
 */
import type { AssistantEvent } from '@columenlabs/lumen-ui-types/assistant';
import type { AskSink } from './agent';

export interface AskResponseOptions {
  /** The request's signal: when the person stops or leaves, `stop` ends the answer. */
  signal?: AbortSignal;
  stop?: () => unknown;
  /** Keeps the answer running past the response (a Worker's `ctx.waitUntil`). */
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Cloudflare ends a Durable Object (or a request) when a new version of the app is deployed. Its
 * error carries `durableObjectReset`; the answer stops there, and every step that already ended has
 * ended. The panel says so in plain words (code `app_updated`) instead of the runtime's message.
 */
export function updatedMidAnswer(err: unknown): boolean {
  const e = err as { durableObjectReset?: boolean; message?: unknown } | null;
  if (e?.durableObjectReset === true) return true;
  return /code was updated|code had changed/i.test(String(e?.message ?? ''));
}

/** The `error` event's data for a failure: plain words for an app update, else its message. */
export function errorData(err: unknown): { message: string; code?: string } {
  if (updatedMidAnswer(err))
    return {
      message: 'The app was updated while this answer ran, so it stopped here.',
      code: 'app_updated',
    };
  return { message: String((err as Error)?.message ?? err).slice(0, 500) };
}

/** Streams `run`'s events as `event:` / `data:` blocks; a failure ends in an `error` event. */
export function askResponse(
  run: (sink: AskSink) => Promise<void>,
  o: AskResponseOptions = {},
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let open = true;
  const write = async (e: AssistantEvent) => {
    if (!open) return;
    try {
      await writer.write(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
    } catch {
      open = false;
    }
  };
  o.signal?.addEventListener('abort', () => {
    open = false;
    void Promise.resolve(o.stop?.()).catch(() => undefined);
  });
  const work = (async () => {
    try {
      await run({ event: write });
    } catch (err) {
      await write({ event: 'error', data: errorData(err) });
    } finally {
      open = false;
      await writer.close().catch(() => undefined);
    }
  })();
  o.waitUntil?.(work);
  return new Response(readable, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
