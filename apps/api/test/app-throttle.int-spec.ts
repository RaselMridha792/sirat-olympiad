/**
 * Boots the real AppModule (real env, Postgres, both Redis) and proves the rate limiter is wired globally:
 * 600 requests per minute per route and client, then 429 with Retry-After; liveness is never limited.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';

let app: NestExpressApplication;
let base: string;

async function deleteThrottleKeys(client: Redis): Promise<void> {
  // Only the app's rate-limit counters (prefix throttle:default:), so a re-run within a minute starts at zero.
  let cursor = '0';
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', 'throttle:default:*', 'COUNT', 500);
    if (keys.length > 0) await client.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

async function statuses(path: string, count: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i += 50) {
    const batch = Array.from({ length: Math.min(50, count - i) }, () =>
      fetch(`${base}${path}`).then((r) => r.status),
    );
    out.push(...(await Promise.all(batch)));
  }
  return out;
}

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent'; // read when AppModule is imported below
  const admin = new Redis(process.env.REDIS_CACHE_URL as string);
  await deleteThrottleKeys(admin);
  await admin.quit();

  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const { REDIS_CACHE } = await import('../src/redis/redis.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app); // the production pipeline (main.ts)
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const cache = app.get<Redis>(REDIS_CACHE);
  if (cache.status !== 'ready') await new Promise((r) => cache.once('ready', r)); // otherwise the limiter fails open
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('global rate limit (AppModule wiring)', () => {
  it('allows 600 requests per minute on a route, then answers 429 with Retry-After', async () => {
    const first = await statuses('/api/ready', 600);
    expect(first.filter((s) => s === 200)).toHaveLength(600);

    const blocked = await fetch(`${base}/api/ready`);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 60_000);

  it('never rate-limits liveness (/api/health)', async () => {
    const all = await statuses('/api/health', 650);
    expect(all.every((s) => s === 200)).toBe(true);
  }, 60_000);
});
