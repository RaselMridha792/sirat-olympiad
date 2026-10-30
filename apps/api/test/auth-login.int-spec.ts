/**
 * POST /api/auth/login over HTTP with the owner's rules (2026-10-31): only failures count; an account+IP pair locks
 * (and then even the right password is refused); a right password without a lock resets the count; an account-wide
 * and a per-IP limit; one message for every failure (no enumeration). Small limits for speed; every test uses its
 * own client IPs through X-Forwarded-For, as nginx sends them (the API trusts one proxy hop).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { argon2id, hash } from 'argon2';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { LOGIN_FAILED_MESSAGE } from '../src/modules/auth/auth.service';
import { ARGON2_OPTIONS, PasswordService } from '../src/modules/auth/password.service';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let passwords: PasswordService;
const PASSWORD = 'Blue-river-moon-42';

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  // Small limits, read when AppModule is imported below.
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
const newEmail = () => `s-${randomUUID().slice(0, 8)}@test.invalid`;

async function student(data: Parameters<typeof makeUser>[1] = {}) {
  return makeUser(prisma, {
    email: newEmail(),
    passwordHash: await passwords.hash(PASSWORD),
    ...data,
  });
}

function login(email: string, password: string, ip: string, extra: Record<string, unknown> = {}) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ email, password, ...extra }),
  });
}
const cookieNames = (res: Response) => res.headers.getSetCookie().map((c) => c.split('=')[0]);

describe('POST /api/auth/login', () => {
  it('logs in: 204 with an empty body and both session cookies; not audited (the sessions row records it)', async () => {
    const user = await student({ name: 'Ayesha' });
    const res = await login(`  ${user.email.toUpperCase()} `, PASSWORD, newIp());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(cookieNames(res)).toEqual(expect.arrayContaining([ACCESS_COOKIE, REFRESH_COOKIE]));
    const access = res.headers.getSetCookie().find((c) => c.startsWith(`${ACCESS_COOKIE}=`)) ?? '';
    const me = await fetch(`${base}/api/auth/me`, {
      headers: { cookie: access.split(';')[0] ?? '' },
    });
    expect(me.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'auth.login', actorId: user.id } })).toBe(
      0,
    );
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });

  it('answers a wrong password and an unknown email the same way, with the same argon2 work', async () => {
    const user = await student();
    const dummy = jest.spyOn(passwords, 'verifyDummy');
    const wrong = await login(user.email, 'not-the-password', newIp());
    const unknown = await login(newEmail(), 'not-the-password', newIp());
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    const [a, b] = [
      (await wrong.json()) as { message: string },
      (await unknown.json()) as { message: string },
    ];
    expect(a.message).toBe(LOGIN_FAILED_MESSAGE);
    expect(b.message).toBe(LOGIN_FAILED_MESSAGE);
    expect(cookieNames(wrong)).toEqual([]);
    expect(dummy).toHaveBeenCalledTimes(1); // the unknown email still paid for a verify
    dummy.mockRestore();
    const failed = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.login_failed', actorId: user.id },
    });
    expect(failed.meta).toEqual({ reason: 'bad_password' }); // no email and no email hash in the trail
  });

  it('locks the account+IP pair at the limit: 429 + Retry-After even for the right password; other IPs log in', async () => {
    const user = await student();
    const [ipA, ipB] = [newIp(), newIp()];
    for (let i = 0; i < 3; i += 1) expect((await login(user.email, 'wrong', ipA)).status).toBe(401);

    const locked = await login(user.email, PASSWORD, ipA); // the right password, during the lock
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(50);
    expect(((await locked.json()) as { message: string }).message).toBe(
      'Too many attempts. Try again in 1 minute, or reset your password',
    );
    expect(cookieNames(locked)).toEqual([]);
    expect((await login(user.email, PASSWORD, ipB)).status).toBe(204); // nobody locks you out from another IP
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.login_locked', actorId: user.id } }),
    ).toBe(1);
  });

  it('resets the failure count after a right password without a lock', async () => {
    const user = await student();
    const ip = newIp();
    for (let i = 0; i < 2; i += 1) await login(user.email, 'wrong', ip);
    expect((await login(user.email, PASSWORD, ip)).status).toBe(204);
    for (let i = 0; i < 2; i += 1) expect((await login(user.email, 'wrong', ip)).status).toBe(401);
    expect((await login(user.email, PASSWORD, ip)).status).toBe(204); // still not locked
  });

  it('at the account limit (10 per hour here) refuses only IPs that failed; the student gets in from a fresh one', async () => {
    const user = await student();
    const failedIps = Array.from({ length: 10 }, () => newIp());
    for (const ip of failedIps) await login(user.email, 'wrong', ip);
    expect((await login(user.email, PASSWORD, failedIps[0] as string)).status).toBe(429);
    expect((await login(user.email, PASSWORD, newIp())).status).toBe(204);
    const started = await prisma.auditLog.findMany({
      where: { action: 'auth.login_locked', actorId: user.id },
    });
    expect(started.map((r) => r.meta)).toEqual([{ scope: 'account' }]);
  });

  it('keys limits on the address nginx appended, never on X-Forwarded-For entries a client wrote', async () => {
    const user = await student();
    const real = newIp();
    // A client can prepend anything; nginx appends the address it saw (the API trusts one hop).
    await login(user.email, 'wrong', `6.6.6.6, ${real}`);
    await login(user.email, 'wrong', `7.7.7.7, ${real}`);
    await login(user.email, 'wrong', real);
    expect((await login(user.email, PASSWORD, `8.8.8.8, ${real}`)).status).toBe(429); // one pair: locked
  });

  it('limits failures from one IP across accounts (20 per minute here)', async () => {
    const ip = newIp();
    for (let i = 0; i < 20; i += 1) await login(newEmail(), 'wrong', ip);
    const user = await student();
    expect((await login(user.email, PASSWORD, ip)).status).toBe(429);
    expect((await login(user.email, PASSWORD, newIp())).status).toBe(204);
  });

  it('locks an email without an account exactly like a real one (no enumeration)', async () => {
    const [ghost, ip] = [newEmail(), newIp()];
    for (let i = 0; i < 3; i += 1) expect((await login(ghost, 'wrong', ip)).status).toBe(401);
    const res = await login(ghost, 'wrong', ip);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { message: string }).message).toBe(
      'Too many attempts. Try again in 1 minute, or reset your password',
    );
  });

  it('tells a blocked account so only after the right password', async () => {
    const user = await student({ isBlocked: true });
    expect((await login(user.email, 'wrong', newIp())).status).toBe(401);
    const res = await login(user.email, PASSWORD, newIp());
    expect(res.status).toBe(403);
    expect(cookieNames(res)).toEqual([]);
  });

  it('upgrades an older password hash after a successful login', async () => {
    const weak = await hash(PASSWORD, { ...ARGON2_OPTIONS, type: argon2id, timeCost: 1 });
    const user = await student({ passwordHash: weak });
    expect((await login(user.email, PASSWORD, newIp())).status).toBe(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(passwords.needsRehash(stored.passwordHash)).toBe(false);
    expect((await login(user.email, PASSWORD, newIp())).status).toBe(204);
  });

  it('needs the CSRF header and accepts only email and password', async () => {
    const user = await student();
    const noCsrf = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    expect(noCsrf.status).toBe(403);
    expect((await login(user.email, PASSWORD, newIp(), { role: 'admin' })).status).toBe(400);
    expect((await login('not-an-email', PASSWORD, newIp())).status).toBe(400);
  });
});
