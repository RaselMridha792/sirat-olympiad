import { PaymentStatus } from '@prisma/client';

/**
 * The payment state machine (plan section 5). The database trigger payments_status_transition enforces the same
 * table; payment-state.int-spec.ts checks every pair against it, so the two cannot drift apart.
 * - initiated -> pending (checkout URL received) | failed (initiate refused, or nothing reached the student)
 * - pending -> paid | failed | expired
 * - failed, expired -> paid: money taken wins (a late success, or an admin reconcile)
 * - refunded is never entered: there is no refund handling (owner, 2026-10-31)
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.initiated]: [PaymentStatus.pending, PaymentStatus.failed],
  [PaymentStatus.pending]: [PaymentStatus.paid, PaymentStatus.failed, PaymentStatus.expired],
  [PaymentStatus.failed]: [PaymentStatus.paid],
  [PaymentStatus.expired]: [PaymentStatus.paid],
  [PaymentStatus.paid]: [],
  [PaymentStatus.refunded]: [],
};

/** True when `from -> to` is a change the state machine allows (a same-status write is not a transition). */
export function isAllowedTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from !== to && PAYMENT_TRANSITIONS[from].includes(to);
}

/** A payment that may still turn into money: worth asking PayStation about. */
export function isActive(status: PaymentStatus): boolean {
  return status === PaymentStatus.initiated || status === PaymentStatus.pending;
}
