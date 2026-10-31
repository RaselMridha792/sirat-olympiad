/**
 * Ends a /refresh loop: the session renews, yet the page sends the user straight back (for example a blocked
 * account, or a cookie the browser refuses). Only renewals that worked count: at most MAX_RENEWALS per target page
 * within WINDOW_MS, per tab (sessionStorage); the next arrival goes to /login without trying. Reloads while the
 * API is unavailable count nothing, so an outage never sends anyone to /login. No storage, or storage that throws
 * (blocked site data, some private modes), refuses: fail closed.
 */
export const MAX_RENEWALS = 2;
export const WINDOW_MS = 120_000;

type TabStorage = Pick<Storage, 'getItem' | 'setItem'>;

const keyOf = (target: string) => `sirat-refresh:${target}`;

function recentRenewals(storage: TabStorage, target: string, now: number): number[] {
  const saved: unknown = JSON.parse(storage.getItem(keyOf(target)) ?? '[]');
  return (Array.isArray(saved) ? saved : []).filter(
    (t): t is number => typeof t === 'number' && t <= now && now - t < WINDOW_MS,
  );
}

/** On arrival at /refresh: false once renewals for `target` already looped MAX_RENEWALS times. Reads only. */
export function mayRenew(storage: TabStorage | null, target: string, now: number): boolean {
  if (!storage) return false;
  try {
    return recentRenewals(storage, target, now).length < MAX_RENEWALS;
  } catch {
    return false;
  }
}

/** After a renewal worked, before going back to `target`: records it; false (go to /login) if one too many. */
export function recordRenewal(storage: TabStorage | null, target: string, now: number): boolean {
  if (!storage) return false;
  try {
    const recent = recentRenewals(storage, target, now);
    if (recent.length >= MAX_RENEWALS) return false;
    storage.setItem(keyOf(target), JSON.stringify([...recent, now]));
    return true;
  } catch {
    return false;
  }
}
