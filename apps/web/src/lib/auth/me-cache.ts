import { createHash } from 'node:crypto';

/**
 * A short in-process cache of successful /auth/me answers, so page loads and navigations do not all reach the API
 * (a whole school can share one IP). Keyed by the SHA-256 of the access cookie, never the cookie itself; only
 * 200 answers are stored, errors never; bounded, the oldest entry goes first. Trade-off (docs/DECISIONS.md): a
 * block or a role change can take up to `ttlMs` to show in the web. The API's guards trust the access token's role
 * until it expires (up to 15 min); /auth/me, refresh and login read the database at once.
 */
export class MeCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(ttlMs: number, maxEntries: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get(token: string): T | undefined {
    const key = keyOf(token);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(token: string, value: T): void {
    const key = keyOf(token);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }
}

function keyOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
