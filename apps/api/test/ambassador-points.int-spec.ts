/**
 * Referral points (core C5b, CORE-PLAN §6; lead 2026-11-01): the sweep writes one ledger row per paid referral, is
 * idempotent under repeats and concurrent runs, back-fills, honours the setting, looks back 2 days every 5 minutes, and
 * runs from one scheduler per period. The test database is shared, so assertions are about this file's own rows.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { Queue, QueueEvents } from 'bullmq';
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
import { registeredStudent } from './core-helpers';
import { makePaidPayment, makeUser, testPrisma } from './helpers';

let prisma: PrismaClient;
let sweep: ReferralPoints;

beforeAll(() => {
  prisma = testPrisma();
  sweep = new ReferralPoints(prisma as unknown as PrismaService);
});

afterAll(async () => {
  await setPoints(10);
  await prisma?.$disconnect();
});

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
    const eventsRedis = redis.duplicate();
    const events = new QueueEvents(queueName, { connection: eventsRedis });
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
      await events.waitUntilReady();
      const job = await queue.add(AMBASSADOR_JOBS.referralBackfill, {}, AMBASSADOR_JOB_OPTIONS);
      expect(await job.waitUntilFinished(events, 20_000)).toMatchObject({ mode: 'full' });
      expect(runs).toContain('full');
    } finally {
      for (const w of workers) await w.onApplicationShutdown();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      eventsRedis.disconnect();
      redis.disconnect();
    }
  });
});
