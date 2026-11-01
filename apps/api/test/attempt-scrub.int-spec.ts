/**
 * The registration form's retention (PAYMENTS-PLAN 4.3, D6; the nightly attempt-scrub job) against the *_test
 * database: which attempts lose their stored form and which keep it, what stays of a cleared attempt, reruns and
 * parallel runs, and that money is never lost: a payment that succeeds after the scrub is still paid and set aside.
 * Every run gets an explicit `now`, and the rows sit days from the cutoff, so no result depends on timing.
 */
import { randomUUID } from 'node:crypto';
import { PaymentStatus, Prisma, RegistrationAttemptStatus } from '@prisma/client';
import { AuditService } from '../src/modules/audit/audit.service';
import { AttemptScrub } from '../src/modules/housekeeping/attempt-scrub';
import {
  type CleanupLimits,
  DEFAULT_CLEANUP_LIMITS,
} from '../src/modules/housekeeping/session-cleanup';
import { PrismaService } from '../src/prisma/prisma.service';
import { makeRegistrationAttempt, makeUser, paymentData } from './helpers';
import { bootPaymentsApp, checkout, startRegistration, type PaymentsApp } from './payments-app';

let env: PaymentsApp;

beforeAll(async () => {
  env = await bootPaymentsApp();
}, 60_000);

afterAll(async () => {
  await env?.close();
});

const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number, from = NOW) => new Date(from.getTime() - days * DAY);
const FORM = {
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$not-a-real-hash',
  district: 'Dhaka',
  institution: 'Sirat Test School',
  educationType: 'general',
  gradeLevelId: randomUUID(),
};

const scrubWith = (limits: Partial<CleanupLimits> = {}) =>
  new AttemptScrub(env.app.get(PrismaService), env.app.get(AuditService), {
    ...DEFAULT_CLEANUP_LIMITS,
    ...limits,
  });

type PaymentSpec = { status: PaymentStatus; expiredDaysAgo: number };

/** An attempt with its form, last changed `changedDaysAgo`, with payments in the given states. */
async function attempt(
  status: RegistrationAttemptStatus,
  changedDaysAgo: number,
  payments: PaymentSpec[] = [],
) {
  const user =
    status === RegistrationAttemptStatus.completed ? await makeUser(env.prisma) : undefined;
  const a = await makeRegistrationAttempt(env.prisma, {
    status,
    payload: status === RegistrationAttemptStatus.completed ? Prisma.DbNull : FORM,
    ...(user ? { userId: user.id, completedAt: ago(changedDaysAgo) } : {}),
  });
  for (const p of payments) {
    const row = await env.prisma.payment.create({
      data: paymentData(a.id, { expiresAt: ago(p.expiredDaysAgo) }),
    });
    // The status-transition trigger: initiated -> pending -> failed / expired.
    if (p.status !== PaymentStatus.initiated)
      await env.prisma.payment.update({ where: { id: row.id }, data: { status: 'pending' } });
    if (p.status === PaymentStatus.failed || p.status === PaymentStatus.expired)
      await env.prisma.payment.update({ where: { id: row.id }, data: { status: p.status } });
  }
  // Last changed then (Prisma's @updatedAt would stamp now).
  await env.prisma
    .$executeRaw`UPDATE pending_registrations SET updated_at = ${ago(changedDaysAgo)} WHERE id = ${a.id}::uuid`;
  return env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id: a.id } });
}

const formOf = async (id: string) =>
  (await env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id } })).payload;
const expired = (days: number): PaymentSpec => ({
  status: PaymentStatus.expired,
  expiredDaysAgo: days,
});

/** Nothing else in the test database may be due, so the counts are this file's own. */
beforeEach(async () => {
  await scrubWith().run(NOW);
});

describe('which attempts lose their form', () => {
  it('abandoned: after 30 days since the last change; the row, name, email, phone and updated_at stay', async () => {
    const old = await attempt('abandoned', 31, [expired(31)]);
    const recent = await attempt('abandoned', 29, [expired(31)]);

    expect(await scrubWith().run(NOW)).toEqual({ abandoned: 1, dead: 0, batches: 2, more: false });
    const after = await env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id: old.id } });
    expect(after.payload).toBeNull();
    expect(after).toMatchObject({
      status: 'abandoned',
      name: old.name,
      email: old.email,
      phone: old.phone,
      updatedAt: old.updatedAt,
    });
    expect(await env.prisma.payment.count({ where: { pendingRegistrationId: old.id } })).toBe(1);
    expect(await formOf(recent.id)).toEqual(FORM);
  });

  it('open and dead: no live payment and every checkout expired over 30 days ago; anything alive keeps its form', async () => {
    const dead = await attempt('open', 31, [expired(40), { status: 'failed', expiredDaysAgo: 35 }]);
    const keep = [
      await attempt('open', 31, [expired(20)]), // a checkout expired 20 days ago
      await attempt('open', 31, [expired(40), { status: 'pending', expiredDaysAgo: 40 }]),
      await attempt('open', 31, [{ status: 'initiated', expiredDaysAgo: 40 }]),
      await attempt('open', 29, [expired(40)]), // changed 29 days ago
    ];

    expect(await scrubWith().run(NOW)).toMatchObject({ abandoned: 0, dead: 1 });
    expect(await formOf(dead.id)).toBeNull();
    for (const a of keep) expect(await formOf(a.id)).toEqual(FORM);
  });

  it('never a conflict (an admin case) or a completed attempt', async () => {
    const conflict = await attempt('conflict', 90, [expired(90)]);
    const completed = await attempt('completed', 90);
    expect(await scrubWith().run(NOW)).toMatchObject({ abandoned: 0, dead: 0 });
    expect(await formOf(conflict.id)).toEqual(FORM);
    expect(
      await env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id: completed.id } }),
    ).toMatchObject({ status: 'completed', userId: completed.userId });
  });
});

describe('reruns, parallel runs and the cap', () => {
  it('a second run clears nothing; two at once both finish and clear each due form once', async () => {
    for (let i = 0; i < 6; i += 1) await attempt('abandoned', 40, [expired(40)]);
    for (let i = 0; i < 4; i += 1) await attempt('open', 40, [expired(40)]);
    const scrub = scrubWith({ batchSize: 2 });
    const [a, b] = await Promise.all([scrub.run(NOW), scrub.run(NOW)]);
    expect(a.abandoned + b.abandoned).toBe(6);
    expect(a.dead + b.dead).toBe(4);
    expect(await scrub.run(NOW)).toEqual({ abandoned: 0, dead: 0, batches: 2, more: false });
  });

  it('stops at the cap and says more is left', async () => {
    for (let i = 0; i < 5; i += 1) await attempt('abandoned', 40, [expired(40)]);
    const scrub = scrubWith({ batchSize: 2, maxBatches: 2 });
    expect(await scrub.run(NOW)).toMatchObject({ abandoned: 4, more: true });
    expect(await scrub.run(NOW)).toMatchObject({ abandoned: 1, more: false });
  });

  it('audits counts only', async () => {
    await attempt('abandoned', 40, [expired(40)]);
    const started = new Date();
    await scrubWith().run(NOW);
    const row = await env.prisma.auditLog.findFirstOrThrow({
      where: { action: 'housekeeping.attempt_scrub', createdAt: { gte: started } },
    });
    expect(row.meta).toEqual({ abandoned: 1, dead: 0, batches: 2, more: false });
    expect(JSON.stringify(row)).not.toContain('argon2');
  });
});

describe('money is never lost', () => {
  it('a payment that succeeds after its form was cleared is paid and set aside (attempt_invalid), with no account', async () => {
    const s = await startRegistration(env);
    const p = await env.prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } });
    // Expired by reconciliation; the student never comes back.
    await env.verifier.verify(s.paymentId, 'reconcile', new Date(p.expiresAt.getTime() + 1_000));
    expect(
      (await env.prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } })).status,
    ).toBe(PaymentStatus.expired);
    // 40 days later the nightly job clears the form of this dead attempt.
    const later = new Date(p.expiresAt.getTime() + 40 * DAY);
    expect((await scrubWith().run(later)).dead).toBeGreaterThanOrEqual(1); // this file's other rows may be due then too
    expect(await formOf(s.attemptId)).toBeNull();

    // Then PayStation reports it paid after all, and an IPN asks for a check.
    checkout(env, s.invoiceNumber).status = 'success';
    await env.verifier.verify(s.paymentId, 'ipn', later);
    expect(
      await env.prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } }),
    ).toMatchObject({
      status: PaymentStatus.paid,
      reviewReason: 'attempt_invalid',
      userId: null,
    });
    expect(
      (await env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id: s.attemptId } }))
        .status,
    ).toBe(RegistrationAttemptStatus.conflict);
    expect(await env.prisma.user.count({ where: { email: s.email } })).toBe(0);
  });
});
