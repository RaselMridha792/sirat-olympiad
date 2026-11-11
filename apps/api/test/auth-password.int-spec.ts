/**
 * Password endpoints over HTTP (RULEBOOK §5, owner rules of 2026-10-31). change-password: the current password is
 * checked under the login limits; success ends every session and gives this device a fresh one.
 * Only staff have a password (here a jury account): a student or ambassador logs in with email + participant ID and has
 * no password to change or reset (owner, 2026-11-10; docs/plans/PARTICIPANT-LOGIN-PLAN.md §4).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AuthTokenType } from '@prisma/client';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { EmailTokenService } from '../src/modules/auth/email-tokens.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { makePaidPayment, makeUser, testPrisma } from './helpers';

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

/** A staff account (jury): the roles that keep a password. */
async function student() {
  return makeUser(prisma, {
    email: `p-${randomUUID().slice(0, 8)}@test.invalid`,
    role: 'jury',
    passwordHash: await passwords.hash(PASSWORD),
  });
}

/** A real student: a paid registration (so a participant ID) and no password. Logged in the way students are. */
async function registeredStudent() {
  const user = await makeUser(prisma, {
    email: `p-${randomUUID().slice(0, 8)}@test.invalid`,
    role: 'student',
  });
  const payment = await makePaidPayment(prisma, user.id);
  const { participantId } = await prisma.registration.create({
    data: { userId: user.id, paymentId: payment.id },
  });
  const res = await post('/api/auth/login', { email: user.email, participantId }, { ip: newIp() });
  expect(res.status).toBe(204);
  return { user, cookie: cookiesOf(res) };
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
  it('refuses a student or ambassador: there is no password to change (403 PASSWORD_NOT_USED)', async () => {
    const { user, cookie } = await registeredStudent();
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie, ip: newIp() },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('PASSWORD_NOT_USED');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toBeNull();
  });

  it('cancels outstanding password-reset links in the same transaction', async () => {
    const user = await student();
    const cookie = await loginAs(user.email);
    const tokens = app.get(EmailTokenService);
    const pending = await tokens.issue(user.id, AuthTokenType.password_reset);
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie, ip: newIp() },
    );
    expect(res.status).toBe(204);
    await expect(tokens.consume(pending.token, AuthTokenType.password_reset)).resolves.toBeNull();
  });

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

describe('POST /api/auth/reset-password', () => {
  const tokens = () => app.get(EmailTokenService);
  const reset = (token: string, password: string, opts: { csrf?: boolean } = {}) =>
    post('/api/auth/reset-password', { token, password }, { ip: newIp(), ...opts });
  const messageOf = async (res: Response) => ((await res.json()) as { message: string }).message;

  it('sets the new password, ends every session, verifies the email, and never logs in', async () => {
    const user = await student();
    const device = await loginAs(user.email);
    const { token } = await tokens().issue(user.id, AuthTokenType.password_reset);

    const res = await reset(token, NEW_PASSWORD);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([]); // no automatic login
    expect(
      (await post('/api/auth/refresh', {}, { cookie: pick(device, REFRESH_COOKIE) })).status,
    ).toBe(401);
    const login = (password: string) =>
      post('/api/auth/login', { email: user.email, password }, { ip: newIp() });
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull(); // the link proved the inbox
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.password_reset', actorId: user.id },
    });
    expect(entry.meta).toEqual({ sessionsEnded: 1 });
  });

  it('unlocks the account: a locked account+IP pair logs in right after a completed reset', async () => {
    const user = await student();
    const ip = newIp();
    const login = (password: string) =>
      post('/api/auth/login', { email: user.email, password }, { ip });
    for (let i = 0; i < 3; i += 1) expect((await login('wrong')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(429);
    const { token } = await tokens().issue(user.id, AuthTokenType.password_reset);
    expect((await reset(token, NEW_PASSWORD)).status).toBe(204);
    expect((await login(NEW_PASSWORD)).status).toBe(204);
  });

  it('answers every bad link the same way: unknown, malformed, used, expired, verify-type, blocked', async () => {
    const user = await student();
    const used = await tokens().issue(user.id, AuthTokenType.password_reset);
    expect((await reset(used.token, NEW_PASSWORD)).status).toBe(204);
    const expired = await tokens().issue(user.id, AuthTokenType.password_reset);
    await prisma.authToken.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const verifyType = await tokens().issue(user.id, AuthTokenType.email_verify);
    const blocked = await student();
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    const blockedLink = await tokens().issue(blocked.id, AuthTokenType.password_reset);
    // A student's link from before the participant-ID login: a reset never gives a student a password.
    const { user: pupil } = await registeredStudent();
    const studentLink = await tokens().issue(pupil.id, AuthTokenType.password_reset);

    for (const token of [
      randomBytes(32).toString('base64url'),
      'short',
      used.token,
      expired.token,
      verifyType.token,
      blockedLink.token,
      studentLink.token,
    ]) {
      const res = await reset(token, 'Another-good-pass-5');
      expect(res.status).toBe(400);
      expect(await messageOf(res)).toBe('This link is invalid or has expired');
    }
    const stillNone = await prisma.user.findUniqueOrThrow({ where: { id: pupil.id } });
    expect(stillNone.passwordHash).toBeNull();
  });

  it('keeps the link usable when the new password is refused', async () => {
    const user = await student();
    const { token } = await tokens().issue(user.id, AuthTokenType.password_reset);
    const weak = await reset(token, 'password1');
    expect(weak.status).toBe(400);
    expect(JSON.stringify(await weak.json())).toContain('too common');
    expect((await reset(token, NEW_PASSWORD)).status).toBe(204);
  });

  it('lets exactly one of two simultaneous resets with one link succeed', async () => {
    const user = await student();
    const { token } = await tokens().issue(user.id, AuthTokenType.password_reset);
    const results = await Promise.all([reset(token, NEW_PASSWORD), reset(token, 'Other-pass-917')]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  });

  it('needs the CSRF header, and a refused request leaves the link usable', async () => {
    const user = await student();
    const { token } = await tokens().issue(user.id, AuthTokenType.password_reset);
    expect((await reset(token, NEW_PASSWORD, { csrf: false })).status).toBe(403);
    expect((await reset(token, NEW_PASSWORD)).status).toBe(204);
  });
});
