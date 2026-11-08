/**
 * The TypeScript state machine (payment-state.ts) and the database trigger (payments_status_transition) must agree
 * on every pair, so a later change to one without the other fails here.
 */
import { randomUUID } from 'node:crypto';
import { PaymentStatus, type PrismaClient } from '@prisma/client';
import { isAllowedTransition } from '../src/modules/payments/payment-state';
import {
  applyReferenceData,
  makeRegistrationAttempt,
  paymentData,
  testPrisma,
  truncateAll,
} from './helpers';

const prisma: PrismaClient = testPrisma();
// The reference data goes back at once: suites that run later on a reused test database need it (Round 1, grades).
beforeAll(async () => {
  await truncateAll(prisma);
  await applyReferenceData(prisma);
});
afterAll(() => prisma.$disconnect());

const paidFields = () => ({
  trxId: `TRX${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
  paidAmountMinor: 40000,
  paidAt: new Date(),
});

/** A payment brought to `status` along legal transitions (refunded cannot be reached). */
async function paymentIn(status: PaymentStatus) {
  const attempt = await makeRegistrationAttempt(prisma);
  const p = await prisma.payment.create({ data: paymentData(attempt.id) });
  if (status === PaymentStatus.initiated) return p;
  await prisma.payment.update({ where: { id: p.id }, data: { status: PaymentStatus.pending } });
  if (status === PaymentStatus.pending) return p;
  return prisma.payment.update({
    where: { id: p.id },
    data: { status, ...(status === PaymentStatus.paid ? paidFields() : {}) },
  });
}

const reachable = Object.values(PaymentStatus).filter((s) => s !== PaymentStatus.refunded);
const pairs = reachable.flatMap((from) =>
  Object.values(PaymentStatus)
    .filter((to) => to !== from)
    .map((to) => [from, to] as const),
);

it.each(pairs)('%s -> %s: the trigger agrees with payment-state.ts', async (from, to) => {
  const p = await paymentIn(from);
  let accepted = true;
  try {
    await prisma.payment.update({
      where: { id: p.id },
      data: { status: to, ...(to === PaymentStatus.paid ? paidFields() : {}) },
    });
  } catch {
    accepted = false;
  }
  expect(accepted).toBe(isAllowedTransition(from, to));
});
