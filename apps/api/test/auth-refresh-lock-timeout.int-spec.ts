/**
 * The production path of a slow rotation: the database's own lock_timeout (5 s, migration db_session_timeouts)
 * cancels a lock wait long before the 8 s rotation budget runs out. That too must answer 503 and keep the session
 * (the transaction rolled back), not a 500. Real values here, so this case waits about 5 s.
 */
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { SessionService } from '../src/modules/auth/session.service';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let holder: PrismaClient;
let sessions: SessionService;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  process.env.COOKIE_SECURE = 'true';
  process.env.REFRESH_ROTATION_BUDGET_MS = '8000'; // the production default
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app); // the production 25 s request timeout
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  holder = testPrisma();
  sessions = app.get(SessionService);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await holder?.$disconnect();
});

async function refresh(refreshToken: string) {
  const res = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${REFRESH_COOKIE}=${refreshToken}`, 'x-requested-with': 'XMLHttpRequest' },
  });
  return { status: res.status, setCookies: res.headers.getSetCookie() };
}

it('a lock wait cut by the database lock_timeout answers 503, changes nothing, and the old token still renews', async () => {
  const settings = await prisma.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`;
  expect(settings[0]?.lock_timeout).toBe('5s'); // the premise: shorter than the 8 s budget

  const user = await makeUser(prisma, {});
  const issued = await sessions.start({ id: user.id, role: user.role }, { ip: '203.0.113.10' });
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => (markLocked = resolve));
  const released = holder.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${issued.user.sessionId}::uuid FOR UPDATE`;
      markLocked();
      await new Promise((resolve) => setTimeout(resolve, 6_500));
    },
    { timeout: 20_000 },
  );
  await locked;

  const started = Date.now();
  const slow = await refresh(issued.refreshToken);
  const took = Date.now() - started;
  expect(slow.status).toBe(503);
  expect(slow.setCookies).toEqual([]);
  expect(took).toBeGreaterThanOrEqual(4_500); // cut by the 5 s lock_timeout ...
  expect(took).toBeLessThan(8_000); // ... before the budget ran out

  await released;
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  expect(
    (await prisma.session.findUniqueOrThrow({ where: { id: issued.user.sessionId } })).revokedAt,
  ).toBeNull();
  expect((await refresh(issued.refreshToken)).status).toBe(204);
}, 30_000);
