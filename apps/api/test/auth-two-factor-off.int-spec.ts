/**
 * Admin two-factor login with 2FA OFF (no TOTP_ENCRYPTION_KEY: development and tests only; production refuses to
 * start without it): nothing is enforced, the login asks for no code even for an enrolled admin, and every 2FA route
 * answers 503 TWO_FACTOR_UNAVAILABLE (DECISIONS "Admin two-factor login").
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { CHALLENGE_COOKIE } from '../src/modules/auth/session-cookies';
import { SessionService } from '../src/modules/auth/session.service';
import { SecretBox } from '../src/modules/auth/two-factor/secret-box';
import { TwoFactorConfig } from '../src/modules/auth/two-factor/two-factor.config';
import { makeUser, testPrisma } from './helpers';

const PASSWORD = 'Quiet-harbour-lamp-58';
let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  // An empty value beats apps/api/.env (test/load-env.ts fills only missing keys) and means "not set" (env.ts).
  Object.assign(process.env, { TOTP_ENCRYPTION_KEY: '', TOTP_ENCRYPTION_KEY_PREVIOUS: '' });
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });

/** An admin with a confirmed factor in the database (sealed with some key: the server has none). */
async function enrolledAdmin() {
  const user = await makeUser(prisma, {
    email: `tfa-off-${randomUUID().slice(0, 8)}@test.invalid`,
    role: 'admin',
    passwordHash: await app.get(PasswordService).hash(PASSWORD),
  });
  await prisma.userTwoFactor.create({
    data: {
      userId: user.id,
      secretCiphertext: new SecretBox(randomBytes(32)).seal(randomBytes(20)),
      enabledAt: new Date(),
    },
  });
  return user;
}

describe('two-factor login while off (no TOTP_ENCRYPTION_KEY)', () => {
  it('is off: the config says so', () => {
    expect(app.get(TwoFactorConfig).enabled).toBe(false);
  });

  it('enforces nothing: even an enrolled admin logs in with the password alone and opens the admin pages', async () => {
    const admin = await enrolledAdmin();
    const login = await post('/api/auth/login', { email: admin.email, password: PASSWORD });
    expect(login.status).toBe(204);
    const names = login.headers.getSetCookie().map((c) => c.split('=')[0]);
    expect(names).not.toContain(CHALLENGE_COOKIE);
    const access = login.headers.getSetCookie().find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    const cookie = access?.split(';')[0] ?? '';
    expect((await get('/api/admin/users', cookie)).status).toBe(200);
    expect((await get('/api/admin/stats', cookie)).status).toBe(200);
    expect(
      ((await (await get('/api/auth/me', cookie)).json()) as { twoFactor: unknown }).twoFactor,
    ).toEqual({ enabled: true, required: false, verified: false });
  });

  it('answers 503 TWO_FACTOR_UNAVAILABLE on every 2FA route', async () => {
    const admin = await enrolledAdmin();
    const issued = await app
      .get(SessionService)
      .start({ id: admin.id, role: 'admin' }, { ip: null, userAgent: null });
    const cookie = `${ACCESS_COOKIE}=${issued.accessToken}`;
    const answers = [
      await get('/api/auth/2fa', cookie),
      await post('/api/auth/2fa/setup', { password: PASSWORD }, cookie),
      await post('/api/auth/2fa/enable', { code: '123456' }, cookie),
      await post('/api/auth/2fa/recovery-codes', { code: '123456' }, cookie),
      await post('/api/auth/2fa/disable', { password: PASSWORD, code: '123456' }, cookie),
      await post('/api/auth/2fa/verify', { code: '123456' }),
      await post(
        `/api/admin/users/${randomUUID()}/2fa/reset`,
        { reason: 'Lost phone', code: '123456' },
        cookie,
      ),
    ];
    for (const res of answers) {
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'TWO_FACTOR_UNAVAILABLE' });
    }
    // Nothing was written.
    expect(await prisma.auditLog.count({ where: { actorId: admin.id } })).toBe(0);
  });
});
