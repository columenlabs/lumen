/**
 * One JSON fetch for the assistant, workspaces and joins. A failure throws `ApiError` with the
 * method, address, status and the server's `error` and `code`, so a caller shows what failed and
 * Workers Logs keep it: a server fault (5xx) or a network failure is reported to
 * `/api/client-error` with `where` naming the caller. Every failure is also a `fetch_fail`
 * telemetry point (its route with ids folded, status and request id) once `useLumenTelemetry` runs. A 4xx is the server saying why it refused,
 * shown to the person and not logged as a fault.
 */
import { reportError } from './route-error';
import { apiRoute, reportFailedFetch } from './telemetry';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(
    message: string,
    readonly method: string,
    readonly url: string,
    status: number,
    code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * How long a request waits for the server before it fails as unreachable, so a page never waits
 * forever: reads give up sooner than writes, which may be doing slow work the person asked for.
 */
export const API_TIMEOUT_MS = { read: 15_000, write: 60_000 };

/**
 * A JSON request; `where` names the caller in the error log (`assistant.undo`, `workspace.read`).
 * It gives up after `API_TIMEOUT_MS` (or `timeoutMs`); a caller's own `signal` still aborts it. A string
 * body is sent as JSON; FormData or a Blob keeps its own content type. A 2xx that is not JSON fails.
 */
export async function apiJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  where = 'api',
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const { timeoutMs, ...rest } = init;
  const timeout = AbortSignal.timeout(
    timeoutMs ?? (method === 'GET' ? API_TIMEOUT_MS.read : API_TIMEOUT_MS.write),
  );
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      headers: {
        accept: 'application/json',
        // A string body is the caller's JSON; FormData, a Blob or URLSearchParams set their own type.
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    // The caller's own abort is theirs to handle; running out of time is a failure like no network.
    if ((err as Error).name === 'AbortError' && !timeout.aborted) throw err;
    const e = new ApiError(
      timeout.aborted
        ? `The server didn't answer in time (${method} ${url})`
        : `Couldn't reach the server (${method} ${url})`,
      method,
      url,
      0,
    );
    reportError(e, 'shown', where);
    reportFailedFetch(apiRoute(url), 0);
    throw e;
  }
  const text = await res.text();
  let body: unknown = null;
  let json = true;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    json = false;
  }
  // A 2xx that is not JSON (a sign-in page, a proxy's error page) is a failed call, never an empty answer.
  if (res.ok && !json) {
    const e = new ApiError(
      `${method} ${url} answered ${res.status} with something that is not JSON`,
      method,
      url,
      res.status,
    );
    reportError(e, 'shown', where);
    reportFailedFetch(apiRoute(url), res.status, res.headers.get('x-request-id'));
    throw e;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; code?: string };
    const e = new ApiError(
      b.error ?? `${method} ${url} answered ${res.status}`,
      method,
      url,
      res.status,
      b.code,
    );
    if (res.status >= 500) reportError(e, 'shown', where);
    reportFailedFetch(apiRoute(url), res.status, res.headers.get('x-request-id'));
    throw e;
  }
  return body as T;
}
