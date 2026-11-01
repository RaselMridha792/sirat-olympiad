/**
 * Referral points (core C5b, CORE-PLAN §6; lead 2026-11-01): the sweep writes one ledger row per paid referral, is
 * idempotent under repeats and concurrent runs, back-fills, honours the setting, looks back 2 days every 5 minutes, and
 * runs from one scheduler per period. The test database is shared, so assertions are about this file's own rows.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { EnvVars } from '../src/config/env';
import { AmbassadorPointsWorker } from '../src/modules/ambassadors/ambassador-points.worker';
import { newPromoCode } from '../src/modules/ambassadors/promo-code';
import { AMBASSADOR_JOBS, AMBASSADOR_JOB_OPTIONS } from '../src/modules/ambassadors/points-queue';
import {
  POINTS_PER_REFERRAL_KEY,
  ReferralPoints,
} from '../src/modules/ambassadors/referral-points';
import { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_REDIS_OPTIONS } from '../src/redis/redis.module';
import type { AmbassadorPointsConfig, PointsAdjustResult } from '@sirat/shared';
import { bootCoreApp, call, registeredStudent, sessionFor, type CoreApp } from './core-helpers';
import { makePaidPayment, makeUser, testPrisma } from './helpers';

let prisma: PrismaClient;
let sweep: ReferralPoints;
let env: CoreApp;
let admin: { id: string; cookie: string };

/** The core plan's Q3 defaults, restored after the settings tests (other suites read the ranks). */
const DEFAULTS: AmbassadorPointsConfig = {
  pointsPerReferral: 10,
  thresholds: [
    { name: 'Bronze', minPoints: 0 },
    { name: 'Silver', minPoints: 100 },
    { name: 'Gold', minPoints: 250 },
  ],
};

beforeAll(async () => {
  prisma = testPrisma();
  sweep = new ReferralPoints(prisma as unknown as PrismaService);
  env = await bootCoreApp();
  admin = await sessionFor(env, prisma, { role: 'admin' });
});

afterAll(async () => {
  await setPoints(10);
  await prisma.rankThreshold.deleteMany({});
  await prisma.rankThreshold.createMany({ data: DEFAULTS.thresholds });
  await env?.app.close();
  await prisma?.$disconnect();
});

const details = (json: unknown) => (json as { details?: string[] }).details;

const setPoints = (value: number) =>
  prisma.setting.upsert({
    where: { key: POINTS_PER_REFERRAL_KEY },
    create: { key: POINTS_PER_REFERRAL_KEY, value },
    update: { value },
  });

async function ambassador(approved = true) {
  const { user } = await registeredStudent(prisma, { role: approved ? 'ambassador' : 'student' });
  await prisma.ambassadorProfile.create({
    data: { userId: user.id, promoCode: newPromoCode(), approvedAt: approved ? new Date() : null },
  });
  return user;
}

/** A paid student referred by `referrerId`, registered at `createdAt`. */
async function referral(referrerId: string, createdAt = new Date()) {
  const user = await makeUser(prisma, { role: 'student', referredById: referrerId });
  const payment = await makePaidPayment(prisma, user.id);
  await prisma.registration.create({ data: { userId: user.id, paymentId: payment.id, createdAt } });
  return payment;
}

const ledgerOf = (userId: string) =>
  prisma.pointLedger.findMany({ where: { userId }, orderBy: { eventKey: 'asc' } });

describe('the referral sweep', () => {
  it('writes one row per paid referral with the set amount, and nothing more when run again', async () => {
    await setPoints(7);
    const a = await ambassador();
    const p1 = await referral(a.id);
    const p2 = await referral(a.id);
    await registeredStudent(prisma); // no referrer: no points for anyone

    await sweep.run('full');
    const rows = await ledgerOf(a.id);
    expect(rows.map((r) => [r.eventKey, r.amount, r.reason])).toEqual(
      [`referral_paid:${p1.id}`, `referral_paid:${p2.id}`].sort().map((k) => [k, 7, 'referral']),
    );
    await sweep.run('full');
    await sweep.run('recent');
    expect(await ledgerOf(a.id)).toHaveLength(2);
    // A later setting changes later awards only; earlier rows stay as written.
    await setPoints(5);
    const p3 = await referral(a.id);
    await sweep.run('recent');
    const after = await ledgerOf(a.id);
    expect(after.find((r) => r.eventKey === `referral_paid:${p3.id}`)?.amount).toBe(5);
    expect(after.filter((r) => r.amount === 7)).toHaveLength(2);
  });

  it('two sweeps at once still award each referral once', async () => {
    await setPoints(10);
    const a = await ambassador();
    for (let i = 0; i < 5; i += 1) await referral(a.id);
    await Promise.all([sweep.run('full'), sweep.run('full'), sweep.run('recent')]);
    expect(await ledgerOf(a.id)).toHaveLength(5);
  });

  it('counts a referral of an ambassador revoked since, and awards nothing while the setting is 0', async () => {
    await setPoints(10);
    const revoked = await ambassador(false);
    const kept = await referral(revoked.id);
    await setPoints(0);
    await sweep.run('full');
    expect(await ledgerOf(revoked.id)).toHaveLength(0);
    await setPoints(10);
    await sweep.run('full');
    expect((await ledgerOf(revoked.id)).map((r) => r.eventKey)).toEqual([
      `referral_paid:${kept.id}`,
    ]);
  });

  it('looks back 2 days every 5 minutes; the nightly back-fill takes the rest', async () => {
    await setPoints(10);
    const a = await ambassador();
    await referral(a.id); // makes sure some referral is already awarded, so "recent" is not a first run
    await sweep.run('full');
    const old = await referral(a.id, new Date(Date.now() - 3 * 86_400_000));
    const fresh = await referral(a.id, new Date(Date.now() - 86_400_000));
    await sweep.run('recent');
    const keys = (await ledgerOf(a.id)).map((r) => r.eventKey);
    expect(keys).toContain(`referral_paid:${fresh.id}`);
    expect(keys).not.toContain(`referral_paid:${old.id}`);
    await sweep.run('full');
    expect((await ledgerOf(a.id)).map((r) => r.eventKey)).toContain(`referral_paid:${old.id}`);
  });
});

describe('the schedulers', () => {
  it('two workers starting give one 5-minute and one nightly scheduler, and the job runs the sweep', async () => {
    const queueName = `ambassador-test-${randomUUID().slice(0, 8)}`;
    const values: Record<string, string | undefined> = {
      REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL,
      AMBASSADOR_QUEUE_NAME: queueName,
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<EnvVars, true>;
    const runs: string[] = [];
    const fake = {
      run: async (mode: string) => {
        runs.push(mode);
        return { mode, awarded: 0 };
      },
    } as unknown as ReferralPoints;
    const workers = [
      new AmbassadorPointsWorker(fake, config),
      new AmbassadorPointsWorker(fake, config),
    ];
    const redis = new Redis(process.env.REDIS_QUEUE_URL as string, QUEUE_REDIS_OPTIONS);
    const queue = new Queue(queueName, { connection: redis });
    try {
      for (const w of workers) await w.onModuleInit();
      const schedulers = await queue.getJobSchedulers(0, 10, true);
      expect(schedulers.map((s) => s.key).sort()).toEqual(
        [AMBASSADOR_JOBS.referralPoints, AMBASSADOR_JOBS.referralBackfill].sort(),
      );
      expect(schedulers.find((s) => s.key === AMBASSADOR_JOBS.referralPoints)).toMatchObject({
        every: 300_000,
      });
      expect(schedulers.find((s) => s.key === AMBASSADOR_JOBS.referralBackfill)).toMatchObject({
        pattern: '45 3 * * *',
        tz: 'Asia/Dhaka',
      });
      // Wait on the effect (the worker ran the back-fill), not on the job: with the real options the job's key is
      // removed on completion, and reading it back after that races (BullMQ "Missing key for job").
      await queue.add(AMBASSADOR_JOBS.referralBackfill, {}, AMBASSADOR_JOB_OPTIONS);
      for (let i = 0; i < 400 && !runs.includes('full'); i += 1)
        await new Promise((resolve) => setTimeout(resolve, 50));
      expect(runs).toContain('full');
    } finally {
      for (const w of workers) await w.onApplicationShutdown();
      await queue.obliterate({ force: true });
      await queue.close();
      redis.disconnect();
    }
  });
});

describe('the points settings', () => {
  const read = (cookie = admin.cookie) =>
    call<AmbassadorPointsConfig>(env, 'GET', '/admin/ambassador-points', cookie);
  const put = (body: unknown, cookie = admin.cookie) =>
    call<AmbassadorPointsConfig>(env, 'PUT', '/admin/ambassador-points', cookie, body);

  async function reset() {
    await setPoints(DEFAULTS.pointsPerReferral);
    await prisma.rankThreshold.deleteMany({});
    await prisma.rankThreshold.createMany({ data: DEFAULTS.thresholds });
  }

  it('admins change points per referral and the ranks with the values they saw; a change in between is 409', async () => {
    await reset();
    expect((await read()).json).toEqual(DEFAULTS);
    const next = {
      pointsPerReferral: 12,
      thresholds: [
        { name: 'Bronze', minPoints: 0 },
        { name: 'Silver', minPoints: 120 },
        { name: 'Gold', minPoints: 300 },
        { name: 'Platinum', minPoints: 600 },
      ],
    };
    const res = await put({ ...next, expected: DEFAULTS, reason: 'Season two' });
    expect([res.status, res.json]).toEqual([200, next]);
    expect((await read()).json).toEqual(next);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ambassador_points.changed', actorId: admin.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.meta).toEqual({ before: DEFAULTS, after: next, reason: 'Season two' });

    const stale = await put({ ...DEFAULTS, expected: DEFAULTS, reason: 'Back again' });
    expect([stale.status, details(stale.json)]).toEqual([409, ['stale']]);
    await reset();
  });

  it('two admins saving at once: one wins, the other gets 409', async () => {
    await reset();
    const a = { ...DEFAULTS, pointsPerReferral: 20, expected: DEFAULTS, reason: 'Admin A' };
    const b = { ...DEFAULTS, pointsPerReferral: 30, expected: DEFAULTS, reason: 'Admin B' };
    const statuses = (await Promise.all([put(a), put(b)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect([20, 30]).toContain((await read()).json.pointsPerReferral);
    await reset();
  });

  it('refuses ranks that do not start at 0, do not rise, repeat a name, or are too many', async () => {
    await reset();
    const base = { ...DEFAULTS, expected: DEFAULTS, reason: 'Check' };
    const bad = [
      [{ name: 'Bronze', minPoints: 5 }],
      [
        { name: 'Bronze', minPoints: 0 },
        { name: 'Silver', minPoints: 0 },
      ],
      [
        { name: 'Bronze', minPoints: 0 },
        { name: 'Gold', minPoints: 300 },
        { name: 'Silver', minPoints: 100 },
      ],
      [
        { name: 'Bronze', minPoints: 0 },
        { name: 'bronze', minPoints: 50 },
      ],
    ];
    for (const thresholds of bad) {
      const res = await put({ ...base, thresholds });
      expect([res.status, details(res.json)]).toEqual([400, ['bad_thresholds']]);
    }
    const many = Array.from({ length: 11 }, (_, i) => ({ name: 'Rank ' + i, minPoints: i * 10 }));
    for (const body of [
      { ...base, thresholds: many },
      { ...base, thresholds: [] },
      { ...base, pointsPerReferral: 1001 },
      { ...base, pointsPerReferral: -1 },
      { ...base, reason: 'ab' },
      { ...base, extra: true },
      { pointsPerReferral: 10, thresholds: DEFAULTS.thresholds, reason: 'No expected' },
    ])
      expect((await put(body)).status).toBe(400);
    expect((await read()).json).toEqual(DEFAULTS);
  });
});

describe('point adjustments', () => {
  const adjust = (body: unknown, cookie = admin.cookie) =>
    call<PointsAdjustResult>(env, 'POST', '/admin/points/adjust', cookie, body);

  it('writes a compensating entry for an ambassador, audited, and never edits a row', async () => {
    const a = await ambassador();
    const up = await adjust({ userId: a.id, amount: 15, reason: 'Event help' });
    expect([up.status, up.json]).toEqual([200, { userId: a.id, points: 15 }]);
    const down = await adjust({ userId: a.id, amount: -5, reason: 'Correction' });
    expect(down.json.points).toBe(10);
    const rows = await ledgerOf(a.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.eventKey).toMatch(/^adjust:[0-9a-f-]{36}$/);
      expect(r.createdById).toBe(admin.id);
    }
    expect(
      await prisma.auditLog.count({ where: { action: 'points.adjusted', entityId: a.id } }),
    ).toBe(2);
    // A revoked ambassador keeps the profile, so an adjustment still lands.
    const gone = await ambassador(false);
    expect((await adjust({ userId: gone.id, amount: 3, reason: 'Late credit' })).status).toBe(200);
  });

  it('refuses a student without a profile, an unknown user, a zero or too large amount, and a missing reason', async () => {
    const { user } = await registeredStudent(prisma);
    const res = await adjust({ userId: user.id, amount: 5, reason: 'Not one' });
    expect([res.status, details(res.json)]).toEqual([409, ['not_ambassador']]);
    expect((await adjust({ userId: randomUUID(), amount: 5, reason: 'Nobody' })).status).toBe(404);
    const a = await ambassador();
    for (const body of [
      { userId: a.id, amount: 0, reason: 'Zero' },
      { userId: a.id, amount: 10_001, reason: 'Too big' },
      { userId: a.id, amount: 1.5, reason: 'Half' },
      { userId: a.id, amount: 5 },
      { userId: 'not-a-uuid', amount: 5, reason: 'Bad id' },
    ])
      expect((await adjust(body)).status).toBe(400);
    expect(await ledgerOf(a.id)).toHaveLength(0);
  });
});

describe('who may change points', () => {
  it('is for admins only: manager, ambassador, student and a demoted admin get 403', async () => {
    const a = await ambassador();
    const body = { userId: a.id, amount: 5, reason: 'Try' };
    for (const role of ['manager', 'ambassador', 'student'] as const) {
      const other = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/admin/ambassador-points', other.cookie)).status).toBe(403);
      expect((await call(env, 'POST', '/admin/points/adjust', other.cookie, body)).status).toBe(
        403,
      );
    }
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    expect((await call(env, 'GET', '/admin/ambassador-points', demoted.cookie)).status).toBe(403);
    expect(await ledgerOf(a.id)).toHaveLength(0);
  });
});
