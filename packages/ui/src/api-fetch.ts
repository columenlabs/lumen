/**
 * One JSON fetch for the assistant, workspaces and joins. A failure throws `ApiError` with the
 * method, address, status and the server's `error` and `code`, so a caller shows what failed and
 * Workers Logs keep it: a server fault (5xx) or a network failure is reported to
 * `/api/client-error` with `where` naming the caller. A 4xx is the server saying why it refused,
 * shown to the person and not logged as a fault.
 */
import { reportError } from './route-error';

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

/** A JSON request; `where` names the caller in the error log (`assistant.undo`, `workspace.read`). */
export async function apiJson<T>(url: string, init: RequestInit = {}, where = 'api'): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    const e = new ApiError(`Couldn't reach the server (${method} ${url})`, method, url, 0);
    reportError(e, 'shown', where);
    throw e;
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
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
    throw e;
  }
  return body as T;
}
