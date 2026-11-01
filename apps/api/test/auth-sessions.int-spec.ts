/**
 * Refresh sessions over HTTP (RULEBOOK §5): rotation, reuse detection, the two-tabs race, logout, logout-all and
 * /me. Boots the real AppModule against the *_test database; sessions are started through SessionService because
 * login arrives in a later step.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import {
  REFRESH_REUSE_GRACE_MS,
  type IssuedSession,
  SessionService,
} from '../src/modules/auth/session.service';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let sessions: SessionService;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  // Pinned so the cookie assertions do not depend on a developer's local .env (read when AppModule is imported).
  process.env.COOKIE_SECURE = 'true';
  process.env.JWT_ACCESS_TTL_SECONDS = '900';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  sessions = app.get(SessionService);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

const client = { ip: '203.0.113.7', userAgent: 'jest' };
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

async function newSession(data: Parameters<typeof makeUser>[1] = {}) {
  const user = await makeUser(prisma, data);
  const issued = await sessions.start({ id: user.id, role: user.role }, client);
  return { user, issued };
}

const access = (s: IssuedSession) => `${ACCESS_COOKIE}=${s.accessToken}`;
const refreshOf = (token: string) => `${REFRESH_COOKIE}=${token}`;

function post(path: string, cookie?: string, csrf = true) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-requested-with'] = 'XMLHttpRequest';
  return fetch(`${base}${path}`, { method: 'POST', headers });
}
const get = (path: string, cookie?: string) =>
  fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });

type SetCookie = { value: string; attrs: Record<string, string | true> };
function setCookies(res: Response): Record<string, SetCookie> {
  const out: Record<string, SetCookie> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const parsed: Record<string, string | true> = {};
    for (const attr of attrs) {
      const i = attr.indexOf('=');
      if (i < 0) parsed[attr.toLowerCase()] = true;
      else parsed[attr.slice(0, i).toLowerCase()] = attr.slice(i + 1);
    }
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attrs: parsed };
  }
  return out;
}

/** Refreshes and returns the new session's tokens from the Set-Cookie headers. */
async function rotate(refreshToken: string) {
  const res = await post('/api/auth/refresh', refreshOf(refreshToken));
  const cookies = setCookies(res);
  return {
    status: res.status,
    accessToken: cookies[ACCESS_COOKIE]?.value ?? '',
    refreshToken: cookies[REFRESH_COOKIE]?.value ?? '',
    cookies,
  };
}

describe('GET /api/auth/me', () => {
  it('answers 401 without a session', async () => {
    expect((await get('/api/auth/me')).status).toBe(401);
  });

  it('returns the session user read fresh from the database (role included)', async () => {
    const { user, issued } = await newSession({ name: 'Ayesha' });
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ambassador' } });
    const res = await get('/api/auth/me', access(issued));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: user.id,
      name: 'Ayesha',
      email: user.email,
      role: 'ambassador',
      twoFactor: { enabled: false, required: false, verified: false },
    });
  });

  it('logs out a blocked user', async () => {
    const { issued } = await newSession({ isBlocked: true });
    expect((await get('/api/auth/me', access(issued))).status).toBe(401);
  });
});

describe('POST /api/auth/refresh: rotation', () => {
  it('retires the token, issues a new pair in the same family, and stores only hashes', async () => {
    const { issued } = await newSession();
    const next = await rotate(issued.refreshToken);
    expect(next.status).toBe(204);
    expect(next.refreshToken).not.toBe(issued.refreshToken);
    expect((await get('/api/auth/me', `${ACCESS_COOKIE}=${next.accessToken}`)).status).toBe(200);

    const old = await prisma.session.findUniqueOrThrow({ where: { id: issued.user.sessionId } });
    const fresh = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: sha256(next.refreshToken) },
    });
    expect(old.revokedAt).not.toBeNull();
    expect(fresh).toMatchObject({ familyId: old.familyId, revokedAt: null });
    expect(old.tokenHash).toBe(sha256(issued.refreshToken));
    expect(await prisma.session.count({ where: { tokenHash: next.refreshToken } })).toBe(0);
  });

  it('sets httpOnly cookies: access Lax on /, refresh Strict on /api/auth only', async () => {
    const { issued } = await newSession();
    const { cookies } = await rotate(issued.refreshToken);
    expect(cookies[ACCESS_COOKIE]?.attrs).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'Lax',
      path: '/',
      'max-age': '900',
    });
    expect(cookies[REFRESH_COOKIE]?.attrs).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'Strict',
      path: '/api/auth',
    });
    expect(cookies[ACCESS_COOKIE]?.attrs.domain).toBeUndefined(); // host-only
  });

  it('answers 401 and clears both cookies for a missing or unknown token', async () => {
    expect((await post('/api/auth/refresh')).status).toBe(401);
    const res = await post('/api/auth/refresh', refreshOf('not-a-real-token'));
    expect(res.status).toBe(401);
    const cookies = setCookies(res);
    expect(cookies[ACCESS_COOKIE]?.attrs.expires).toMatch(/1970/);
    expect(cookies[REFRESH_COOKIE]?.attrs.expires).toMatch(/1970/);
  });

  it('needs the CSRF header like every POST', async () => {
    const { issued } = await newSession();
    expect((await post('/api/auth/refresh', refreshOf(issued.refreshToken), false)).status).toBe(
      403,
    );
  });

  it('refuses an expired refresh token', async () => {
    const { issued } = await newSession();
    await prisma.session.update({
      where: { id: issued.user.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await rotate(issued.refreshToken)).status).toBe(401);
  });

  it('refuses a blocked user and ends the family', async () => {
    const { user, issued } = await newSession();
    await prisma.user.update({ where: { id: user.id }, data: { isBlocked: true } });
    expect((await rotate(issued.refreshToken)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });
});

describe('POST /api/auth/refresh: reuse detection', () => {
  it('revokes the whole family when a retired token comes back later, and audits it', async () => {
    const { user, issued } = await newSession();
    const next = await rotate(issued.refreshToken);
    expect(next.status).toBe(204);
    await prisma.session.update({
      where: { id: issued.user.sessionId },
      data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 50_000) },
    });

    expect((await rotate(issued.refreshToken)).status).toBe(401); // the stolen copy
    expect((await rotate(next.refreshToken)).status).toBe(401); // the family is gone for both holders
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    const family = (
      await prisma.session.findUniqueOrThrow({ where: { id: issued.user.sessionId } })
    ).familyId;
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.refresh_reuse', entityId: family, actorId: user.id },
      }),
    ).toBe(1);
  });

  it('treats a reuse within the grace period as two tabs: 409, family kept', async () => {
    const { issued } = await newSession();
    const next = await rotate(issued.refreshToken);
    expect((await rotate(issued.refreshToken)).status).toBe(409);
    expect((await rotate(next.refreshToken)).status).toBe(204);
  });

  it('lets exactly one of two simultaneous refreshes win; the other gets 409', async () => {
    const { user, issued } = await newSession();
    const results = await Promise.all([rotate(issued.refreshToken), rotate(issued.refreshToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });

  it('never issues two sessions for one token, even when rotations start at the same instant', async () => {
    // Service level, so all five read the token before any of them retires it: only the conditional retire
    // inside the transaction can stop a second winner.
    const { user, issued } = await newSession();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sessions.rotate(issued.refreshToken, client)),
    );
    expect(results.filter((r) => r.status === 'rotated')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'race')).toHaveLength(4);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });
});

describe('logout', () => {
  it('ends this device only: cookies cleared, its family revoked, other devices untouched', async () => {
    const { user, issued } = await newSession();
    const otherDevice = await sessions.start({ id: user.id, role: user.role }, client);

    const res = await post('/api/auth/logout', access(issued));
    expect(res.status).toBe(204);
    expect(setCookies(res)[REFRESH_COOKIE]?.attrs.expires).toMatch(/1970/);
    expect((await rotate(issued.refreshToken)).status).toBe(401);
    expect((await rotate(otherDevice.refreshToken)).status).toBe(204);
    // A token of a family that already ended is simply refused: not a reuse, nothing audited.
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.refresh_reuse', actorId: user.id } }),
    ).toBe(0);
  });

  it('needs a session and the CSRF header', async () => {
    const { issued } = await newSession();
    expect((await post('/api/auth/logout')).status).toBe(401);
    expect((await post('/api/auth/logout', access(issued), false)).status).toBe(403);
  });

  it('logout-all ends every session of the user and audits it', async () => {
    const { user, issued } = await newSession();
    await sessions.start({ id: user.id, role: user.role }, client);
    const someoneElse = await newSession();

    expect((await post('/api/auth/logout-all', access(issued))).status).toBe(204);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await rotate(someoneElse.issued.refreshToken)).status).toBe(204);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.logout_all', actorId: user.id },
    });
    expect(entry.meta).toEqual({ sessions: 2 });
  });
});
