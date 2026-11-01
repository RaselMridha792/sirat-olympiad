import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { drainBatches } from './batch-drain';
import { CLEANUP_LIMITS, type CleanupLimits } from './session-cleanup';

/** PAYMENTS-PLAN 4.3 (D6): a registration attempt that will not become an account keeps its form 30 days. */
export const ATTEMPT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ScrubResult {
  /** Abandoned attempts whose form was cleared. */
  abandoned: number;
  /** Open attempts that are dead (no live payment, every checkout long expired) whose form was cleared. */
  dead: number;
  batches: number;
  more: boolean;
}

export function scrubCutoff(now: Date): Date {
  return new Date(now.getTime() - ATTEMPT_RETENTION_DAYS * DAY_MS);
}

/**
 * Clears the stored form of registration attempts that will never become an account (PAYMENTS-PLAN 4.3, D6;
 * DECISIONS "The registration form's retention"). `payload` holds the argon2id password hash and the rest of the form;
 * it becomes NULL for:
 * - abandoned attempts (cancelled, or replaced by a new start) whose last change is more than 30 days old;
 * - open attempts that are dead: last changed more than 30 days ago, no payment initiated, pending, paid or refunded,
 *   and every payment's checkout expired more than 30 days ago (far past the 48 h late watch).
 *
 * Never: completed attempts (cleared at settlement), conflict attempts (an admin case, RUNBOOK §11), the row itself,
 * the name, email or phone (payment lookups), payments or their events; `updated_at` stays as it was. A payment that
 * still succeeds on a cleared attempt is not lost: settlement marks it paid and sets it aside (`attempt_invalid`).
 * Batches as SessionCleanup (SKIP LOCKED, SET LOCAL timeout, a cap); idempotent; logs and audits counts only.
 */
@Injectable()
export class AttemptScrub {
  private readonly logger = new Logger(AttemptScrub.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLEANUP_LIMITS) private readonly limits: CleanupLimits,
  ) {}

  async run(now: Date = new Date()): Promise<ScrubResult> {
    const cut = scrubCutoff(now);
    const abandoned = await drainBatches(
      this.prisma,
      this.limits,
      (tx, limit) => tx.$executeRaw`
        UPDATE pending_registrations SET payload = NULL WHERE id IN (
          SELECT id FROM pending_registrations
          WHERE status = 'abandoned' AND payload IS NOT NULL AND updated_at < ${cut}
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)`,
    );
    const dead = await drainBatches(
      this.prisma,
      this.limits,
      (tx, limit) => tx.$executeRaw`
        UPDATE pending_registrations SET payload = NULL WHERE id IN (
          SELECT a.id FROM pending_registrations a
          WHERE a.status = 'open' AND a.payload IS NOT NULL AND a.updated_at < ${cut}
            AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.pending_registration_id = a.id
                AND (p.status IN ('initiated', 'pending', 'paid', 'refunded') OR p.expires_at >= ${cut}))
          LIMIT ${limit}
          FOR UPDATE OF a SKIP LOCKED)`,
    );
    const result: ScrubResult = {
      abandoned: abandoned.count,
      dead: dead.count,
      batches: abandoned.batches + dead.batches,
      more: abandoned.more || dead.more,
    };
    this.logger.log({ msg: 'attempt scrub done', ...result });
    await this.audit.record({ action: 'housekeeping.attempt_scrub', meta: { ...result } });
    return result;
  }
}
