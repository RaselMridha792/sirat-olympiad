import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import type Redis from 'ioredis';
import { errorLogFields } from '../../../common/all-exceptions.filter';
import { withTimeout } from '../../../common/with-timeout';
import { REDIS_QUEUE } from '../../../redis/redis.module';

/** The payments queue on the queue Redis (plan 6, 6.3, 6.5). Jobs run only in the worker. */
export const PAYMENT_QUEUE = 'payments';
/** The queue's name: PAYMENT_QUEUE, or PAYMENTS_QUEUE_NAME (tests give each run its own queue). */
export const PAYMENT_QUEUE_NAME = Symbol('PAYMENT_QUEUE_NAME');
export const PAYMENT_JOBS = { verify: 'verify', reconcile: 'reconcile' } as const;
export type PaymentJobName = (typeof PAYMENT_JOBS)[keyof typeof PAYMENT_JOBS];

/** Why a status check was asked for. Kept with the job for the logs; never read as a payment status. */
export type VerifyReason = 'callback' | 'ipn' | 'recheck' | 'admin' | 'reconcile';
export interface PaymentJobData {
  paymentId?: string;
  reason?: VerifyReason;
}

/**
 * Three tries from 5 s for a job that threw (the database; an unreachable PayStation is a recorded outcome, and
 * reconciliation asks again later). A failed job is removed at once: a kept one would hold its job id
 * (`verify.<paymentId>`) and silently swallow every later hint for that payment. The worker logs each failure.
 */
export const PAYMENT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
};

/** BullMQ: 1 is the highest priority. A student on the result page goes before the reconciliation sweep. */
const PRIORITY: Record<VerifyReason, number> = {
  callback: 1,
  ipn: 1,
  recheck: 1,
  admin: 1,
  reconcile: 10,
};
const ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * Puts status checks on the queue (API and worker). One verify per payment at a time: the job id is
 * `verify.<paymentId>`, so a callback and an IPN arriving together make one status call. Never throws and gives up
 * after 2 s: a callback must still redirect and an IPN still answer when the queue is down (reconciliation catches
 * up).
 */
@Injectable()
export class PaymentQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(PaymentQueue.name);
  private readonly queue: Queue<PaymentJobData>;

  constructor(
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
    @Inject(PAYMENT_QUEUE_NAME) name: string,
  ) {
    this.queue = new Queue<PaymentJobData>(name, { connection: redis });
  }

  verify(paymentId: string, reason: VerifyReason): Promise<boolean> {
    return this.add(
      PAYMENT_JOBS.verify,
      { paymentId, reason },
      `verify.${paymentId}`,
      PRIORITY[reason],
    );
  }

  private async add(
    name: PaymentJobName,
    data: PaymentJobData,
    jobId: string,
    priority: number,
  ): Promise<boolean> {
    if (this.redis.status !== 'ready') {
      this.logger.error({ msg: 'payment job not queued: queue Redis not ready', name, jobId });
      return false;
    }
    try {
      await withTimeout(
        this.queue.add(name, data, { ...PAYMENT_JOB_OPTIONS, jobId, priority }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (e) {
      this.logger.error({ msg: 'payment job not queued', name, jobId, ...errorLogFields(e) });
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
