/**
 * Payments' demo generator (DECISIONS 2026-11-08 "Demo payments stay out of the money flow"): on a batch of demo users
 * it writes attempts, payments in every state, registrations and unshipped free-book orders, all with the demo markers,
 * no payment events and no audit rows, every row registered; and demo_clear then removes exactly those rows. The
 * framework's context is faked here (exam's seeded random source, the registry written directly); exam's loader runs the
 * same generator inside its one transaction (DEMO_GENERATORS).
 */
import { randomUUID } from 'node:crypto';
import { PaymentStatus, type PrismaClient } from '@prisma/client';
import { DEMO_ACCOUNT_LABEL, DEMO_EMAIL_DOMAIN } from '@sirat/shared';
import { seedConfig } from '../prisma/seed';
import { demoRandom } from '../src/modules/demo/demo-random';
import type { DemoContext, DemoUser } from '../src/modules/demo/demo.types';
import { paymentsAllowDemo } from '../src/modules/payments/demo/allow-demo';
import { isDemoPayment } from '../src/modules/payments/demo/demo-payment';
import { paymentsDemoGenerator } from '../src/modules/payments/demo/payments.demo';
import type { PaymentConfig } from '../src/modules/payments/payment.config';
import { applyReferenceData, testPrisma, truncateAll } from './helpers';

const STUDENTS = 100;
const AMBASSADORS = 4;
const MINUTE = 60_000;

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = testPrisma();
  await truncateAll(prisma);
  await applyReferenceData(prisma);
  await seedConfig(prisma);
});

afterAll(async () => {
  // A test that failed half-way leaves its batch, and only one may exist (exam's demo_batches_one_at_a_time): clear it
  // the normal way, or, if a half-written batch refuses, empty this *_test database (truncateAll refuses any other).
  try {
    for (const { id } of await prisma.demoBatch.findMany({ select: { id: true } })) {
      await prisma.demoBatch.update({ where: { id }, data: { status: 'loaded' } });
      await prisma.$queryRaw`SELECT demo_clear(${id}::uuid)`;
    }
  } catch {
    await truncateAll(prisma);
  }
  await prisma?.$disconnect();
});

/** A batch with demo accounts, as the users generator leaves them (marked and registered). */
async function demoBatch() {
  const batch = await prisma.demoBatch.create({
    data: { status: 'loading', reason: 'Generator test' },
  });
  const run = randomUUID().slice(0, 6);
  const account = (i: number, role: 'student' | 'ambassador'): DemoUser => ({
    id: randomUUID(),
    email: `${role[0]}${i}-${run}@${DEMO_EMAIL_DOMAIN}`,
    phone: `017${String(i + (role === 'ambassador' ? 50_000_000 : 0)).padStart(8, '0')}`,
    name: `Demo ${role} ${i}`,
    role,
    district: i % 3 === 0 ? 'Nowhere' : 'Dhaka', // the generator falls back to a real district
    institution: 'Demo School',
    educationType: 'general',
    gradeLevelId: null,
    category: null,
  });
  const students = Array.from({ length: STUDENTS }, (_, i) => account(i, 'student'));
  const ambassadors = Array.from({ length: AMBASSADORS }, (_, i) => account(i, 'ambassador'));
  await prisma.user.createMany({
    data: [...students, ...ambassadors].map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      name: u.name,
      role: u.role,
      passwordHash: 'not-a-real-hash',
      demoBatchId: batch.id,
    })),
  });
  await prisma.demoRecord.createMany({
    data: [...students, ...ambassadors].map((u) => ({
      batchId: batch.id,
      tableName: 'users',
      rowId: u.id,
    })),
  });
  return { batch, students, ambassadors };
}

describe('paymentsDemoGenerator', () => {
  it('writes every payment state with the demo markers, no events or audit rows, registers every row, and demo_clear removes them all', async () => {
    const { batch, students, ambassadors } = await demoBatch();
    const auditBefore = await prisma.auditLog.count();
    const eventsBefore = await prisma.paymentEvent.count();
    const now = new Date();

    await prisma.$transaction(
      async (tx) => {
        const ctx: DemoContext = {
          tx,
          batchId: batch.id,
          now,
          rng: demoRandom(20261108),
          passwordHash: 'not-a-real-hash',
          users: { students, ambassadors, jury: [] },
          exams: { practice: null, round1: null },
          register: async (table, ids) => {
            await tx.demoRecord.createMany({
              data: ids.map((rowId) => ({ batchId: batch.id, tableName: table, rowId })),
            });
          },
          progress: async () => undefined,
        };
        await paymentsDemoGenerator.load(ctx);
      },
      { timeout: 60_000 },
    );
    await prisma.demoBatch.update({ where: { id: batch.id }, data: { status: 'loaded' } });

    // Every state; the shares of 100 students, plus the 4 ambassadors, who are always paid and registered.
    const payments = await prisma.payment.findMany();
    const byStatus = (s: PaymentStatus) => payments.filter((p) => p.status === s);
    expect(byStatus(PaymentStatus.paid)).toHaveLength(80 + 2 + AMBASSADORS);
    expect(byStatus(PaymentStatus.failed)).toHaveLength(5);
    expect(byStatus(PaymentStatus.expired)).toHaveLength(5);
    expect(byStatus(PaymentStatus.pending)).toHaveLength(3);
    expect(byStatus(PaymentStatus.initiated)).toHaveLength(0);
    expect(payments.filter((p) => p.reviewReason === 'refund_reported')).toHaveLength(2);
    for (const p of payments) {
      expect(p).toMatchObject({
        gatewayAccount: DEMO_ACCOUNT_LABEL,
        gatewayEnv: 'demo',
        paymentUrl: null,
        amountMinor: 40000,
      });
      expect(isDemoPayment(p)).toBe(true);
      expect(p.invoiceNumber).toMatch(/^DEMO\d{6}[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(p.createdAt.getTime()).toBeLessThan(now.getTime());
      if (p.status === PaymentStatus.paid) {
        expect(p.trxId).toMatch(/^DEMO\d{18}$/);
        expect(p.paidAmountMinor).toBe(40000);
        expect(p.paidAt!.getTime()).toBeLessThan(now.getTime());
      } else expect(p.trxId).toBeNull();
    }
    // A pending demo payment looks fresh (minutes old), and none can be resumed or watched (no checkout link).
    for (const p of byStatus(PaymentStatus.pending))
      expect(now.getTime() - p.createdAt.getTime()).toBeLessThan(10 * MINUTE);

    // Registrations for exactly the paid ones (refunded included), each on its own user's paid payment.
    const registrations = await prisma.registration.findMany({ include: { payment: true } });
    expect(registrations).toHaveLength(80 + 2 + AMBASSADORS);
    for (const r of registrations) {
      expect(r.payment.status).toBe(PaymentStatus.paid);
      expect(r.payment.userId).toBe(r.userId);
    }
    const registered = new Set(registrations.map((r) => r.userId));
    for (const a of ambassadors) expect(registered.has(a.id)).toBe(true);

    // Attempts: completed with the account for the paid ones, open with no account for the rest.
    const attempts = await prisma.pendingRegistration.findMany();
    expect(attempts).toHaveLength(payments.length);
    expect(attempts.filter((a) => a.status === 'completed' && a.userId)).toHaveLength(
      registrations.length,
    );
    expect(attempts.filter((a) => a.status === 'open' && a.userId === null)).toHaveLength(13);

    // Book orders: for 60% of the plain paid (never a refunded one), confirmed, never shipped.
    const orders = await prisma.bookOrder.findMany({
      include: { registration: { include: { payment: true } } },
    });
    expect(orders).toHaveLength(Math.round((80 + AMBASSADORS) * 0.6));
    for (const o of orders) {
      expect(o).toMatchObject({ status: 'confirmed', shippedAt: null, shippedBy: null });
      expect(o.bookTitle).toBe('Sirat Leadership Olympiad book');
      expect(o.registration.payment.reviewReason).toBeNull();
      expect(o.confirmedAt.getTime()).toBeLessThan(now.getTime());
    }

    // Nothing in the append-only tables (they could never be cleared), and the demo money never counts as real.
    expect(await prisma.paymentEvent.count()).toBe(eventsBefore);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    const config = { enabled: true, env: 'sandbox' } as PaymentConfig;
    expect(await paymentsAllowDemo(prisma, config)).toEqual({ ok: true });

    // Every row registered for the batch: the admin card's counts come from the registry (exam's demoCounts).
    const registry = await prisma.demoRecord.groupBy({
      by: ['tableName'],
      where: { batchId: batch.id },
      _count: { _all: true },
    });
    const registeredCount = Object.fromEntries(registry.map((r) => [r.tableName, r._count._all]));
    expect(registeredCount).toMatchObject({
      pending_registrations: attempts.length,
      payments: payments.length,
      registrations: registrations.length,
      book_orders: orders.length,
    });

    // demo_clear takes all of it; nothing is left behind.
    const [cleared] = await prisma.$queryRaw<{ counts: Record<string, number> }[]>`
      SELECT demo_clear(${batch.id}::uuid) AS counts`;
    expect(cleared!.counts).toMatchObject({
      book_orders: orders.length,
      registrations: registrations.length,
      payments: payments.length,
      pending_registrations: attempts.length,
      users: STUDENTS + AMBASSADORS,
    });
    expect(
      await Promise.all([
        prisma.bookOrder.count(),
        prisma.registration.count(),
        prisma.payment.count(),
        prisma.pendingRegistration.count(),
        prisma.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } }),
        prisma.demoBatch.count(),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
