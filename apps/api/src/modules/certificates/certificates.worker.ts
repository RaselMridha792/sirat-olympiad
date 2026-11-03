import { Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { EnvVars } from '../../config/env';
import { PrismaModule } from '../../prisma/prisma.module';
import { QUEUE_REDIS_OPTIONS } from '../../redis/redis.module';
import { CertificateIssuer } from './certificate-issuer';
import { CERTIFICATE_JOBS, certificatesQueueName, type IssueJobData } from './certificates-queue';

/**
 * Worker side of certificates (the `worker` service, never an API replica): the issue job, one at a time. Logs job
 * names, ids and counts only.
 */
@Injectable()
export class CertificatesWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CertificatesWorker.name);
  private connection?: Redis;
  private worker?: Worker<IssueJobData>;

  constructor(
    private readonly issuer: CertificateIssuer,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    this.worker = new Worker<IssueJobData>(
      certificatesQueueName(this.config),
      (job) => this.process(job),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn({
        msg: 'certificate job failed',
        name: job?.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        ...errorLogFields(err),
      }),
    );
  }

  private async process(job: Job<IssueJobData>): Promise<number> {
    if (job.name !== CERTIFICATE_JOBS.issue) throw new Error(`unknown certificate job ${job.name}`);
    const issued = await this.issuer.issue(job.data);
    this.logger.log({ msg: 'certificates issued', jobId: job.id, type: job.data.type, issued });
    return issued;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // lets a running job finish
    this.connection?.disconnect();
  }
}

/** Registered in worker.ts only. */
@Module({
  imports: [PrismaModule],
  providers: [CertificateIssuer, CertificatesWorker],
})
export class CertificatesWorkerModule {}
