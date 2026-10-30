import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from './access-token.service';
import { LoginLimiter } from './login-limiter';
import { PasswordService } from './password.service';
import { type ClientInfo, type IssuedSession, SessionService } from './session.service';

/** One message for every failed login: it never tells whether the email has an account. */
export const LOGIN_FAILED_MESSAGE = 'Email or password is incorrect';

/**
 * 429 for a locked pair or a reached limit. Same text whether or not the account exists, and it names the way out:
 * a completed password reset lifts the lock (owner).
 */
export class TooManyAttemptsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Login, password and email-token flows (RULEBOOK §5, owner rules of 2026-10-31). */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginLimiter,
    private readonly audit: AuditService,
  ) {}

  /**
   * Limits first: during a lock the password is not even checked, so the right one is refused too (owner).
   * An unknown email costs the same argon2 work as a real one and is counted the same way. Returns the new session
   * only (the caller sets cookies; the body stays empty and the web reads /auth/me). A successful login is not
   * audited: the sessions row records it, keeping login at one read and one write (02-SYSTEM-DESIGN §3).
   */
  async login(email: string, password: string, client: ClientInfo): Promise<IssuedSession> {
    const verdict = await this.limiter.check(email, client.ip);
    if (!verdict.allowed)
      throw new TooManyAttemptsException(Math.ceil(verdict.retryAfterMs / 1000));

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, isBlocked: true, passwordHash: true },
    });
    const ok = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verifyDummy(password);

    if (!user || !ok) {
      // Audit rows carry no email and no email hash (personal data); unknown emails have no actor.
      const failure = await this.limiter.recordFailure(email, client.ip);
      const actorId = user?.id ?? null;
      await this.audit.record({
        action: 'auth.login_failed',
        actorId,
        ip: client.ip,
        meta: { reason: user ? 'bad_password' : 'unknown_email' },
      });
      if (failure.lockedForMs > 0)
        await this.audit.record({
          action: 'auth.login_locked',
          actorId,
          ip: client.ip,
          meta: {
            scope: 'account_ip',
            level: failure.lockLevel,
            minutes: failure.lockedForMs / 60_000,
          },
        });
      if (failure.accountLimitStarted)
        await this.audit.record({
          action: 'auth.login_locked',
          actorId,
          ip: client.ip,
          meta: { scope: 'account' },
        });
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    await this.limiter.recordSuccess(email, client.ip);
    if (user.isBlocked) {
      // Only someone who knows the password learns that the account is blocked.
      await this.audit.record({
        action: 'auth.login_blocked_user',
        actorId: user.id,
        ip: client.ip,
      });
      throw new ForbiddenException('This account is blocked. Please contact support');
    }
    if (this.passwords.needsRehash(user.passwordHash)) await this.rehash(user.id, password);

    return this.sessions.start({ id: user.id, role: user.role }, client);
  }

  /**
   * Change password (RULEBOOK §5): the current password is checked under the same limits as login, since a stolen
   * session must not become a way to guess it. Success ends every session on every device and starts a fresh one
   * for this device, which the caller sets as cookies.
   */
  async changePassword(
    actor: AuthUser,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, email: true, role: true, isBlocked: true, passwordHash: true },
    });
    if (!user || user.isBlocked) throw new UnauthorizedException('Authentication required');

    const verdict = await this.limiter.check(user.email, client.ip);
    if (!verdict.allowed)
      throw new TooManyAttemptsException(Math.ceil(verdict.retryAfterMs / 1000));
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      const { lockedForMs } = await this.limiter.recordFailure(user.email, client.ip);
      await this.audit.record({
        action: 'auth.password_change_failed',
        actorId: user.id,
        ip: client.ip,
        meta: { locked: lockedForMs > 0 },
      });
      throw new BadRequestException('Current password is incorrect');
    }
    await this.limiter.recordSuccess(user.email, client.ip);
    if (await this.passwords.verify(user.passwordHash, newPassword))
      throw new BadRequestException('Choose a new password that differs from the current one');

    const passwordHash = await this.passwords.hash(newPassword); // CPU work outside the transaction
    const ended = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      // An emailed reset link must not set a password over the one just chosen.
      await tx.authToken.updateMany({
        where: { userId: user.id, type: AuthTokenType.password_reset, usedAt: null },
        data: { usedAt: new Date() },
      });
      return this.sessions.endAllForUser(user.id, tx);
    });
    const session = await this.sessions.start({ id: user.id, role: user.role }, client);
    await this.audit.record({
      action: 'auth.password_changed',
      actorId: user.id,
      ip: client.ip,
      meta: { sessionsEnded: ended },
    });
    return session;
  }

  /** Upgrades an older hash after a successful login. Best effort: a failure here never blocks the login. */
  private async rehash(userId: string, password: string): Promise<void> {
    try {
      const passwordHash = await this.passwords.hash(password);
      await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    } catch {
      this.logger.warn({ msg: 'password rehash failed', userId });
    }
  }
}
