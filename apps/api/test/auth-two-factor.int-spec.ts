/**
 * Admin two-factor login over HTTP with 2FA ON (a throwaway TOTP_ENCRYPTION_KEY of this suite; DECISIONS "Admin
 * two-factor login"): the login's code step under the login limits, the challenge, replay, recovery codes, enrolment,
 * disable, the admin reset and the break-glass CLI. Small login limits for speed; every test uses its own users and
 * client IPs (X-Forwarded-For, as nginx sends them).
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient, Role } from '@prisma/client';
import type Redis from 'ioredis';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { CHALLENGE_COOKIE, REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { type IssuedSession, SessionService } from '../src/modules/auth/session.service';
import {
  hashRecoveryCode,
  newRecoveryCodes,
  normalizeRecoveryCode,
} from '../src/modules/auth/two-factor/recovery-codes';
import { SecretBox, parseSecretBoxKey } from '../src/modules/auth/two-factor/secret-box';
import {
  base32Decode,
  newTotpSecret,
  totpCode,
  totpStep,
} from '../src/modules/auth/two-factor/totp';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { makeUser, testPrisma } from './helpers';

const KEY = randomBytes(32).toString('base64');
const PASSWORD = 'Quiet-harbour-lamp-58';
let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let sessions: SessionService;
let redis: Redis;
let passwordHash: string;
const box = new SecretBox(parseSecretBoxKey(KEY)!);

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  // Read when AppModule is imported below: 2FA on, small login limits, no alert emails.
  Object.assign(process.env, {
    TOTP_ENCRYPTION_KEY: KEY,
    TOTP_ENCRYPTION_KEY_PREVIOUS: '',
    SECURITY_ALERT_EMAIL: '',
    LOGIN_PAIR_MAX_FAILURES: '3',
    LOGIN_LOCK_MINUTES: '1',
    LOGIN_ACCOUNT_FAILURES_PER_HOUR: '30',
    LOGIN_IP_FAILURES_PER_MINUTE: '100',
    LOGIN_ALERT_DISTINCT_IPS_PER_HOUR: '50',
  });
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  sessions = app.get(SessionService);
  redis = app.get<Redis>(REDIS_CACHE);
  passwordHash = await app.get(PasswordService).hash(PASSWORD);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

// A /64 of its own per run and per call: login counters live in Redis across runs, keyed by IP.
const run = randomUUID().slice(0, 4);
let nextIp = 0;
const newIp = () => `2001:db8:${run}:${(nextIp += 1).toString(16)}::1`;
const client = { ip: '203.0.113.50', userAgent: 'jest' };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface Staff {
  id: string;
  email: string;
  role: Role;
  secret: Buffer;
  codes: string[];
}

/** An admin, manager or student with the shared password; `enrolled`: a confirmed factor and 10 recovery codes. */
async function person(role: Role = 'admin', enrolled = true): Promise<Staff> {
  const user = await makeUser(prisma, {
    email: `tfa-${randomUUID().slice(0, 8)}@test.invalid`,
    role,
    passwordHash,
    emailVerifiedAt: new Date(),
  });
  const secret = newTotpSecret();
  const codes = newRecoveryCodes();
  if (enrolled) {
    await prisma.userTwoFactor.create({
      data: { userId: user.id, secretCiphertext: box.seal(secret), enabledAt: new Date() },
    });
    await prisma.twoFactorRecoveryCode.createMany({
      data: codes.map((c) => ({
        userId: user.id,
        codeHash: hashRecoveryCode(normalizeRecoveryCode(c)!),
      })),
    });
  }
  return { id: user.id, email: user.email, role, secret, codes };
}

/** The code of the current step (+offset). Offsets only ever grow within a test: a code works once. */
const totp = (secret: Buffer, offset = 0) => totpCode(secret, totpStep(Date.now()) + offset);
const wrongCode = (secret: Buffer) => {
  const near = new Set([-1, 0, 1].map((o) => totp(secret, o)));
  let code = '000000';
  for (let n = 0; near.has(code); n += 1) code = String(n).padStart(6, '0');
  return code;
};

const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieLine = (res: Response, name: string) =>
  setCookies(res).find((c) => c.startsWith(`${name}=`));
const cookieValue = (res: Response, name: string) =>
  cookieLine(res, name)
    ?.split(';')[0]
    ?.slice(name.length + 1);
const cleared = (res: Response, name: string) =>
  setCookies(res).some((c) => c.startsWith(`${name}=;`) && c.includes('Expires=Thu, 01 Jan 1970'));
const claimsOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { tfa?: unknown };

function post(path: string, body: unknown, opts: { ip?: string; cookie?: string } = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-forwarded-for': opts.ip ?? newIp(),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

/** The password step; `challenge` is the cookie header for the code step. */
async function passwordStep(email: string, ip = newIp()) {
  const res = await post('/api/auth/login', { email, password: PASSWORD }, { ip });
  return { res, challenge: `${CHALLENGE_COOKIE}=${cookieValue(res, CHALLENGE_COOKIE) ?? ''}` };
}
const verify = (challenge: string, body: unknown, ip = newIp()) =>
  post('/api/auth/2fa/verify', body, { ip, cookie: challenge });
const accessOf = (res: Response) => `${ACCESS_COOKIE}=${cookieValue(res, ACCESS_COOKIE) ?? ''}`;
const access = (s: IssuedSession) => `${ACCESS_COOKIE}=${s.accessToken}`;
const refresh = (token: string) =>
  post('/api/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${token}` });
const auditRows = (action: string, actorId: string | null, entityId?: string) =>
  prisma.auditLog.findMany({
    where: { action, ...(actorId ? { actorId } : {}), ...(entityId ? { entityId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
const liveSessions = (userId: string) =>
  prisma.session.count({ where: { userId, revokedAt: null } });

describe('login with two-factor on: the password step', () => {
  it('answers 200 twoFactorRequired with only the sirat_2fa cookie (httpOnly, Strict, its path, 5 minutes); no session yet', async () => {
    const admin = await person();
    const { res } = await passwordStep(admin.email.toUpperCase());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ twoFactorRequired: true });
    expect(setCookies(res).map((c) => c.split('=')[0])).toEqual([CHALLENGE_COOKIE]);
    const line = cookieLine(res, CHALLENGE_COOKIE) ?? '';
    for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/api/auth/2fa', 'Max-Age=300'])
      expect(line).toContain(attr);
    expect(await liveSessions(admin.id)).toBe(0);
    // Redis holds only the user id, under the id's hash, for 5 minutes.
    const key = `2fa:challenge:${sha256(cookieValue(res, CHALLENGE_COOKIE) ?? '')}`;
    expect(await redis.get(key)).toBe(admin.id);
    expect(await redis.ttl(key)).toBeGreaterThan(290);
  });

  it('keeps the plain 204 login for everyone without 2FA, admins who have not enrolled included', async () => {
    for (const role of ['student', 'admin'] as const) {
      const someone = await person(role, false);
      const { res } = await passwordStep(someone.email);
      expect(res.status).toBe(204);
      expect(cookieValue(res, ACCESS_COOKIE)).toBeTruthy();
      expect(cookieLine(res, CHALLENGE_COOKIE)).toBeUndefined();
    }
  });
});

describe('POST /api/auth/2fa/verify', () => {
  it('the right code: 204, session cookies with tfa, the challenge cookie cleared; the admin pages open', async () => {
    const admin = await person();
    const { challenge } = await passwordStep(admin.email);
    const res = await verify(challenge, { code: totp(admin.secret) });
    expect(res.status).toBe(204);
    expect(cleared(res, CHALLENGE_COOKIE)).toBe(true);
    expect(claimsOf(cookieValue(res, ACCESS_COOKIE) ?? '').tfa).toBe(true);
    expect(cookieValue(res, REFRESH_COOKIE)).toBeTruthy();
    expect((await get('/api/admin/users', accessOf(res))).status).toBe(200);
    const me = await json(await get('/api/auth/me', accessOf(res)));
    expect(me.twoFactor).toEqual({ enabled: true, required: true, verified: true });
    expect(await liveSessions(admin.id)).toBe(1);
    const row = await prisma.userTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(row.lastStep).not.toBeNull();
  });

  it('resets the failure counts only after the right code', async () => {
    const admin = await person();
    const ip = newIp();
    for (let i = 0; i < 2; i += 1)
      expect(
        (await post('/api/auth/login', { email: admin.email, password: 'wrong' }, { ip })).status,
      ).toBe(401);
    const { challenge } = await passwordStep(admin.email, ip);
    expect((await verify(challenge, { code: totp(admin.secret) }, ip)).status).toBe(204);
    // Counted from zero again: two more failures do not lock the pair (three would).
    for (let i = 0; i < 2; i += 1)
      expect(
        (await post('/api/auth/login', { email: admin.email, password: 'wrong' }, { ip })).status,
      ).toBe(401);
    expect((await passwordStep(admin.email, ip)).res.status).toBe(200);
  }, 60_000);

  it('a wrong code: 401 TWO_FACTOR_CODE_INVALID, counted in the login limits; the third locks the pair, and then even the right code is refused', async () => {
    const admin = await person();
    const ip = newIp();
    const { challenge } = await passwordStep(admin.email, ip);
    for (let i = 0; i < 3; i += 1) {
      const res = await verify(challenge, { code: wrongCode(admin.secret) }, ip);
      expect(res.status).toBe(401);
      expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
    }
    const locked = await verify(challenge, { code: totp(admin.secret) }, ip);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(50);
    expect((await passwordStep(admin.email, ip)).res.status).toBe(429); // the password too
    expect(await liveSessions(admin.id)).toBe(0);
    const failed = await auditRows('auth.2fa_failed', admin.id);
    expect(failed.map((r) => r.meta)).toEqual([
      { purpose: 'login', method: 'totp', locked: false, challengeUsedUp: false },
      { purpose: 'login', method: 'totp', locked: false, challengeUsedUp: false },
      { purpose: 'login', method: 'totp', locked: true, challengeUsedUp: false },
    ]);
    expect(await auditRows('auth.login_locked', admin.id)).toHaveLength(1);
  });

  it('a right password with wrong codes never resets the counts', async () => {
    const admin = await person();
    const ip = newIp();
    expect(
      (await post('/api/auth/login', { email: admin.email, password: 'wrong' }, { ip })).status,
    ).toBe(401);
    const first = await passwordStep(admin.email, ip); // right password: no reset
    expect(first.res.status).toBe(200);
    expect((await verify(first.challenge, { code: wrongCode(admin.secret) }, ip)).status).toBe(401);
    const second = await passwordStep(admin.email, ip); // still no reset
    expect((await verify(second.challenge, { code: wrongCode(admin.secret) }, ip)).status).toBe(
      401,
    );
    // Three failures in all (1 password, 2 codes): the pair is locked, the right password is refused.
    expect((await passwordStep(admin.email, ip)).res.status).toBe(429);
  });

  it('a lock refuses even the right code; the same challenge from an IP without failures still works', async () => {
    const admin = await person();
    const [ipA, ipB] = [newIp(), newIp()];
    const { challenge } = await passwordStep(admin.email, ipA);
    for (let i = 0; i < 3; i += 1)
      await post('/api/auth/login', { email: admin.email, password: 'wrong' }, { ip: ipA });
    expect((await verify(challenge, { code: totp(admin.secret) }, ipA)).status).toBe(429);
    expect((await verify(challenge, { code: totp(admin.secret) }, ipB)).status).toBe(204);
  });

  it('a challenge works once, and expires', async () => {
    const admin = await person();
    const { challenge } = await passwordStep(admin.email);
    expect((await verify(challenge, { code: totp(admin.secret) })).status).toBe(204);
    const again = await verify(challenge, { code: totp(admin.secret, 1) });
    expect(again.status).toBe(401);
    expect(await json(again)).toMatchObject({ code: 'TWO_FACTOR_CHALLENGE_INVALID' });
    expect(cleared(again, CHALLENGE_COOKIE)).toBe(true);

    const other = await person();
    const expiring = await passwordStep(other.email);
    const id = cookieValue(expiring.res, CHALLENGE_COOKIE) ?? '';
    await redis.pexpire(`2fa:challenge:${sha256(id)}`, 1);
    await new Promise((r) => setTimeout(r, 20));
    const late = await verify(expiring.challenge, { code: totp(other.secret) });
    expect(await json(late)).toMatchObject({ code: 'TWO_FACTOR_CHALLENGE_INVALID' });
    // Without a cookie, or with one that is not even an id: the same answer.
    for (const cookie of ['', `${CHALLENGE_COOKIE}=not-a-challenge`]) {
      const res = await post('/api/auth/2fa/verify', { code: '123456' }, { cookie });
      expect(res.status).toBe(401);
      expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_CHALLENGE_INVALID' });
    }
  });

  it('five wrong codes use the challenge up: its cookie is cleared, and the right code no longer works', async () => {
    const admin = await person();
    const { challenge } = await passwordStep(admin.email);
    let last: Response | undefined;
    for (let i = 0; i < 5; i += 1)
      last = await verify(challenge, { code: wrongCode(admin.secret) }); // 5 IPs: no lock
    expect(last?.status).toBe(401);
    expect(cleared(last!, CHALLENGE_COOKIE)).toBe(true);
    const failed = await auditRows('auth.2fa_failed', admin.id);
    expect(failed.map((r) => (r.meta as { challengeUsedUp: boolean }).challengeUsedUp)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    const res = await verify(challenge, { code: totp(admin.secret) });
    expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_CHALLENGE_INVALID' });
  });

  it('two parallel right codes give exactly one session, through one challenge or two', async () => {
    const admin = await person();
    const { challenge } = await passwordStep(admin.email);
    const code = totp(admin.secret);
    const one = await Promise.all([verify(challenge, { code }), verify(challenge, { code })]);
    expect(one.map((r) => r.status).sort()).toEqual([204, 401]);
    expect(await liveSessions(admin.id)).toBe(1);

    const [a, b] = await Promise.all([passwordStep(admin.email), passwordStep(admin.email)]);
    const next = totp(admin.secret, 1);
    const two = await Promise.all([
      verify(a.challenge, { code: next }),
      verify(b.challenge, { code: next }),
    ]);
    expect(two.map((r) => r.status).sort()).toEqual([204, 401]);
    expect(await liveSessions(admin.id)).toBe(2);
  });

  it('a code works once: the same code again is refused, a later one works', async () => {
    const admin = await person();
    const code = totp(admin.secret);
    expect((await verify((await passwordStep(admin.email)).challenge, { code })).status).toBe(204);
    const replay = await verify((await passwordStep(admin.email)).challenge, { code });
    expect(replay.status).toBe(401);
    expect(await json(replay)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
    const later = await verify((await passwordStep(admin.email)).challenge, {
      code: totp(admin.secret, 1),
    });
    expect(later.status).toBe(204);
  });

  it('a recovery code works once (any case, spaces or dash), is audited with the count left, and raises an alert', async () => {
    const admin = await person();
    const typed = admin.codes[0]!.toLowerCase().replace('-', ' ');
    const res = await verify((await passwordStep(admin.email)).challenge, { recoveryCode: typed });
    expect(res.status).toBe(204);
    expect(claimsOf(cookieValue(res, ACCESS_COOKIE) ?? '').tfa).toBe(true);
    expect((await auditRows('auth.2fa_recovery_used', admin.id)).map((r) => r.meta)).toEqual([
      { purpose: 'login', remaining: 9 },
    ]);
    expect(
      (await auditRows('security.two_factor.recovery_used', admin.id)).map((r) => r.meta),
    ).toEqual([{ purpose: 'login', remaining: 9 }]);
    const again = await verify((await passwordStep(admin.email)).challenge, {
      recoveryCode: admin.codes[0],
    });
    expect(again.status).toBe(401);
    expect(await json(again)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
  });

  it('takes exactly one factor, in its shape, and nothing else (400 before anything is counted)', async () => {
    const admin = await person();
    const { challenge } = await passwordStep(admin.email);
    for (const body of [
      {},
      { code: '12345' },
      { code: 123456 },
      { recoveryCode: 'not a code!' },
      { code: totp(admin.secret), recoveryCode: admin.codes[1] },
      { code: totp(admin.secret), userId: admin.id },
    ])
      expect((await verify(challenge, body)).status).toBe(400);
    expect(await auditRows('auth.2fa_failed', admin.id)).toHaveLength(0);
    expect((await verify(challenge, { code: totp(admin.secret) })).status).toBe(204);
  });

  it('never writes a code, a recovery code, the challenge or the email into the audit trail', async () => {
    const admin = await person();
    const { res, challenge } = await passwordStep(admin.email);
    const id = cookieValue(res, CHALLENGE_COOKIE) ?? '';
    const wrong = wrongCode(admin.secret);
    await verify(challenge, { code: wrong });
    await verify(challenge, { recoveryCode: admin.codes[2] });
    const rows = await prisma.auditLog.findMany({ where: { actorId: admin.id } });
    const text = JSON.stringify(rows);
    for (const secret of [
      wrong,
      admin.codes[2]!,
      normalizeRecoveryCode(admin.codes[2]!)!,
      id,
      admin.email,
    ])
      expect(text).not.toContain(secret);
  });
});

describe('enrolment (admins and managers)', () => {
  it('an admin or manager without 2FA gets 403 TWO_FACTOR_REQUIRED on staff routes, but reaches /auth/me, the 2FA status and logout', async () => {
    for (const role of ['admin', 'manager'] as const) {
      const someone = await person(role, false);
      const { res } = await passwordStep(someone.email);
      expect(res.status).toBe(204);
      const cookie = accessOf(res);
      const stats = await get('/api/admin/stats', cookie);
      expect(stats.status).toBe(403);
      expect(await json(stats)).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
      expect((await json(await get('/api/auth/me', cookie))).twoFactor).toEqual({
        enabled: false,
        required: true,
        verified: false,
      });
      expect(await json(await get('/api/auth/2fa', cookie))).toEqual({
        enabled: false,
        pending: false,
        required: true,
        verified: false,
        recoveryCodesRemaining: 0,
      });
      expect((await post('/api/auth/logout', {}, { cookie })).status).toBe(204);
    }
    const admin = await person('admin', false);
    const cookie = accessOf((await passwordStep(admin.email)).res);
    expect(await json(await get('/api/admin/users', cookie))).toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    });
    // Students never meet any of it.
    const student = await person('student', false);
    const studentCookie = accessOf((await passwordStep(student.email)).res);
    expect((await json(await get('/api/auth/me', studentCookie))).twoFactor).toEqual({
      enabled: false,
      required: false,
      verified: false,
    });
    expect((await get('/api/auth/2fa', studentCookie)).status).toBe(403);
  }, 60_000);

  it('setup and enable: the secret once as a URI and a QR code, recovery codes once, the other sessions end, this device gets tfa', async () => {
    const admin = await person('admin', false);
    const deviceB = await sessions.start({ id: admin.id, role: admin.role }, client);
    const deviceA = await sessions.start({ id: admin.id, role: admin.role }, client);
    const cookie = access(deviceA);

    const wrongPassword = await post('/api/auth/2fa/setup', { password: 'wrong' }, { cookie });
    expect(wrongPassword.status).toBe(400);
    expect(await json(wrongPassword)).toMatchObject({ code: 'PASSWORD_INCORRECT' });

    const first = await json(await post('/api/auth/2fa/setup', { password: PASSWORD }, { cookie }));
    const setup = await post('/api/auth/2fa/setup', { password: PASSWORD }, { cookie }); // replaces it
    expect(setup.status).toBe(200);
    const body = (await setup.json()) as { otpauthUri: string; qrDataUri: string };
    const uri =
      /^otpauth:\/\/totp\/Sirat%20Olympiad%3A[^?]+\?secret=([A-Z2-7]{32})&issuer=Sirat\+Olympiad&/.exec(
        body.otpauthUri,
      );
    expect(uri).not.toBeNull();
    expect(body.otpauthUri).not.toBe(first.otpauthUri);
    expect(body.qrDataUri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/);
    const secret = base32Decode(uri![1]!);
    const pending = await prisma.userTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(pending).toMatchObject({ enabledAt: null, lastStep: null });
    expect(pending.secretCiphertext).toMatch(/^v1:/);
    expect(pending.secretCiphertext).not.toContain(uri![1]!);
    expect((await json(await get('/api/auth/2fa', cookie))).pending).toBe(true);

    // The replaced secret no longer enables; neither does a wrong code.
    const oldSecret = base32Decode(/secret=([A-Z2-7]+)/.exec(String(first.otpauthUri))![1]!);
    for (const code of [totp(oldSecret), wrongCode(secret)]) {
      const res = await post('/api/auth/2fa/enable', { code }, { cookie });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
    }

    const enabled = await post('/api/auth/2fa/enable', { code: totp(secret) }, { cookie });
    expect(enabled.status).toBe(200);
    const { recoveryCodes } = (await enabled.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(claimsOf(cookieValue(enabled, ACCESS_COOKIE) ?? '').tfa).toBe(true);
    const row = await prisma.userTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(row.enabledAt).not.toBeNull();
    expect(row.lastStep).not.toBeNull();
    const stored = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: admin.id } });
    expect(stored.map((c) => c.codeHash).sort()).toEqual(
      recoveryCodes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)).sort(),
    );
    // Every earlier session ended, this device's too; its new cookies open the admin pages.
    for (const old of [deviceA, deviceB])
      expect((await refresh(old.refreshToken)).status).toBe(401);
    expect(await liveSessions(admin.id)).toBe(1);
    expect((await get('/api/admin/users', accessOf(enabled))).status).toBe(200);
    expect((await auditRows('auth.2fa_enabled', admin.id)).map((r) => r.meta)).toEqual([
      { sessionsEnded: 2 },
    ]);
    expect(await auditRows('auth.2fa_setup_started', admin.id)).toHaveLength(2);

    const again = accessOf(enabled);
    expect(
      await json(await post('/api/auth/2fa/setup', { password: PASSWORD }, { cookie: again })),
    ).toMatchObject({ code: 'TWO_FACTOR_ALREADY_ENABLED' });
    expect(
      await json(await post('/api/auth/2fa/enable', { code: totp(secret, 1) }, { cookie: again })),
    ).toMatchObject({ code: 'TWO_FACTOR_ALREADY_ENABLED' });
    // From now on the login asks for the code.
    expect((await passwordStep(admin.email)).res.status).toBe(200);
  }, 60_000);

  it('enable without a setup: 409 TWO_FACTOR_SETUP_REQUIRED', async () => {
    const admin = await person('admin', false);
    const cookie = access(await sessions.start({ id: admin.id, role: admin.role }, client));
    const res = await post('/api/auth/2fa/enable', { code: '123456' }, { cookie });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_SETUP_REQUIRED' });
  });

  it('new recovery codes need a current code; the old ones stop working', async () => {
    const admin = await person();
    const cookie = access(await sessions.startVerified({ id: admin.id, role: admin.role }, client));
    const wrong = await post(
      '/api/auth/2fa/recovery-codes',
      { code: wrongCode(admin.secret) },
      { cookie },
    );
    expect(wrong.status).toBe(400);
    expect(
      (await post('/api/auth/2fa/recovery-codes', { recoveryCode: admin.codes[0] }, { cookie }))
        .status,
    ).toBe(400); // a TOTP code only
    const res = await post(
      '/api/auth/2fa/recovery-codes',
      { code: totp(admin.secret) },
      { cookie },
    );
    expect(res.status).toBe(200);
    const { recoveryCodes } = (await res.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes).not.toContain(admin.codes[0]);
    expect(
      (await verify((await passwordStep(admin.email)).challenge, { recoveryCode: admin.codes[0] }))
        .status,
    ).toBe(401);
    expect(
      (
        await verify((await passwordStep(admin.email)).challenge, {
          recoveryCode: recoveryCodes[0],
        })
      ).status,
    ).toBe(204);
    expect(await auditRows('auth.2fa_recovery_codes_replaced', admin.id)).toHaveLength(1);
    expect((await json(await get('/api/auth/2fa', cookie))).recoveryCodesRemaining).toBe(9);
  }, 60_000);

  it('disable needs both factors; it ends the other sessions and this device continues without the claim', async () => {
    const admin = await person();
    const deviceB = await sessions.startVerified({ id: admin.id, role: admin.role }, client);
    const cookie = access(await sessions.startVerified({ id: admin.id, role: admin.role }, client));
    const noPassword = await post(
      '/api/auth/2fa/disable',
      { password: 'wrong', code: totp(admin.secret) },
      { cookie },
    );
    expect(await json(noPassword)).toMatchObject({ code: 'PASSWORD_INCORRECT' });
    const noCode = await post(
      '/api/auth/2fa/disable',
      { password: PASSWORD, code: wrongCode(admin.secret) },
      { cookie },
    );
    expect(await json(noCode)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
    expect((await post('/api/auth/2fa/disable', { password: PASSWORD }, { cookie })).status).toBe(
      400,
    );

    const res = await post(
      '/api/auth/2fa/disable',
      { password: PASSWORD, code: totp(admin.secret) },
      { cookie },
    );
    expect(res.status).toBe(204);
    expect(claimsOf(cookieValue(res, ACCESS_COOKIE) ?? '').tfa).toBe(false);
    expect(await prisma.userTwoFactor.findUnique({ where: { userId: admin.id } })).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: admin.id } })).toBe(0);
    expect((await refresh(deviceB.refreshToken)).status).toBe(401);
    expect(await liveSessions(admin.id)).toBe(1);
    expect((await auditRows('auth.2fa_disabled', admin.id)).map((r) => r.meta)).toEqual([
      { method: 'totp', sessionsEnded: 2 },
    ]);
    // An admin is sent back to enrolment; the login asks for no code.
    expect(await json(await get('/api/admin/users', accessOf(res)))).toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect((await passwordStep(admin.email)).res.status).toBe(204);
  }, 60_000);

  it('disable with a recovery code raises the recovery alert', async () => {
    const admin = await person('manager');
    const cookie = access(await sessions.startVerified({ id: admin.id, role: admin.role }, client));
    const res = await post(
      '/api/auth/2fa/disable',
      { password: PASSWORD, recoveryCode: admin.codes[3] },
      { cookie },
    );
    expect(res.status).toBe(204);
    expect((await auditRows('auth.2fa_disabled', admin.id)).map((r) => r.meta)).toEqual([
      { method: 'recovery', sessionsEnded: 1 },
    ]);
    expect(
      (await auditRows('security.two_factor.recovery_used', admin.id)).map((r) => r.meta),
    ).toEqual([{ purpose: 'disable', remaining: 0 }]);
  });

  it('recovery-codes and disable need a session that proved the code (403 TWO_FACTOR_REQUIRED)', async () => {
    const admin = await person();
    const cookie = access(await sessions.start({ id: admin.id, role: admin.role }, client));
    for (const [path, body] of [
      ['/api/auth/2fa/recovery-codes', { code: totp(admin.secret) }],
      ['/api/auth/2fa/disable', { password: PASSWORD, code: totp(admin.secret) }],
    ] as const)
      expect(await json(await post(path, body, { cookie }))).toMatchObject({
        code: 'TWO_FACTOR_REQUIRED',
      });
  });
});

describe('the claim across refresh and password change', () => {
  it('a refresh copies the CURRENT 2FA state, and change-password keeps what this session proved', async () => {
    const admin = await person();
    const verified = await sessions.startVerified({ id: admin.id, role: admin.role }, client);
    const rotated = await refresh(verified.refreshToken);
    expect(rotated.status).toBe(204);
    expect(claimsOf(cookieValue(rotated, ACCESS_COOKIE) ?? '').tfa).toBe(true);

    const changed = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: PASSWORD },
      { cookie: accessOf(rotated) },
    );
    expect(changed.status).toBe(400); // the same password is refused; a real change below
    const fresh = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'Another-quiet-lamp-77' },
      { cookie: accessOf(rotated) },
    );
    expect(fresh.status).toBe(204);
    expect(claimsOf(cookieValue(fresh, ACCESS_COOKIE) ?? '').tfa).toBe(true);

    // 2FA gone (as after a reset, here straight in the database): the next refresh no longer claims it.
    await prisma.userTwoFactor.delete({ where: { userId: admin.id } });
    const after = await refresh(cookieValue(fresh, REFRESH_COOKIE) ?? '');
    expect(after.status).toBe(204);
    expect(claimsOf(cookieValue(after, ACCESS_COOKIE) ?? '').tfa).toBe(false);
  }, 60_000);
});

describe('POST /api/admin/users/:id/2fa/reset', () => {
  const reset = (cookie: string, id: string, body: Record<string, unknown>) =>
    post(`/api/admin/users/${id}/2fa/reset`, body, { cookie });

  it("another admin's own code resets a manager's or admin's 2FA and ends all their sessions; audited and alerted", async () => {
    for (const role of ['manager', 'admin'] as const) {
      // One acting admin per target: each stays within the 5-an-hour tier (4 requests, the replay check 5).
      const actor = await person();
      const cookie = access(
        await sessions.startVerified({ id: actor.id, role: actor.role }, client),
      );
      const target = await person(role);
      const t1 = await sessions.startVerified({ id: target.id, role }, client);
      await sessions.startVerified({ id: target.id, role }, client);
      const bad = await reset(cookie, target.id, {
        reason: 'Lost phone',
        code: wrongCode(actor.secret),
      });
      expect(await json(bad)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
      // The target's code or a recovery code is no step-up.
      expect(
        (await reset(cookie, target.id, { reason: 'Lost phone', code: totp(target.secret) }))
          .status,
      ).toBe(400);
      expect(
        (await reset(cookie, target.id, { reason: 'Lost phone', recoveryCode: actor.codes[0] }))
          .status,
      ).toBe(400);

      const code = totp(actor.secret);
      const res = await reset(cookie, target.id, { reason: 'Lost phone', code });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sessionsEnded: 2 });
      expect(await prisma.userTwoFactor.findUnique({ where: { userId: target.id } })).toBeNull();
      expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: target.id } })).toBe(0);
      expect(await liveSessions(target.id)).toBe(0);
      expect((await refresh(t1.refreshToken)).status).toBe(401);
      const audited = await auditRows('auth.2fa_reset', actor.id, target.id);
      expect(audited.map((r) => [r.entityType, r.meta])).toEqual([
        ['user', { via: 'admin', reason: 'Lost phone', sessionsEnded: 2 }],
      ]);
      const alerts = await prisma.auditLog.findMany({
        where: {
          action: 'security.two_factor.reset',
          meta: { path: ['targetUserId'], equals: target.id },
        },
      });
      expect(alerts.map((r) => [r.actorId, r.meta])).toEqual([
        [actor.id, { via: 'admin', targetUserId: target.id, sessionsEnded: 2 }],
      ]);
      // The target logs in with the password alone and must enrol again.
      const login = await passwordStep(target.email);
      expect(login.res.status).toBe(204);
      expect(await json(await get('/api/admin/stats', accessOf(login.res)))).toMatchObject({
        code: 'TWO_FACTOR_REQUIRED',
      });
      if (role === 'admin') {
        // The actor's code worked once: used again on another target, refused.
        const third = await person('manager');
        const replay = await reset(cookie, third.id, { reason: 'Lost phone', code });
        expect(await json(replay)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
      }
    }
  }, 90_000);

  it('never oneself, only admins and managers, 404 for nobody, 409 without 2FA; managers and unverified admins cannot', async () => {
    // Two acting admins, so neither meets the 5-an-hour tier.
    const actor = await person();
    const cookie = access(await sessions.startVerified({ id: actor.id, role: actor.role }, client));
    const body = { reason: 'Lost phone', code: totp(actor.secret) };
    const self = await reset(cookie, actor.id, body);
    expect(self.status).toBe(403);
    expect(await json(self)).toMatchObject({ code: 'TWO_FACTOR_RESET_NOT_ALLOWED' });
    const student = await person('student', false);
    expect(await json(await reset(cookie, student.id, body))).toMatchObject({
      code: 'TWO_FACTOR_RESET_NOT_ALLOWED',
    });
    expect((await reset(cookie, randomUUID(), body)).status).toBe(404);
    const plain = await person('admin', false);
    expect(await json(await reset(cookie, plain.id, body))).toMatchObject({
      code: 'TWO_FACTOR_NOT_ENABLED',
    });
    // None of these used the actor's code: it still works.
    const target = await person('manager');
    expect((await reset(cookie, target.id, body)).status).toBe(200);

    const other = await person();
    const otherCookie = access(
      await sessions.startVerified({ id: other.id, role: other.role }, client),
    );
    expect((await reset(otherCookie, 'not-a-uuid', body)).status).toBe(400);
    expect((await reset(otherCookie, plain.id, { code: body.code, reason: 'x' })).status).toBe(400);
    const unverified = access(await sessions.start({ id: other.id, role: 'admin' }, client));
    expect(await json(await reset(unverified, target.id, body))).toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    });
    const manager = await person('manager');
    const managerCookie = access(
      await sessions.startVerified({ id: manager.id, role: 'manager' }, client),
    );
    expect(
      (await reset(managerCookie, plain.id, { reason: 'x y z', code: totp(manager.secret) }))
        .status,
    ).toBe(403);
  }, 60_000);

  it('is limited to 5 an hour per admin', async () => {
    const actor = await person();
    const cookie = access(await sessions.startVerified({ id: actor.id, role: actor.role }, client));
    const body = { reason: 'Lost phone', code: '000000' };
    for (let i = 0; i < 5; i += 1) expect((await reset(cookie, actor.id, body)).status).toBe(403);
    const limited = await reset(cookie, actor.id, body);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(60);
  });
});

describe('admin:2fa-reset (break-glass CLI)', () => {
  const apiDir = join(__dirname, '..');
  const tsxCli = require.resolve('tsx/cli', { paths: [apiDir] });
  /** The real CLI as a child process, in production mode and WITHOUT TOTP_ENCRYPTION_KEY: it decrypts nothing. */
  function cli(args: string[]) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      SECURITY_ALERT_EMAIL: '',
    };
    delete env.TOTP_ENCRYPTION_KEY;
    delete env.TOTP_ENCRYPTION_KEY_PREVIOUS;
    const r = spawnSync(process.execPath, [tsxCli, 'src/cli/admin-2fa-reset.ts', ...args], {
      cwd: apiDir,
      encoding: 'utf8',
      env,
      timeout: 60_000,
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it('removes the factor and the codes, ends every session, audits and alerts; prints only the user id', async () => {
    const admin = await person();
    const s = await sessions.startVerified({ id: admin.id, role: admin.role }, client);
    const { code, out } = cli([
      '--email',
      admin.email.toUpperCase(),
      '--reason',
      'Lost phone, no admin',
    ]);
    expect(out).toMatch(new RegExp(`^2FA reset: ${admin.id}$`, 'm'));
    expect(code).toBe(0);
    expect(out.toLowerCase()).not.toContain(admin.email);
    expect(await prisma.userTwoFactor.findUnique({ where: { userId: admin.id } })).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: admin.id } })).toBe(0);
    expect((await refresh(s.refreshToken)).status).toBe(401);
    const audited = await prisma.auditLog.findMany({
      where: { action: 'auth.2fa_reset', entityId: admin.id },
    });
    expect(audited.map((r) => [r.actorId, r.meta])).toEqual([
      [null, { via: 'cli', reason: 'Lost phone, no admin', sessionsEnded: 1 }],
    ]);
    const alerts = await prisma.auditLog.findMany({
      where: {
        action: 'security.two_factor.reset',
        meta: { path: ['targetUserId'], equals: admin.id },
      },
    });
    expect(alerts.map((r) => [r.actorId, r.meta])).toEqual([
      [null, { via: 'cli', targetUserId: admin.id, sessionsEnded: 1 }],
    ]);
    expect((await passwordStep(admin.email)).res.status).toBe(204);
  }, 90_000);

  it('refuses an unknown email and an account without 2FA (exit 1, nothing changed), and bad arguments (exit 2)', async () => {
    const unknown = cli([
      '--email',
      `nobody-${randomUUID().slice(0, 8)}@test.invalid`,
      '--reason',
      'Lost phone',
    ]);
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('No account with this email');
    const plain = await person('admin', false);
    const none = cli(['--email', plain.email, '--reason', 'Lost phone']);
    expect(none.code).toBe(1);
    expect(none.out).toContain('no two-factor login');
    expect(cli(['--email', plain.email]).code).toBe(2);
  }, 90_000);
});

/** The session id an answer's access cookie names. */
const sidOf = (res: Response) =>
  (
    JSON.parse(
      Buffer.from(
        (cookieValue(res, ACCESS_COOKIE) ?? '').split('.')[1] ?? '',
        'base64url',
      ).toString(),
    ) as { sid: string }
  ).sid;
const proofOf = async (sessionId: string) =>
  (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).twoFactorVerified;
const hashOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
/** A new setup for the session's user: the secret from its otpauth URI. */
async function setupSecret(cookie: string): Promise<Buffer> {
  const body = await json(await post('/api/auth/2fa/setup', { password: PASSWORD }, { cookie }));
  return base32Decode(/secret=([A-Z2-7]+)/.exec(String(body.otpauthUri))![1]!);
}
const NEW_PASSWORD = 'Another-quiet-lamp-77';

describe('the proof lives on the session row (review finding 1)', () => {
  it('a session that skipped the code stays unverified across refreshes once the user is enrolled', async () => {
    const admin = await person();
    let token = (await sessions.start({ id: admin.id, role: admin.role }, client)).refreshToken;
    for (let i = 0; i < 2; i += 1) {
      const res = await refresh(token);
      expect(res.status).toBe(204);
      expect(claimsOf(cookieValue(res, ACCESS_COOKIE) ?? '').tfa).toBe(false);
      expect(await proofOf(sidOf(res))).toBe(false);
      expect(await json(await get('/api/admin/users', accessOf(res)))).toMatchObject({
        code: 'TWO_FACTOR_REQUIRED',
      });
      token = cookieValue(res, REFRESH_COOKIE) ?? '';
    }
  });

  it('the attack chain: a login before enrolment never becomes a session after it (change-password 401, refresh 401)', async () => {
    const admin = await person('admin', false);
    const attacker = await passwordStep(admin.email); // knows the password, logs in before the admin enrols
    expect(attacker.res.status).toBe(204);
    const device = access(await sessions.start({ id: admin.id, role: admin.role }, client));
    const secret = await setupSecret(device);
    const enabled = await post('/api/auth/2fa/enable', { code: totp(secret) }, { cookie: device });
    expect(enabled.status).toBe(200);
    const before = await hashOf(admin.id);

    const changed = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie: accessOf(attacker.res) },
    );
    expect(changed.status).toBe(401);
    expect(cookieValue(changed, REFRESH_COOKIE)).toBeUndefined();
    expect((await refresh(cookieValue(attacker.res, REFRESH_COOKIE) ?? '')).status).toBe(401);
    expect(await hashOf(admin.id)).toBe(before);
    expect(await liveSessions(admin.id)).toBe(1); // only the one enable started
  }, 60_000);

  it("a live session that skipped the code cannot change an enrolled user's password (403, nothing changes)", async () => {
    const admin = await person();
    const slipped = await sessions.start({ id: admin.id, role: admin.role }, client); // e.g. past enable in a race
    const before = await hashOf(admin.id);
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie: access(slipped) },
    );
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    expect(await hashOf(admin.id)).toBe(before);
    expect(await liveSessions(admin.id)).toBe(1);
    expect(await auditRows('auth.password_changed', admin.id)).toHaveLength(0);
  });

  it("the row's proof survives rotation, and the successor carries it", async () => {
    const admin = await person();
    const verified = await sessions.startVerified({ id: admin.id, role: admin.role }, client);
    expect(await proofOf(verified.user.sessionId)).toBe(true);
    let token = verified.refreshToken;
    for (let i = 0; i < 2; i += 1) {
      const res = await refresh(token);
      expect(res.status).toBe(204);
      expect(claimsOf(cookieValue(res, ACCESS_COOKIE) ?? '').tfa).toBe(true);
      expect(await proofOf(sidOf(res))).toBe(true);
      token = cookieValue(res, REFRESH_COOKIE) ?? '';
    }
  });

  it('change-password from a proved session keeps the proof, on the new row and in its token', async () => {
    const admin = await person();
    const verified = await sessions.startVerified({ id: admin.id, role: admin.role }, client);
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie: access(verified) },
    );
    expect(res.status).toBe(204);
    expect(claimsOf(cookieValue(res, ACCESS_COOKIE) ?? '').tfa).toBe(true);
    expect(await proofOf(sidOf(res))).toBe(true);
  }, 60_000);
});

describe('enable has a cap on wrong codes (review finding 2)', () => {
  it('the 5th wrong code deletes the pending setup (409 TWO_FACTOR_SETUP_REQUIRED); a new setup and a right code clear the count', async () => {
    const admin = await person('admin', false);
    const cookie = access(await sessions.start({ id: admin.id, role: admin.role }, client));
    const attempts = async () =>
      (await prisma.userTwoFactor.findUnique({ where: { userId: admin.id } }))?.enableAttempts;
    const enable = (code: string) => post('/api/auth/2fa/enable', { code }, { cookie });

    let secret = await setupSecret(cookie);
    for (let i = 0; i < 3; i += 1) expect((await enable(wrongCode(secret))).status).toBe(400);
    expect(await attempts()).toBe(3);
    secret = await setupSecret(cookie); // a new setup starts from zero
    expect(await attempts()).toBe(0);
    for (let i = 0; i < 4; i += 1) expect((await enable(wrongCode(secret))).status).toBe(400);
    const fifth = await enable(wrongCode(secret));
    expect(fifth.status).toBe(409);
    expect(await json(fifth)).toMatchObject({ code: 'TWO_FACTOR_SETUP_REQUIRED' });
    expect(await attempts()).toBeUndefined(); // the pending row is gone
    expect(await json(await enable(totp(secret)))).toMatchObject({
      code: 'TWO_FACTOR_SETUP_REQUIRED',
    });

    secret = await setupSecret(cookie);
    for (let i = 0; i < 4; i += 1) expect((await enable(wrongCode(secret))).status).toBe(400);
    expect((await enable(totp(secret))).status).toBe(200); // the 5th attempt, right
    const row = await prisma.userTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(row.enabledAt).not.toBeNull();
    expect(row.enableAttempts).toBe(0);
  }, 90_000);

  it('parallel wrong codes: at most 5 are checked', async () => {
    const admin = await person('admin', false);
    const cookie = access(await sessions.start({ id: admin.id, role: admin.role }, client));
    const secret = await setupSecret(cookie);
    const answers = await Promise.all(
      Array.from({ length: 8 }, () =>
        post('/api/auth/2fa/enable', { code: wrongCode(secret) }, { cookie }),
      ),
    );
    expect(answers.map((r) => r.status).filter((s) => s !== 400 && s !== 409)).toEqual([]);
    expect(await auditRows('auth.2fa_failed', admin.id)).toHaveLength(5);
    expect(await prisma.userTwoFactor.findUnique({ where: { userId: admin.id } })).toBeNull();
  }, 60_000);
});

describe('a challenge checks at most 5 codes, also in parallel (review finding 3)', () => {
  it('8 parallel wrong codes on one challenge: 5 checked, 3 refused unchecked, then the challenge is gone', async () => {
    const admin = await person();
    const { challenge } = await passwordStep(admin.email);
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => verify(challenge, { code: wrongCode(admin.secret) })),
    );
    expect(answers.map((r) => r.status)).toEqual(Array(8).fill(401));
    const codes = await Promise.all(answers.map(async (r) => (await json(r)).code));
    expect(codes.filter((c) => c === 'TWO_FACTOR_CODE_INVALID')).toHaveLength(5);
    expect(codes.filter((c) => c === 'TWO_FACTOR_CHALLENGE_INVALID')).toHaveLength(3);
    expect(await auditRows('auth.2fa_failed', admin.id)).toHaveLength(5);
    const late = await verify(challenge, { code: totp(admin.secret) });
    expect(await json(late)).toMatchObject({ code: 'TWO_FACTOR_CHALLENGE_INVALID' });
  });
});

describe('the reset re-reads the acting admin (review finding 4)', () => {
  it("an admin demoted since the token was issued is refused, and the target's 2FA stays", async () => {
    const actor = await person();
    const cookie = access(await sessions.startVerified({ id: actor.id, role: 'admin' }, client));
    const target = await person('manager');
    await prisma.user.update({ where: { id: actor.id }, data: { role: 'manager' } });
    const res = await post(
      `/api/admin/users/${target.id}/2fa/reset`,
      { reason: 'Lost phone', code: totp(actor.secret) },
      { cookie },
    );
    expect(res.status).toBe(403);
    expect(await prisma.userTwoFactor.findUnique({ where: { userId: target.id } })).not.toBeNull();
    expect(await auditRows('auth.2fa_reset', actor.id)).toHaveLength(0);
  });
});
