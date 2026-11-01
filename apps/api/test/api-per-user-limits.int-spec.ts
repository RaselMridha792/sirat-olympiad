/**
 * Per-user API limits on the real AppModule (DECISIONS "Per-user API limits"). Every case uses its own client IP
 * through X-Forwarded-For, as nginx sends it (the API trusts one proxy hop), so counters from other suites or a
 * re-run never mix in. The per-user limit is lowered to 10 here; the per-IP default stays the production 600.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService } from '../src/modules/auth/session.service';
import { makeUser, testPrisma } from './helpers';

const PER_USER = 10;
const PER_IP = 600;
const PASSWORD = 'school-crowd-password-7413';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let sessions: SessionService;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  process.env.API_LIMIT_PER_USER_PER_MINUTE = String(PER_USER);
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const { REDIS_CACHE } = await import('../src/redis/redis.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  sessions = app.get(SessionService);
  const cache = app.get<Redis>(REDIS_CACHE);
  if (cache.status !== 'ready') await new Promise((r) => cache.once('ready', r)); // else the limiter fails open
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

/** A fresh client address per case (private range, random), so no counter is shared with anything else. */
const freshIp = () =>
  `10.${Array.from({ length: 3 }, () => 1 + Math.floor(Math.random() * 254)).join('.')}`;

const me = (ip: string, token?: string) =>
  fetch(`${base}/api/auth/me`, {
    headers: { 'x-forwarded-for': ip, ...(token ? { cookie: `${ACCESS_COOKIE}=${token}` } : {}) },
  }).then((r) => r.status);

/** Runs `count` calls, `width` at a time, and returns their results in order. */
async function many<T>(count: number, call: (i: number) => Promise<T>, width = 50): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < count; i += width) {
    out.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(width, count - i) }, (_, j) => call(i + j)),
      )),
    );
  }
  return out;
}

async function signedIn() {
  const user = await makeUser(prisma, {});
  const issued = await sessions.start({ id: user.id, role: user.role }, { ip: '203.0.113.20' });
  return { user, token: issued.accessToken, sessionId: issued.user.sessionId };
}

describe('per-user API limits', () => {
  it('gives every signed-in user their own budget, even behind one shared IP', async () => {
    const ip = freshIp();
    const [a, b] = [await signedIn(), await signedIn()];
    expect(await many(PER_USER, () => me(ip, a.token))).toEqual(Array(PER_USER).fill(200));
    expect(await me(ip, a.token)).toBe(429);
    // Same IP, another student: untouched by the first one's limit.
    expect(await many(PER_USER, () => me(ip, b.token))).toEqual(Array(PER_USER).fill(200));
    expect(await me(ip, b.token)).toBe(429);
  });

  it('counts requests without a verified session against the IP (600), never against a user', async () => {
    const ip = freshIp();
    expect(new Set(await many(PER_IP, () => me(ip)))).toEqual(new Set([401]));
    expect(await me(ip)).toBe(429);
    const c = await signedIn();
    expect(await me(ip, c.token)).toBe(200); // a session from the same IP has its own budget
  });

  it('puts forged and expired tokens in the IP bucket, so invented user keys cannot spread requests', async () => {
    const ip = freshIp();
    const real = await signedIn();
    const forger = new JwtService({ secret: `not-the-server-secret-${randomUUID()}` });
    const forged = (sub: string) =>
      forger.sign({ role: 'student', sid: randomUUID() }, { subject: sub, expiresIn: 900 });
    // 600 requests, each claiming a different user (one of them the real one): one shared IP bucket.
    const claims = Array.from({ length: PER_IP }, (_, i) =>
      i === 0 ? real.user.id : randomUUID(),
    );
    expect(new Set(await many(PER_IP, (i) => me(ip, forged(claims[i] as string))))).toEqual(
      new Set([401]),
    );
    expect(await me(ip, forged(randomUUID()))).toBe(429);
    // A token signed with the real key but expired is no session either: same IP bucket, already full.
    const expired = app
      .get(JwtService)
      .sign({ role: 'student', sid: real.sessionId }, { subject: real.user.id, expiresIn: -60 });
    expect(await me(ip, expired)).toBe(429);
    // The real user's own budget was never touched by the forgeries that named them.
    expect(await many(PER_USER, () => me(ip, real.token))).toEqual(Array(PER_USER).fill(200));
    expect(await me(ip, real.token)).toBe(429);
  });

  it('lets 500 different accounts log in successfully from one IP within a minute', async () => {
    const ip = freshIp();
    const passwordHash = await app.get(PasswordService).hash(PASSWORD);
    const run = randomUUID().slice(0, 8);
    const emails = Array.from({ length: 500 }, (_, i) => `crowd-${run}-${i}@test.invalid`);
    await prisma.user.createMany({
      data: emails.map((email) => ({ email, passwordHash, name: 'Crowd Student' })),
    });
    const started = Date.now();
    const answers = await many(
      emails.length,
      (i) =>
        fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest',
            'x-forwarded-for': ip,
          },
          body: JSON.stringify({ email: emails[i], password: PASSWORD }),
        }).then((r) => ({ status: r.status, limit: r.headers.get('x-ratelimit-limit') })),
      25,
    );
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(answers.filter((a) => a.status !== 204)).toEqual([]);
    // Not counted at all (no limiter header), so not even a bigger crowd would meet the per-IP 600.
    expect(answers.filter((a) => a.limit !== null)).toEqual([]);
  }, 120_000);

  it("answers every anonymous auth route with its own per-IP tier, and /auth/me with the asker's", async () => {
    const ip = freshIp();
    const limitOf = async (path: string, body?: object, token?: string) => {
      const res = await fetch(`${base}/api/auth/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          'x-forwarded-for': ip,
          ...(token ? { cookie: `${ACCESS_COOKIE}=${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.headers.get('x-ratelimit-limit');
    };
    const token = 'A'.repeat(43); // the right shape, not a real link
    expect(await limitOf('refresh', {})).toBe('15000');
    expect(await limitOf('forgot-password', { email: 'nobody@test.invalid' })).toBe('120');
    expect(await limitOf('resend-verification', { email: 'nobody@test.invalid' })).toBe('300');
    expect(await limitOf('reset-password', { token, password: 'a-long-new-password-1' })).toBe(
      '300',
    );
    expect(await limitOf('verify-email', { token })).toBe('300');
    expect(await limitOf('me')).toBe(String(PER_IP));
    expect(await limitOf('me', undefined, (await signedIn()).token)).toBe(String(PER_USER));
  });
});
