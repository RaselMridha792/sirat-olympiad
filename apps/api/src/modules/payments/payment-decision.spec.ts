import { PaymentStatus } from '@prisma/client';
import type { StatusResult } from './gateway/payment-gateway';
import { decide, type PaymentSnapshot } from './payment-decision';

const NOW = new Date('2026-11-04T10:00:00Z');
const LATER = new Date('2026-11-04T12:00:00Z'); // after expiry

const payment = (over: Partial<PaymentSnapshot> = {}): PaymentSnapshot => ({
  id: '0190f0d0-0000-7000-8000-000000000001',
  status: PaymentStatus.pending,
  invoiceNumber: 'T26110412345ABCDEF',
  amountMinor: 40000,
  trxId: null,
  expiresAt: new Date('2026-11-04T11:00:00Z'),
  ...over,
});
const found = (over: Partial<Extract<StatusResult, { kind: 'found' }>> = {}): StatusResult => ({
  kind: 'found',
  invoiceNumber: 'T26110412345ABCDEF',
  trxStatus: 'success',
  trxId: 'TRX123',
  paymentMinor: 40000,
  reference: null,
  paymentMethod: 'bkash',
  raw: null,
  ...over,
});
const ctx = { now: NOW, trxIdUsedElsewhere: false };

describe('decide: success', () => {
  it.each(['success', 'successful'])('%s with everything matching -> paid', (trxStatus) => {
    expect(decide(payment(), found({ trxStatus }), ctx)).toMatchObject({
      action: 'mark_paid',
      outcome: 'applied_paid',
      alert: null,
      trxId: 'TRX123',
      paidAmountMinor: 40000,
      gatewayStatus: trxStatus,
    });
  });

  it('an initiated payment can be paid too (the executor moves it through pending)', () => {
    expect(decide(payment({ status: PaymentStatus.initiated }), found(), ctx).action).toBe(
      'mark_paid',
    );
  });

  it.each([PaymentStatus.failed, PaymentStatus.expired])(
    'a late success on a %s payment is paid, flagged late_success (money taken wins)',
    (status) => {
      expect(decide(payment({ status }), found(), { ...ctx, now: LATER })).toMatchObject({
        action: 'mark_paid',
        alert: 'warn',
        reviewReason: 'late_success',
      });
    },
  );

  it.each([
    ['one paisa less', 39999],
    ['one paisa more', 40001],
    ['400 plus a typical charge', 40740],
    ['missing', null],
  ])('amount %s -> never paid: rejected_amount, critical', (_label, paymentMinor) => {
    expect(decide(payment(), found({ paymentMinor }), ctx)).toMatchObject({
      action: 'none',
      outcome: 'rejected_amount',
      alert: 'critical',
    });
  });

  it('another invoice number, or another reference echoed back -> rejected_invoice, critical', () => {
    for (const result of [
      found({ invoiceNumber: 'T26110499999ZZZZZZ' }),
      found({ reference: '0190f0d0-0000-7000-8000-00000000ffff' }),
    ]) {
      expect(decide(payment(), result, ctx)).toMatchObject({
        action: 'none',
        outcome: 'rejected_invoice',
        alert: 'critical',
      });
    }
    expect(decide(payment(), found({ reference: payment().id }), ctx).action).toBe('mark_paid');
  });

  it('no trx_id -> nothing changes; a trx_id of another payment -> critical', () => {
    expect(decide(payment(), found({ trxId: null }), ctx)).toMatchObject({
      action: 'none',
      outcome: 'unknown_status',
    });
    expect(decide(payment(), found(), { ...ctx, trxIdUsedElsewhere: true })).toMatchObject({
      action: 'none',
      outcome: 'duplicate',
      alert: 'critical',
    });
  });

  it('already paid: the same trx_id is a duplicate; another one is critical', () => {
    const paid = payment({ status: PaymentStatus.paid, trxId: 'TRX123' });
    expect(decide(paid, found(), ctx)).toMatchObject({
      action: 'none',
      outcome: 'duplicate',
      alert: null,
    });
    expect(decide(paid, found({ trxId: 'TRX999' }), ctx)).toMatchObject({
      action: 'none',
      alert: 'critical',
      reviewReason: 'paid_trx_mismatch',
    });
  });
});

describe('decide: failed, refund, open and unknown answers', () => {
  it('failed fails an active payment only; a stale failed never downgrades paid', () => {
    expect(decide(payment(), found({ trxStatus: 'failed' }), ctx).action).toBe('mark_failed');
    expect(
      decide(payment({ status: PaymentStatus.initiated }), found({ trxStatus: 'failed' }), ctx)
        .action,
    ).toBe('mark_failed');
    expect(
      decide(
        payment({ status: PaymentStatus.paid, trxId: 'TRX123' }),
        found({ trxStatus: 'failed' }),
        ctx,
      ),
    ).toMatchObject({ action: 'none', alert: 'warn', reviewReason: 'failed_after_paid' });
    expect(
      decide(payment({ status: PaymentStatus.expired }), found({ trxStatus: 'failed' }), ctx)
        .action,
    ).toBe('none');
  });

  it('refund on a paid payment changes nothing: refund_reported, critical (no refund handling)', () => {
    expect(
      decide(
        payment({ status: PaymentStatus.paid, trxId: 'TRX123' }),
        found({ trxStatus: 'refund' }),
        ctx,
      ),
    ).toEqual({
      action: 'none',
      outcome: 'refund_reported',
      alert: 'critical',
      reviewReason: 'refund_reported',
      gatewayStatus: 'refund',
    });
  });

  it('processing stays pending until expiry, then expires (initiated: fails)', () => {
    const processing = found({ trxStatus: 'processing', trxId: null });
    expect(decide(payment(), processing, ctx)).toMatchObject({
      action: 'none',
      outcome: 'no_change',
    });
    expect(decide(payment(), processing, { ...ctx, now: LATER })).toMatchObject({
      action: 'mark_expired',
      outcome: 'applied_expired',
      alert: null,
    });
    expect(
      decide(payment({ status: PaymentStatus.initiated }), processing, { ...ctx, now: LATER })
        .action,
    ).toBe('mark_failed');
  });

  it('an unknown trx_status is neither paid nor failed: alert, and expiry still applies', () => {
    const odd = found({ trxStatus: 'on hold' });
    expect(decide(payment(), odd, ctx)).toMatchObject({
      action: 'none',
      outcome: 'unknown_status',
      alert: 'warn',
    });
    expect(decide(payment(), odd, { ...ctx, now: LATER })).toMatchObject({
      action: 'mark_expired',
      alert: 'warn',
    });
  });

  it('2001 is never failed; past expiry the payment expires with an alert', () => {
    const notFound: StatusResult = { kind: 'not_found_or_auth', statusCode: '2001', raw: null };
    expect(decide(payment(), notFound, ctx)).toEqual({
      action: 'none',
      outcome: 'not_found_2001',
      alert: null,
    });
    expect(decide(payment(), notFound, { ...ctx, now: LATER })).toMatchObject({
      action: 'mark_expired',
      alert: 'warn',
    });
    expect(
      decide(payment({ status: PaymentStatus.paid }), notFound, { ...ctx, now: LATER }).action,
    ).toBe('none');
  });

  it('timeouts and other codes change nothing (an unavailable gateway never expires a payment)', () => {
    for (const reason of ['timeout', 'network', 'http', 'bad_response'] as const) {
      expect(
        decide(payment(), { kind: 'unavailable', reason, raw: null }, { ...ctx, now: LATER }),
      ).toEqual({ action: 'none', outcome: 'unavailable', alert: null });
    }
    expect(decide(payment(), { kind: 'other', statusCode: '5000', raw: null }, ctx)).toMatchObject({
      action: 'none',
      outcome: 'unknown_status',
      alert: 'warn',
    });
  });
});
