import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { withTimeout } from '../with-timeout';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Atomic fixed-window counter + optional block, shared by every API replica (RULEBOOK §4: no in-memory state).
 * KEYS[1] = hit counter, KEYS[2] = block flag. ARGV = ttl ms, limit, block ms.
 * Returns { hits, windowMsLeft, isBlocked (0/1), blockMsLeft }.
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
    return { hits, left, 1, block }
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
const WARN_EVERY_MS = 30_000;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly command: ThrottleCommand;
  private lastWarnAt = 0;

  constructor(
    redis: Redis,
    private readonly prefix = 'throttle:',
  ) {
    redis.defineCommand('siratThrottle', { numberOfKeys: 2, lua: THROTTLE_LUA });
    // defineCommand adds the method at runtime; ioredis cannot type it statically.
    this.command = (redis as unknown as { siratThrottle: ThrottleCommand }).siratThrottle.bind(redis);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [hits, windowLeft, blocked, blockLeft] = await withTimeout(
        this.command(`${base}:hits`, `${base}:block`, ttl, limit, blockDuration),
        THROTTLE_REDIS_TIMEOUT_MS,
      );
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(windowLeft / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockLeft / 1000),
      };
    } catch (err) {
      // Fail open: a cache outage must not take the whole API down on exam day. Nginx limit_req still applies.
      const now = Date.now();
      if (now - this.lastWarnAt > WARN_EVERY_MS) {
        this.lastWarnAt = now;
        this.logger.warn(`rate limiter unavailable, allowing requests: ${err instanceof Error ? err.message : 'unknown'}`);
      }
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
