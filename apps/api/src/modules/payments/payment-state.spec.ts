import { PaymentStatus } from '@prisma/client';
import { isActive, isAllowedTransition } from './payment-state';

const ALLOWED = new Set([
  'initiated>pending',
  'initiated>failed',
  'pending>paid',
  'pending>failed',
  'pending>expired',
  'failed>paid',
  'expired>paid',
]);

describe('payment state machine (plan section 5)', () => {
  const statuses = Object.values(PaymentStatus);

  it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))(
    '%s -> %s',
    (from, to) => {
      expect(isAllowedTransition(from, to)).toBe(ALLOWED.has(`${from}>${to}`));
    },
  );

  it('never enters refunded and never leaves paid (no refund handling, owner)', () => {
    for (const from of statuses)
      expect(isAllowedTransition(from, PaymentStatus.refunded)).toBe(false);
    for (const to of statuses) expect(isAllowedTransition(PaymentStatus.paid, to)).toBe(false);
  });

  it('treats only initiated and pending as active', () => {
    expect(statuses.filter(isActive)).toEqual([PaymentStatus.initiated, PaymentStatus.pending]);
  });
});
