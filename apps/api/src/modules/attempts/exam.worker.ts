import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { EnvVars } from '../../config/env';
import { QUEUE_REDIS_OPTIONS } from '../../redis/redis.module';
import { ExamJobs } from './exam-jobs';
import {
  EXAM_JOBS,
  EXAM_JOB_OPTIONS,
  EXAM_QUEUE,
  EXAM_QUEUE_NAME,
  type ExamJobData,
} from './exam-queue';

/** Jobs at the same time per worker process: scoring is two reads and one update each. */
export const EXAM_CONCURRENCY = 4;
const SWEEP_EVERY_MS = 60_000;
const SWEEP_SCHEDULER_ID = 'exam-sweep';

/**
 * Worker side of the exam engine (runs in the `worker` service, never in an API replica): scoring after each submit,
 * the minute sweep (one scheduler, so one sweep per minute across all workers) and results builds. Logs job names and
 * ids only, never answers or personal data.
 */
@Injectable()
export class ExamWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ExamWorker.name);
  private connection?: Redis;
  private worker?: Worker<ExamJobData>;
  private queue?: Queue<ExamJobData>;

  constructor(
    private readonly jobs: ExamJobs,
    private readonly config: ConfigService<EnvVars, true>,
    @Optional() @Inject(EXAM_QUEUE_NAME) private readonly queueName: string = EXAM_QUEUE,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    this.queue = new Queue<ExamJobData>(this.queueName, { connection: this.connection });
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_EVERY_MS },
      { name: EXAM_JOBS.sweep, opts: { ...EXAM_JOB_OPTIONS, attempts: 1 } },
    );
    this.worker = new Worker<ExamJobData>(this.queueName, (job) => this.process(job), {
      connection: this.connection,
      concurrency: EXAM_CONCURRENCY,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn({
        msg: 'exam job failed',
        name: job?.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        ...errorLogFields(err),
      }),
    );
  }

  private async process(job: Job<ExamJobData>): Promise<unknown> {
    switch (job.name) {
      case EXAM_JOBS.score:
        return job.data.attemptId ? this.jobs.score(job.data.attemptId) : false;
      case EXAM_JOBS.sweep:
        return this.jobs.sweep();
      case EXAM_JOBS.build:
        return job.data.examId ? this.jobs.buildResults(job.data.examId) : 'not_ready';
      default:
        throw new Error(`unknown exam job ${job.name}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // lets running jobs finish
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
