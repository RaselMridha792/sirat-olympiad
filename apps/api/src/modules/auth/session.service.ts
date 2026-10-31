import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Role, type Session } from '@prisma/client';
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

/** Only the SHA-256 of a refresh token is stored; the token itself exists only in the user's cookie. */
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/** Thrown inside the rotation transaction to roll it back when the budget is used up. */
class OutOfTime extends Error {}

/** P2028: the interactive transaction could not start in time (maxWait) or ran past its timeout; rolled back. */
const isTransactionTimeout = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';

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

  /** A new session family, after a successful login. */
  start(user: { id: string; role: Role }, client: ClientInfo): Promise<IssuedSession> {
    return this.issue(this.prisma, user, randomUUID(), client);
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
      include: { user: { select: { id: true, role: true, isBlocked: true } } },
    });
    if (!current) return { status: 'invalid' };
    const now = new Date();
    if (current.revokedAt) return this.reused(current, current.revokedAt, client, now);
    if (current.expiresAt <= now) return { status: 'invalid' };
    if (current.user.isBlocked) {
      await this.endFamily(current.familyId);
      return { status: 'invalid' };
    }
    const budget = deadline - Date.now();
    if (budget < MIN_ROTATION_MS) return { status: 'busy' };
    let session: IssuedSession | null;
    try {
      session = await this.prisma.$transaction(
        async (tx) => {
          const left = deadline - Date.now(); // waiting for a connection may have used some of it
          if (left < MIN_ROTATION_MS) throw new OutOfTime();
          // Every statement, a wait for a row lock included, ends by the deadline (set_config(..., true) is
          // SET LOCAL: this transaction only, safe behind PgBouncer's transaction pooling).
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(left)}, true)`;
          // Conditional retire: of two requests carrying the same token, exactly one wins.
          const { count } = await tx.session.updateMany({
            where: { id: current.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          const issued =
            count === 1 ? await this.issue(tx, current.user, current.familyId, client) : null;
          if (Date.now() >= deadline) throw new OutOfTime(); // never commit what can no longer be answered
          return issued;
        },
        // Prisma also refuses to commit once `timeout` has passed since the transaction started.
        { maxWait: Math.min(2_000, budget), timeout: budget },
      );
    } catch (error) {
      if (error instanceof OutOfTime || isTransactionTimeout(error) || Date.now() >= deadline) {
        return { status: 'busy' }; // rolled back: nothing changed
      }
      throw error;
    }
    return session ? { status: 'rotated', session } : { status: 'race' };
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
    const authUser: AuthUser = { id: user.id, role: user.role, sessionId: row.id };
    return {
      user: authUser,
      accessToken: await this.tokens.sign(authUser),
      refreshToken,
      refreshExpiresAt,
    };
  }
}
