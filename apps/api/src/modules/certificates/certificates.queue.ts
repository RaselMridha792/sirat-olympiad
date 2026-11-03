import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { withTimeout } from '../../common/with-timeout';
import type { EnvVars } from '../../config/env';
import { REDIS_QUEUE } from '../../redis/redis.module';
import {
  CERTIFICATE_JOBS,
  CERTIFICATE_JOB_OPTIONS,
  certificatesQueueName,
  type IssueJobData,
} from './certificates-queue';

const ENQUEUE_TIMEOUT_MS = 2_000;

/** API side: puts an issue job on the queue; false when the queue Redis does not answer (the admin tries again). */
@Injectable()
export class CertificatesQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(CertificatesQueue.name);
  private readonly queue: Queue<IssueJobData>;

  constructor(
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
    config: ConfigService<EnvVars, true>,
  ) {
    this.queue = new Queue<IssueJobData>(certificatesQueueName(config), { connection: redis });
  }

  async issue(data: IssueJobData): Promise<boolean> {
    // The time in the id: a later request is a new job (the job itself skips what exists).
    const jobId = `issue.${data.type}.${data.roundId}.${Date.now()}`;
    if (this.redis.status !== 'ready') {
      this.logger.error({ msg: 'certificate job not queued: queue Redis not ready', jobId });
      return false;
    }
    try {
      await withTimeout(
        this.queue.add(CERTIFICATE_JOBS.issue, data, { ...CERTIFICATE_JOB_OPTIONS, jobId }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (e) {
      this.logger.error({ msg: 'certificate job not queued', jobId, ...errorLogFields(e) });
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
