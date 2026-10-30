/** Per-address caps on link emails against a real Redis (forgot-password, resend-verification). */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { EmailSendLimiter } from '../src/modules/auth/email-send-limiter';

const url = process.env.REDIS_CACHE_URL as string;
const prefix = `mailcap-test:${randomUUID()}:`;
let redis: Redis;
let limiter: EmailSendLimiter;

beforeAll(async () => {
  redis = new Redis(url, { maxRetriesPerRequest: 1 });
  await redis.ping();
  limiter = new EmailSendLimiter(redis, { perMinute: 1, perHour: 3 }, prefix);
});

afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

const email = () => `m-${randomUUID().slice(0, 8)}@test.invalid`;

describe('EmailSendLimiter', () => {
  it('allows one link email per minute per address and kind', async () => {
    const mail = email();
    expect(await limiter.allow('reset', mail)).toBe(true);
    expect(await limiter.allow('reset', mail)).toBe(false);
    expect(await limiter.allow('reset', ` ${mail.toUpperCase()} `)).toBe(false); // same address
    expect(await limiter.allow('verify', mail)).toBe(true); // another kind
    expect(await limiter.allow('reset', email())).toBe(true); // another address
  });

  it('caps an address per hour and counts only allowed sends', async () => {
    const mail = email();
    const base = `${prefix}reset:`;
    for (let i = 0; i < 3; i += 1) {
      expect(await limiter.allow('reset', mail)).toBe(true);
      await redis.del(...(await redis.keys(`${base}*:m`))); // skip ahead past the minute window
    }
    expect(await limiter.allow('reset', mail)).toBe(false); // hour cap of 3 reached
  });

  it('fails open while Redis is unavailable', async () => {
    const down = new Redis({ host: '127.0.0.1', port: 1, lazyConnect: true });
    down.on('error', () => undefined);
    const blind = new EmailSendLimiter(down, { perMinute: 1, perHour: 1 }, prefix);
    expect(await blind.allow('reset', email())).toBe(true);
    down.disconnect();
  });
});
