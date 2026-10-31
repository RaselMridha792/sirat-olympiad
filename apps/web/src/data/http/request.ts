/**
 * Request rules of the HTTP data source, pure (no Next imports) so node --test covers them. `ApiGet` is bound to
 * the page request in server.ts: the session cookie, the student's IP and nginx's request id go along, and a 401
 * sends the browser to /refresh before it gets here. Reads only: writes go from the browser through lib/api.ts
 * (DECISIONS "Web data layer over HTTP").
 */
export interface ApiResult {
  status: number;
  body: unknown;
}

/** GET `/api${path}` for the current page request; resolves with any status, throws when the API cannot answer. */
export type ApiGet = (path: string) => Promise<ApiResult>;

/**
 * A read the API refused or answered with an unexpected shape: the page shows its error state. Class and status
 * only, never the path, a query value or a body, because errors can reach the logs.
 */
export class DataRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(status === null ? message : `${message} (${status})`);
    this.name = 'DataRequestError';
    this.status = status;
  }
}

export type QueryValue = string | number | boolean | null | undefined;

/** `path?key=value&…` with every value encoded; null, undefined and '' are left out. */
export function withQuery(path: string, params: Record<string, QueryValue>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    query.append(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** The body of a 200 that passes `check`; any other answer throws DataRequestError. */
export async function getJson<T>(
  get: ApiGet,
  path: string,
  check: (body: unknown) => body is T,
): Promise<T> {
  const { status, body } = await get(path);
  if (status !== 200) throw new DataRequestError('Data request refused', status);
  if (!check(body)) throw new DataRequestError('Unexpected data shape', status);
  return body;
}

/** As getJson, but a 404 is null: an unknown id, so the page shows not found. */
export async function getJsonOrNull<T>(
  get: ApiGet,
  path: string,
  check: (body: unknown) => body is T,
): Promise<T | null> {
  const { status, body } = await get(path);
  if (status === 404) return null;
  if (status !== 200) throw new DataRequestError('Data request refused', status);
  if (!check(body)) throw new DataRequestError('Unexpected data shape', status);
  return body;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
