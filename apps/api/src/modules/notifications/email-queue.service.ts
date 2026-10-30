import { Inject, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import type Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { withTimeout } from '../../common/with-timeout';
import { REDIS_QUEUE } from '../../redis/redis.module';
import { EMAIL_QUEUE, EMAIL_QUEUE_NAME, type EmailJobData, type EmailMessage } from './email.types';

/** 8 attempts with exponential backoff from 30 s (about 2 h in all); a failed job is kept 3 days, then dropped. */
export const EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true, // the job holds the address and the link: gone once sent
  removeOnFail: { age: 3 * 86_400 },
};
export const ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * API side of email: puts one job on the queue Redis; the worker sends it (02-SYSTEM-DESIGN). Owner rule: a failed
 * or slow email never blocks registration, payment or login, so enqueue never throws and gives up after 2 s.
 */
@Injectable()
export class EmailQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(EmailQueue.name);
  private readonly queue: Queue<EmailJobData>;

  constructor(
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
    @Optional() @Inject(EMAIL_QUEUE_NAME) name: string = EMAIL_QUEUE,
  ) {
    this.queue = new Queue<EmailJobData>(name, { connection: redis });
  }

  /**
   * Queues one email and reports whether it was queued. `key` (e.g. `verify-email.<token id>`, no colons) makes it
   * idempotent: a key already waiting or failed is not queued twice, and the provider sees it as its idempotency key.
   * Logs kind and key only, never the address or the content.
   */
  async enqueue(kind: string, key: string, message: EmailMessage): Promise<boolean> {
    if (this.redis.status !== 'ready') {
      this.logger.error({ msg: 'email not queued: queue Redis not ready', kind, key });
      return false;
    }
    try {
      await withTimeout(
        this.queue.add(kind, { kind, message }, { ...EMAIL_JOB_OPTIONS, jobId: key }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (e) {
      this.logger.error({ msg: 'email not queued', kind, key, ...errorLogFields(e) });
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close(); // the shared connection itself is closed by RedisModule
  }
}
