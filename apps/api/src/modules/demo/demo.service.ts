import { randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEMO_STALE_MINUTES,
  type AdminDemoStatus,
  type DemoBatchStatus,
  type DemoLoadAccepted,
  type DemoRefusal,
} from '@sirat/shared';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CACHE } from '../../redis/redis.module';
import { PasswordService } from '../auth/password.service';
import { type Actor, assertAdmin } from '../exams/admin-exams.service';
import type { PaymentConfig } from '../payments/payment.config';
import { PAYMENT_CONFIG } from '../payments/payments-boot-check';
import {
  assertCanLoad,
  beginDemoClear,
  beginDemoLoad,
  DemoRefusalError,
  type DemoRequest,
  isSecondBatch,
} from './demo-batches';
import { DemoRunner } from './demo-runner';
import { DemoQueue } from './demo.queue';

const refuse = (code: DemoRefusal) => new ConflictException([code]);
/** 16 characters of base64url: the one password of every demo login in a batch, shown once. */
const PASSWORD_BYTES = 12;

/** Whether this server allows demo data (DEMO_DATA_ALLOWED, an env var: a session cannot turn it on). */
export const demoAllowed = (config: ConfigService<EnvVars, true>): boolean =>
  config.get('DEMO_DATA_ALLOWED', { infer: true }) === 'true';

/**
 * The admin card's side of demo data (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click"). Admin
 * only (the controller; @TwoFactorAlways while 2FA is on), with a reason and an audit row; the work runs as a queue job
 * (demo.worker.ts). One batch at a time (the unique index); the database refuses every mix of demo and real rows.
 */
@Injectable()
export class DemoService {
  private readonly runner: DemoRunner;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) cache: Redis,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(PAYMENT_CONFIG) private readonly payments: PaymentConfig,
    private readonly queue: DemoQueue,
    private readonly passwords: PasswordService,
  ) {
    this.runner = new DemoRunner({ prisma, cache });
  }

  async status(): Promise<AdminDemoStatus> {
    const [batch, job] = await Promise.all([
      this.prisma.demoBatch.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          counts: true,
          createdBy: { select: { name: true } },
        },
      }),
      this.runner.jobState(),
    ]);
    const busy = batch?.status === 'loading' || batch?.status === 'clearing';
    // The abandoned-job rule (DEMO_STALE_MINUTES): no progress any more, and the card offers the removal.
    const stale = busy && batch.updatedAt.getTime() < Date.now() - DEMO_STALE_MINUTES * 60_000;
    const running = busy && !stale;
    return {
      allowed: demoAllowed(this.config),
      batch: batch && {
        id: batch.id,
        status: batch.status as DemoBatchStatus,
        createdAt: batch.createdAt.toISOString(),
        createdByName: batch.createdBy?.name ?? 'Server (CLI)',
        counts: (batch.counts ?? {}) as Record<string, number>,
        stale,
      },
      progress:
        running && job?.step
          ? { action: batch.status === 'loading' ? 'load' : 'clear', step: job.step }
          : null,
      lastOutcome: job?.outcome ?? null,
    };
  }

  /**
   * 202: the batch exists ('loading') and its job is queued. The password is in this answer only: never stored in
   * clear, never logged. Refused: demo_not_allowed, demo_exists (remove the batch first), demo_busy, payments_live,
   * real_payments.
   */
  async load(actor: Actor, reason: string): Promise<DemoLoadAccepted> {
    if (!demoAllowed(this.config)) throw refuse('demo_not_allowed');
    // The cheap refusals first (A2's review): a click that will be refused costs no password hash. The transaction
    // below checks again under the lock.
    await this.refusing(() => assertCanLoad(this.prisma, this.payments));
    const password = randomBytes(PASSWORD_BYTES).toString('base64url');
    const passwordHash = await this.passwords.hash(password); // CPU work outside the transaction
    const batchId = await this.refusing(() =>
      this.prisma.$transaction(async (tx) => {
        await assertAdmin(tx, actor.id);
        return beginDemoLoad(tx, request(actor, reason), this.payments);
      }),
    );
    await this.runner.queued('load');
    if (!(await this.queue.load({ batchId, passwordHash, requestedBy: actor.id }))) {
      await this.runner.loadFailed(batchId);
      throw new ServiceUnavailableException(['queue_unavailable']);
    }
    return { batchId, password };
  }

  /**
   * 202: the batch is 'clearing' and its job is queued. Works while DEMO_DATA_ALLOWED is off too, so demo data never
   * outlives the switch. Refused: demo_absent, demo_busy. A removal the database refuses (real rows use demo rows)
   * shows on the card as lastOutcome 'blocked' with the counts.
   */
  async clear(actor: Actor, reason: string): Promise<AdminDemoStatus> {
    const { batchId, previous } = await this.refusing(() =>
      this.prisma.$transaction(async (tx) => {
        await assertAdmin(tx, actor.id);
        return beginDemoClear(tx, request(actor, reason));
      }),
    );
    await this.runner.queued('clear');
    if (!(await this.queue.clear({ batchId, previous, requestedBy: actor.id }))) {
      await this.runner.clearRefused(batchId, previous);
      throw new ServiceUnavailableException(['queue_unavailable']);
    }
    return this.status();
  }

  /** A named refusal becomes 409 [code]. */
  private async refusing<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DemoRefusalError) throw refuse(e.code);
      if (isSecondBatch(e)) throw refuse('demo_busy');
      throw e;
    }
  }
}

const request = (actor: Actor, reason: string): DemoRequest => ({
  actorId: actor.id,
  ip: actor.ip,
  reason,
  via: 'api',
});
