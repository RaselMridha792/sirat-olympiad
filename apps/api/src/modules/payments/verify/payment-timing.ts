import { PaymentStatus } from '@prisma/client';

/**
 * When PayStation is asked again about a payment (plan 6.2–6.5). Constants, not env: they follow from the plan and
 * the sandbox, and tests pass their own clock instead of shorter values.
 */
export const PAYMENT_TIMING = {
  /** A failed or expired checkout is still watched this long after its expiry: a late success is money taken. */
  lateWatchMs: 48 * 3_600_000,
  /** Reconciliation leaves a payment alone this long after it started: the callback and the IPN usually come first. */
  minAgeMs: 2 * 60_000,
  /** How often the reconciliation job runs (one scheduler, so one run at a time across workers). */
  reconcileEveryMs: 2 * 60_000,
  /** Payments one reconciliation run claims; at most this many status calls per run. */
  reconcileBatch: 100,
  /** One callback/IPN-triggered verify per invoice per this window (cache Redis). */
  hintWindowSeconds: 30,
  /** One recheck per payment per this window, for a student and for an admin. */
  recheckWindowSeconds: 10,
} as const;

/**
 * Worth asking PayStation about: an active payment, or a failed/expired one that reached a checkout and is still
 * inside the late watch. A paid payment is asked about only by an admin recheck (to see a reported refund).
 */
export function isWatched(
  payment: { status: PaymentStatus; expiresAt: Date; paymentUrl: string | null },
  now: Date,
): boolean {
  if (payment.status === PaymentStatus.initiated || payment.status === PaymentStatus.pending)
    return true;
  if (payment.status !== PaymentStatus.failed && payment.status !== PaymentStatus.expired)
    return false;
  return (
    payment.paymentUrl !== null &&
    now.getTime() < payment.expiresAt.getTime() + PAYMENT_TIMING.lateWatchMs
  );
}
