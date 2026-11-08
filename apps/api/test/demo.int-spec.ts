/**
 * Demo data over HTTP and the worker (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click"): admin
 * only; a load is one queued job that fills users, exams with scored attempts, a published leaderboard and
 * announcements, with one password shown once; demo and real rows never mix (exam visibility both ways, team joins
 * both ways); a removal the database refuses names its blockers and removes nothing; a removal takes every demo row
 * and no real one. Runs on this run's own demo queue with a worker in this process.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import type {
  AdminDemoStatus,
  DemoLoadAccepted,
  ExamLeaderboard,
  StudentExamListItem,
} from '@sirat/shared';
import type Redis from 'ioredis';
import type { EnvVars } from '../src/config/env';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import type { SecurityAlerts } from '../src/modules/audit/security-alerts.service';
import { newJoinCode } from '../src/modules/ambassadors/promo-code';
import { DemoWorker } from '../src/modules/demo/demo.worker';
import type { PaymentConfig } from '../src/modules/payments/payment.config';
import { PAYMENT_CONFIG } from '../src/modules/payments/payments-boot-check';
import type { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makePublishedExam } from './exam-helpers';
import {
  applyReferenceData,
  makeRegistrationAttempt,
  makeUser,
  paymentData,
  testPrisma,
} from './helpers';

const QUEUE = `demo-test-${randomUUID().slice(0, 8)}`;
const LOAD_LIMIT_MS = 60_000;

let env: CoreApp;
let prisma: PrismaClient;
let redis: Redis;
let worker: DemoWorker;
const raise = jest.fn<Promise<void>, Parameters<SecurityAlerts['raise']>>();
let admin: { id: string; cookie: string };
let loadMs = 0;

beforeAll(async () => {
  process.env.DEMO_QUEUE_NAME = QUEUE;
  process.env.DEMO_DATA_ALLOWED = 'true';
  env = await bootCoreApp();
  prisma = testPrisma();
  redis = env.app.get(REDIS_CACHE);
  if (!(await prisma.gradeLevel.count()) || !(await prisma.round.count()))
    await applyReferenceData(prisma);
  await removeAnyBatch();
  if (await prisma.payment.count({ where: { status: 'paid', gatewayEnv: 'live' } }))
    await dropPayments();
  const values: Record<string, string> = {
    REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL ?? '',
    DEMO_QUEUE_NAME: QUEUE,
    DEMO_DATA_ALLOWED: 'true',
  };
  worker = new DemoWorker(
    prisma as unknown as PrismaService,
    redis,
    { get: (key: string) => values[key] } as unknown as ConfigService<EnvVars, true>,
    env.app.get<PaymentConfig>(PAYMENT_CONFIG),
    { raise } as unknown as SecurityAlerts,
  );
  worker.onModuleInit();
  admin = await sessionFor(env, prisma, { role: 'admin', name: 'Demo Admin' });
}, 60_000);

beforeEach(async () => {
  const keys = await redis.keys('throttle:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await worker?.onApplicationShutdown();
  if (prisma) await removeAnyBatch();
  delete process.env.DEMO_QUEUE_NAME;
  delete process.env.DEMO_DATA_ALLOWED;
  await env?.app.close();
  await prisma?.$disconnect();
  if (loadMs) console.log(`demo load end to end: ${loadMs} ms`);
});

/** Leaves no batch behind (a failed run, or another suite): as the API would, through demo_clear. */
async function removeAnyBatch() {
  for (const b of await prisma.demoBatch.findMany({ select: { id: true } })) {
    await prisma.demoBatch.update({ where: { id: b.id }, data: { status: 'loaded' } });
    await prisma.$queryRaw`SELECT "demo_clear"(${b.id}::uuid)`;
  }
}

/** A payment started live and paid, the legal way (initiated, pending, paid): real money as the guard sees it. */
async function livePaidPayment() {
  const attempt = await makeRegistrationAttempt(prisma);
  const row = await prisma.payment.create({
    data: paymentData(attempt.id, { gatewayEnv: 'live', gatewayAccount: 'live-test' }),
  });
  await prisma.payment.update({ where: { id: row.id }, data: { status: 'pending' } });
  await prisma.payment.update({
    where: { id: row.id },
    data: {
      status: 'paid',
      trxId: `TRX${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      paidAmountMinor: row.amountMinor,
      paidAt: new Date(),
    },
  });
}

/**
 * Payments cannot be deleted row by row (their triggers); the *_test database only: TRUNCATE, as truncateAll does.
 * Also run before the suite, as another suite may leave a paid live payment behind, which refuses every load.
 */
async function dropPayments() {
  await prisma.$executeRawUnsafe('TRUNCATE "payments" CASCADE');
}

const status = async () =>
  (await call<AdminDemoStatus>(env, 'GET', '/admin/demo', admin.cookie)).json;

/** Polls the card's status until `done` holds (the worker runs in this process). */
async function until(done: (s: AdminDemoStatus) => boolean, ms = LOAD_LIMIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    const s = await status();
    if (done(s)) return s;
    if (Date.now() > end) throw new Error(`demo status never reached: ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Waits until the worker has raised `kind` (it raises after the commit and after writing the outcome). */
async function alerted(kind: string, ms = 10_000) {
  const end = Date.now() + ms;
  while (!raise.mock.calls.some((c) => c[0] === kind)) {
    if (Date.now() > end) throw new Error(`no ${kind} alert within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const load = (reason = 'try the dashboards') =>
  call<DemoLoadAccepted & { details?: string[] }>(env, 'POST', '/admin/demo/load', admin.cookie, {
    reason,
  });
const clear = (reason = 'done with the demo') =>
  call<AdminDemoStatus & { details?: string[] }>(env, 'POST', '/admin/demo/clear', admin.cookie, {
    reason,
  });

async function loaded(): Promise<{ batchId: string; password: string; status: AdminDemoStatus }> {
  const started = Date.now();
  const res = await load();
  expect(res.status).toBe(202);
  // 'loaded' is committed first, the outcome a moment later: wait for both, or the expects below race the worker.
  const s = await until(
    (x) =>
      (x.batch?.status === 'loaded' && x.lastOutcome?.action === 'load') ||
      x.batch?.status === 'failed',
  );
  expect(s.batch?.status).toBe('loaded');
  loadMs = Date.now() - started;
  return { batchId: res.json.batchId, password: res.json.password, status: s };
}

describe('access', () => {
  it('admin only: 401 without a session, 403 for a student and a manager, on every route', async () => {
    const student = await sessionFor(env, prisma, { role: 'student' });
    const manager = await sessionFor(env, prisma, { role: 'manager' });
    for (const [method, path] of [
      ['GET', '/admin/demo'],
      ['POST', '/admin/demo/load'],
      ['POST', '/admin/demo/clear'],
    ] as const) {
      const body = method === 'POST' ? { reason: 'a reason' } : undefined;
      expect((await call(env, method, path, '', body)).status).toBe(401);
      expect((await call(env, method, path, student.cookie, body)).status).toBe(403);
      expect((await call(env, method, path, manager.cookie, body)).status).toBe(403);
    }
    expect(await prisma.demoBatch.count()).toBe(0);
  });

  it('validates the body: a reason of 3 to 200 characters, nothing else', async () => {
    for (const body of [
      {},
      { reason: 'ab' },
      { reason: 'x'.repeat(201) },
      { reason: 'ok go', role: 'admin' },
    ])
      expect((await call(env, 'POST', '/admin/demo/load', admin.cookie, body)).status).toBe(400);
    expect(await prisma.demoBatch.count()).toBe(0);
  });

  it('nothing to remove: 409 demo_absent; the status shows no batch', async () => {
    const res = await clear();
    expect(res.status).toBe(409);
    expect(res.json.details).toEqual(['demo_absent']);
    expect(await status()).toMatchObject({ allowed: true, batch: null, progress: null });
  });

  it('refuses a load once real money was taken (payments guard): 409 real_payments, nothing written', async () => {
    await livePaidPayment();
    try {
      const res = await load();
      expect(res.status).toBe(409);
      expect(res.json.details).toEqual(['real_payments']);
      expect(await prisma.demoBatch.count()).toBe(0);
    } finally {
      await dropPayments();
    }
  });
  it('throttles load and remove: ten an hour per admin, refusals included, then 429', async () => {
    for (let i = 0; i < 10; i++) expect((await clear()).status).toBe(409); // demo_absent
    expect((await clear()).status).toBe(429);
  });

  it('a batch abandoned in loading (the job lost) may be removed after 15 minutes, not before', async () => {
    const insert = (minutesAgo: number) => prisma.$executeRaw`
      INSERT INTO "demo_batches" ("id", "status", "reason", "created_by_id", "created_at", "updated_at")
      VALUES (gen_random_uuid(), 'loading', 'job lost', ${admin.id}::uuid,
              now() - make_interval(mins => ${minutesAgo}::int), now() - make_interval(mins => ${minutesAgo}::int))`;
    await insert(5);
    try {
      // Fresh: a job may still run. Both actions wait.
      expect((await status()).batch).toMatchObject({ status: 'loading', stale: false });
      expect((await clear()).json.details).toEqual(['demo_busy']);
      expect((await load()).json.details).toEqual(['demo_busy']);
    } finally {
      await removeAnyBatch();
    }
    await insert(20);
    const s = await status();
    expect(s.batch).toMatchObject({ status: 'loading', stale: true });
    expect(s.progress).toBeNull();
    expect((await load()).json.details).toEqual(['demo_exists']);
    const res = await clear('the job was lost');
    expect(res.status).toBe(202);
    await until((x) => x.batch === null);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'demo.clear_requested', meta: { path: ['abandoned'], equals: 'loading' } },
      orderBy: { createdAt: 'desc' },
      select: { meta: true },
    });
    expect(audit.meta).toMatchObject({ reason: 'the job was lost', abandoned: 'loading' });
  });

  it('a batch abandoned in clearing may be removed again; refused, it goes back to failed (A2)', async () => {
    const batch = await prisma.demoBatch.create({
      data: { status: 'clearing', reason: 'job lost', createdById: admin.id },
      select: { id: true },
    });
    await prisma.$executeRaw`
      UPDATE "demo_batches" SET "updated_at" = now() - interval '20 minutes' WHERE "id" = ${batch.id}::uuid`;
    // A registered, marked demo ambassador whom a real account names as its referrer: the removal must refuse.
    const ambassador = await prisma.user.create({
      data: {
        email: `ambassador-x${randomUUID().slice(0, 6)}@demo.sirat.invalid`,
        passwordHash: 'not-a-real-hash',
        name: 'Demo Ambassador',
        role: 'ambassador',
        demoBatchId: batch.id,
      },
      select: { id: true },
    });
    await prisma.demoRecord.create({
      data: { batchId: batch.id, tableName: 'users', rowId: ambassador.id },
    });
    const real = await makeUser(prisma, { role: 'student', referredById: ambassador.id });
    try {
      expect((await status()).batch).toMatchObject({ status: 'clearing', stale: true });
      expect((await clear('the removal job was lost')).status).toBe(202);
      const s = await until(
        (x) => x.lastOutcome?.action === 'clear' && x.batch?.status !== 'clearing',
      );
      expect(s.lastOutcome).toMatchObject({
        result: 'blocked',
        blockers: { real_users_referred_by_demo: 1 },
      });
      expect(s.batch).toMatchObject({ status: 'failed', stale: false });
      expect(await prisma.user.count({ where: { id: ambassador.id } })).toBe(1);
    } finally {
      await prisma.user.update({ where: { id: real.id }, data: { referredById: null } });
      await removeAnyBatch();
    }
  });
});

describe('load, use, remove', () => {
  let batchId: string;
  let password: string;

  it('loads in one job: 300 students, 15 ambassadors, 2 jury, 2 exams of 30 questions, scored attempts, a published leaderboard, announcements', async () => {
    raise.mockClear();
    const res = await loaded();
    ({ batchId, password } = res);
    expect(loadMs).toBeLessThan(LOAD_LIMIT_MS);
    expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const counts = res.status.batch!.counts;
    expect(counts).toMatchObject({
      students: 300,
      ambassadors: 15,
      jury: 2,
      exams: 2,
      questions: 60,
      announcements: 4,
    });
    expect(counts.attempts).toBeGreaterThan(250);
    expect(counts.submissions).toBe(counts.attempts);
    expect(counts.leaderboard_entries).toBe(counts.attempts);
    expect(res.status.batch).toMatchObject({ createdByName: 'Demo Admin' });
    expect(res.status.progress).toBeNull();
    expect(res.status.lastOutcome).toMatchObject({ action: 'load', result: 'done' });
    // Never an admin or a manager; every account on the marker domain with the root marker.
    expect(
      await prisma.user.count({
        where: { demoBatchId: batchId, role: { in: ['admin', 'manager'] } },
      }),
    ).toBe(0);
    expect(
      await prisma.user.count({
        where: { demoBatchId: batchId, NOT: { email: { endsWith: '@demo.sirat.invalid' } } },
      }),
    ).toBe(0);
    // The audit row (the request) and the alert (the job).
    expect(
      await prisma.auditLog.count({
        where: { action: 'demo.load_requested', entityId: batchId, actorId: admin.id },
      }),
    ).toBe(1);
    await alerted('ops.demo_loaded');
    expect(raise).toHaveBeenCalledWith(
      'ops.demo_loaded',
      expect.objectContaining({ actorId: admin.id }),
    );
    // The password is nowhere in the database in clear.
    const row = await prisma.user.findFirstOrThrow({
      where: { demoBatchId: batchId },
      select: { passwordHash: true },
    });
    expect(row.passwordHash).not.toContain(password);
  }, 90_000);

  it('a second load is refused while the batch exists: 409 demo_exists', async () => {
    const res = await load();
    expect(res.status).toBe(409);
    expect(res.json.details).toEqual(['demo_exists']);
    expect(await prisma.demoBatch.count()).toBe(1);
  });

  it('the demo logins work with the one password', async () => {
    const res = await fetch(`${env.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ email: 'student-001@demo.sirat.invalid', password }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain(ACCESS_COOKIE);
  });

  it('the demo Round 1 board is published, one row per scored attempt, for demo accounts only', async () => {
    const round1 = await prisma.exam.findFirstOrThrow({
      where: { demoBatchId: batchId, roundId: { not: null } },
      select: { id: true, resultsPublishedAt: true },
    });
    expect(round1.resultsPublishedAt).not.toBeNull();
    const demoStudent = await prisma.user.findFirstOrThrow({
      where: { demoBatchId: batchId, role: 'student' },
      select: { id: true },
    });
    const demo = await env.sessions.start(
      { id: demoStudent.id, role: 'student' },
      { ip: '203.0.113.30', userAgent: 'jest' },
    );
    const demoCookie = `${ACCESS_COOKIE}=${demo.accessToken}`;
    const board = await call<ExamLeaderboard>(
      env,
      'GET',
      `/leaderboard?exam=${round1.id}`,
      demoCookie,
    );
    expect(board.status).toBe(200);
    expect(board.json.status).toBe('published');
    expect(board.json.total).toBe(
      await prisma.attempt.count({ where: { examId: round1.id, status: 'scored' } }),
    );
    // The default board of a demo account is the demo one; a real account never sees it, asked or by default.
    const byDefault = await call<ExamLeaderboard>(env, 'GET', '/leaderboard', demoCookie);
    expect(byDefault.json.exam?.id).toBe(round1.id);
    const real = await sessionFor(env, prisma, { role: 'student' });
    expect((await call(env, 'GET', `/leaderboard?exam=${round1.id}`, real.cookie)).status).toBe(
      404,
    );
    const realDefault = await call<ExamLeaderboard>(env, 'GET', '/leaderboard', real.cookie);
    expect(realDefault.json.exam?.id).not.toBe(round1.id);
  });

  it('exams never cross: a demo account sees and opens only demo exams, a real account only real ones', async () => {
    const realExam = await makePublishedExam(prisma, { title: `Real ${randomUUID().slice(0, 6)}` });
    const demoStudent = await prisma.user.findFirstOrThrow({
      where: { demoBatchId: batchId, role: 'student' },
      select: { id: true },
    });
    const demoSession = await env.sessions.start(
      { id: demoStudent.id, role: 'student' },
      { ip: '203.0.113.31', userAgent: 'jest' },
    );
    const demoCookie = `${ACCESS_COOKIE}=${demoSession.accessToken}`;
    const realStudent = await sessionFor(env, prisma, { role: 'student' });
    const demoExams = await prisma.exam.findMany({
      where: { demoBatchId: batchId },
      select: { id: true },
    });
    const ids = (r: { json: StudentExamListItem[] }) => r.json.map((e) => e.id);

    const asDemo = await call<StudentExamListItem[]>(env, 'GET', '/exams', demoCookie);
    expect(asDemo.status).toBe(200);
    expect(ids(asDemo)).toEqual(expect.arrayContaining(demoExams.map((e) => e.id)));
    expect(ids(asDemo)).not.toContain(realExam.id);
    const asReal = await call<StudentExamListItem[]>(env, 'GET', '/exams', realStudent.cookie);
    expect(ids(asReal)).toContain(realExam.id);
    for (const e of demoExams) expect(ids(asReal)).not.toContain(e.id);

    // Opening or starting the other side's exam: the same 404 as an unknown exam.
    const practice = demoExams[0]!.id;
    expect((await call(env, 'GET', `/exams/${realExam.id}`, demoCookie)).status).toBe(404);
    expect((await call(env, 'POST', `/exams/${realExam.id}/attempts`, demoCookie)).status).toBe(
      404,
    );
    expect((await call(env, 'GET', `/exams/${practice}`, realStudent.cookie)).status).toBe(404);
    expect(
      (await call(env, 'POST', `/exams/${practice}/attempts`, realStudent.cookie)).status,
    ).toBe(404);
    expect(await prisma.attempt.count({ where: { examId: realExam.id } })).toBe(0);
    await prisma.exam.update({ where: { id: realExam.id }, data: { status: 'archived' } });
  });

  it('teams never mix: a real account cannot join a demo team, nor a demo account a real team', async () => {
    const demoOwner = await prisma.user.findFirstOrThrow({
      where: { demoBatchId: batchId, role: 'ambassador' },
      select: { id: true, role: true },
    });
    const demoJoiner = await prisma.user.findFirstOrThrow({
      where: { demoBatchId: batchId, role: 'student' },
      select: { id: true },
    });
    expect(demoOwner.role).toBe('ambassador');
    const realOwner = await makeUser(prisma, { role: 'ambassador' });
    const code = () => `SR-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    await prisma.ambassadorProfile.createMany({
      data: [
        { userId: demoOwner.id, promoCode: code(), approvedAt: new Date() },
        { userId: realOwner.id, promoCode: code(), approvedAt: new Date() },
      ],
    });
    const demoTeam = await prisma.team.create({
      data: {
        name: `Demo team ${randomUUID().slice(0, 6)}`,
        joinCode: newJoinCode(),
        ownerId: demoOwner.id,
      },
    });
    const realTeam = await prisma.team.create({
      data: {
        name: `Real team ${randomUUID().slice(0, 6)}`,
        joinCode: newJoinCode(),
        ownerId: realOwner.id,
      },
    });
    const realStudent = await sessionFor(env, prisma, { role: 'student' });
    const demoSession = await env.sessions.start(
      { id: demoJoiner.id, role: 'student' },
      { ip: '203.0.113.32', userAgent: 'jest' },
    );
    const demoCookie = `${ACCESS_COOKIE}=${demoSession.accessToken}`;

    const join = (cookie: string, joinCode: string) =>
      call(env, 'POST', '/teams/join', cookie, { code: joinCode });
    expect((await join(realStudent.cookie, demoTeam.joinCode)).status).toBe(404);
    expect((await join(demoCookie, realTeam.joinCode)).status).toBe(404);
    expect(
      await prisma.teamMember.count({ where: { teamId: { in: [demoTeam.id, realTeam.id] } } }),
    ).toBe(0);
    // Same side: allowed.
    expect((await join(demoCookie, demoTeam.joinCode)).status).toBe(200);

    // The real team and its owner's profile are real rows: they stay after the removal below. Tidy them now.
    await prisma.team.delete({ where: { id: realTeam.id } });
    await prisma.ambassadorProfile.delete({ where: { userId: realOwner.id } });
  });

  it('a removal the database refuses names its blockers, removes nothing and restores the batch', async () => {
    const ambassador = await prisma.user.findFirstOrThrow({
      where: { demoBatchId: batchId, role: 'ambassador' },
      select: { id: true },
    });
    const real = await makeUser(prisma, { role: 'student', referredById: ambassador.id });
    const before = await prisma.demoRecord.count({ where: { batchId } });
    raise.mockClear();
    try {
      const res = await clear();
      expect(res.status).toBe(202);
      const s = await until(
        (x) => x.batch?.status === 'loaded' && x.lastOutcome?.action === 'clear',
      );
      expect(s.lastOutcome).toMatchObject({
        action: 'clear',
        result: 'blocked',
        blockers: { real_users_referred_by_demo: 1 },
      });
      expect(await prisma.demoRecord.count({ where: { batchId } })).toBe(before);
      expect(raise).not.toHaveBeenCalled();
    } finally {
      await prisma.user.update({ where: { id: real.id }, data: { referredById: null } });
    }
  });

  it('removes every demo row, also those made after the load, and no real row; the audit and the alert follow', async () => {
    const realStudent = await makeUser(prisma, { role: 'student' });
    raise.mockClear();
    const res = await clear('before the launch');
    expect(res.status).toBe(202);
    // The batch row goes with the commit, the outcome and the alert just after: wait for all three.
    const s = await until(
      (x) =>
        x.batch === null && x.lastOutcome?.action === 'clear' && x.lastOutcome.result === 'done',
    );
    expect(s.lastOutcome).toMatchObject({ action: 'clear', result: 'done' });
    await alerted('ops.demo_cleared');
    expect(await prisma.demoRecord.count()).toBe(0);
    expect(await prisma.user.count({ where: { email: { endsWith: '@demo.sirat.invalid' } } })).toBe(
      0,
    );
    expect(await prisma.exam.count({ where: { demoBatchId: { not: null } } })).toBe(0);
    expect(await prisma.announcement.count({ where: { demoBatchId: { not: null } } })).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: [realStudent.id, admin.id] } } })).toBe(2);
    expect(
      await prisma.auditLog.count({ where: { action: 'demo.clear_requested', entityId: batchId } }),
    ).toBe(2); // the refused one and this one
    expect(raise).toHaveBeenCalledWith(
      'ops.demo_cleared',
      expect.objectContaining({ actorId: admin.id }),
    );
  });
});
