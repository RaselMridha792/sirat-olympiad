import { Inject, Injectable } from '@nestjs/common';
import { PaymentQueue, type VerifyReason } from './payment-queue';
import { PAYMENT_TIMING } from './payment-timing';
import { type HintKind, VerifyHints } from './verify-hints';

export type VerifyRequestResult = 'requested' | 'throttled' | 'not_queued';

/** Injected VerifyHints instance (cache Redis). */
export const VERIFY_HINTS = Symbol('VERIFY_HINTS');

const WINDOW: Record<Exclude<VerifyReason, 'reconcile'>, [HintKind, number]> = {
  callback: ['hint', PAYMENT_TIMING.hintWindowSeconds],
  ipn: ['hint', PAYMENT_TIMING.hintWindowSeconds],
  recheck: ['recheck', PAYMENT_TIMING.recheckWindowSeconds],
  admin: ['admin', PAYMENT_TIMING.recheckWindowSeconds],
};

/**
 * Asks the worker for a status check on behalf of an outside signal: the throttle window first, then the queue.
 * Never throws. Reconciliation queues directly (it has its own claim and back-off).
 */
@Injectable()
export class VerifyRequests {
  constructor(
    private readonly queue: PaymentQueue,
    @Inject(VERIFY_HINTS) private readonly hints: VerifyHints,
  ) {}

  async request(
    paymentId: string,
    reason: Exclude<VerifyReason, 'reconcile'>,
  ): Promise<VerifyRequestResult> {
    const [kind, seconds] = WINDOW[reason];
    if (!(await this.hints.allow(kind, paymentId, seconds))) return 'throttled';
    if (await this.queue.verify(paymentId, reason)) return 'requested';
    await this.hints.release(kind, paymentId);
    return 'not_queued';
  }
}
