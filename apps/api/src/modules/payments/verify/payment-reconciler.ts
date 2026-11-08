import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PaymentConfig } from '../payment.config';
import { PAYMENT_CONFIG } from '../payments-boot-check';
import { PaymentQueue } from './payment-queue';
import { PAYMENT_TIMING } from './payment-timing';

/**
 * Reconciliation (plan 6.5): the safety net for a closed tab, a lost callback or a missing IPN. Each run claims up
 * to 100 payments of the current PayStation account, least recently checked first, and queues one verify each:
 * - initiated/pending older than 2 minutes (expiry happens inside the verify job, so PayStation is asked once more);
 * - failed/expired that reached a checkout, until 48 hours after their expiry (a late success is money taken).
 * Back-off by check_count: 2, 2, 5, 10, then every 30 minutes. The claim (last_checked_at) is a short transaction
 * with SKIP LOCKED, so two workers never claim the same payment.
 */
@Injectable()
export class PaymentReconciler {
  private readonly logger = new Logger('PaymentReconciler');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_CONFIG) private readonly config: PaymentConfig,
    private readonly queue: PaymentQueue,
  ) {}

  async run(now = new Date()): Promise<{ claimed: number; queued: number }> {
    if (!this.config.enabled) return { claimed: 0, queued: 0 };
    const account = this.config.accountLabel;
    const startedBefore = new Date(now.getTime() - PAYMENT_TIMING.minAgeMs);
    const expiredAfter = new Date(now.getTime() - PAYMENT_TIMING.lateWatchMs);
    const ids = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payments
        WHERE gateway_account = ${account}
          AND gateway_env <> 'demo' -- demo data is never sent to PayStation (demo-payment.ts)
          AND (
            (status IN ('initiated', 'pending') AND created_at <= ${startedBefore}::timestamptz)
            OR (status IN ('failed', 'expired') AND payment_url IS NOT NULL
                AND expires_at > ${expiredAfter}::timestamptz)
          )
          AND (
            last_checked_at IS NULL
            OR last_checked_at <= ${now}::timestamptz - make_interval(mins => CASE
              WHEN check_count <= 2 THEN 2
              WHEN check_count = 3 THEN 5
              WHEN check_count = 4 THEN 10
              ELSE 30
            END)
          )
        ORDER BY last_checked_at ASC NULLS FIRST, created_at ASC
        LIMIT ${PAYMENT_TIMING.reconcileBatch}
        FOR UPDATE SKIP LOCKED`;
      const claimed = rows.map((r) => r.id);
      if (claimed.length > 0)
        await tx.payment.updateMany({
          where: { id: { in: claimed } },
          data: { lastCheckedAt: now },
        });
      return claimed;
    });
    let queued = 0;
    for (const id of ids) if (await this.queue.verify(id, 'reconcile')) queued += 1;
    if (ids.length > 0) this.logger.log({ msg: 'reconciliation run', claimed: ids.length, queued });
    return { claimed: ids.length, queued };
  }
}
