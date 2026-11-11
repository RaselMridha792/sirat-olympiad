import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { withTimeout } from '../../../common/with-timeout';

/*
 * Guessing discount codes through the public quote (the lead's note on D1): every miss (an unknown, inactive, expired
 * or used-up code) is counted per IP per hour, in a sorted set keyed by the hour, the member a hash of the IP (never
 * the address). ops-check warns (`quote_misses`) while one IP has QUOTE_MISS_WARN misses in the current or the last
 * hour. Nothing is refused for it: the per-IP throttle on the route does that. A counting failure never fails the
 * request.
 */

export const QUOTE_MISS_WARN = 50;
const HOUR_MS = 3_600_000;
const KEY_TTL_SECONDS = 2 * 3600 + 300;
const TIMEOUT_MS = 300;

export const quoteMissKey = (hour: number) => `quote:miss:${hour}`;
const hourOf = (ms: number) => Math.floor(ms / HOUR_MS);
const ipHash = (ip: string) => createHash('sha256').update(ip).digest('hex').slice(0, 16);

export async function recordQuoteMiss(redis: Redis, ip: string | null, now: Date): Promise<void> {
  if (!ip) return;
  const key = quoteMissKey(hourOf(now.getTime()));
  try {
    await withTimeout(
      redis.multi().zincrby(key, 1, ipHash(ip)).expire(key, KEY_TTL_SECONDS).exec(),
      TIMEOUT_MS,
    );
  } catch {
    // A lost count only delays the warning; the throttle still limits the guessing.
  }
}

export interface QuoteMissFacts {
  /** The most misses one IP made in the current or the last hour. */
  maxMissesPerIp: number;
}

/** For ops-check: read only, from the cache Redis. */
export async function readQuoteMissFacts(redis: Redis, nowMs: number): Promise<QuoteMissFacts> {
  const hour = hourOf(nowMs);
  let max = 0;
  for (const h of [hour, hour - 1]) {
    const top = await redis.zrevrange(quoteMissKey(h), 0, 0, 'WITHSCORES');
    if (top.length === 2) max = Math.max(max, Number(top[1]));
  }
  return { maxMissesPerIp: max };
}

export const isQuoteGuessing = (facts: QuoteMissFacts): boolean =>
  facts.maxMissesPerIp >= QUOTE_MISS_WARN;
