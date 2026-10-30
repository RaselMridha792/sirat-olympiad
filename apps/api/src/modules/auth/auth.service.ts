import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { SessionUser } from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginLimiter, emailHash } from './login-limiter';
import { PasswordService } from './password.service';
import { type ClientInfo, type IssuedSession, SessionService } from './session.service';

/** One message for every failed login: it never tells whether the email has an account. */
export const LOGIN_FAILED_MESSAGE = 'Email or password is incorrect';

/** 429 for a locked pair or a reached limit. Same text whether or not the account exists. */
export class TooManyAttemptsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export interface LoginResult {
  user: SessionUser;
  session: IssuedSession;
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
   * An unknown email costs the same argon2 work as a real one and is counted the same way.
   */
  async login(email: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const verdict = await this.limiter.check(email, client.ip);
    if (!verdict.allowed)
      throw new TooManyAttemptsException(Math.ceil(verdict.retryAfterMs / 1000));

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isBlocked: true,
        passwordHash: true,
      },
    });
    const ok = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verifyDummy(password);

    if (!user || !ok) {
      const { lockedForMs, lockLevel } = await this.limiter.recordFailure(email, client.ip);
      await this.audit.record({
        action: 'auth.login_failed',
        actorId: user?.id ?? null,
        ip: client.ip,
        meta: { reason: user ? 'bad_password' : 'unknown_email', emailHash: emailHash(email) },
      });
      if (lockedForMs > 0)
        await this.audit.record({
          action: 'auth.login_locked',
          actorId: user?.id ?? null,
          ip: client.ip,
          meta: { emailHash: emailHash(email), level: lockLevel, minutes: lockedForMs / 60_000 },
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

    const session = await this.sessions.start({ id: user.id, role: user.role }, client);
    await this.audit.record({ action: 'auth.login', actorId: user.id, ip: client.ip });
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      session,
    };
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
