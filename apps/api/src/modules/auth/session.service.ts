import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Role, Session } from '@prisma/client';
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
  | { status: 'invalid' }; // unknown, expired, reused, or the user is blocked: log in again

/** Only the SHA-256 of a refresh token is stored; the token itself exists only in the user's cookie. */
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Refresh-token sessions (RULEBOOK §5). One family per login; every refresh retires the presented token and issues a
 * new one in the same family (sliding REFRESH_TTL_DAYS). A retired token presented again revokes the whole family.
 */
@Injectable()
export class SessionService {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.refreshTtlMs = config.get('REFRESH_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  /** A new session family, after a successful login. */
  start(user: { id: string; role: Role }, client: ClientInfo): Promise<IssuedSession> {
    return this.issue(this.prisma, user, randomUUID(), client);
  }

  async rotate(refreshToken: string, client: ClientInfo): Promise<RotateResult> {
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
    const session = await this.prisma.$transaction(async (tx) => {
      // Conditional retire: of two requests carrying the same token, exactly one wins.
      const { count } = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return count === 1 ? this.issue(tx, current.user, current.familyId, client) : null;
    });
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

  /** Logout everywhere (also after a password change or reset). Returns how many sessions were still active. */
  async endAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
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
