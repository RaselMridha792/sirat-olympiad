import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { withTimeout } from '../with-timeout';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Atomic fixed-window counter + optional block, shared by every API replica (RULEBOOK §4: no in-memory state).
 * KEYS[1] = hit counter, KEYS[2] = block flag. ARGV = ttl ms, limit, block ms (integers, see increment()).
 * Returns { hits, windowMsLeft, isBlocked (0/1), blockMsLeft }.
 * When a block starts, the counter expires together with it, so counting restarts after the block
 * (same as the in-memory @nestjs/throttler storage).
 */
const THROTTLE_LUA = `
local blockLeft = redis.call('PTTL', KEYS[2])
if blockLeft > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockLeft }
end
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local hits = redis.call('INCR', KEYS[1])
local left = redis.call('PTTL', KEYS[1])
if left < 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
  left = ttl
end
if hits > limit then
  if block > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', block)
    redis.call('PEXPIRE', KEYS[1], block)
    return { hits, block, 1, block }
  end
  return { hits, left, 1, left }
end
return { hits, left, 0, 0 }
`;

type ThrottleCommand = (
  hitsKey: string,
  blockKey: string,
  ttlMs: number,
  limit: number,
  blockMs: number,
) => Promise<[number, number, number, number]>;

/** If Redis does not answer within this time, the request is allowed (fail-open, see DECISIONS.md). */
export const THROTTLE_REDIS_TIMEOUT_MS = 300;
/** After a timeout/error, skip Redis for this long so a degraded Redis does not add latency to every request. */
export const THROTTLE_BREAKER_MS = 2_000;
const WARN_EVERY_MS = 30_000;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly command: ThrottleCommand;
  private lastWarnAt = 0;
  private breakerOpenUntil = 0;

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'throttle:',
  ) {
    redis.defineCommand('siratThrottle', { numberOfKeys: 2, lua: THROTTLE_LUA });
    // defineCommand adds the method at runtime; ioredis cannot type it statically.
    this.command = (redis as unknown as { siratThrottle: ThrottleCommand }).siratThrottle.bind(
      redis,
    );
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // Fail open at once while Redis is not connected (commands would only wait in the offline queue)
    // or while the breaker is open after a recent timeout.
    if (this.redis.status === 'wait') void this.redis.connect().catch(() => undefined);
    if (this.redis.status !== 'ready') return this.failOpen(ttl, `redis ${this.redis.status}`);
    if (Date.now() < this.breakerOpenUntil) return this.failOpen(ttl, null);

    // PEXPIRE / SET PX reject non-integers (which would silently fail open), and 0 would delete the key.
    const ttlMs = Math.max(1, Math.ceil(ttl));
    const blockMs = Math.max(0, Math.ceil(blockDuration));
    const base = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [hits, windowLeft, blocked, blockLeft] = await withTimeout(
        this.command(`${base}:hits`, `${base}:block`, ttlMs, limit, blockMs),
        THROTTLE_REDIS_TIMEOUT_MS,
      );
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(windowLeft / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockLeft / 1000),
      };
    } catch (err) {
      this.breakerOpenUntil = Date.now() + THROTTLE_BREAKER_MS;
      return this.failOpen(ttl, err instanceof Error ? err.message : 'unknown error');
    }
  }

  /** Fail open: a cache outage must not take the whole API down on exam day. Nginx limit_req still applies. */
  private failOpen(ttl: number, reason: string | null): ThrottlerStorageRecord {
    const now = Date.now();
    if (reason !== null && now - this.lastWarnAt > WARN_EVERY_MS) {
      this.lastWarnAt = now;
      this.logger.warn(`rate limiter unavailable, allowing requests: ${reason}`);
    }
    return {
      totalHits: 0,
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
