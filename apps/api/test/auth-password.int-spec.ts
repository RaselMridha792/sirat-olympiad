/**
 * Password endpoints over HTTP (RULEBOOK §5, owner rules of 2026-10-31). change-password: the current password is
 * checked under the login limits; success ends every session and gives this device a fresh one.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let passwords: PasswordService;
const PASSWORD = 'Blue-river-moon-42';
const NEW_PASSWORD = 'Green-hill-sun-77';

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  Object.assign(process.env, {
    LOGIN_PAIR_MAX_FAILURES: '3',
    LOGIN_LOCK_MINUTES: '1',
    LOGIN_ACCOUNT_FAILURES_PER_HOUR: '10',
    LOGIN_IP_FAILURES_PER_MINUTE: '20',
  });
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  passwords = app.get(PasswordService);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

// A /64 of its own per run and per call: login counters live in Redis across runs, keyed by IP.
const run = randomUUID().slice(0, 4);
let nextIp = 0;
const newIp = () => `2001:db8:${run}:${(nextIp += 1).toString(16)}::1`;

async function student() {
  return makeUser(prisma, {
    email: `p-${randomUUID().slice(0, 8)}@test.invalid`,
    passwordHash: await passwords.hash(PASSWORD),
  });
}

function post(
  path: string,
  body: unknown,
  opts: { cookie?: string; ip?: string; csrf?: boolean } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.csrf !== false) headers['x-requested-with'] = 'XMLHttpRequest';
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** The Cookie header a browser would send back: name=value of each Set-Cookie (cleared ones dropped). */
function cookiesOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .filter((c) => !/expires=Thu, 01 Jan 1970/i.test(c))
    .map((c) => c.split(';')[0])
    .join('; ');
}
const pick = (cookies: string, name: string) =>
  cookies.split('; ').find((c) => c.startsWith(`${name}=`)) ?? '';

async function loginAs(email: string, password = PASSWORD) {
  const res = await post('/api/auth/login', { email, password }, { ip: newIp() });
  expect(res.status).toBe(204);
  return cookiesOf(res);
}

describe('POST /api/auth/change-password', () => {
  it('needs a session and the CSRF header', async () => {
    const user = await student();
    const cookie = await loginAs(user.email);
    const body = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };
    expect((await post('/api/auth/change-password', body)).status).toBe(401);
    expect((await post('/api/auth/change-password', body, { cookie, csrf: false })).status).toBe(
      403,
    );
  });

  it('refuses a wrong current password, counted under the login limits', async () => {
    const user = await student();
    const cookie = await loginAs(user.email);
    const ip = newIp();
    const wrong = { currentPassword: 'not-it', newPassword: NEW_PASSWORD };
    for (let i = 0; i < 3; i += 1) {
      const res = await post('/api/auth/change-password', wrong, { cookie, ip });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe(
        'Current password is incorrect',
      );
    }
    const locked = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie, ip },
    );
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(50);
  });

  it('applies the password policy and refuses the current password as the new one', async () => {
    const user = await student();
    const cookie = await loginAs(user.email);
    const common = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'password1' },
      { cookie, ip: newIp() },
    );
    expect(common.status).toBe(400);
    expect(JSON.stringify(await common.json())).toContain('too common');
    const same = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: PASSWORD },
      { cookie, ip: newIp() },
    );
    expect(same.status).toBe(400);
  });

  it('changes it: every session ends, this device gets fresh cookies, only the new password logs in', async () => {
    const user = await student();
    const deviceA = await loginAs(user.email);
    const deviceB = await loginAs(user.email);

    const res = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie: deviceA, ip: newIp() },
    );
    expect(res.status).toBe(204);
    const fresh = cookiesOf(res);
    expect(pick(fresh, ACCESS_COOKIE)).not.toBe('');

    const me = await fetch(`${base}/api/auth/me`, {
      headers: { cookie: pick(fresh, ACCESS_COOKIE) },
    });
    expect(me.status).toBe(200);
    for (const old of [deviceA, deviceB])
      expect(
        (await post('/api/auth/refresh', {}, { cookie: pick(old, REFRESH_COOKIE) })).status,
      ).toBe(401);
    expect(
      (await post('/api/auth/refresh', {}, { cookie: pick(fresh, REFRESH_COOKIE) })).status,
    ).toBe(204);

    expect(
      (await post('/api/auth/login', { email: user.email, password: PASSWORD }, { ip: newIp() }))
        .status,
    ).toBe(401);
    expect(
      (
        await post(
          '/api/auth/login',
          { email: user.email, password: NEW_PASSWORD },
          { ip: newIp() },
        )
      ).status,
    ).toBe(204);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.password_changed', actorId: user.id },
    });
    expect(entry.meta).toEqual({ sessionsEnded: 2 });
  });
});
