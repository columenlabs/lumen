/**
 * The Worker's side of the browser's telemetry (`useLumenTelemetry` in `@columenlabs/lumen-ui`):
 * checks a batch against a strict schema, so only enums, templates, codes and numbers pass, and
 * writes one Analytics Engine point per entry. A batch that doesn't pass is dropped whole.
 */
import { z } from 'zod';
import { cap, num } from './fields';
import type { PointSink } from './points';
import { currentRequest } from './requests';

const code = z.string().regex(/^[A-Za-z0-9_.:/$-]{1,64}$/);
const route = z.string().regex(/^[A-Za-z0-9_.:/$-]{0,256}$/);

const point = z.object({
  kind: z.enum(['view', 'error', 'fetch_fail', 'vital']),
  route,
  name: code.optional(),
  fingerprint: z
    .string()
    .regex(/^[0-9a-f]{1,16}$/)
    .optional(),
  requestId: code.optional(),
  value: z.number().finite().optional(),
  status: z.number().int().min(0).max(999).optional(),
  device: z.enum(['phone', 'desktop']).optional(),
});

export const clientBatch = z.object({
  app: code,
  version: code.optional(),
  points: z.array(point).max(50),
});
export type ClientBatch = z.infer<typeof clientBatch>;

let sink: PointSink | undefined;

/** The entry point sets the dataset once per isolate. */
export function setClientSink(s: PointSink | undefined) {
  sink = s;
}

/**
 * Writes a checked batch; says how many points it wrote (0 when the batch didn't pass). Column
 * order is the contract: index1 subject (or `anon`); blobs app, kind, route, name, fingerprint,
 * request id, version, device, env; doubles value, status.
 */
export function meterClientBatch(body: unknown, opts: { subject?: string; app?: string } = {}) {
  const parsed = clientBatch.safeParse(body);
  if (!parsed.success || !sink) return 0;
  const b = parsed.data;
  const env = currentRequest()?.env;
  // The app named by the server wins: a page can't write as another app.
  const app = opts.app ?? b.app;
  for (const p of b.points) {
    try {
      sink.writeDataPoint({
        indexes: [cap(opts.subject || 'anon')],
        blobs: [
          cap(app),
          p.kind,
          p.route,
          p.name ?? '',
          p.fingerprint ?? '',
          p.requestId ?? '',
          b.version ?? '',
          p.device ?? '',
          cap(env),
        ],
        doubles: [num(p.value), num(p.status)],
      });
    } catch (err) {
      console.error('meterClientBatch', err);
    }
  }
  return b.points.length;
}
