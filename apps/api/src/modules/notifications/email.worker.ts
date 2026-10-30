import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import { QUEUE_REDIS_OPTIONS } from '../../redis/redis.module';
import {
  EMAIL_PROVIDER,
  EMAIL_QUEUE,
  EMAIL_QUEUE_NAME,
  type EmailJobData,
  type EmailProvider,
  PermanentEmailError,
} from './email.types';

/** Jobs sent at the same time per worker process; below a new SES account's sending rate outside the sandbox. */
export const EMAIL_CONCURRENCY = 5;

/**
 * Worker side of email (runs in the `worker` service, never in an API replica). Retries come from the job options;
 * a PermanentEmailError fails the job at once. Logs kind, job id and attempt, never the address or the content.
 */
@Injectable()
export class EmailWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EmailWorker.name);
  private connection?: Redis;
  private worker?: Worker<EmailJobData>;

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly config: ConfigService<EnvVars, true>,
    @Optional() @Inject(EMAIL_QUEUE_NAME) private readonly queueName: string = EMAIL_QUEUE,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    this.worker = new Worker<EmailJobData>(this.queueName, (job) => this.process(job), {
      connection: this.connection,
      concurrency: EMAIL_CONCURRENCY,
    });
    this.worker.on('completed', (job) =>
      this.logger.log({
        msg: 'email sent',
        kind: job.name,
        jobId: job.id,
        attempt: job.attemptsMade,
      }),
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn({
        msg: 'email attempt failed',
        kind: job?.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        final:
          !job || err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1),
        errName: err.name,
        error: err.message.slice(0, 200), // our own messages: status codes and SES error names only
      }),
    );
  }

  /** Exposed for tests; BullMQ calls it for every job. */
  async process(job: Job<EmailJobData>): Promise<void> {
    try {
      await this.provider.send(job.data.message, job.id ?? `${job.name}.${job.timestamp}`);
    } catch (e) {
      if (e instanceof PermanentEmailError) throw new UnrecoverableError(e.message);
      throw e;
    }
  }

  isRunning(): boolean {
    return this.worker?.isRunning() ?? false;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // waits for jobs in progress
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
