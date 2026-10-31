import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { withTimeout } from '../../../common/with-timeout';

export type HintKind = 'hint' | 'recheck' | 'admin';

/**
 * Caps how often an outside signal can cause a status call for one payment (plan 6.4, 6.7): the callback and the IPN
 * share one key per payment (30 s), a student's recheck and an admin's recheck have their own (10 s). Unsigned IPN
 * spam therefore cannot become a flood of PayStation calls; the queue's job id adds "one verify per payment at a
 * time". Fails open, like the other limiters: a cache outage must not hide a real payment.
 */
export class VerifyHints {
  private readonly logger = new Logger('VerifyHints');

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'pay:',
  ) {}

  /** True for the first call per kind and payment inside the window. */
  async allow(kind: HintKind, paymentId: string, seconds: number): Promise<boolean> {
    if (this.redis.status !== 'ready') return true;
    try {
      const set = await withTimeout(
        this.redis.set(`${this.prefix}${kind}:${paymentId}`, '1', 'EX', seconds, 'NX'),
        300,
      );
      return set === 'OK';
    } catch (err) {
      this.logger.warn(`verify hint limiter unavailable, not limiting: ${(err as Error).name}`);
      return true;
    }
  }

  /** Gives the window back when the job could not be queued, so the next hint tries again. */
  async release(kind: HintKind, paymentId: string): Promise<void> {
    try {
      await withTimeout(this.redis.del(`${this.prefix}${kind}:${paymentId}`), 300);
    } catch {
      /* the window ends by itself */
    }
  }
}
