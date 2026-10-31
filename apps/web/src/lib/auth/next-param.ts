/**
 * The `next` parameter: where to go after logging in or renewing the session. Only a page inside the dashboards,
 * on this origin, is accepted; anything else returns null and the caller uses the user's home. Pure (no Next or
 * browser imports) so node --test covers the attack strings.
 */
const AREAS = ['/dashboard', '/admin'] as const;

// Control characters and spaces: browsers drop some of them, so "/\t/evil.example" can become "//evil.example".
// Backslashes: browsers read "/\evil.example" as "//evil.example".
const UNSAFE = /[\u0000- \u007f\\]/;
const MAX_LENGTH = 2048;

export function safeNext(raw: string | null | undefined, origin: string): string | null {
  if (!raw || raw.length > MAX_LENGTH || UNSAFE.test(raw)) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const inArea = AREAS.some((area) => url.pathname === area || url.pathname.startsWith(`${area}/`));
  return inArea ? url.pathname + url.search : null;
}

/** `/login`, carrying `next` only when it is safe. */
export function loginUrl(next: string | null): string {
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
