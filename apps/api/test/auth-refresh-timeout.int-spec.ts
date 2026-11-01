/**
 * A slow refresh never ends the session (Lead, 2026-10-31). A rotation commits only within its budget
 * (REFRESH_ROTATION_BUDGET_MS from the handler's start), so its answer, the only copy of the new cookies, always
 * goes out; past the budget it is rolled back and the old token keeps working. Scaled down here (budget 2 s, request
 * timeout 4.5 s) from production's 8 s budget, 25 s request timeout and nginx's 30 s. Another connection holds the
 * session row locked, as a busy database would, so the rotation waits. No case depends on how fast the machine is:
 * a lock that must outlast the budget is held until the answer is in, and a short lock is released only once the
 * rotation is seen waiting for it.
 */
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { REFRESH_REUSE_GRACE_MS, SessionService } from '../src/modules/auth/session.service';
import { makeUser, testPrisma } from './helpers';

// A rotation takes a few ms on an idle machine and well under a second on a loaded one: the cases that must rotate
// need the budget as headroom, while the "busy" cases hold the lock until their answer arrives, so its size never
// decides them (each waits this long). The request timeout stays below the database's lock_timeout (5 s,
// auth-refresh-lock-timeout covers it): a lock wait the budget failed to cut would end in the request timeout's 503,
// not in the handler's.
const BUDGET_MS = 2_000;
const REQUEST_TIMEOUT_MS = 4_500;
/** The handler's own 503 (rotation 'busy'); the request timeout would answer 'Request timed out'. */
const BUSY_MESSAGE = 'Session renewal is busy, try again';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Holds the session row locked, like a busy database, until `release()`. `locked` resolves with the holder's backend
 * pid once the lock is held; `release()` resolves once the row is free again, with the time just before the COMMIT
 * that freed it. Should a test fail before releasing, Prisma ends the holder itself after `timeout`.
 */
function holdRow(sessionId: string) {
  let markLocked!: (pid: number) => void;
  const locked = new Promise<number>((resolve) => (markLocked = resolve));
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let releasedAt = 0;
  const done = holder.$transaction(
    async (tx) => {
      const [me] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      markLocked(me?.pid ?? -1);
      await opened;
      releasedAt = Date.now();
    },
    { timeout: REQUEST_TIMEOUT_MS + 10_000 },
  );
  const release = async () => {
    open();
    await done;
    return releasedAt;
  };
  return { locked, release };
}

/** True once another connection waits for a lock the backend `pid` holds; false if `answered` settles first. */
async function seenWaitingOn(pid: number, answered: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void answered.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
    if ((row?.n ?? 0) > 0) return true;
    await sleep(10);
  }
  return false;
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
  const message =
    res.status === 204 ? undefined : ((await res.json()) as { message?: string }).message;
  return { status: res.status, retryAfter: res.headers.get('retry-after'), cookies, message };
}

const familyOf = async (sessionId: string) =>
  (await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).familyId;

describe('POST /api/auth/refresh within the rotation budget', () => {
  it('rolls back a rotation that cannot commit in time: 503, nothing changed, and the old token still renews', async () => {
    const { user, issued } = await newSession();
    const lock = holdRow(issued.user.sessionId);
    await lock.locked;

    const slow = await refresh(issued.refreshToken); // the row stays locked until this answer is in
    await lock.release(); // the database is free again: a late commit would land now
    expect(slow.status).toBe(503);
    expect(slow.message).toBe(BUSY_MESSAGE); // from the handler, within its budget, before the request timeout
    expect(slow.retryAfter).toBeNull(); // the browser's own growing, jittered pause spreads the retries
    expect(slow.cookies).toEqual({}); // the browser keeps its cookies

    await sleep(300);
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

  it('a short wait inside the budget still rotates, and the token counts as retired from the commit', async () => {
    const { issued } = await newSession();
    const lock = holdRow(issued.user.sessionId);
    const holderPid = await lock.locked;
    const pending = refresh(issued.refreshToken);
    expect(await seenWaitingOn(holderPid, pending)).toBe(true); // its UPDATE waits behind the lock
    const releasedAt = await lock.release();
    const res = await pending;
    expect(res.status).toBe(204);
    expect(res.cookies[REFRESH_COOKIE]).toBeTruthy();
    // Not stamped when the UPDATE was sent (before the lock was released): the reuse grace starts after the wait.
    const retired = await prisma.session.findUniqueOrThrow({
      where: { id: issued.user.sessionId },
    });
    expect(retired.revokedAt!.getTime()).toBeGreaterThanOrEqual(releasedAt);
  });

  it('still detects real reuse: a retired token after the grace ends the family and is audited', async () => {
    const { user, issued } = await newSession();
    const lock = holdRow(issued.user.sessionId);
    await lock.locked;
    const slow = await refresh(issued.refreshToken); // the row stays locked until this answer is in
    await lock.release();
    expect(slow).toMatchObject({ status: 503, message: BUSY_MESSAGE });
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
