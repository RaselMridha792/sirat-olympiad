import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { EnvVars } from '../../config/env';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_REDIS_OPTIONS, REDIS_CACHE, RedisModule } from '../../redis/redis.module';
import { SecurityAlerts } from '../audit/security-alerts.service';
import { paymentsAllowDemo } from '../payments/demo/allow-demo';
import type { PaymentConfig } from '../payments/payment.config';
import { PAYMENT_CONFIG } from '../payments/payments-boot-check';
import { PaymentsCoreModule } from '../payments/payments-core.module';
import {
  DEMO_JOBS,
  type DemoClearJobData,
  type DemoLoadJobData,
  demoQueueName,
} from './demo-queue';
import { DemoClearBlocked, DemoClearBusy, DemoRunner } from './demo-runner';
import { demoAllowed } from './demo.service';

type DemoJobData = DemoLoadJobData | DemoClearJobData;
type DemoJob = Job<DemoJobData>;

/** A refusal a retry cannot change, already written to the batch and the card: failed() leaves it alone. */
class DemoRefused extends UnrecoverableError {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DemoRefused';
  }
}

/**
 * Worker side of demo data (the `worker` service): load and remove, one job at a time. Logs job names, ids, batch ids
 * and counts only (never the hash).
 */
@Injectable()
export class DemoWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DemoWorker.name);
  private readonly runner: DemoRunner;
  private connection?: Redis;
  private worker?: Worker<DemoJobData>;

  constructor(
    prisma: PrismaService,
    @Inject(REDIS_CACHE) cache: Redis,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(PAYMENT_CONFIG) payments: PaymentConfig,
    private readonly alerts: SecurityAlerts,
  ) {
    this.runner = new DemoRunner({
      prisma,
      cache,
      // Checked again inside the load transaction: the API checked when the admin clicked.
      guard: async (tx) => {
        const allowed = await paymentsAllowDemo(tx, payments);
        if (!allowed.ok) throw new UnrecoverableError(allowed.reason);
      },
    });
  }

  onModuleInit(): void {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    this.worker = new Worker<DemoJobData>(demoQueueName(this.config), (job) => this.process(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) => void this.failed(job, err));
  }

  /** Exposed for tests; BullMQ calls it for every job. Returns the counts, or null when there was nothing to do. */
  async process(job: DemoJob): Promise<Record<string, number> | null> {
    if (job.name === DEMO_JOBS.load) return this.load(job, job.data as DemoLoadJobData);
    if (job.name === DEMO_JOBS.clear) return this.clear(job, job.data as DemoClearJobData);
    throw new UnrecoverableError(`unknown demo job ${job.name}`);
  }

  private async load(job: DemoJob, data: DemoLoadJobData): Promise<Record<string, number> | null> {
    if (!demoAllowed(this.config)) throw new UnrecoverableError('demo_not_allowed');
    const counts = await this.runner.load(data.batchId, data.passwordHash);
    if (!counts) return null;
    this.logger.log({ msg: 'demo data loaded', jobId: job.id, batchId: data.batchId, ...counts });
    await this.alerts.raise('ops.demo_loaded', {
      actorId: data.requestedBy,
      meta: { batch: data.batchId, students: counts.students ?? 0, rows: total(counts) },
    });
    return counts;
  }

  private async clear(
    job: DemoJob,
    data: DemoClearJobData,
  ): Promise<Record<string, number> | null> {
    let counts: Record<string, number> | null;
    try {
      counts = await this.runner.clear(data.batchId);
    } catch (e) {
      if (e instanceof DemoClearBlocked) {
        await this.runner.clearRefused(data.batchId, data.previous, e.blockers);
        this.logger.warn({ msg: 'demo removal refused', jobId: job.id, ...e.blockers });
        throw new DemoRefused(e.message);
      }
      if (e instanceof DemoClearBusy) {
        await this.runner.clearRefused(data.batchId, data.previous);
        throw new DemoRefused(e.message);
      }
      throw e;
    }
    if (!counts) return null;
    this.logger.log({ msg: 'demo data removed', jobId: job.id, batchId: data.batchId, ...counts });
    await this.alerts.raise('ops.demo_cleared', {
      actorId: data.requestedBy,
      meta: { batch: data.batchId, rows: total(counts) },
    });
    return counts;
  }

  /** After the last try: the batch gets a status an admin can act on ('failed', or its status before the removal). */
  async failed(job: DemoJob | undefined, err: Error): Promise<void> {
    const final =
      !job || err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn({
      msg: 'demo job failed',
      name: job?.name,
      jobId: job?.id,
      attempt: job?.attemptsMade,
      final,
      // Our own refusal codes (payments_live, demo_clear_blocked, ...); never a database message.
      refusal: err instanceof UnrecoverableError ? err.message.slice(0, 60) : undefined,
      ...errorLogFields(err),
    });
    if (!job || !final || err.name === 'DemoRefused') return;
    try {
      if (job.name === DEMO_JOBS.load) await this.runner.loadFailed(job.data.batchId);
      if (job.name === DEMO_JOBS.clear) {
        const data = job.data as DemoClearJobData;
        await this.runner.clearRefused(data.batchId, data.previous);
      }
    } catch (e) {
      this.logger.error({
        msg: 'demo job: batch status not restored',
        jobId: job.id,
        ...errorLogFields(e),
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // lets a running job finish
    this.connection?.disconnect();
  }
}

const total = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((a, b) => a + b, 0);

/** Registered in worker.ts only. */
@Module({
  imports: [PrismaModule, RedisModule, PaymentsCoreModule],
  providers: [DemoWorker],
})
export class DemoWorkerModule {}
