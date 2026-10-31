import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import type Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { withTimeout } from '../../common/with-timeout';
import { REDIS_QUEUE } from '../../redis/redis.module';

/** The exam engine's queue on the queue Redis (EXAM-PLAN 3.9, 3.10, 3.12). Jobs run only in the worker. */
export const EXAM_QUEUE = 'exam';
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

  constructor(@Inject(REDIS_QUEUE) private readonly redis: Redis) {
    this.queue = new Queue<ExamJobData>(EXAM_QUEUE, { connection: redis });
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
