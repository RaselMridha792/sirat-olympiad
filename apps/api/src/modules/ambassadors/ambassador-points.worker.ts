import { Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { EnvVars } from '../../config/env';
import { PrismaModule } from '../../prisma/prisma.module';
import { QUEUE_REDIS_OPTIONS } from '../../redis/redis.module';
import {
  AMBASSADOR_JOBS,
  AMBASSADOR_JOB_OPTIONS,
  REFERRAL_BACKFILL_SCHEDULE,
  REFERRAL_POINTS_SCHEDULE,
  ambassadorQueueName,
} from './points-queue';
import { ReferralPoints } from './referral-points';

/**
 * Worker side of ambassador points (the `worker` service, never an API replica): the referral sweep every 5 minutes
 * and the nightly back-fill. One scheduler id each, so one run per period across all workers; one job at a time.
 * Logs job names and ids only.
 */
@Injectable()
export class AmbassadorPointsWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AmbassadorPointsWorker.name);
  private connection?: Redis;
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private readonly referrals: ReferralPoints,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    const queueName = ambassadorQueueName(this.config);
    this.queue = new Queue(queueName, { connection: this.connection });
    await this.queue.upsertJobScheduler(AMBASSADOR_JOBS.referralPoints, REFERRAL_POINTS_SCHEDULE, {
      name: AMBASSADOR_JOBS.referralPoints,
      opts: AMBASSADOR_JOB_OPTIONS,
    });
    await this.queue.upsertJobScheduler(
      AMBASSADOR_JOBS.referralBackfill,
      REFERRAL_BACKFILL_SCHEDULE,
      {
        name: AMBASSADOR_JOBS.referralBackfill,
        opts: AMBASSADOR_JOB_OPTIONS,
      },
    );
    this.logger.log({ msg: 'ambassador points schedulers set', queue: queueName });
    this.worker = new Worker(queueName, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn({
        msg: 'ambassador points job failed',
        name: job?.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        ...errorLogFields(err),
      }),
    );
  }

  private async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case AMBASSADOR_JOBS.referralPoints:
        return this.referrals.run('recent');
      case AMBASSADOR_JOBS.referralBackfill:
        return this.referrals.run('full');
      default:
        throw new Error(`unknown ambassador points job ${job.name}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // lets a running sweep finish
    await this.queue?.close();
    this.connection?.disconnect();
  }
}

/** Registered in worker.ts only. */
@Module({
  imports: [PrismaModule],
  providers: [ReferralPoints, AmbassadorPointsWorker],
})
export class AmbassadorPointsWorkerModule {}
