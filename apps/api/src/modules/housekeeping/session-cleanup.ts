import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { drainBatches } from './batch-drain';

/** DECISIONS A2.1b #9: a session row goes 30 days after it expired or was revoked (a rotation revokes it). */
export const SESSION_RETENTION_DAYS = 30;
/** Email and password-reset tokens go 7 days after they expired, used or not. */
export const TOKEN_RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;

export interface CleanupLimits {
  /** Rows per DELETE. */
  batchSize: number;
  /** Batches per table and run; the rest waits for the next night. */
  maxBatches: number;
  /** Per batch (SET LOCAL), well under the database's 10 s. */
  statementTimeoutMs: number;
}
export const DEFAULT_CLEANUP_LIMITS: CleanupLimits = {
  batchSize: 1_000,
  maxBatches: 50,
  statementTimeoutMs: 5_000,
};
export const CLEANUP_LIMITS = Symbol('CLEANUP_LIMITS');

export interface CleanupResult {
  sessions: number;
  tokens: number;
  batches: number;
  /** A table reached the batch cap with a full last batch: the next run goes on. */
  more: boolean;
}

/** The two cutoffs for a run at `now`. */
export function cleanupCutoffs(now: Date): { sessions: Date; tokens: Date } {
  return {
    sessions: new Date(now.getTime() - SESSION_RETENTION_DAYS * DAY_MS),
    tokens: new Date(now.getTime() - TOKEN_RETENTION_DAYS * DAY_MS),
  };
}

/**
 * Deletes old session and auth-token rows (LAUNCH-PLAN §9, L13). Sessions keep minors' IPs and browsers, so they go
 * once they can no longer be used: 30 days after expiry or revocation. A replay of a purged token is then simply
 * 'invalid' (401) instead of ending its family (the accepted loss in A2.1b #9); rotate() is unchanged.
 *
 * Batches of `batchSize` rows, each its own short transaction under SET LOCAL statement_timeout, with
 * FOR UPDATE SKIP LOCKED: two runs at once neither block nor fail, and a row a request holds is left for next time.
 * Idempotent: a retry deletes only what is still there. Logs and audits counts only, never a row's contents.
 * Touches only `sessions` and `auth_tokens`.
 */
@Injectable()
export class SessionCleanup {
  private readonly logger = new Logger(SessionCleanup.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLEANUP_LIMITS) private readonly limits: CleanupLimits,
  ) {}

  async run(now: Date = new Date()): Promise<CleanupResult> {
    const cut = cleanupCutoffs(now);
    const sessions = await drainBatches(
      this.prisma,
      this.limits,
      (tx, limit) => tx.$executeRaw`
        DELETE FROM sessions WHERE id IN (
          SELECT id FROM sessions
          WHERE expires_at < ${cut.sessions} OR revoked_at < ${cut.sessions}
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)`,
    );
    const tokens = await drainBatches(
      this.prisma,
      this.limits,
      (tx, limit) => tx.$executeRaw`
        DELETE FROM auth_tokens WHERE id IN (
          SELECT id FROM auth_tokens
          WHERE expires_at < ${cut.tokens}
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)`,
    );
    const result: CleanupResult = {
      sessions: sessions.count,
      tokens: tokens.count,
      batches: sessions.batches + tokens.batches,
      more: sessions.more || tokens.more,
    };
    this.logger.log({ msg: 'session cleanup done', ...result });
    await this.audit.record({
      action: 'housekeeping.session_cleanup',
      meta: { ...result },
    });
    return result;
  }
}
