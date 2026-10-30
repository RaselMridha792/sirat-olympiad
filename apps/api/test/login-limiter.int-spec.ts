/**
 * Login limits against a real Redis (owner rules, 2026-10-31), with small limits so the test is fast:
 * pair lock after 3 failures (1 s, doubling to a 3 s cap), 5 failures per account, 6 failures per IP.
 */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  type FailureResult,
  LoginLimiter,
  type LoginLimits,
} from '../src/modules/auth/login-limiter';

const url = process.env.REDIS_CACHE_URL as string;
const prefix = `login-test:${randomUUID()}:`;
const limits: LoginLimits = {
  ipFailuresPerMinute: 6,
  pairMaxFailures: 3,
  lockBaseMs: 1_000,
  lockMaxMs: 3_000,
  accountFailuresPerHour: 5,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let redis: Redis;
let limiter: LoginLimiter;

beforeAll(async () => {
  redis = new Redis(url, { maxRetriesPerRequest: 1 });
  await redis.ping();
  limiter = new LoginLimiter(redis, limits, prefix);
});

afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

const email = () => `u-${randomUUID().slice(0, 8)}@test.invalid`;
let n = 0;
const ip = () => `198.51.100.${(n = (n % 250) + 1)}`; // a fresh IPv4 per call
async function fail(times: number, mail: string, from: string) {
  let last: FailureResult = {
    lockedForMs: 0,
    lockLevel: 0,
    accountFailures: 0,
    accountLimitStarted: false,
  };
  for (let i = 0; i < times; i += 1) last = await limiter.recordFailure(mail, from);
  return last;
}

describe('LoginLimiter', () => {
  it('locks an account+IP pair at the failure limit, and only that pair', async () => {
    const mail = email();
    const [a, b] = [ip(), ip()];
    expect(await fail(2, mail, a)).toMatchObject({ lockedForMs: 0, lockLevel: 0 });
    expect(await limiter.check(mail, a)).toEqual({ allowed: true });
    expect(await fail(1, mail, a)).toMatchObject({ lockedForMs: 1_000, lockLevel: 1 });

    const locked = await limiter.check(mail, a);
    expect(locked).toMatchObject({ allowed: false, reason: 'pair_locked' });
    expect((locked as { retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(1_000);
    expect(await limiter.check(mail, b)).toEqual({ allowed: true }); // another IP is not locked out
    expect(await limiter.check(email(), a)).toEqual({ allowed: true }); // nor another account
  });

  it('lets a lock expire by itself; repeated locks double up to the cap', async () => {
    const [mail, from] = [email(), ip()];
    expect((await fail(3, mail, from)).lockedForMs).toBe(1_000);
    await sleep(1_100);
    expect(await limiter.check(mail, from)).toEqual({ allowed: true });
    expect(await fail(3, mail, from)).toMatchObject({ lockedForMs: 2_000, lockLevel: 2 });
    await sleep(2_100);
    expect(await fail(3, mail, from)).toMatchObject({ lockedForMs: 3_000, lockLevel: 3 }); // 4 s capped at 3 s
  });

  it('resets the count and the escalation after a right password without a lock', async () => {
    const [mail, from] = [email(), ip()];
    await fail(2, mail, from);
    await limiter.recordSuccess(mail, from);
    expect((await fail(2, mail, from)).lockedForMs).toBe(0); // counting started again
    expect(await fail(1, mail, from)).toMatchObject({ lockedForMs: 1_000, lockLevel: 1 });
  });

  it('at the account limit refuses only IPs that failed on it; a fresh IP still gets in', async () => {
    const mail = email();
    const failed = [ip(), ip(), ip(), ip(), ip()];
    const results = [];
    for (const from of failed) results.push(await fail(1, mail, from)); // 5: the account limit here
    expect(results.map((r) => r.accountLimitStarted)).toEqual([false, false, false, false, true]);
    expect(await limiter.check(mail, failed[0])).toMatchObject({
      allowed: false,
      reason: 'account_limit',
    });
    const fresh = ip(); // e.g. the student's own network
    expect(await limiter.check(mail, fresh)).toEqual({ allowed: true });
    await fail(1, mail, fresh); // one guess per fresh IP, then refused too
    expect(await limiter.check(mail, fresh)).toMatchObject({ reason: 'account_limit' });
  });

  it('counts the account failures, and a right password clears the failed mark of that IP', async () => {
    const [mail, mine] = [email(), ip()];
    expect((await fail(1, mail, mine)).accountFailures).toBe(1);
    await limiter.recordSuccess(mail, mine); // the student got in from here
    for (let i = 0; i < 5; i += 1) await fail(1, mail, ip()); // others push the account over the limit
    expect(await limiter.check(mail, mine)).toEqual({ allowed: true });
  });

  it('limits one IP across accounts, counting only failures', async () => {
    const shared = ip();
    for (let i = 0; i < 20; i += 1) await limiter.recordSuccess(email(), shared);
    expect(await limiter.check(email(), shared)).toEqual({ allowed: true }); // successes never count
    for (let i = 0; i < 6; i += 1) await fail(1, email(), shared);
    expect(await limiter.check(email(), shared)).toMatchObject({
      allowed: false,
      reason: 'ip_limit',
    });
  });

  it('a completed password reset unlocks that account on every IP, and no other account', async () => {
    // A high IP limit here: two accounts fail from one IP, and a reset never clears an IP's limit.
    const roomy = new LoginLimiter(redis, { ...limits, ipFailuresPerMinute: 100 }, prefix);
    const [mail, other] = [email(), email()];
    const [a, b] = [ip(), ip()];
    for (let i = 0; i < 3; i += 1) await roomy.recordFailure(mail, a);
    for (let i = 0; i < 2; i += 1) await roomy.recordFailure(mail, b); // account count 5: limit reached
    for (let i = 0; i < 3; i += 1) await roomy.recordFailure(other, a);
    expect(await roomy.check(mail, a)).toMatchObject({ reason: 'pair_locked' });
    expect(await roomy.check(mail, b)).toMatchObject({ reason: 'account_limit' });

    await roomy.resetAccount(mail);
    expect(await roomy.check(mail, a)).toEqual({ allowed: true });
    expect(await roomy.check(mail, b)).toEqual({ allowed: true });
    expect(await roomy.check(other, a)).toMatchObject({ reason: 'pair_locked' });
    expect(await roomy.recordFailure(mail, a)).toMatchObject({ lockedForMs: 0, lockLevel: 0 }); // fresh count
  });

  it('keeps an IP limit after a password reset: it protects every account', async () => {
    const shared = ip();
    const mail = email();
    for (let i = 0; i < 6; i += 1) await fail(1, i === 0 ? mail : email(), shared);
    await limiter.resetAccount(mail);
    expect(await limiter.check(mail, shared)).toMatchObject({ reason: 'ip_limit' });
  });

  it('treats addresses of one IPv6 /64 as one client', async () => {
    const mail = email();
    for (const from of ['2001:db8:9:2::1', '2001:db8:9:2::2', '2001:db8:9:2:abcd::3'])
      await fail(1, mail, from);
    expect(await limiter.check(mail, '2001:db8:9:2::9')).toMatchObject({ reason: 'pair_locked' });
  });

  it('never writes the email into Redis keys', async () => {
    const mail = email();
    await fail(1, mail, ip());
    const keys = await redis.keys(`${prefix}*`);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.includes(mail) || k.includes(mail.split('@')[0] as string))).toBe(
      false,
    );
  });

  it('fails open while the cache Redis is unavailable', async () => {
    const down = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    down.on('error', () => undefined);
    const blind = new LoginLimiter(down, limits, prefix);
    expect(await blind.check(email(), ip())).toEqual({ allowed: true });
    expect(await blind.recordFailure(email(), ip())).toMatchObject({
      lockedForMs: 0,
      lockLevel: 0,
    });
    down.disconnect();
  });
});
