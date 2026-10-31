import { createRefresher, parseRetryAfter, type RefreshResult } from './refresh';
import { timeoutSignal } from './timeout';

const LOCK_NAME = 'sirat-refresh';
/** The POST gives up after this; so a tab never holds the lock longer. */
const POST_TIMEOUT_MS = 10_000;
/** Waiting for another tab's refresh longer than this counts as "unavailable" (try again). */
const LOCK_WAIT_MS = 15_000;

let refresher: (() => Promise<RefreshResult>) | null = null;

/** The browser's one session refresher (see refresh.ts). Created on first use, so SSR never touches browser APIs. */
export function refreshSession(): Promise<RefreshResult> {
  refresher ??= createRefresher({
    post: async () => {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true, // finishes even if the tab navigates away mid-rotation
        headers: { 'X-Requested-With': 'sirat-web' },
        signal: timeoutSignal(POST_TIMEOUT_MS),
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
