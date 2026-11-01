/**
 * The nightly session and token cleanup (LAUNCH-PLAN §9, L13) against the *_test database: what goes and what stays,
 * the batch cap, a second run and two runs at once, nothing else touched, a purged token replayed over HTTP, and one
 * scheduler however many workers start. Every run gets an explicit `now`, and the rows sit days from each cutoff,
 * so no result depends on timing.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { EnvVars } from '../src/config/env';
import { AuditService } from '../src/modules/audit/audit.service';
import { REFRESH_COOKIE } from '../src/modules/auth/session-cookies';
import { SessionService } from '../src/modules/auth/session.service';
import {
  HOUSEKEEPING_JOBS,
  HOUSEKEEPING_JOB_OPTIONS,
  SESSION_CLEANUP_SCHEDULER_ID,
} from '../src/modules/housekeeping/housekeeping-queue';
import { HousekeepingWorker } from '../src/modules/housekeeping/housekeeping.worker';
import {
  type CleanupLimits,
  DEFAULT_CLEANUP_LIMITS,
  SessionCleanup,
} from '../src/modules/housekeeping/session-cleanup';
import { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_REDIS_OPTIONS } from '../src/redis/redis.module';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let sessions: SessionService;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  process.env.COOKIE_SECURE = 'true';
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

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.authToken.deleteMany();
});

const DAY = 86_400_000;
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
const ahead = (now: Date, days: number) => new Date(now.getTime() + days * DAY);
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
const IP = '203.0.113.77';
const AGENT = 'cleanup-test-agent/1.0';

const cleanupWith = (limits: Partial<CleanupLimits> = {}) =>
  new SessionCleanup(app.get(PrismaService), app.get(AuditService), {
    ...DEFAULT_CLEANUP_LIMITS,
    ...limits,
  });

function session(userId: string, expiresAt: Date, revokedAt: Date | null = null) {
  return prisma.session.create({
    data: {
      userId,
      familyId: randomUUID(),
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt,
      revokedAt,
      ip: IP,
      userAgent: AGENT,
    },
  });
}

function token(userId: string, expiresAt: Date, usedAt: Date | null = null) {
  return prisma.authToken.create({
    data: {
      userId,
      type: 'password_reset',
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt,
      usedAt,
    },
  });
}

/** Rows that are due at `now`: sessions expired 40 days ago, tokens expired 10 days ago. */
async function due(now: Date, sessionCount: number, tokenCount = 0) {
  const user = await makeUser(prisma);
  for (let i = 0; i < sessionCount; i += 1) await session(user.id, ago(now, 40));
  for (let i = 0; i < tokenCount; i += 1) await token(user.id, ago(now, 10));
}

const ids = async () =>
  (await prisma.session.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(
    (s) => s.id,
  );

describe('which rows go', () => {
  it('deletes sessions 30 days after expiry or revocation, each on its own; keeps the rest', async () => {
    const now = new Date();
    const user = await makeUser(prisma);
    await session(user.id, ago(now, 31)); // expired 31 days ago, never revoked
    await session(user.id, ahead(now, 1), ago(now, 31)); // revoked 31 days ago (rotated), expiry not reached
    await session(user.id, ago(now, 40), ago(now, 35)); // both
    const kept = [
      await session(user.id, ago(now, 29)), // expired 29 days ago
      await session(user.id, ahead(now, 1), ago(now, 29)), // revoked 29 days ago
      await session(user.id, ahead(now, 5)), // live
    ].map((s) => s.id);

    expect(await cleanupWith().run(now)).toEqual({
      sessions: 3,
      tokens: 0,
      batches: 2,
      more: false,
    });
    expect(await ids()).toEqual([...kept].sort());
  });

  it('deletes tokens 7 days after expiry, used or not; keeps younger ones', async () => {
    const now = new Date();
    const user = await makeUser(prisma);
    await token(user.id, ago(now, 8)); // unused
    await token(user.id, ago(now, 8), ago(now, 9)); // used
    const kept = [await token(user.id, ago(now, 6)), await token(user.id, ahead(now, 1))].map(
      (t) => t.id,
    );

    expect(await cleanupWith().run(now)).toMatchObject({ sessions: 0, tokens: 2 });
    const left = await prisma.authToken.findMany({ select: { id: true } });
    expect(left.map((t) => t.id).sort()).toEqual([...kept].sort());
  });
});

describe('batches, reruns and parallel runs', () => {
  it('stops at the batch cap and says more is left; the next run takes the rest', async () => {
    const now = new Date();
    await due(now, 7);
    const cleanup = cleanupWith({ batchSize: 2, maxBatches: 3 });

    expect(await cleanup.run(now)).toEqual({ sessions: 6, tokens: 0, batches: 4, more: true });
    expect(await prisma.session.count()).toBe(1);
    expect(await cleanup.run(now)).toEqual({ sessions: 1, tokens: 0, batches: 2, more: false });
    expect(await prisma.session.count()).toBe(0);
  });

  it('a second run deletes nothing', async () => {
    const now = new Date();
    await due(now, 3, 2);
    const cleanup = cleanupWith();
    expect(await cleanup.run(now)).toMatchObject({ sessions: 3, tokens: 2 });
    expect(await cleanup.run(now)).toEqual({ sessions: 0, tokens: 0, batches: 2, more: false });
  });

  it('two runs at once both finish, and together delete every due row once', async () => {
    const now = new Date();
    await due(now, 30, 10);
    const cleanup = cleanupWith({ batchSize: 4 });

    const [a, b] = await Promise.all([cleanup.run(now), cleanup.run(now)]);
    expect(a.sessions + b.sessions).toBe(30);
    expect(a.tokens + b.tokens).toBe(10);
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.authToken.count()).toBe(0);
  });
});

describe('nothing else is touched', () => {
  it('leaves users, payments and the append-only logs alone, and audits counts only', async () => {
    const now = new Date();
    await due(now, 4, 3);
    const count = () =>
      Promise.all([
        prisma.user.count(),
        prisma.payment.count(),
        prisma.registration.count(),
        prisma.paymentEvent.count(),
        prisma.submission.count(),
        prisma.auditLog.count(),
      ]);
    const [users, payments, registrations, events, submissions, audits] = await count();
    const started = new Date();

    await cleanupWith().run(now);

    expect(await count()).toEqual([
      users,
      payments,
      registrations,
      events,
      submissions,
      audits + 1,
    ]);
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'housekeeping.session_cleanup', createdAt: { gte: started } },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toMatchObject({ actorId: null, ip: null, entityId: null });
    expect(row.meta).toEqual({ sessions: 4, tokens: 3, batches: 2, more: false });
    expect(JSON.stringify(row)).not.toContain(IP);
    expect(JSON.stringify(row)).not.toContain(AGENT);
  });
});

describe('a purged token replayed over HTTP', () => {
  const client = { ip: IP, userAgent: AGENT };
  const refresh = (refreshToken: string) =>
    fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `${REFRESH_COOKIE}=${refreshToken}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    });
  const refreshCookie = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((line) => line.split(';')[0] ?? '')
      .find((pair) => pair.startsWith(`${REFRESH_COOKIE}=`))
      ?.slice(REFRESH_COOKIE.length + 1) ?? '';

  it('gets 401, and the live session of its family keeps working (no reuse alarm)', async () => {
    const user = await makeUser(prisma);
    const first = await sessions.start({ id: user.id, role: user.role }, client);
    const rotated = await refresh(first.refreshToken);
    expect(rotated.status).toBe(204);
    const second = refreshCookie(rotated);
    expect(second).not.toBe('');

    // The retired row as it is 31 days after its rotation.
    const now = new Date();
    await prisma.session.update({
      where: { tokenHash: sha256(first.refreshToken) },
      data: { revokedAt: ago(now, 31) },
    });
    expect(await cleanupWith().run(now)).toMatchObject({ sessions: 1 });
    expect(
      await prisma.session.findUnique({ where: { tokenHash: sha256(first.refreshToken) } }),
    ).toBeNull();

    const alarms = () =>
      prisma.auditLog.count({ where: { action: 'auth.refresh_reuse', actorId: user.id } });
    const before = await alarms();
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect(await alarms()).toBe(before);
    expect((await refresh(second)).status).toBe(204);
  });
});

describe('the nightly scheduler', () => {
  it('two workers starting give one scheduler at 03:30 Dhaka, and its job runs the cleanup', async () => {
    const queueName = `housekeeping-test-${randomUUID().slice(0, 8)}`;
    const values: Record<string, string | undefined> = {
      REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL,
      HOUSEKEEPING_QUEUE_NAME: queueName,
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<EnvVars, true>;
    const cleanup = cleanupWith();
    const workers = [
      new HousekeepingWorker(cleanup, config),
      new HousekeepingWorker(cleanup, config),
    ];
    const redis = new Redis(process.env.REDIS_QUEUE_URL as string, QUEUE_REDIS_OPTIONS);
    const queue = new Queue(queueName, { connection: redis });
    try {
      for (const w of workers) await w.onModuleInit();
      const schedulers = await queue.getJobSchedulers(0, 10, true);
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]).toMatchObject({
        key: SESSION_CLEANUP_SCHEDULER_ID,
        pattern: '30 3 * * *',
        tz: 'Asia/Dhaka',
      });

      const now = new Date();
      await due(now, 2, 1);
      // Wait on the effect (the worker ran the cleanup), not on the job: with the real options the job's key is
      // removed on completion, and reading it back after that races (BullMQ "Missing key for job").
      const run = jest.spyOn(cleanup, 'run');
      await queue.add(HOUSEKEEPING_JOBS.sessionCleanup, {}, HOUSEKEEPING_JOB_OPTIONS);
      for (let i = 0; i < 400 && run.mock.results.length === 0; i += 1)
        await new Promise((resolve) => setTimeout(resolve, 50));
      expect(run).toHaveBeenCalledTimes(1);
      await expect(run.mock.results[0]!.value).resolves.toMatchObject({ sessions: 2, tokens: 1 });
    } finally {
      for (const w of workers) await w.onApplicationShutdown();
      await queue.obliterate({ force: true });
      await queue.close();
      redis.disconnect();
    }
  });
});
