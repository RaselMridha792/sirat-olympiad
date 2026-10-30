/** The rate limiter's Lua script against a real Redis: counting, blocking, expiry, and fail-open on outage. */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/common/throttler/redis-throttler.storage';

const url = process.env.REDIS_CACHE_URL;
if (!url) throw new Error('REDIS_CACHE_URL is not set');

const redis = new Redis(url, { maxRetriesPerRequest: 1 });
const prefix = `test-throttle:${randomUUID()}:`; // isolated keys; cleaned up afterwards
const storage = new RedisThrottlerStorage(redis, prefix);

afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

describe('RedisThrottlerStorage', () => {
  it('counts hits in a window and blocks once the limit is exceeded', async () => {
    const key = randomUUID();
    const hits = [];
    for (let i = 0; i < 3; i += 1) hits.push(await storage.increment(key, 60_000, 3, 5_000, 'default'));
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3]);
    expect(hits.every((h) => !h.isBlocked)).toBe(true);
    expect(hits[0]?.timeToExpire).toBeGreaterThan(55);

    const fourth = await storage.increment(key, 60_000, 3, 5_000, 'default');
    expect(fourth.isBlocked).toBe(true);
    expect(fourth.timeToBlockExpire).toBe(5);

    // While blocked, further requests stay blocked and do not inflate the counter.
    const fifth = await storage.increment(key, 60_000, 3, 5_000, 'default');
    expect(fifth).toMatchObject({ isBlocked: true, totalHits: 4 });
  });

  it('keeps separate counters per key and per throttler name', async () => {
    const key = randomUUID();
    await storage.increment(key, 60_000, 10, 0, 'default');
    expect((await storage.increment(key, 60_000, 10, 0, 'auth')).totalHits).toBe(1);
    expect((await storage.increment(randomUUID(), 60_000, 10, 0, 'default')).totalHits).toBe(1);
  });

  it('starts a fresh window after the ttl expires', async () => {
    const key = randomUUID();
    await storage.increment(key, 200, 1, 0, 'default');
    expect((await storage.increment(key, 200, 1, 0, 'default')).isBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await storage.increment(key, 200, 1, 0, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('shares state between two storage instances (= two API replicas)', async () => {
    const other = new Redis(url, { maxRetriesPerRequest: 1 });
    try {
      const replicaB = new RedisThrottlerStorage(other, prefix);
      const key = randomUUID();
      await storage.increment(key, 60_000, 10, 0, 'default');
      expect((await replicaB.increment(key, 60_000, 10, 0, 'default')).totalHits).toBe(2);
    } finally {
      await other.quit();
    }
  });

  it('fails open quickly when Redis is unreachable', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, lazyConnect: true, retryStrategy: () => null });
    try {
      const started = Date.now();
      const res = await new RedisThrottlerStorage(dead, prefix).increment(randomUUID(), 60_000, 1, 0, 'default');
      expect(res).toMatchObject({ isBlocked: false, totalHits: 0 });
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      dead.disconnect();
    }
  });
});
