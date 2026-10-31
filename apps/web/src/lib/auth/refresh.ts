/**
 * Renews the session from the browser: POST /api/auth/refresh. The refresh cookie is httpOnly and only sent to
 * /api/auth, so the server rendering a page cannot do this. One refresh at a time per tab (a shared promise) and,
 * where the browser has Web Locks, across tabs; older phone browsers lack them, so there it is per tab only.
 * Pure: the browser APIs come in as deps, so node --test covers it (refresh-browser.ts binds them).
 *
 *   ok           renewed (204), or another tab renewed it a moment ago (409: the browser already has new cookies)
 *   expired      the session is over (401; the API cleared both cookies): log in again
 *   unavailable  rate limited, server or network trouble: try again later; never a reason to send anyone to /login
 */
export type RefreshResult =
  | { outcome: 'ok' }
  | { outcome: 'expired' }
  | { outcome: 'unavailable'; retryAfterMs: number | null };

export interface RefreshDeps {
  /** The POST itself: resolves to the status and Retry-After (seconds), rejects on a network error. */
  post: () => Promise<{ status: number; retryAfter: number | null }>;
  /** Runs `fn` while holding the cross-tab lock; absent when the browser has no Web Locks. */
  withLock?: (fn: () => Promise<RefreshResult>) => Promise<RefreshResult>;
  sleep: (ms: number) => Promise<void>;
}

/** After a 409 the other tab's response is usually a few ms away; give its Set-Cookie time to land. */
export const RACE_WAIT_MS = 300;

export function createRefresher(deps: RefreshDeps): () => Promise<RefreshResult> {
  let inFlight: Promise<RefreshResult> | null = null;

  const once = async (): Promise<RefreshResult> => {
    let res: { status: number; retryAfter: number | null };
    try {
      res = await deps.post();
    } catch {
      return { outcome: 'unavailable', retryAfterMs: null };
    }
    if (res.status === 204) return { outcome: 'ok' };
    if (res.status === 409) {
      await deps.sleep(RACE_WAIT_MS);
      return { outcome: 'ok' };
    }
    if (res.status === 401) return { outcome: 'expired' };
    const retryAfterMs =
      res.retryAfter !== null && res.retryAfter >= 0 ? res.retryAfter * 1000 : null;
    return { outcome: 'unavailable', retryAfterMs };
  };

  return () => {
    inFlight ??= (async () => {
      try {
        return deps.withLock ? await deps.withLock(once) : await once();
      } catch {
        return { outcome: 'unavailable', retryAfterMs: null } as const; // e.g. the lock wait timed out
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}

/** Seconds from a Retry-After header (the delta form; nginx and the API send that). */
export function parseRetryAfter(value: string | null): number | null {
  if (!value || !/^\d{1,6}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Waits between automatic retries on /refresh: Retry-After when given, else 2, 4, 8 ... 30 s, with jitter. */
export function retryDelayMs(
  attempt: number,
  retryAfterMs: number | null,
  random = Math.random,
): number {
  if (retryAfterMs !== null) return Math.min(Math.max(retryAfterMs, 1000), 60_000);
  const base = Math.min(2000 * 2 ** attempt, 30_000);
  return Math.round(base * (0.75 + random() * 0.5));
}
