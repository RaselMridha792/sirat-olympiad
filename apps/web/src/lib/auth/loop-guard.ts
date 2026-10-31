/**
 * Ends a /refresh loop: the session renews, yet the page sends the user straight back (for example a blocked
 * account, or a cookie the browser refuses). At most MAX_VISITS per target page within WINDOW_MS, per tab
 * (sessionStorage); after that, /login. Storage that throws (some private modes) refuses: fail closed.
 */
export const MAX_VISITS = 2;
export const WINDOW_MS = 120_000;

type TabStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function allowRefreshVisit(storage: TabStorage, target: string, now: number): boolean {
  try {
    const key = `sirat-refresh:${target}`;
    const saved: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    const recent = (Array.isArray(saved) ? saved : []).filter(
      (t): t is number => typeof t === 'number' && t <= now && now - t < WINDOW_MS,
    );
    if (recent.length >= MAX_VISITS) return false;
    storage.setItem(key, JSON.stringify([...recent, now]));
    return true;
  } catch {
    return false;
  }
}
