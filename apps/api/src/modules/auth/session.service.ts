import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Role, Session } from '@prisma/client';
import { isRetryableDbError } from '../../common/db-errors';
import type { EnvVars } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessTokenService, type AuthUser } from './access-token.service';

/**
 * A retired refresh token that comes back this soon, while its family is still alive, is two tabs refreshing at
 * once, not theft: answer "retry" and keep the family. Kept short, because inside it reuse is not detected.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type RotateResult =
  | { status: 'rotated'; session: IssuedSession }
  | { status: 'race' } // another request rotated this token a moment ago; the browser holds the new cookies
  | { status: 'busy' } // could not commit within the rotation budget: rolled back, the old token stays valid
  | { status: 'invalid' }; // unknown, expired, reused, or the user is blocked: log in again

/** Below this much budget left, a rotation is not started at all. */
const MIN_ROTATION_MS = 50;
/** The database's own statement_timeout (migration db_session_timeouts): the rotation only ever lowers it. */
const DB_STATEMENT_TIMEOUT_MS = 10_000;
/** Prisma's own transaction timer runs this far past the deadline, so it never cuts a commit the deadline allowed. */
const PRISMA_TIMEOUT_MARGIN_MS = 5_000;

/** Only the SHA-256 of a refresh token is stored; the token itself exists only in the user's cookie. */
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/** Thrown inside the rotation transaction to roll it back when the budget is used up. */
class OutOfTime extends Error {}

/**
 * Refresh-token sessions (RULEBOOK §5). One family per login; every refresh retires the presented token and issues a
 * new one in the same family (sliding REFRESH_TTL_DAYS). A retired token presented again revokes the whole family.
 */
@Injectable()
export class SessionService {
  private readonly refreshTtlMs: number;
  private readonly rotationBudgetMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.refreshTtlMs = config.get('REFRESH_TTL_DAYS', { infer: true }) * 86_400_000;
    this.rotationBudgetMs = config.get('REFRESH_ROTATION_BUDGET_MS', { infer: true });
  }

  /** A new session family, after a successful login. Its tokens say no second factor was proved (`tfa` false). */
  start(user: { id: string; role: Role }, client: ClientInfo): Promise<IssuedSession> {
    return this.issue(this.prisma, user, randomUUID(), client, false);
  }

  /**
   * A new session family whose tokens carry `tfa` true: only after the second factor was proved (the login's code
   * step, or turning 2FA on with a code). Its refreshes keep the flag while the user's 2FA stays on (rotate).
   */
  startVerified(user: { id: string; role: Role }, client: ClientInfo): Promise<IssuedSession> {
    return this.issue(this.prisma, user, randomUUID(), client, true);
  }

  /**
   * Retires `refreshToken` and issues its successor, or explains why not. The rotation commits only within
   * REFRESH_ROTATION_BUDGET_MS of `startedAt` (the request reaching the handler): its answer carries the only copy
   * of the new cookies, so a commit after the answer can no longer go out (the 25 s request timeout, nginx's 30 s)
   * would retire the token the browser still holds, and its next try would look like reuse. Past the budget the
   * transaction is rolled back ('busy'): nothing changed, and the browser simply tries again.
   */
  async rotate(
    refreshToken: string,
    client: ClientInfo,
    startedAt: number = Date.now(),
  ): Promise<RotateResult> {
    const deadline = startedAt + this.rotationBudgetMs;
    const current = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            isBlocked: true,
            twoFactor: { select: { enabledAt: true } },
          },
        },
      },
    });
    if (!current) return { status: 'invalid' };
    const now = new Date();
    if (current.revokedAt) return this.reused(current, current.revokedAt, client, now);
    if (current.expiresAt <= now) return { status: 'invalid' };
    if (current.user.isBlocked) {
      await this.endFamily(current.familyId);
      return { status: 'invalid' };
    }
    // The user's CURRENT 2FA state, not the old token's: every change of it ends the user's other sessions, so a
    // family still alive while 2FA is on proved the code (DECISIONS "Admin two-factor login").
    const twoFactor = current.user.twoFactor?.enabledAt != null;
    const budget = deadline - Date.now();
    if (budget < MIN_ROTATION_MS) return { status: 'busy' };
    // Assigned inside the transaction callback, which TypeScript's flow analysis does not follow.
    let issued = null as IssuedSession | null;
    let committing = false as boolean; // set once the callback returns: from then on an error may come from the COMMIT itself
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Before each statement: the time left bounds it, a wait for a row lock included (set_config(..., true)
          // is SET LOCAL: this transaction only, safe behind PgBouncer's transaction pooling).
          const bound = async () => {
            const left = deadline - Date.now(); // waiting for a connection or a lock uses it up
            if (left < MIN_ROTATION_MS) throw new OutOfTime();
            const ms = String(Math.min(left, DB_STATEMENT_TIMEOUT_MS));
            await tx.$queryRaw`SELECT set_config('statement_timeout', ${ms}, true)`;
          };
          await bound();
          // Conditional retire: of two requests carrying the same token, exactly one wins.
          const { count } = await tx.session.updateMany({
            where: { id: current.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          if (count !== 1) return;
          await bound();
          issued = await this.issue(tx, current.user, current.familyId, client, twoFactor);
          // Retired as of now, not as of when the UPDATE was sent (it may have waited for a lock): the reuse grace
          // counts from when the token really stops working.
          await tx.session.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
          if (Date.now() >= deadline) throw new OutOfTime(); // never commit what can no longer be answered
          committing = true;
        },
        { maxWait: Math.min(2_000, budget), timeout: budget + PRISMA_TIMEOUT_MARGIN_MS },
      );
    } catch (error) {
      // A failed COMMIT may still have committed: then the successor exists, and its cookies must go out.
      if (committing && issued) {
        const successor = await this.prisma.session.findUnique({
          where: { tokenHash: sha256(issued.refreshToken) },
          select: { id: true },
        });
        return successor ? { status: 'rotated', session: issued } : { status: 'busy' };
      }
      // Rolled back, nothing changed: the old token still works and the browser tries again.
      if (error instanceof OutOfTime || isRetryableDbError(error) || Date.now() >= deadline) {
        return { status: 'busy' };
      }
      throw error;
    }
    return issued ? { status: 'rotated', session: issued } : { status: 'race' };
  }

  /** Logout on this device: ends the family of the session the access token belongs to. */
  async endFamilyOfSession(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { familyId: true },
    });
    if (session) await this.endFamily(session.familyId);
  }

  /**
   * Logout everywhere (also after a password change or reset). Returns how many sessions were still active.
   * Pass `tx` to end them in the same transaction as the password change (RULEBOOK §6: one transaction).
   */
  async endAllForUser(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<number> {
    const { count } = await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  private async endFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * A retired refresh token came back. If its family has already ended (logout, or an earlier reuse), there is
   * nothing left to protect: just refuse. Otherwise, after the grace period, someone holds a copy of a token that was
   * rotated away: end the family for every holder and audit it, once.
   */
  private async reused(
    session: Session,
    retiredAt: Date,
    client: ClientInfo,
    now: Date,
  ): Promise<RotateResult> {
    const alive = await this.prisma.session.count({
      where: { familyId: session.familyId, revokedAt: null },
    });
    if (alive === 0) return { status: 'invalid' };
    if (now.getTime() - retiredAt.getTime() < REFRESH_REUSE_GRACE_MS) return { status: 'race' };
    await this.endFamily(session.familyId);
    await this.audit.record({
      action: 'auth.refresh_reuse',
      actorId: session.userId,
      entityType: 'session_family',
      entityId: session.familyId,
      ip: client.ip,
    });
    return { status: 'invalid' };
  }

  private async issue(
    db: Prisma.TransactionClient,
    user: { id: string; role: Role },
    familyId: string,
    client: ClientInfo,
    twoFactor: boolean,
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs);
    const row = await db.session.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: client.ip ?? null,
        userAgent: client.userAgent?.slice(0, 512) ?? null,
      },
    });
    const authUser: AuthUser = { id: user.id, role: user.role, sessionId: row.id, twoFactor };
    return {
      user: authUser,
      accessToken: await this.tokens.sign(authUser),
      refreshToken,
      refreshExpiresAt,
    };
  }
}
