/**
 * ops-check against a real queue Redis and the test database (LAUNCH-PLAN §6, L11): the app facts of real BullMQ
 * queues (a backlog with no worker, a failed job, a scheduler), the alert that fires once on a change and not again
 * while the state holds, and a digest that goes out once a day. Every queue has its own name for this run.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { raiseCheckAlerts, runChecks } from '../src/cli/ops-check';
import { BackgroundTasks } from '../src/common/background/background-tasks';
import { AlertEmailLimiter } from '../src/modules/audit/alert-email-limiter';
import { AuditService } from '../src/modules/audit/audit.service';
import { SecurityAlerts } from '../src/modules/audit/security-alerts.service';
import type { EmailMessage } from '../src/modules/notifications/email.types';
import { collectAppFacts } from '../src/modules/ops/app-facts';
import { sendDailyDigest } from '../src/modules/ops/digest';
import { EMPTY_STATE, type HostFacts } from '../src/modules/ops/ops-rules';
import type { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_REDIS_OPTIONS } from '../src/redis/redis.module';
import { testPrisma } from './helpers';

const run = randomUUID().slice(0, 8);
const names = {
  email: `opscheck-${run}-email`,
  payments: `opscheck-${run}-payments`,
  exam: `opscheck-${run}-exam`,
};
const prisma: PrismaClient = testPrisma();
let redis: Redis;
let cache: Redis;
const queues: Queue[] = [];
const workers: Worker[] = [];

const host: HostFacts = {
  diskUsedPercent: 40,
  cpuBusyPercent: 10,
  memoryUsedPercent: 40,
  swapUsedMb: 0,
  containersBad: 0,
  requests: 100,
  responses5xx: 0,
  apiP95Ms: 100,
  webRenderErrors: 0,
  api5xxLogged: 0,
  certificateDaysLeft: 90,
  backupAgeHours: 1,
  timeSynced: true,
  trustedGeneratorsMinutesLeft: null,
};

const queue = (name: string) => {
  const q = new Queue(name, { connection: redis });
  queues.push(q);
  return q;
};
const facts = (nowMs: number, sinceMs = nowMs - 5 * 60_000) =>
  collectAppFacts(redis, {
    queues: [
      { name: 'email', queueName: names.email },
      { name: 'payments', queueName: names.payments, criticalJob: 'verify' },
      { name: 'exam', queueName: names.exam },
    ],
    reconcile: { queueName: names.payments, jobName: 'reconcile', intervalSeconds: 120 },
    sinceMs,
    nowMs,
  });

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_QUEUE_URL as string, QUEUE_REDIS_OPTIONS);
  cache = new Redis(process.env.REDIS_CACHE_URL as string, { maxRetriesPerRequest: 1 });
  await Promise.all([redis.ping(), cache.ping()]);
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  for (const q of queues) await q.obliterate({ force: true }).catch(() => undefined);
  await Promise.all(queues.map((q) => q.close()));
  const keys = await cache.keys(`opscheck-test:${run}:*`);
  if (keys.length > 0) await cache.del(...keys);
  await Promise.all([redis.quit(), cache.quit(), prisma.$disconnect()]);
});

describe('ops-check app facts', () => {
  it('reads a backlog with no worker, a job that failed for good, and the reconciliation schedule', async () => {
    const payments = queue(names.payments);
    await payments.add('verify', {}, { jobId: `w-${run}-1`, timestamp: Date.now() - 20 * 60_000 });
    await payments.add('verify', {}, { jobId: `w-${run}-2` });
    let a = await facts(Date.now());
    const p = a.queues.find((q) => q.name === 'payments')!;
    expect(p).toMatchObject({ workers: 0, waiting: 2, failedSinceLastRun: 0 });
    expect(p.oldestWaitingSeconds).toBeGreaterThanOrEqual(20 * 60 - 5);
    expect(a.reconcileOverdueSeconds).toBeNull(); // no schedule yet
    expect(a.queueRedisMemoryMb).toBeGreaterThanOrEqual(0);

    // A job that fails for good (its only attempt) on the exam queue, and a verify job on payments. The backlog
    // above goes first, or the payments worker would take (and fail) those jobs too.
    await payments.drain(true);
    const exam = queue(names.exam);
    const since = Date.now() - 1;
    for (const [q, name] of [
      [exam, 'score-attempt'],
      [payments, 'verify'],
    ] as const) {
      const worker = new Worker(
        q.name,
        async (): Promise<void> => {
          throw new Error('boom');
        },
        {
          connection: redis,
        },
      );
      workers.push(worker);
      const failed = new Promise((resolve) => worker.once('failed', resolve));
      await q.add(name, {}, { attempts: 1, jobId: `f-${run}-${name}` });
      await failed;
      await worker.close();
    }
    await payments.upsertJobScheduler(
      'payments-reconcile',
      { every: 120_000 },
      { name: 'reconcile' },
    );
    a = await facts(Date.now(), since);
    expect(a.queues.find((q) => q.name === 'exam')!.failedSinceLastRun).toBe(1);
    expect(a.queues.find((q) => q.name === 'payments')).toMatchObject({
      failedSinceLastRun: 1,
      failedVerifySinceLastRun: 1,
    });
    expect(a.reconcileOverdueSeconds).toBe(0);
    // Six minutes later, with the schedule not run: overdue.
    expect((await facts(Date.now() + 8 * 60_000, since)).reconcileOverdueSeconds).toBeGreaterThan(
      300,
    );
  });
});

describe('ops-check alerts', () => {
  it('alert once when a check turns critical, not again while it holds, and once when resolved', async () => {
    const audit = new AuditService(prisma as unknown as PrismaService);
    const background = new BackgroundTasks();
    const alerts = new SecurityAlerts(
      audit,
      {} as never, // no recipient: no email is queued
      background,
      new AlertEmailLimiter(cache, 6, `opscheck-test:${run}:`),
      undefined,
    );
    const started = new Date();
    const noWorker = { ...(await facts(Date.now())) };
    noWorker.reconcileOverdueSeconds = 0; // only the workers check changes in this test
    const t0 = Date.now();
    const first = runChecks({ host, state: EMPTY_STATE, lastRunAt: null }, noWorker, t0);
    expect(first.summary.critical).not.toContain('workers'); // one run is not enough
    const second = runChecks({ host, state: first.state, lastRunAt: t0 }, noWorker, t0 + 300_000);
    expect(second.summary.critical).toContain('workers');
    await raiseCheckAlerts(first.alerts, alerts);
    await raiseCheckAlerts(second.alerts, alerts);
    const third = runChecks({ host, state: second.state, lastRunAt: t0 }, noWorker, t0 + 600_000);
    await raiseCheckAlerts(third.alerts, alerts);
    const rows = await prisma.auditLog.findMany({
      where: { action: 'security.ops.workers', createdAt: { gte: started } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.meta).toMatchObject({ level: 2 });
    const healthy = {
      ...noWorker,
      queues: noWorker.queues.map((q) => ({
        ...q,
        workers: 1,
        waiting: 0,
        oldestWaitingSeconds: null,
      })),
    };
    const fixed = runChecks({ host, state: third.state, lastRunAt: t0 }, healthy, t0 + 900_000);
    await raiseCheckAlerts(fixed.alerts, alerts);
    const after = await prisma.auditLog.findMany({
      where: { action: 'security.ops.workers', createdAt: { gte: started } },
      orderBy: { createdAt: 'asc' },
    });
    expect(after.map((r) => (r.meta as { level: number }).level)).toEqual([2, 0]);
  });
});

describe('the daily digest', () => {
  it('goes out once a Dhaka day, with alert and payment counts but no address in its text', async () => {
    const sent: EmailMessage[] = [];
    const enqueue = async (_kind: string, _key: string, message: EmailMessage) => {
      sent.push(message);
      return true;
    };
    // A day of its own (far ahead), so earlier runs of this test never count.
    const day = new Date(Date.UTC(2100 + Math.floor(Math.random() * 800), 4, 10, 2, 0));
    const deps = {
      prisma,
      enqueue,
      to: 'digest@example.invalid',
      host: { diskUsedPercent: 41, backupAgeHours: 2 },
      now: day,
    };
    expect(await sendDailyDigest(deps)).toBe('sent');
    expect(await sendDailyDigest({ ...deps, now: new Date(day.getTime() + 3 * 3_600_000) })).toBe(
      'already_sent',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/^\[Sirat\] Daily digest \d{4}-05-10$/);
    expect(sent[0]!.text).toContain('Disk used: 41%');
    expect(sent[0]!.text).toContain('Newest backup: 2 h old');
    expect(sent[0]!.text).not.toContain('example.invalid');
    expect(await sendDailyDigest({ ...deps, to: undefined })).toBe('no_recipient');
  });
});
