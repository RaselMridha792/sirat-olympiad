/** The rate limiter's Lua script against a real Redis: counting, blocking, expiry, and fail-open on outage. */
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import Redis from 'ioredis';
import {
  RedisThrottlerStorage,
  THROTTLE_BREAKER_MS,
  THROTTLE_REDIS_TIMEOUT_MS,
} from '../src/common/throttler/redis-throttler.storage';
import { CACHE_REDIS_OPTIONS } from '../src/redis/redis.module';

const url = process.env.REDIS_CACHE_URL;
if (!url) throw new Error('REDIS_CACHE_URL is not set');

const redis = new Redis(url, { maxRetriesPerRequest: 1 });
const prefix = `test-throttle:${randomUUID()}:`; // isolated keys; cleaned up afterwards
const storage = new RedisThrottlerStorage(redis, prefix);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await redis.ping(); // the storage fails open until the client is ready
});
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

/** A TCP server that accepts connections and never answers (a hung Redis). */
async function blackHole(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('data', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => {
      sockets.forEach((s) => s.destroy());
      return new Promise((r) => server.close(() => r()));
    },
  };
}

/** A proxy to the real Redis that can stop forwarding requests (Redis hangs after the client is ready). */
async function pausableProxy(): Promise<{ port: number; pause: () => void; close: () => Promise<void> }> {
  const target = new URL(url as string);
  let paused = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port || 6379), target.hostname);
    sockets.add(client).add(upstream);
    client.on('data', (d) => {
      if (!paused) upstream.write(d);
    });
    upstream.on('data', (d) => client.write(d));
    client.on('error', () => undefined);
    upstream.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as net.AddressInfo).port,
    pause: () => {
      paused = true;
    },
    close: () => {
      sockets.forEach((s) => s.destroy());
      return new Promise((r) => server.close(() => r()));
    },
  };
}

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

  it('restarts counting when a block ends, even if the window is longer than the block', async () => {
    const key = randomUUID();
    for (let i = 0; i < 2; i += 1) await storage.increment(key, 10_000, 2, 1_000, 'default');
    expect((await storage.increment(key, 10_000, 2, 1_000, 'default')).isBlocked).toBe(true);
    await sleep(1_200);
    expect(await storage.increment(key, 10_000, 2, 1_000, 'default')).toMatchObject({ isBlocked: false, totalHits: 1 });
  });

  it('accepts a fractional ttl instead of silently failing open', async () => {
    const key = randomUUID();
    await storage.increment(key, 1500.5, 2, 0, 'default');
    await storage.increment(key, 1500.5, 2, 0, 'default');
    expect(await storage.increment(key, 1500.5, 2, 0, 'default')).toMatchObject({ isBlocked: true, totalHits: 3 });
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
    await sleep(300);
    expect(await storage.increment(key, 200, 1, 0, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('shares state between two storage instances (= two API replicas)', async () => {
    const other = new Redis(url, { maxRetriesPerRequest: 1 });
    try {
      await other.ping();
      const replicaB = new RedisThrottlerStorage(other, prefix);
      const key = randomUUID();
      await storage.increment(key, 60_000, 10, 0, 'default');
      expect((await replicaB.increment(key, 60_000, 10, 0, 'default')).totalHits).toBe(2);
    } finally {
      await other.quit();
    }
  });

  it('fails open at once when Redis accepts connections but never answers (production client options)', async () => {
    const hole = await blackHole();
    const client = new Redis({ ...CACHE_REDIS_OPTIONS, host: '127.0.0.1', port: hole.port });
    client.on('error', () => undefined);
    try {
      await sleep(100); // connected at TCP level, but the ready check never completes
      const started = Date.now();
      const res = await new RedisThrottlerStorage(client, prefix).increment(randomUUID(), 60_000, 1, 0, 'default');
      expect(res).toMatchObject({ isBlocked: false, totalHits: 0 });
      expect(Date.now() - started).toBeLessThan(100);
    } finally {
      client.disconnect();
      await hole.close();
    }
  });

  it('times out a Redis that hangs after it was ready, then skips Redis while the breaker is open', async () => {
    const proxy = await pausableProxy();
    const client = new Redis({ ...CACHE_REDIS_OPTIONS, host: '127.0.0.1', port: proxy.port });
    client.on('error', () => undefined);
    try {
      await client.ping();
      const limiter = new RedisThrottlerStorage(client, prefix);
      expect((await limiter.increment(randomUUID(), 60_000, 5, 0, 'default')).totalHits).toBe(1);

      proxy.pause();
      let started = Date.now();
      expect(await limiter.increment(randomUUID(), 60_000, 5, 0, 'default')).toMatchObject({ totalHits: 0 });
      const waited = Date.now() - started;
      expect(waited).toBeGreaterThanOrEqual(THROTTLE_REDIS_TIMEOUT_MS - 20);
      expect(waited).toBeLessThan(THROTTLE_REDIS_TIMEOUT_MS + 300);

      started = Date.now(); // breaker open: no second 300 ms wait
      expect(await limiter.increment(randomUUID(), 60_000, 5, 0, 'default')).toMatchObject({ totalHits: 0 });
      expect(Date.now() - started).toBeLessThan(50);
      expect(THROTTLE_BREAKER_MS).toBeGreaterThan(0);
    } finally {
      client.disconnect();
      await proxy.close();
    }
  });
});
