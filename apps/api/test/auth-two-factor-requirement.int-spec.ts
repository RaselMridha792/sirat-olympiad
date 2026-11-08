/**
 * The admin two-factor REQUIREMENT over HTTP with 2FA ON (a throwaway TOTP_ENCRYPTION_KEY of this suite; DECISIONS
 * "The admin 2FA requirement is a setting"): the guard per role with the requirement on and off, the login's code step
 * (always, for an enrolled account), GET/PUT /admin/security/two-factor-requirement, the generic settings PUT, the
 * CHECK and the break-glass CLI. Every test sets the row itself; the row as it was is put back at the end.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, type PrismaClient, type Role } from '@prisma/client';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { type IssuedSession, SessionService } from '../src/modules/auth/session.service';
import {
  hashRecoveryCode,
  newRecoveryCodes,
  normalizeRecoveryCode,
} from '../src/modules/auth/two-factor/recovery-codes';
import { SecretBox, parseSecretBoxKey } from '../src/modules/auth/two-factor/secret-box';
import { newTotpSecret, totpCode, totpStep } from '../src/modules/auth/two-factor/totp';
import {
  REQUIREMENT_CACHE_MS,
  REQUIREMENT_KEY,
  TwoFactorRequirement,
} from '../src/modules/auth/two-factor/two-factor-requirement';
import { makeUser, testPrisma } from './helpers';

const KEY = randomBytes(32).toString('base64');
const PASSWORD = 'Quiet-harbour-lamp-58';
const PATH = '/api/admin/security/two-factor-requirement';
let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let sessions: SessionService;
let requirement: TwoFactorRequirement;
let passwordHash: string;
let before: { value: Prisma.JsonValue } | null = null;
const box = new SecretBox(parseSecretBoxKey(KEY)!);

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
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
  requirement = app.get(TwoFactorRequirement);
  passwordHash = await app.get(PasswordService).hash(PASSWORD);
  before = await prisma.setting.findUnique({
    where: { key: REQUIREMENT_KEY },
    select: { value: true },
  });
}, 60_000);

afterAll(async () => {
  if (prisma) {
    if (before) await setRow(before.value);
    else await setRow(undefined);
  }
  await app?.close();
  await prisma?.$disconnect();
});

/** The row as a test wants it (undefined: no row), and this replica's copy dropped, as after a change. */
async function setRow(value: Prisma.JsonValue | undefined): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: REQUIREMENT_KEY } });
  if (value !== undefined)
    await prisma.setting.create({
      data: { key: REQUIREMENT_KEY, value: value === null ? Prisma.JsonNull : value },
    });
  requirement?.invalidate();
}
const rowValue = async () =>
  (await prisma.setting.findUnique({ where: { key: REQUIREMENT_KEY } }))?.value;

const run = randomUUID().slice(0, 4);
let nextIp = 0;
const newIp = () => `2001:db8:${run}:a${(nextIp += 1).toString(16)}::1`;
const client = { ip: '203.0.113.60', userAgent: 'jest' };

interface Staff {
  id: string;
  email: string;
  role: Role;
  secret: Buffer;
}

/** An admin or manager with the shared password; `enrolled`: a confirmed factor and 10 recovery codes. */
async function person(role: Role = 'admin', enrolled = true): Promise<Staff> {
  const user = await makeUser(prisma, {
    email: `tfa-req-${randomUUID().slice(0, 8)}@test.invalid`,
    role,
    passwordHash,
    emailVerifiedAt: new Date(),
  });
  const secret = newTotpSecret();
  if (enrolled) {
    await prisma.userTwoFactor.create({
      data: { userId: user.id, secretCiphertext: box.seal(secret), enabledAt: new Date() },
    });
    await prisma.twoFactorRecoveryCode.createMany({
      data: newRecoveryCodes().map((c) => ({
        userId: user.id,
        codeHash: hashRecoveryCode(normalizeRecoveryCode(c)!),
      })),
    });
  }
  return { id: user.id, email: user.email, role, secret };
}

const totp = (secret: Buffer, offset = 0) => totpCode(secret, totpStep(Date.now()) + offset);
const wrongCode = (secret: Buffer) => {
  const near = new Set([-1, 0, 1, 2].map((o) => totp(secret, o)));
  let code = '000000';
  for (let n = 0; near.has(code); n += 1) code = String(n).padStart(6, '0');
  return code;
};

const access = (s: IssuedSession) => `${ACCESS_COOKIE}=${s.accessToken}`;
/** A session that proved the code, and one that did not (e.g. logged in before the requirement was switched on). */
const proved = async (p: Staff) =>
  access(await sessions.startVerified({ id: p.id, role: p.role }, client));
const unproved = async (p: Staff) =>
  access(await sessions.start({ id: p.id, role: p.role }, client));

function send(method: string, path: string, body: unknown, cookie?: string) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-forwarded-for': newIp(),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
const get = (path: string, cookie: string) =>
  fetch(`${base}${path}`, { headers: { cookie, 'x-forwarded-for': newIp() } });
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const change = (cookie: string, body: Record<string, unknown>) => send('PUT', PATH, body, cookie);
const auditRows = (action: string, where: Prisma.AuditLogWhereInput = {}) =>
  prisma.auditLog.findMany({ where: { action, ...where }, orderBy: { createdAt: 'asc' } });
const meTwoFactor = async (cookie: string) =>
  ((await json(await get('/api/auth/me', cookie))) as { twoFactor: Record<string, boolean> })
    .twoFactor;

describe('the guard follows the requirement (2FA on)', () => {
  it('an unproved admin gets 403 TWO_FACTOR_REQUIRED with no row and with the default; with the requirement off the admin routes open', async () => {
    const admin = await person();
    const cookie = await unproved(admin);
    for (const value of [undefined, ['admin', 'manager']]) {
      await setRow(value);
      const res = await get('/api/admin/users', cookie);
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    }
    await setRow([]);
    expect((await get('/api/admin/users', cookie)).status).toBe(200);
    expect((await get('/api/admin/stats', await unproved(await person('manager')))).status).toBe(
      200,
    );
  });

  it('only "admin" required: an unproved manager opens /admin/leaderboard (admin and manager), an unproved admin does not', async () => {
    await setRow(['admin']);
    const manager = await unproved(await person('manager'));
    const res = await get('/api/admin/leaderboard', manager);
    expect(res.status).not.toBe(403);
    expect((await get('/api/admin/stats', manager)).status).toBe(200);
    expect(await meTwoFactor(manager)).toEqual({ enabled: true, required: false, verified: false });
    const admin = await unproved(await person());
    expect(await json(await get('/api/admin/leaderboard', admin))).toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect(await meTwoFactor(admin)).toEqual({ enabled: true, required: true, verified: false });
  });

  it('while off, an enrolled admin still gets the code step at login; an admin without 2FA logs in with the password', async () => {
    await setRow([]);
    const enrolled = await person();
    const login = await send('POST', '/api/auth/login', {
      email: enrolled.email,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ twoFactorRequired: true });
    expect(login.headers.getSetCookie().some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(false);
    const plain = await person('admin', false);
    const res = await send('POST', '/api/auth/login', { email: plain.email, password: PASSWORD });
    expect(res.status).toBe(204);
  });
});

describe('PUT /api/admin/security/two-factor-requirement', () => {
  it('needs a session that proved the code even while the requirement is off; managers get 403 on both routes', async () => {
    await setRow([]);
    const admin = await person();
    const res = await change(await unproved(admin), {
      roles: ['admin', 'manager'],
      expected: [],
      reason: 'Go-live',
      code: totp(admin.secret),
    });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    expect(await rowValue()).toEqual([]);
    // The GET carries no @TwoFactorAlways: while off, the unproved admin may read it.
    expect((await get(PATH, await unproved(admin))).status).toBe(200);

    const manager = await person('manager');
    const managerCookie = await proved(manager);
    const refused = await change(managerCookie, {
      roles: [],
      expected: [],
      reason: 'Go-live',
      code: totp(manager.secret),
    });
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ code: 'FORBIDDEN' });
    expect((await get(PATH, managerCookie)).status).toBe(403);
    expect(
      await auditRows('security.two_factor_requirement_changed', { actorId: admin.id }),
    ).toEqual([]);
  });

  it('refuses a wrong code (400, counted), a stale expected (409, the code not used), an unknown role and a short reason (400)', async () => {
    await setRow(undefined);
    const admin = await person();
    const cookie = await proved(admin);
    const body = { roles: [], expected: ['admin', 'manager'], reason: 'Testing before go-live' };

    const wrong = await change(cookie, { ...body, code: wrongCode(admin.secret) });
    expect(wrong.status).toBe(400);
    expect(await json(wrong)).toMatchObject({ code: 'TWO_FACTOR_CODE_INVALID' });
    expect((await auditRows('auth.2fa_failed', { actorId: admin.id })).map((r) => r.meta)).toEqual([
      { purpose: 'requirement', method: 'totp', locked: false },
    ]);

    const code = totp(admin.secret);
    const stale = await change(cookie, { ...body, expected: ['admin'], code });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: 'TWO_FACTOR_REQUIREMENT_CHANGED' });

    const unknown = await change(cookie, { ...body, roles: ['admin', 'jury'], code });
    expect(unknown.status).toBe(400);
    const short = await change(cookie, { ...body, reason: 'no', code });
    expect(short.status).toBe(400);
    expect(await rowValue()).toBeUndefined(); // the 409 rolled back the default row it inserted
    expect(
      await auditRows('security.two_factor_requirement_changed', { actorId: admin.id }),
    ).toEqual([]);

    // The 409 did not use the code up: the same code works (the 5th request of the 5-an-hour tier).
    expect((await change(cookie, { ...body, code })).status).toBe(200);
  });

  it('a change: the value, the audit row with the reason, the alert with from and to only; this replica follows at once, GET and /auth/me too; enrolments stay', async () => {
    await setRow(undefined);
    const admin = await person();
    const cookie = await proved(admin);
    const other = await person();
    const otherCookie = await unproved(other);
    const otherBefore = await prisma.session.count({
      where: { userId: other.id, revokedAt: null },
    });
    // The copy now holds "both roles" for REQUIREMENT_CACHE_MS.
    expect((await get('/api/admin/users', otherCookie)).status).toBe(403);
    expect(await json(await get(PATH, cookie))).toEqual({
      roles: ['admin', 'manager'],
      updatedAt: null,
      available: true,
    });

    const res = await change(cookie, {
      roles: [],
      expected: ['manager', 'admin'],
      reason: '  Testing   before go-live ',
      code: totp(admin.secret),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ roles: [], updatedAt: expect.any(String) });
    expect(await rowValue()).toEqual([]);

    // At once on this replica, well within REQUIREMENT_CACHE_MS: no logout, no new token.
    expect((await get('/api/admin/users', otherCookie)).status).toBe(200);
    expect(await meTwoFactor(otherCookie)).toEqual({
      enabled: true,
      required: false,
      verified: false,
    });
    expect(await json(await get('/api/auth/2fa', otherCookie))).toMatchObject({ required: false });
    expect(await json(await get(PATH, cookie))).toEqual({
      roles: [],
      updatedAt: body.updatedAt,
      available: true,
    });

    expect(
      (await auditRows('security.two_factor_requirement_changed', { actorId: admin.id })).map(
        (r) => [r.entityType, r.entityId, r.meta],
      ),
    ).toEqual([
      [
        'setting',
        REQUIREMENT_KEY,
        { from: ['admin', 'manager'], to: [], reason: 'Testing before go-live' },
      ],
    ]);
    const alerts = await auditRows('security.two_factor.requirement_changed', {
      actorId: admin.id,
    });
    expect(alerts.map((r) => r.meta)).toEqual([{ from: 'admin,manager', to: 'none' }]);
    expect(JSON.stringify(alerts)).not.toMatch(/Testing|@test\.invalid/);

    // Nothing else changed: the factors, the recovery codes and the sessions.
    for (const id of [admin.id, other.id]) {
      expect(
        (await prisma.userTwoFactor.findUniqueOrThrow({ where: { userId: id } })).enabledAt,
      ).not.toBeNull();
      expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: id } })).toBe(10);
    }
    expect(await prisma.session.count({ where: { userId: other.id, revokedAt: null } })).toBe(
      otherBefore,
    );

    // And back on: the unproved session is refused again at once.
    const back = await change(cookie, {
      roles: ['manager', 'admin'],
      expected: [],
      reason: 'Go-live',
      code: totp(admin.secret, 1),
    });
    expect(back.status).toBe(200);
    expect(await json(back)).toMatchObject({ roles: ['admin', 'manager'] });
    expect(await json(await get('/api/admin/users', otherCookie))).toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect(await meTwoFactor(otherCookie)).toMatchObject({ required: true });
  });

  it('re-reads the acting admin: one demoted since the token was issued gets 403, and nothing changes', async () => {
    await setRow(['admin', 'manager']);
    const admin = await person();
    const cookie = await proved(admin); // the token still says admin
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'manager' } });
    const res = await change(cookie, {
      roles: [],
      expected: ['admin', 'manager'],
      reason: 'Testing before go-live',
      code: totp(admin.secret),
    });
    expect(res.status).toBe(403);
    expect(await rowValue()).toEqual(['admin', 'manager']);
    expect(
      await auditRows('security.two_factor_requirement_changed', { actorId: admin.id }),
    ).toEqual([]);
  });

  it('a change to the current set writes nothing and raises nothing', async () => {
    await setRow(['admin']);
    const admin = await person();
    const res = await change(await proved(admin), {
      roles: ['admin'],
      expected: ['admin'],
      reason: 'No change',
      code: totp(admin.secret),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ roles: ['admin'] });
    expect(
      await auditRows('security.two_factor_requirement_changed', { actorId: admin.id }),
    ).toEqual([]);
    expect(
      await auditRows('security.two_factor.requirement_changed', { actorId: admin.id }),
    ).toEqual([]);
  });

  it('the generic settings PUT refuses the key (404) and its list does not show it', async () => {
    await setRow(['admin', 'manager']);
    const cookie = await proved(await person());
    const res = await send(
      'PUT',
      `/api/admin/settings/${REQUIREMENT_KEY}`,
      { value: [], expected: ['admin', 'manager'], reason: 'Testing before go-live' },
      cookie,
    );
    expect(res.status).toBe(404);
    expect(await rowValue()).toEqual(['admin', 'manager']);
    const listed = (await (await get('/api/admin/settings', cookie)).json()) as { key: string }[];
    expect(listed.map((s) => s.key)).not.toContain(REQUIREMENT_KEY);
  });
});

describe('the settings CHECK', () => {
  it('refuses anything but an array within ["admin","manager"], written directly', async () => {
    await setRow(undefined);
    for (const value of ['admin', ['admin', 'jury'], ['student'], [1], [['admin']], { a: 1 }, null])
      await expect(setRow(value as Prisma.JsonValue)).rejects.toThrow(
        /settings_two_factor_required_roles_check/,
      );
    for (const value of [[], ['manager'], ['admin', 'manager'], ['admin', 'admin']]) {
      await setRow(value);
      expect(await rowValue()).toEqual(value);
    }
  });
});

describe('admin:2fa-requirement (break-glass CLI)', () => {
  const apiDir = join(__dirname, '..');
  const tsxCli = require.resolve('tsx/cli', { paths: [apiDir] });
  /** The real CLI as a child process, in production mode and WITHOUT TOTP_ENCRYPTION_KEY. */
  function cli(args: string[]) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      SECURITY_ALERT_EMAIL: '',
    };
    delete env.TOTP_ENCRYPTION_KEY;
    delete env.TOTP_ENCRYPTION_KEY_PREVIOUS;
    const r = spawnSync(process.execPath, [tsxCli, 'src/cli/admin-2fa-requirement.ts', ...args], {
      cwd: apiDir,
      encoding: 'utf8',
      env,
      timeout: 60_000,
    });
    return { code: r.status, stdout: r.stdout, out: `${r.stdout}${r.stderr}` };
  }
  const cliRows = (action: string) =>
    auditRows(action, { actorId: null, createdAt: { gte: new Date(Date.now() - 120_000) } });

  it('an unknown role or bad usage: exit 2, nothing changed', async () => {
    await setRow(['admin', 'manager']);
    const unknown = cli(['--roles', 'admin,jury', '--reason', 'Testing before go-live']);
    expect(unknown.code).toBe(2);
    expect(unknown.out).toContain('Unknown role');
    expect(cli(['--roles', '']).code).toBe(2);
    expect(await rowValue()).toEqual(['admin', 'manager']);
  }, 90_000);

  it('switches it off and on: the value, the audit row via cli, the alert, only the new set printed; the API follows within the cache time', async () => {
    await setRow(undefined);
    const cookie = await unproved(await person());
    expect((await get('/api/admin/users', cookie)).status).toBe(403); // the copy holds "both roles"

    const off = cli(['--roles', '', '--reason', 'Testing before go-live']);
    // The new set on its own line (the alert's log line, if any, carries from and to only).
    expect(off.stdout).toMatch(/^two-factor requirement: none$/m);
    expect(off.out).not.toContain('Testing before go-live');
    expect(off.code).toBe(0);
    expect(await rowValue()).toEqual([]);
    const audited = (await cliRows('security.two_factor_requirement_changed')).filter(
      (r) => (r.meta as { via?: string }).via === 'cli',
    );
    expect(audited.map((r) => r.meta).slice(-1)).toEqual([
      { from: ['admin', 'manager'], to: [], reason: 'Testing before go-live', via: 'cli' },
    ]);
    expect(
      (await cliRows('security.two_factor.requirement_changed')).map((r) => r.meta).slice(-1),
    ).toEqual([{ from: 'admin,manager', to: 'none' }]);

    // No endpoint dropped this replica's copy: it follows within REQUIREMENT_CACHE_MS.
    const until = Date.now() + REQUIREMENT_CACHE_MS + 2000;
    let status = 0;
    while (Date.now() < until && status !== 200) {
      status = (await get('/api/admin/users', cookie)).status;
      if (status !== 200) await new Promise((r) => setTimeout(r, 250));
    }
    expect(status).toBe(200);

    const on = cli(['--roles', 'manager,admin', '--reason', 'Go-live']);
    expect(on.stdout).toMatch(/^two-factor requirement: admin,manager$/m);
    expect(on.code).toBe(0);
    expect(await rowValue()).toEqual(['admin', 'manager']);
  }, 90_000);
});
