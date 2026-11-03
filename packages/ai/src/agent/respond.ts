/**
 * An answer from a `LumenAgent` as the panel's server-sent events, the same stream
 * `assistantRoutes`' `POST /chat` sends, so the panel needs no change. The app's route finds the
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
      await write({
        event: 'error',
        data: { message: String((err as Error)?.message ?? err).slice(0, 500) },
      });
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
