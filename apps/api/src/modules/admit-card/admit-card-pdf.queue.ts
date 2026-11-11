import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { withTimeout } from '../../common/with-timeout';
import type { EnvVars } from '../../config/env';
import { REDIS_QUEUE } from '../../redis/redis.module';
import {
  ADMIT_CARD_PDF_JOB,
  ADMIT_CARD_PDF_JOB_OPTIONS,
  admitCardPdfJobId,
  admitCardPdfQueueName,
  type AdmitCardPdfJobData,
} from './admit-card-pdf-queue';

const ENQUEUE_TIMEOUT_MS = 2_000;

/** API side of the admit card PDF: puts the render job on the queue (the worker does the rest). */
@Injectable()
export class AdmitCardPdfQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(AdmitCardPdfQueue.name);
  private readonly queue: Queue<AdmitCardPdfJobData>;

  constructor(
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
    config: ConfigService<EnvVars, true>,
  ) {
    this.queue = new Queue<AdmitCardPdfJobData>(admitCardPdfQueueName(config), {
      connection: redis,
    });
  }

  /** False when the queue Redis is unreachable: the caller answers 503 and the page offers to try again. */
  async render(data: AdmitCardPdfJobData): Promise<boolean> {
    const jobId = admitCardPdfJobId(data, new Date());
    if (this.redis.status !== 'ready') {
      this.logger.error({ msg: 'admit card pdf job not queued: queue Redis not ready', jobId });
      return false;
    }
    try {
      await withTimeout(
        this.queue.add(ADMIT_CARD_PDF_JOB, data, { ...ADMIT_CARD_PDF_JOB_OPTIONS, jobId }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (e) {
      this.logger.error({ msg: 'admit card pdf job not queued', jobId, ...errorLogFields(e) });
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
