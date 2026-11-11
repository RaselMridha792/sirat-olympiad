import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ADMIT_CARD_PDF_LOCALES, type AdmitCard } from '@sirat/shared';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { errorLogFields } from '../../common/all-exceptions.filter';
import type { EnvVars } from '../../config/env';
import { PrismaModule } from '../../prisma/prisma.module';
import { QUEUE_REDIS_OPTIONS, REDIS_CACHE, RedisModule } from '../../redis/redis.module';
import { renderAdmitCardPdf } from './admit-card-pdf';
import {
  ADMIT_CARD_PDF_JOB,
  ADMIT_CARD_PDF_TTL_SECONDS,
  admitCardPdfKey,
  admitCardPdfQueueName,
  admitCardPdfVersion,
  type AdmitCardPdfJobData,
} from './admit-card-pdf-queue';
import { AdmitCardService } from './admit-card.service';

export type AdmitCardPdfOutcome = 'stored' | 'skipped';

/**
 * Worker side of the admit card PDF (the `worker` service, never an API replica), one render at a time (CPU work,
 * ~0.1 s). Idempotent: it reads the card as it is now, renders it (the same card gives the same bytes) and writes
 * the version and the file to one key in a single MULTI, so a re-run or a retry overwrites safely. A user who is no
 * longer registered, blocked or not a student is skipped, not retried. Logs the job id and the size only. Any
 * other error is logged here (errorLogFields) and rethrown with its NAME only, so BullMQ never keeps a library's
 * message or stack as failedReason for the 7 days a failed job is kept (exam's review of #45).
 */
@Injectable()
export class AdmitCardPdfWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AdmitCardPdfWorker.name);
  private connection?: Redis;
  private worker?: Worker<AdmitCardPdfJobData>;

  constructor(
    private readonly admitCard: AdmitCardService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.get('REDIS_QUEUE_URL', { infer: true }), {
      ...QUEUE_REDIS_OPTIONS,
    });
    this.connection.on('error', () => undefined); // BullMQ reconnects; job failures are logged below
    this.worker = new Worker<AdmitCardPdfJobData>(
      admitCardPdfQueueName(this.config),
      (job) => this.process(job),
      {
        connection: this.connection,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn({
        msg: 'admit card pdf job failed',
        jobId: job?.id,
        attempt: job?.attemptsMade,
        ...errorLogFields(err),
      }),
    );
  }

  async process(
    job: Pick<Job<AdmitCardPdfJobData>, 'id' | 'name' | 'data'>,
  ): Promise<AdmitCardPdfOutcome> {
    if (job.name !== ADMIT_CARD_PDF_JOB)
      throw new UnrecoverableError(`unknown admit card pdf job ${job.name}`);
    const { userId, locale } = job.data;
    if (!(ADMIT_CARD_PDF_LOCALES as readonly string[]).includes(locale))
      throw new UnrecoverableError('admit card pdf job: unknown locale');
    try {
      let card: AdmitCard;
      try {
        card = await this.admitCard.forUser(userId);
      } catch (e) {
        if (e instanceof NotFoundException || e instanceof ForbiddenException) {
          this.logger.log({
            msg: 'admit card pdf skipped: no admit card for this user now',
            jobId: job.id,
          });
          return 'skipped';
        }
        throw e;
      }
      const pdf = await renderAdmitCardPdf(card, locale);
      const key = admitCardPdfKey(userId, locale);
      const results = await this.cache
        .multi()
        .hset(key, 'v', admitCardPdfVersion(card, locale), 'pdf', Buffer.from(pdf))
        .expire(key, ADMIT_CARD_PDF_TTL_SECONDS)
        .exec();
      const failed = results?.find(([err]) => err)?.[0];
      if (!results || failed) throw failed ?? new Error('the cache write was discarded');
      this.logger.log({ msg: 'admit card pdf stored', jobId: job.id, bytes: pdf.length });
      return 'stored';
    } catch (e) {
      // The details go to this log only (errorLogFields); BullMQ keeps the name alone as failedReason.
      this.logger.error({ msg: 'admit card pdf job error', jobId: job.id, ...errorLogFields(e) });
      throw new Error(`admit card render failed: ${e instanceof Error ? e.name : typeof e}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // lets a running render finish
    this.connection?.disconnect();
  }
}

/** Registered in worker.ts only. */
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [AdmitCardService, AdmitCardPdfWorker],
})
export class AdmitCardPdfWorkerModule {}
