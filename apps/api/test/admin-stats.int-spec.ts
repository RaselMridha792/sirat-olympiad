/**
 * GET /admin/stats (06-API "Admin statistics"; lead 2026-11-01): counts only, admins and managers, one snapshot,
 * cached 60 s with a single-flight lock. The test database is shared by every suite (one worker), so the counts are
 * compared as differences around rows this file makes, with the cache key cleared before each fresh read.
 */
import type { PrismaClient } from '@prisma/client';
import type { AdminStats } from '@sirat/shared';
import type Redis from 'ioredis';
import { dhakaDays, STATS_KEY } from '../src/modules/admin/admin-stats.service';
import { newPromoCode } from '../src/modules/ambassadors/promo-code';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, registeredStudent, sessionFor, type CoreApp } from './core-helpers';
import { makeAttempt, makePublishedExam } from './exam-helpers';
import {
  makePaidPayment,
  makeRegistrationAttempt,
  makeUser,
  paymentData,
  testPrisma,
} from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let redis: Redis;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  redis = env.app.get(REDIS_CACHE);
  admin = await sessionFor(env, prisma, { role: 'admin' });
});

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

const stats = (cookie = admin.cookie) => call<AdminStats>(env, 'GET', '/admin/stats', cookie);

/** A fresh computation: the cached copy is dropped first. */
async function fresh(): Promise<AdminStats> {
  await redis.del(STATS_KEY);
  const res = await stats();
  expect(res.status).toBe(200);
  return res.json;
}

/** Field-by-field difference of two answers' counts (numbers only; null stays null). */
function delta(before: unknown, after: unknown): unknown {
  if (typeof after === 'number') return after - (before as number);
  if (Array.isArray(after)) return after.map((v, i) => delta((before as unknown[])[i], v));
  if (after && typeof after === 'object')
    return Object.fromEntries(
      Object.entries(after).map(([k, v]) => [k, delta((before as Record<string, unknown>)[k], v)]),
    );
  return after;
}

describe('the counts', () => {
  it('counts registrations, payments, attempts, categories and ambassadors, all from one snapshot', async () => {
    const before = await fresh();

    const a = await registeredStudent(prisma, { category: 'activist' });
    await registeredStudent(prisma, { category: 'achiever', referredById: a.user.id });
    // A payment still at the gateway, one waiting at PayStation, one that failed, one with a review reason.
    const initiated = await makeRegistrationAttempt(prisma);
    await prisma.payment.create({ data: paymentData(initiated.id) });
    const pendingAttempt = await makeRegistrationAttempt(prisma);
    const pending = await prisma.payment.create({ data: paymentData(pendingAttempt.id) });
    await prisma.payment.update({ where: { id: pending.id }, data: { status: 'pending' } });
    const failedAttempt = await makeRegistrationAttempt(prisma, { status: 'abandoned' });
    const failed = await prisma.payment.create({ data: paymentData(failedAttempt.id) });
    await prisma.payment.update({ where: { id: failed.id }, data: { status: 'failed' } });
    const reviewed = await makePaidPayment(prisma);
    await prisma.payment.update({
      where: { id: reviewed.id },
      data: { reviewReason: 'success_without_trx_id' },
    });
    await makeRegistrationAttempt(prisma, { status: 'conflict' });
    // Exam attempts: one in progress, one submitted, one scored.
    const exam = await makePublishedExam(prisma);
    const inProgress = await makeUser(prisma);
    await makeAttempt(prisma, inProgress.id, exam.id);
    for (const scored of [false, true]) {
      const user = await makeUser(prisma);
      const attempt = await makeAttempt(prisma, user.id, exam.id);
      await prisma.attempt.update({
        where: { id: attempt.id },
        data: { status: 'submitted', submittedAt: new Date(), timeTakenSeconds: 60 },
      });
      if (scored)
        await prisma.attempt.update({
          where: { id: attempt.id },
          data: { status: 'scored', score: 1 },
        });
    }
    // Ambassadors: one approved, one revoked (the row stays with approved_at NULL).
    await prisma.ambassadorProfile.create({
      data: {
        userId: a.user.id,
        promoCode: newPromoCode(),
        approvedAt: new Date(),
      },
    });
    const gone = await makeUser(prisma, { role: 'student' });
    await prisma.ambassadorProfile.create({
      data: {
        userId: gone.id,
        promoCode: newPromoCode(),
        approvedAt: null,
      },
    });

    const after = await fresh();
    const d = delta(before, after) as AdminStats;
    expect(d.totals).toEqual({
      registered: 2,
      paid: 3, // two registrations and the reviewed payment
      pendingPayments: 2,
      activeAttempts: 1,
      submittedAttempts: 2,
      secondRound: null,
      finalists: null,
    });
    expect(d.paymentsByStatus).toEqual({
      initiated: 1,
      pending: 1,
      paid: 3,
      failed: 1,
      expired: 0,
    });
    expect(d.paymentsNeedingReview).toBe(1);
    // makePaidPayment leaves its attempt open (the fixtures' legal order does not complete it).
    expect(d.registrationAttempts).toEqual({ open: 5, completed: 0, abandoned: 1, conflict: 1 });
    expect(d.byCategory).toEqual([
      { category: 'activist', count: 1 },
      { category: 'ambassador', count: 0 },
      { category: 'achiever', count: 1 },
    ]);
    expect(d.ambassadors).toEqual({ approved: 1, revoked: 1, referredStudents: 1 });
    // One snapshot: the totals agree with the breakdowns.
    expect(after.totals.paid).toBe(after.paymentsByStatus.paid);
    expect(after.totals.pendingPayments).toBe(
      after.paymentsByStatus.initiated + after.paymentsByStatus.pending,
    );
  });

  it('counts registrations per Asia/Dhaka calendar day, 45 days oldest first', async () => {
    const now = new Date();
    const { days, start } = dhakaDays(now);
    const before = await fresh();
    expect(before.registrationsDaily.map((d) => d.date)).toEqual(days);
    const today = days[44]!;
    const yesterday = days[43]!;
    // 00:10 today in Dhaka is 18:10 UTC the day before; 23:50 yesterday in Dhaka is 17:50 UTC.
    const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+06:00`);
    const registerAt = async (createdAt: Date) => {
      const user = await makeUser(prisma, { role: 'student' });
      const payment = await makePaidPayment(prisma, user.id);
      await prisma.registration.create({
        data: { userId: user.id, paymentId: payment.id, createdAt },
      });
    };
    await registerAt(at(today, '00:10'));
    await registerAt(at(yesterday, '23:50'));
    await registerAt(new Date(start.getTime() - 60_000)); // a minute before the first day: not in the chart
    await registerAt(new Date(start.getTime())); // the first day's first moment

    const after = await fresh();
    const d = new Map(
      after.registrationsDaily.map((day, i) => [
        day.date,
        day.count - before.registrationsDaily[i]!.count,
      ]),
    );
    expect(d.get(today)).toBe(1);
    expect(d.get(yesterday)).toBe(1);
    expect(d.get(days[0]!)).toBe(1);
    expect([...d.values()].reduce((sum, n) => sum + n, 0)).toBe(3);
    expect(after.totals.registered - before.totals.registered).toBe(4);
  });
});

describe('the cache', () => {
  it('computes once for a burst of admins, then serves the same answer for the TTL', async () => {
    await redis.del(STATS_KEY);
    const from = env.appPrisma.statements.length;
    const burst = await Promise.all(Array.from({ length: 6 }, () => stats()));
    expect(burst.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(new Set(burst.map((r) => r.json.asOf)).size).toBe(1);
    const daily = env.appPrisma.statements
      .slice(from)
      .filter((q) => q.includes("AT TIME ZONE 'Asia/Dhaka'"));
    expect(daily).toHaveLength(1);

    await registeredStudent(prisma, { category: 'activist' });
    const cached = await stats();
    expect(cached.json.asOf).toBe(burst[0]!.json.asOf);
    expect(cached.json.totals.registered).toBe(burst[0]!.json.totals.registered);
    expect(await redis.ttl(STATS_KEY)).toBeGreaterThan(0);
    expect(await redis.ttl(STATS_KEY)).toBeLessThanOrEqual(60);
  });

  it('reads Postgres when the cache does not answer', async () => {
    await redis.del(STATS_KEY);
    const get = jest.spyOn(redis, 'get').mockRejectedValue(new Error('cache down'));
    const set = jest.spyOn(redis, 'set').mockRejectedValue(new Error('cache down'));
    try {
      const first = await stats();
      await registeredStudent(prisma, { category: 'achiever' });
      const second = await stats();
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(second.json.totals.registered).toBe(first.json.totals.registered + 1);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('who may read it', () => {
  it('is for admins and managers; students, ambassadors, jury and a demoted or blocked admin get 403', async () => {
    const manager = await sessionFor(env, prisma, { role: 'manager' });
    expect((await stats(manager.cookie)).status).toBe(200);
    for (const role of ['student', 'ambassador', 'jury'] as const) {
      const other = await sessionFor(env, prisma, { role });
      expect([role, (await stats(other.cookie)).status]).toEqual([role, 403]);
    }
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    expect((await stats(demoted.cookie)).status).toBe(403);
    const blocked = await sessionFor(env, prisma, { role: 'manager' });
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    expect((await stats(blocked.cookie)).status).toBe(403);
    expect((await stats('')).status).toBe(401);
  });

  it('answers counts only: no email, name, id or phone anywhere', async () => {
    const res = await stats();
    const leaves: unknown[] = [];
    const walk = (v: unknown, key: string) => {
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
      else leaves.push(key === 'asOf' || key === 'date' || key === 'category' ? 'label' : v);
    };
    walk(res.json, '');
    expect(leaves.every((v) => v === 'label' || v === null || Number.isInteger(v))).toBe(true);
    expect(res.text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-|01[3-9]\d{8}/i);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});
