/**
 * A slow refresh never ends the session (Lead, 2026-10-31). A rotation commits only within its budget
 * (REFRESH_ROTATION_BUDGET_MS from the handler's start), so its answer, the only copy of the new cookies, always
 * goes out; past the budget it is rolled back and the old token keeps working. Scaled down here (budget 300 ms,
 * request timeout 1 s) from production's 15 s budget, 25 s request timeout and nginx's 30 s. Another connection
 * holds the session row locked, as a busy database would, so the rotation waits.
 */
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { REFRESH_REUSE_GRACE_MS, SessionService } from '../src/modules/auth/session.service';
import { makeUser, testPrisma } from './helpers';

const BUDGET_MS = 300;
const REQUEST_TIMEOUT_MS = 1_000;

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let holder: PrismaClient;
let sessions: SessionService;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  process.env.COOKIE_SECURE = 'true';
  process.env.JWT_ACCESS_TTL_SECONDS = '900';
  process.env.REFRESH_ROTATION_BUDGET_MS = String(BUDGET_MS);
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, { requestTimeoutMs: REQUEST_TIMEOUT_MS });
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  holder = testPrisma(); // its own connection, to hold row locks
  sessions = app.get(SessionService);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await holder?.$disconnect();
});

const client = { ip: '203.0.113.9', userAgent: 'jest' };

async function newSession() {
  const user = await makeUser(prisma, {});
  const issued = await sessions.start({ id: user.id, role: user.role }, client);
  return { user, issued };
}

/** Holds the session row locked for `ms`, like a busy database; `locked` resolves once the lock is held. */
function holdRow(sessionId: string, ms: number) {
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => (markLocked = resolve));
  const released = holder.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      markLocked();
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    { timeout: ms + 10_000 },
  );
  return { locked, released };
}

async function refresh(refreshToken: string) {
  const res = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${REFRESH_COOKIE}=${refreshToken}`, 'x-requested-with': 'XMLHttpRequest' },
  });
  const cookies: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const eq = pair.indexOf('=');
    cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return { status: res.status, retryAfter: res.headers.get('retry-after'), cookies };
}

const familyOf = async (sessionId: string) =>
  (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).familyId;

describe('POST /api/auth/refresh within the rotation budget', () => {
  it('rolls back a rotation that cannot commit in time: 503, nothing changed, and the old token still renews', async () => {
    const { user, issued } = await newSession();
    const lock = holdRow(issued.user.sessionId, 2 * REQUEST_TIMEOUT_MS);
    await lock.locked;

    const started = Date.now();
    const slow = await refresh(issued.refreshToken);
    expect(slow.status).toBe(503); // from the handler, within its budget, before the request timeout
    expect(Date.now() - started).toBeLessThan(REQUEST_TIMEOUT_MS);
    expect(slow.retryAfter).toBe('1');
    expect(slow.cookies).toEqual({}); // the browser keeps its cookies

    await lock.released; // the database is free again: a late commit would land now
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: issued.user.sessionId } });
    expect(row.revokedAt).toBeNull();

    // The browser tries again with the same cookie: the session survives.
    const retry = await refresh(issued.refreshToken);
    expect(retry.status).toBe(204);
    const me = await fetch(`${base}/api/auth/me`, {
      headers: { cookie: `${ACCESS_COOKIE}=${retry.cookies[ACCESS_COOKIE]}` },
    });
    expect(me.status).toBe(200);
  });

  it('a short wait inside the budget still rotates', async () => {
    const { issued } = await newSession();
    const lock = holdRow(issued.user.sessionId, BUDGET_MS / 3);
    await lock.locked;
    const res = await refresh(issued.refreshToken);
    await lock.released;
    expect(res.status).toBe(204);
    expect(res.cookies[REFRESH_COOKIE]).toBeTruthy();
  });

  it('still detects real reuse: a retired token after the grace ends the family and is audited', async () => {
    const { user, issued } = await newSession();
    const lock = holdRow(issued.user.sessionId, 2 * REQUEST_TIMEOUT_MS);
    await lock.locked;
    expect((await refresh(issued.refreshToken)).status).toBe(503);
    await lock.released;
    const next = await refresh(issued.refreshToken);
    expect(next.status).toBe(204);

    // The retired token comes back long after the grace: a stolen copy.
    await prisma.session.update({
      where: { id: issued.user.sessionId },
      data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 50_000) },
    });
    expect((await refresh(issued.refreshToken)).status).toBe(401);
    expect((await refresh(next.cookies[REFRESH_COOKIE] ?? '')).status).toBe(401); // gone for every holder
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    const family = await familyOf(issued.user.sessionId);
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.refresh_reuse', entityId: family, actorId: user.id },
      }),
    ).toBe(1);
  });
});
