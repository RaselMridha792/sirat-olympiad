import type { ApiError } from '@sirat/shared';

/**
 * The ONLY way the web app talks to the backend.
 * - Same origin (/api) -> no CORS, cookies stay simple.
 * - Auth is an httpOnly cookie set by the server; JS never sees or stores a token.
 * - State-changing requests send a custom header (CSRF defense on top of SameSite=Lax).
 */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (method !== 'GET') headers.set('X-Requested-With', 'sirat-web');

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(res.status, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
