import type { ApiError } from '@sirat/shared';
import { loginUrl, safeNext } from './auth/next-param.ts';
import { parseRetryAfter } from './auth/refresh.ts';
import { refreshSession } from './auth/refresh-browser.ts';

/**
 * The ONLY way the browser talks to the backend.
 * - Same origin (/api) -> no CORS, cookies stay simple.
 * - Auth is an httpOnly cookie set by the server; JS never sees or stores a token.
 * - State-changing requests send a custom header (CSRF defense on top of SameSite=Lax).
 * - A 401 renews the session once (lib/auth/refresh.ts) and repeats the request. When the session is over (the
 *   refresh said 401), the user goes to /login (or the caller handles it, like logout); when the renewal is only
 *   unavailable (network, rate limit, server), the request fails with that and nobody is logged out. A request
 *   still refused after renewals that worked fails as an ordinary 401: that is no proof the session is over.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError | null;
  /** Seconds from Retry-After, when the server sent it (429). */
  readonly retryAfter: number | null;

  constructor(status: number, body: ApiError | null, retryAfter: number | null = null) {
    super(body?.message ?? `Request failed (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

/** The session is over (the refresh answered 401 and the API cleared the cookies). */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

/** These work without a session, or are the renewal itself: a 401 from them never triggers a refresh. */
const NO_REFRESH = new Set([
  '/auth/login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/auth/resend-verification',
]);
/** One renewal per request, plus one more if the repeat still got 401 (another tab rotated in between). */
const MAX_REFRESHES = 2;

export interface ApiInit extends RequestInit {
  /** When the session is over: go to /login (default), or throw SessionExpiredError (the caller decides). */
  onExpired?: 'login' | 'throw';
}

function send(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (method !== 'GET') headers.set('X-Requested-With', 'sirat-web');
  return fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
}

async function toError(res: Response): Promise<ApiRequestError> {
  let body: ApiError | null = null;
  try {
    body = (await res.json()) as ApiError;
  } catch {
    /* non-JSON error body */
  }
  return new ApiRequestError(res.status, body, parseRetryAfter(res.headers.get('Retry-After')));
}

function goToLogin(): void {
  const here = safeNext(window.location.pathname + window.location.search, window.location.origin);
  window.location.replace(loginUrl(here));
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { onExpired = 'login', ...request } = init;
  let res = await send(path, request);
  for (let refreshes = 0; res.status === 401 && !NO_REFRESH.has(path); refreshes += 1) {
    if (refreshes >= MAX_REFRESHES) break; // thrown below as the 401 it is, never as "expired"
    const result = await refreshSession();
    if (result.outcome === 'expired') {
      if (onExpired === 'login') goToLogin();
      throw new SessionExpiredError();
    }
    if (result.outcome === 'unavailable') {
      throw new ApiRequestError(
        503,
        null,
        result.retryAfterMs === null ? null : result.retryAfterMs / 1000,
      );
    }
    res = await send(path, request);
  }
  if (!res.ok) throw await toError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
