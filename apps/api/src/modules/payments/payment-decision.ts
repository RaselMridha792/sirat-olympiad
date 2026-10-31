import { PaymentStatus } from '@prisma/client';
import type { StatusResult } from './gateway/payment-gateway';

/**
 * What a PayStation status answer means for one payment (plan 6.3, DECISIONS "PayStation, from the official docs",
 * "Gateway charge", "No refund handling"). A pure function: the verify job (step 6) applies the action in a
 * transaction under a row lock and records the outcome in payment_events.
 * - paid only with a non-empty trx_id not used by another payment, our invoice (and our reference when echoed), and
 *   payment_amount exactly equal to the payment's own amount_minor (the merchant bears the charge);
 * - "failed" fails only an active payment; a stale "failed" never downgrades paid;
 * - "refund" never changes a paid payment: refund_reported, critical alert;
 * - 2001, unknown codes, unknown trx_status and timeouts change nothing, except that an active payment past its
 *   expiry with no success becomes expired (initiated: failed, since initiated -> expired is not a transition).
 */
export type DecisionAction = 'mark_paid' | 'mark_failed' | 'mark_expired' | 'none';

export type DecisionOutcome =
  | 'applied_paid'
  /** Only from the admin reconcile (AdminPaymentsService), never from decide(). */
  | 'manual_paid'
  | 'applied_failed'
  | 'applied_expired'
  | 'refund_reported'
  | 'no_change'
  | 'duplicate'
  | 'rejected_amount'
  | 'rejected_invoice'
  | 'not_found_2001'
  | 'unknown_status'
  | 'unavailable';

export type Decision = {
  action: DecisionAction;
  outcome: DecisionOutcome;
  alert: 'critical' | 'warn' | null;
  /** Shown in the admin review list. */
  reviewReason?: string;
  /** Set with mark_paid. */
  trxId?: string;
  paidAmountMinor?: number;
  /** The raw trx_status to store on the payment, when PayStation sent one. */
  gatewayStatus?: string;
};

export type PaymentSnapshot = {
  id: string;
  status: PaymentStatus;
  invoiceNumber: string;
  amountMinor: number;
  trxId: string | null;
  expiresAt: Date;
};

export type DecisionContext = {
  now: Date;
  /** True when this trx_id already belongs to ANOTHER payment (UNIQUE would refuse it anyway). */
  trxIdUsedElsewhere: boolean;
};

const SUCCESS = new Set(['success', 'successful']);
const STILL_OPEN = new Set(['processing', 'pending', 'initiated']);

function expiryOr(
  payment: PaymentSnapshot,
  now: Date,
  fallback: Decision,
  expiredAlert: Decision['alert'],
): Decision {
  if (now < payment.expiresAt) return fallback;
  if (payment.status === PaymentStatus.pending)
    return { ...fallback, action: 'mark_expired', outcome: 'applied_expired', alert: expiredAlert };
  if (payment.status === PaymentStatus.initiated)
    return { ...fallback, action: 'mark_failed', outcome: 'applied_failed', alert: expiredAlert };
  return fallback;
}

export function decide(
  payment: PaymentSnapshot,
  result: StatusResult,
  ctx: DecisionContext,
): Decision {
  if (result.kind === 'unavailable') return { action: 'none', outcome: 'unavailable', alert: null };
  if (result.kind === 'not_found_or_auth')
    return expiryOr(
      payment,
      ctx.now,
      { action: 'none', outcome: 'not_found_2001', alert: null },
      'warn',
    );
  if (result.kind === 'other')
    return expiryOr(
      payment,
      ctx.now,
      { action: 'none', outcome: 'unknown_status', alert: 'warn' },
      'warn',
    );

  const gatewayStatus = result.trxStatus || undefined;
  const base = { gatewayStatus };
  if (
    result.invoiceNumber !== payment.invoiceNumber ||
    (result.reference && result.reference !== payment.id)
  )
    return {
      ...base,
      action: 'none',
      outcome: 'rejected_invoice',
      alert: 'critical',
      reviewReason: 'invoice_mismatch',
    };

  const trx = result.trxStatus;
  if (SUCCESS.has(trx)) {
    if (payment.status === PaymentStatus.paid) {
      return payment.trxId === result.trxId
        ? { ...base, action: 'none', outcome: 'duplicate', alert: null }
        : {
            ...base,
            action: 'none',
            outcome: 'no_change',
            alert: 'critical',
            reviewReason: 'paid_trx_mismatch',
          };
    }
    if (!result.trxId)
      return {
        ...base,
        action: 'none',
        outcome: 'unknown_status',
        alert: 'warn',
        reviewReason: 'success_without_trx_id',
      };
    if (ctx.trxIdUsedElsewhere)
      return {
        ...base,
        action: 'none',
        outcome: 'duplicate',
        alert: 'critical',
        reviewReason: 'trx_id_reused',
      };
    if (result.paymentMinor !== payment.amountMinor)
      return {
        ...base,
        action: 'none',
        outcome: 'rejected_amount',
        alert: 'critical',
        reviewReason: 'amount_mismatch',
      };
    const late =
      payment.status === PaymentStatus.failed || payment.status === PaymentStatus.expired;
    return {
      ...base,
      action: 'mark_paid',
      outcome: 'applied_paid',
      alert: late ? 'warn' : null,
      reviewReason: late ? 'late_success' : undefined,
      trxId: result.trxId,
      paidAmountMinor: result.paymentMinor,
    };
  }
  if (trx === 'failed') {
    if (payment.status === PaymentStatus.paid)
      return {
        ...base,
        action: 'none',
        outcome: 'no_change',
        alert: 'warn',
        reviewReason: 'failed_after_paid',
      };
    if (payment.status === PaymentStatus.initiated || payment.status === PaymentStatus.pending)
      return { ...base, action: 'mark_failed', outcome: 'applied_failed', alert: null };
    return { ...base, action: 'none', outcome: 'no_change', alert: null };
  }
  if (trx === 'refund') {
    if (payment.status === PaymentStatus.paid)
      return {
        ...base,
        action: 'none',
        outcome: 'refund_reported',
        alert: 'critical',
        reviewReason: 'refund_reported',
      };
    return { ...base, action: 'none', outcome: 'unknown_status', alert: 'warn' };
  }
  if (STILL_OPEN.has(trx))
    return expiryOr(
      payment,
      ctx.now,
      { ...base, action: 'none', outcome: 'no_change', alert: null },
      null,
    );
  return expiryOr(
    payment,
    ctx.now,
    { ...base, action: 'none', outcome: 'unknown_status', alert: 'warn' },
    'warn',
  );
}
