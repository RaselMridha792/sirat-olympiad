import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type JobsOptions, Queue } from 'bullmq';
import type Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { withTimeout } from '../../common/with-timeout';
import type { EnvVars } from '../../config/env';
import { REDIS_QUEUE } from '../../redis/redis.module';

/** The exam engine's queue on the queue Redis (EXAM-PLAN 3.9, 3.10, 3.12). Jobs run only in the worker. */
export const EXAM_QUEUE = 'exam';
/**
 * The queue's name: EXAM_QUEUE, or EXAM_QUEUE_NAME. Tests give each run its own, so a host test never shares a queue
 * with a dev stack worker on the same Redis database (as PAYMENTS_QUEUE_NAME does for payments). The API and the
 * worker read it from the same config, so the two never disagree.
 */
export const examQueueName = (config: ConfigService<EnvVars, true>): string =>
  config.get('EXAM_QUEUE_NAME', { infer: true }) || EXAM_QUEUE;
export const EXAM_JOBS = {
  score: 'score-attempt',
  sweep: 'sweep',
  build: 'build-results',
} as const;
export type ExamJobName = (typeof EXAM_JOBS)[keyof typeof EXAM_JOBS];
export interface ExamJobData {
  attemptId?: string;
  examId?: string;
}

/** 5 tries with backoff from 10 s; a failed job is kept 3 days for inspection (the sweep scores lost ones anyway). */
export const EXAM_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: true,
  removeOnFail: { age: 3 * 86_400 },
};
const ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * API side: puts scoring and results builds on the queue. Never throws and gives up after 2 s: a submit must succeed
 * even when the queue is down (the worker's sweep scores anything left unscored).
 */
@Injectable()
export class ExamQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(ExamQueue.name);
  private readonly queue: Queue<ExamJobData>;

  constructor(
    @Inject(REDIS_QUEUE) private readonly redis: Redis,
    config: ConfigService<EnvVars, true>,
  ) {
    this.queue = new Queue<ExamJobData>(examQueueName(config), { connection: redis });
  }

  /** Job id `score.<attemptId>`: one scoring job per attempt while it waits. */
  score(attemptId: string): Promise<boolean> {
    return this.add(EXAM_JOBS.score, { attemptId }, `score.${attemptId}`);
  }

  /** A rebuild asked by an admin; the id carries the time, so a later rebuild is a new job. */
  build(examId: string): Promise<boolean> {
    return this.add(EXAM_JOBS.build, { examId }, `build.${examId}.${Date.now()}`);
  }

  private async add(name: ExamJobName, data: ExamJobData, jobId: string): Promise<boolean> {
    if (this.redis.status !== 'ready') {
      this.logger.error({ msg: 'exam job not queued: queue Redis not ready', name, jobId });
      return false;
    }
    try {
      await withTimeout(
        this.queue.add(name, data, { ...EXAM_JOB_OPTIONS, jobId }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (e) {
      this.logger.error({ msg: 'exam job not queued', name, jobId, ...errorLogFields(e) });
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
