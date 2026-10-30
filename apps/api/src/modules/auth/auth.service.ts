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
import { SecurityAlerts } from '../audit/security-alerts.service';
import type { AuthUser } from './access-token.service';
import { EmailTokenService } from './email-tokens.service';
import { LoginLimiter } from './login-limiter';
import { PasswordService } from './password.service';
import { type ClientInfo, type IssuedSession, SessionService } from './session.service';

/** One message for every failed login: it never tells whether the email has an account. */
export const LOGIN_FAILED_MESSAGE = 'Email or password is incorrect';
/** One message for every bad emailed link: unknown, malformed, used, expired, other type, or a blocked account. */
export const INVALID_LINK_MESSAGE = 'This link is invalid or has expired';

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
    private readonly alerts: SecurityAlerts,
    private readonly tokens: EmailTokenService,
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
      // Owner conditions for the account limit (2026-10-31): its start and a distributed attempt are alerts.
      if (failure.accountLimitStarted)
        await this.alerts.raise('login.account_limit', {
          actorId,
          ip: client.ip,
          meta: { accountFailures: failure.accountFailures, distinctIps: failure.distinctIps },
        });
      if (failure.distributedSignal)
        await this.alerts.raise('login.distributed', {
          actorId,
          ip: client.ip,
          meta: { accountFailures: failure.accountFailures, distinctIps: failure.distinctIps },
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

  /**
   * Completes a password reset. A bad link is refused before argon2 runs; then one transaction uses the token, sets
   * the hash, marks the email verified (the link proved the inbox), retires other reset links and ends every
   * session. Only after the commit is the account unlocked everywhere (owner) - a failed reset never unlocks.
   * No session is started: the user logs in with the new password.
   */
  async resetPassword(token: string, password: string, client: ClientInfo): Promise<void> {
    if (!(await this.tokens.isUsable(token, AuthTokenType.password_reset)))
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    const passwordHash = await this.passwords.hash(password);
    const done = await this.prisma.$transaction(async (tx) => {
      const used = await this.tokens.consume(token, AuthTokenType.password_reset, tx);
      if (!used) return null;
      const user = await tx.user.findUnique({
        where: { id: used.userId },
        select: { id: true, email: true, isBlocked: true, emailVerifiedAt: true },
      });
      if (!user || user.isBlocked) return null; // a reset never lifts a block
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
      });
      await tx.authToken.updateMany({
        where: { userId: user.id, type: AuthTokenType.password_reset, usedAt: null },
        data: { usedAt: new Date() },
      });
      return { user, ended: await this.sessions.endAllForUser(user.id, tx) };
    });
    if (!done) throw new BadRequestException(INVALID_LINK_MESSAGE);
    await this.limiter.resetAccount(done.user.email);
    await this.audit.record({
      action: 'auth.password_reset',
      actorId: done.user.id,
      ip: client.ip,
      meta: { sessionsEnded: done.ended },
    });
  }

  /**
   * Verifies an email address. Never logs anyone in (RULEBOOK §5). A valid link for an address that is already
   * verified still answers 204 and changes nothing.
   */
  async verifyEmail(token: string, client: ClientInfo): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const used = await this.tokens.consume(token, AuthTokenType.email_verify, tx);
      if (!used) return null;
      const user = await tx.user.findUnique({
        where: { id: used.userId },
        select: { id: true, isBlocked: true, emailVerifiedAt: true },
      });
      if (!user || user.isBlocked) return null;
      await tx.authToken.updateMany({
        where: { userId: user.id, type: AuthTokenType.email_verify, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (user.emailVerifiedAt) return { userId: user.id, newlyVerified: false };
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      return { userId: user.id, newlyVerified: true };
    });
    if (!result) throw new BadRequestException(INVALID_LINK_MESSAGE);
    if (result.newlyVerified)
      await this.audit.record({
        action: 'auth.email_verified',
        actorId: result.userId,
        ip: client.ip,
      });
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
