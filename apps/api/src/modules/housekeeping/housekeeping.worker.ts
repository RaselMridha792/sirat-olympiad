import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { EnvVars } from '../../config/env';
import { QUEUE_REDIS_OPTIONS } from '../../redis/redis.module';
import {
  HOUSEKEEPING_JOBS,
  HOUSEKEEPING_JOB_OPTIONS,
  HOUSEKEEPING_SCHEDULES,
  housekeepingQueueName,
} from './housekeeping-queue';
import { AttemptScrub } from './attempt-scrub';
import { SessionCleanup } from './session-cleanup';

/**
 * Worker side of housekeeping (the `worker` service, never an API replica): the nightly session and token cleanup and
 * the registration form's retention.
 * One scheduler id per job, so one run per night across all workers; one job at a time. Logs job names and ids only.
 */
@Injectable()
export class HousekeepingWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(HousekeepingWorker.name);
  private connection?: Redis;
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private readonly cleanup: SessionCleanup,
    private readonly scrub: AttemptScrub,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    const queueName = housekeepingQueueName(this.config);
    this.queue = new Queue(queueName, { connection: this.connection });
    for (const { id, schedule, job } of HOUSEKEEPING_SCHEDULES) {
      await this.queue.upsertJobScheduler(id, schedule, {
        name: job,
        opts: HOUSEKEEPING_JOB_OPTIONS,
      });
      this.logger.log({ msg: 'housekeeping scheduler set', id, ...schedule });
    }
    this.worker = new Worker(queueName, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn({
        msg: 'housekeeping job failed',
        name: job?.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        ...errorLogFields(err),
      }),
    );
  }

  private async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case HOUSEKEEPING_JOBS.sessionCleanup:
        return this.cleanup.run();
      case HOUSEKEEPING_JOBS.attemptScrub:
        return this.scrub.run();
      default:
        throw new Error(`unknown housekeeping job ${job.name}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // lets a running cleanup finish its batch
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
