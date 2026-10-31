import { createRefresher, parseRetryAfter, type RefreshResult } from './refresh';
import { timeoutSignal } from './timeout';

const LOCK_NAME = 'sirat-refresh';
/** Waiting for another tab's refresh longer than this counts as "unavailable": try again later. */
const LOCK_WAIT_MS = 15_000;

let refresher: (() => Promise<RefreshResult>) | null = null;

/**
 * The browser's one session refresher (see refresh.ts). Created on first use, so SSR never touches browser APIs.
 * The POST is never cut short: once the API rotates the refresh token, the new cookies exist only in its answer.
 * Aborting would lose them, and the next try would send the retired token, which the API treats as reuse and
 * answers by ending the session. So a slow API stays slow (nginx answers within its 30 s proxy_read_timeout, and
 * /refresh says that it is waiting) and never becomes a logout. The tab holds the lock until the answer is in.
 */
export function refreshSession(): Promise<RefreshResult> {
  refresher ??= createRefresher({
    post: async () => {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true, // finishes even if the tab navigates away mid-rotation
        headers: { 'X-Requested-With': 'sirat-web' },
      });
      return { status: res.status, retryAfter: parseRetryAfter(res.headers.get('Retry-After')) };
    },
    withLock:
      typeof navigator !== 'undefined' && navigator.locks
        ? async (fn) =>
            await navigator.locks.request(LOCK_NAME, { signal: timeoutSignal(LOCK_WAIT_MS) }, fn)
        : undefined,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return refresher();
}
