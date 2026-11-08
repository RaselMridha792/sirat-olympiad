import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { withTimeout } from '../../common/with-timeout';
import type { EnvVars } from '../../config/env';
import { REDIS_QUEUE } from '../../redis/redis.module';
import {
  DEMO_JOBS,
  DEMO_JOB_OPTIONS,
  type DemoClearJobData,
  type DemoLoadJobData,
  demoQueueName,
} from './demo-queue';

const ENQUEUE_TIMEOUT_MS = 2_000;

/** API side: puts a load or a removal on the queue; false when the queue Redis does not answer. */
@Injectable()
export class DemoQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(DemoQueue.name);
  private readonly queue: Queue<DemoLoadJobData | DemoClearJobData>;

  constructor(
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
    config: ConfigService<EnvVars, true>,
  ) {
    this.queue = new Queue(demoQueueName(config), { connection: redis });
  }

  load(data: DemoLoadJobData): Promise<boolean> {
    return this.add(DEMO_JOBS.load, `load.${data.batchId}`, data);
  }

  /** The time in the id: a removal asked again after a refusal is a new job. */
  clear(data: DemoClearJobData): Promise<boolean> {
    return this.add(DEMO_JOBS.clear, `clear.${data.batchId}.${Date.now()}`, data);
  }

  private async add(
    name: string,
    jobId: string,
    data: DemoLoadJobData | DemoClearJobData,
  ): Promise<boolean> {
    if (this.redis.status !== 'ready') {
      this.logger.error({ msg: 'demo job not queued: queue Redis not ready', jobId });
      return false;
    }
    try {
      await withTimeout(
        this.queue.add(name, data, { ...DEMO_JOB_OPTIONS, jobId }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (e) {
      this.logger.error({ msg: 'demo job not queued', jobId, ...errorLogFields(e) });
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
