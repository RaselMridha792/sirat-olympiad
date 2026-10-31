import { headers } from 'next/headers';
import { apiRequestHeaders } from './auth/forwarded';

/**
 * Server-side calls from the web to the API (Server Components and Server Actions only). They go straight to
 * the API inside the stack (API_INTERNAL_URL, compose: http://api:4000), not back out through nginx. Only the
 * access cookie, the student's IP and nginx's request id go along (lib/auth/forwarded.ts). Errors carry a class
 * and a status only: never the URL, a cookie, a token or a body, because they can reach the logs.
 */
export const ACCESS_COOKIE = 'sirat_access';
const TIMEOUT_MS = 5000;

export class ServerApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(status === null ? message : `${message} (${status})`);
    this.name = 'ServerApiError';
    this.status = status;
  }
}

function baseUrl(): string {
  const configured = process.env.API_INTERNAL_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production')
    throw new ServerApiError('API_INTERNAL_URL is not set');
  return 'http://localhost:4000'; // pnpm dev:api
}

/** A refused or reset connection (an API replica restarting): worth one retry for a GET. */
function isConnectionDrop(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET';
}

export interface ServerApiResult {
  status: number;
  body: unknown;
}

/** GET `/api${path}` for the current request. Resolves with any HTTP status; throws when the API cannot answer. */
export async function serverGet(path: string, accessToken: string): Promise<ServerApiResult> {
  const out = apiRequestHeaders(
    await headers(),
    `${ACCESS_COOKIE}=${accessToken}`,
    process.env.NODE_ENV === 'production',
  );
  const url = `${baseUrl()}/api${path}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: out,
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, body };
    } catch (error) {
      if (attempt === 0 && isConnectionDrop(error)) continue;
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new ServerApiError(timedOut ? 'API timed out' : 'API unreachable');
    }
  }
}
