import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { errorLogFields } from '../../../common/all-exceptions.filter';
import type { EnvVars } from '../../../config/env';
import { QUEUE_REDIS_OPTIONS } from '../../../redis/redis.module';
import { PaymentReconciler } from './payment-reconciler';
import {
  PAYMENT_JOBS,
  PAYMENT_JOB_OPTIONS,
  PAYMENT_QUEUE,
  type PaymentJobData,
} from './payment-queue';
import { PAYMENT_TIMING } from './payment-timing';
import { PaymentVerifier } from './payment-verifier';

/** Status calls at the same time per worker process: caps the load we put on PayStation. */
export const PAYMENT_CONCURRENCY = 4;
const RECONCILE_SCHEDULER_ID = 'payments-reconcile';

/**
 * Worker side of payments (runs in the `worker` service, never in an API replica): verify jobs and the
 * reconciliation scheduler (one scheduler, so one run per interval across all workers). Logs job names, ids and
 * outcomes only, never personal data or gateway bodies.
 */
@Injectable()
export class PaymentsWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentsWorker.name);
  private connection?: Redis;
  private worker?: Worker<PaymentJobData>;
  private queue?: Queue<PaymentJobData>;

  constructor(
    private readonly verifier: PaymentVerifier,
    private readonly reconciler: PaymentReconciler,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    this.queue = new Queue<PaymentJobData>(PAYMENT_QUEUE, { connection: this.connection });
    await this.queue.upsertJobScheduler(
      RECONCILE_SCHEDULER_ID,
      { every: PAYMENT_TIMING.reconcileEveryMs },
      { name: PAYMENT_JOBS.reconcile, opts: { ...PAYMENT_JOB_OPTIONS, attempts: 1 } },
    );
    this.worker = new Worker<PaymentJobData>(PAYMENT_QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: PAYMENT_CONCURRENCY,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn({
        msg: 'payment job failed',
        name: job?.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        ...errorLogFields(err),
      }),
    );
  }

  private async process(job: Job<PaymentJobData>): Promise<unknown> {
    switch (job.name) {
      case PAYMENT_JOBS.verify:
        return job.data.paymentId
          ? this.verifier.verify(job.data.paymentId, job.data.reason ?? 'reconcile')
          : 'no_payment';
      case PAYMENT_JOBS.reconcile:
        return this.reconciler.run();
      default:
        throw new Error(`unknown payment job ${job.name}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // lets running jobs finish
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
