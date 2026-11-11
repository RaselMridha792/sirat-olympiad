import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenType } from '@prisma/client';
import { formatParticipantId, logsInWithParticipantId, type Role } from '@sirat/shared';
import { BackgroundTasks } from '../../common/background/background-tasks';
import type { EnvVars } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SecurityAlerts } from '../audit/security-alerts.service';
import { EmailQueue } from '../notifications/email-queue.service';
import type { AuthUser } from './access-token.service';
import {
  emailLink,
  participantIdMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from './auth-emails';
import { EmailSendLimiter } from './email-send-limiter';
import { EmailTokenService } from './email-tokens.service';
import { reportLoginFailure } from './login-failure-report';
import { LoginLimiter } from './login-limiter';
import { PasswordService } from './password.service';
import { type ClientInfo, type IssuedSession, SessionService } from './session.service';
import { TwoFactorChallenges } from './two-factor/two-factor-challenges';
import { TwoFactorConfig } from './two-factor/two-factor.config';
import { twoFactorRequired } from './two-factor/two-factor.errors';

/** One message for every failed login: it never tells whether the email has an account. */
export const LOGIN_FAILED_MESSAGE = 'Email or password is incorrect';
/**
 * The participant-ID login's one message for every miss: an unknown email, a wrong ID, a staff account, an account
 * without a registration. The message depends only on the kind the client sent, never on the account.
 */
export const PARTICIPANT_LOGIN_FAILED_MESSAGE = 'Email or participant ID is incorrect';

/** Students and ambassadors have no password (owner, 2026-11-10): nothing to change. */
export const passwordNotUsed = () =>
  new ForbiddenException({
    code: 'PASSWORD_NOT_USED',
    message:
      'Students and ambassadors log in with their participant ID; there is no password to change',
  });

/** What the login checks: a staff password, or a student's or ambassador's participant ID (canonical form). */
export type LoginCredential =
  { kind: 'password'; password: string } | { kind: 'participant_id'; participantId: string };

/** Compared when there is no stored ID, so a miss costs the same as a wrong ID (a valid Damm form, never issued). */
const NO_PARTICIPANT_ID = 'ON00000000000';
const digest = (value: string) => createHash('sha256').update(value).digest();
/** Constant-time over fixed-length digests: the time never depends on how much of the ID matched. */
const sameParticipantId = (stored: string, given: string) =>
  timingSafeEqual(digest(stored), digest(given));
/** One message for every bad emailed link: unknown, malformed, used, expired, other type, or a blocked account. */
export const INVALID_LINK_MESSAGE = 'This link is invalid or has expired';

/**
 * 429 for a locked pair or a reached limit. Same text whether or not the account exists, and it names the way out:
 * a completed password reset lifts the lock (owner).
 */
export class TooManyAttemptsException extends HttpException {
  /** `passwordHint`: off for the participant-ID login, which has no password to reset. */
  constructor(
    readonly retryAfterSeconds: number,
    passwordHint = true,
  ) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}${
        passwordHint ? ', or reset your password' : ''
      }`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** A right password: a session, or (two-factor login on) the challenge for the code step. */
export type LoginOutcome =
  { kind: 'session'; session: IssuedSession } | { kind: 'two_factor'; challengeId: string };

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
    private readonly emails: EmailQueue,
    private readonly sendLimiter: EmailSendLimiter,
    private readonly background: BackgroundTasks,
    private readonly twoFactor: TwoFactorConfig,
    private readonly challenges: TwoFactorChallenges,
    config: ConfigService<EnvVars, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }) ?? 'http://localhost:3000';
    this.resetMinutes = config.get('PASSWORD_RESET_TOKEN_MINUTES', { infer: true });
    this.verifyHours = config.get('EMAIL_VERIFY_TOKEN_HOURS', { infer: true });
  }

  private get signals() {
    return { audit: this.audit, alerts: this.alerts };
  }

  /** Web origin for email links (APP_URL; required in production). */
  private readonly appUrl: string;
  private readonly resetMinutes: number;
  private readonly verifyHours: number;

  /**
   * Forgot password. The caller answers the same at once; the lookup, the token and the email run in the
   * background, so neither the answer nor its timing reveals whether an account exists. Unknown and blocked
   * accounts get nothing; one address gets at most AUTH_LINK_EMAILS_PER_MINUTE/HOUR reset emails.
   */
  requestPasswordReset(email: string): void {
    this.background.run('password-reset-email', () => this.sendPasswordReset(email));
  }

  /** Resend verification: the same shape; only an existing, unblocked, unverified account gets an email. */
  requestVerificationEmail(email: string): void {
    this.background.run('verify-email', () => this.sendVerification(email));
  }

  /**
   * Forgot my participant ID (docs/plans/PARTICIPANT-LOGIN-PLAN.md §3): the same shape as forgot-password. Only an
   * unblocked student or ambassador with a registration gets an email, at its own address only; one address gets at
   * most AUTH_LINK_EMAILS_PER_MINUTE/HOUR of them, forgot-password's ID emails included.
   */
  requestParticipantId(email: string): void {
    this.background.run('participant-id-email', () => this.sendParticipantId(email));
  }

  private findForEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isBlocked: true,
        registration: { select: { participantId: true } },
      },
    });
  }

  private async sendParticipantId(email: string): Promise<void> {
    const user = await this.findForEmail(email);
    if (!user || !logsInWithParticipantId(user.role)) return;
    await this.sendParticipantIdTo(user);
  }

  /** The ID email itself. The ID goes to the account's own address and nowhere else: never a log or an audit row. */
  private async sendParticipantIdTo(user: {
    id: string;
    name: string;
    email: string;
    isBlocked: boolean;
    registration: { participantId: string } | null;
  }): Promise<void> {
    if (!(await this.sendLimiter.allow('participant_id', user.email))) return;
    if (user.isBlocked || !user.registration) return;
    const sent = await this.emails.enqueue('participant-id', `participant-id.${randomUUID()}`, {
      to: user.email,
      ...participantIdMessage(
        user.name,
        formatParticipantId(user.registration.participantId),
        `${this.appUrl}/login`,
      ),
    });
    if (sent) await this.audit.record({ action: 'auth.participant_id_sent', actorId: user.id });
  }

  private async sendPasswordReset(email: string): Promise<void> {
    const user = await this.findForEmail(email);
    // A student or ambassador has no password (owner, 2026-11-10): "forgot password" sends the participant ID.
    if (user && logsInWithParticipantId(user.role)) return this.sendParticipantIdTo(user);
    if (!(await this.sendLimiter.allow('reset', email))) return;
    if (!user || user.isBlocked) return;
    const issued = await this.tokens.issue(user.id, AuthTokenType.password_reset);
    const link = emailLink(this.appUrl, 'reset-password', issued.token);
    await this.emails.enqueue('password-reset', `password-reset.${issued.id}`, {
      to: user.email,
      ...resetPasswordMessage(user.name, link, this.resetMinutes),
    });
  }

  private async sendVerification(email: string): Promise<void> {
    if (!(await this.sendLimiter.allow('verify', email))) return;
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, isBlocked: true, emailVerifiedAt: true },
    });
    if (!user || user.isBlocked || user.emailVerifiedAt) return;
    const issued = await this.tokens.issue(user.id, AuthTokenType.email_verify);
    const link = emailLink(this.appUrl, 'verify-email', issued.token);
    await this.emails.enqueue('verify-email', `verify-email.${issued.id}`, {
      to: user.email,
      ...verifyEmailMessage(user.name, link, this.verifyHours),
    });
  }

  /**
   * Limits first: during a lock the password is not even checked, so the right one is refused too (owner).
   * An unknown email costs the same argon2 work as a real one and is counted the same way. Returns the new session
   * (the caller sets cookies; the body stays empty and the web reads /auth/me), or, for an account with two-factor
   * login on, a challenge for the code step: then nothing resets the failure counts and no session exists until the
   * code (POST /auth/2fa/verify). A successful login is not audited: the sessions row records it, keeping a student's
   * login at one read and one write (02-SYSTEM-DESIGN §3).
   */
  async login(
    email: string,
    credential: LoginCredential,
    client: ClientInfo,
  ): Promise<LoginOutcome> {
    const byPassword = credential.kind === 'password';
    const verdict = await this.limiter.check(email, client.ip);
    if (!verdict.allowed)
      throw new TooManyAttemptsException(Math.ceil(verdict.retryAfterMs / 1000), byPassword);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        isBlocked: true,
        passwordHash: true,
        registration: { select: { participantId: true } },
      },
    });
    const check = byPassword
      ? await this.checkPassword(user, credential.password)
      : this.checkParticipantId(user, credential.participantId);

    if (!user || check.miss !== null) {
      // Audit rows carry no email, no email hash and never the ID (personal data); unknown emails have no actor.
      // Both kinds count against the same limits, so switching kinds never buys more guesses.
      const failure = await this.limiter.recordFailure(email, client.ip);
      const actorId = user?.id ?? null;
      await this.audit.record({
        action: 'auth.login_failed',
        actorId,
        ip: client.ip,
        meta: { reason: check.miss ?? 'unknown_email', credential: credential.kind },
      });
      // Owner conditions (2026-10-31): a lock is audited; the account limit's start and a distributed attempt alert.
      await reportLoginFailure(this.signals, failure, actorId, client.ip);
      throw new UnauthorizedException(
        byPassword ? LOGIN_FAILED_MESSAGE : PARTICIPANT_LOGIN_FAILED_MESSAGE,
      );
    }

    // Only the roles that may enrol can have a second factor, so a student's login reads nothing more. Enrolled is
    // enough: the code step never depends on the requirement setting (DECISIONS "The admin 2FA requirement is a
    // setting"), so switching the requirement off never lets an enrolled account skip its code.
    const codeStep =
      this.twoFactor.enrollableFor(user.role) &&
      (
        await this.prisma.userTwoFactor.findUnique({
          where: { userId: user.id },
          select: { enabledAt: true },
        })
      )?.enabledAt != null;
    // With 2FA the counts reset only after the right code: a right password with wrong codes never clears them.
    if (!codeStep) await this.limiter.recordSuccess(email, client.ip);
    if (user.isBlocked) {
      // Only someone who knows the password learns that the account is blocked.
      await this.audit.record({
        action: 'auth.login_blocked_user',
        actorId: user.id,
        ip: client.ip,
      });
      throw new ForbiddenException('This account is blocked. Please contact support');
    }
    if (byPassword && check.hash && this.passwords.needsRehash(check.hash))
      await this.rehash(user.id, credential.password);

    if (codeStep) return { kind: 'two_factor', challengeId: await this.challenges.create(user.id) };
    return {
      kind: 'session',
      session: await this.sessions.start({ id: user.id, role: user.role }, client),
    };
  }

  /**
   * A staff password (admin, manager, jury). A student's or ambassador's account has none: the same miss as a wrong
   * password, after the same argon2 work, so neither the answer nor its timing tells the roles apart.
   */
  private async checkPassword(
    user: { role: Role; passwordHash: string | null } | null,
    password: string,
  ): Promise<{ miss: string | null; hash: string | null }> {
    const hash = user && !logsInWithParticipantId(user.role) ? user.passwordHash : null;
    const ok = hash
      ? await this.passwords.verify(hash, password)
      : await this.passwords.verifyDummy(password);
    if (!user) return { miss: 'unknown_email', hash: null };
    if (!hash) return { miss: 'no_password', hash: null };
    return { miss: ok ? null : 'bad_password', hash };
  }

  /**
   * A student's or ambassador's participant ID, already canonical (the DTO normalized it and checked its Damm digit).
   * One constant-time compare whatever the account, against a fixed value when there is no stored ID.
   */
  private checkParticipantId(
    user: { role: Role; registration: { participantId: string } | null } | null,
    given: string,
  ): { miss: string | null; hash: null } {
    const stored =
      user && logsInWithParticipantId(user.role)
        ? (user.registration?.participantId ?? null)
        : null;
    const same = sameParticipantId(stored ?? NO_PARTICIPANT_ID, given);
    if (!user) return { miss: 'unknown_email', hash: null };
    if (!logsInWithParticipantId(user.role)) return { miss: 'staff_account', hash: null };
    if (stored === null) return { miss: 'no_registration', hash: null };
    return { miss: same ? null : 'bad_participant_id', hash: null };
  }

  /**
   * Change password (RULEBOOK §5): the current password is checked under the same limits as login, since a stolen
   * session must not become a way to guess it. Success ends every session on every device and starts a fresh one
   * for this device, which the caller sets as cookies. The access token's session row must still be alive (401
   * otherwise), and for an enrolled user it must have proved the second factor (403 TWO_FACTOR_REQUIRED, nothing
   * changed): a token outlives its row, and the new session inherits the row's proof, never the token's claim.
   */
  async changePassword(
    actor: AuthUser,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        role: true,
        isBlocked: true,
        passwordHash: true,
        twoFactor: { select: { enabledAt: true } },
      },
    });
    if (!user || user.isBlocked) throw new UnauthorizedException('Authentication required');
    const currentHash = user.passwordHash;
    if (logsInWithParticipantId(user.role) || currentHash === null) throw passwordNotUsed();
    // A session ended by enable (or anything else) must not come back as a fresh one, let alone a verified one.
    const proof = await this.sessions.liveProof(actor.sessionId, user.id);
    if (proof === null) throw new UnauthorizedException('Session expired, log in again');
    const enrolled = this.twoFactor.enabled && user.twoFactor?.enabledAt != null;
    if (enrolled && !proof) throw twoFactorRequired(); // nothing changed, nothing counted

    const verdict = await this.limiter.check(user.email, client.ip);
    if (!verdict.allowed)
      throw new TooManyAttemptsException(Math.ceil(verdict.retryAfterMs / 1000));
    if (!(await this.passwords.verify(currentHash, currentPassword))) {
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
    if (await this.passwords.verify(currentHash, newPassword))
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
    // This device keeps what its session row proved, while the user is enrolled: a password change is no second
    // factor, and never takes one away.
    const fresh = { id: user.id, role: user.role };
    const session =
      proof && enrolled
        ? await this.sessions.startVerified(fresh, client)
        : await this.sessions.start(fresh, client);
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
        select: { id: true, email: true, role: true, isBlocked: true, emailVerifiedAt: true },
      });
      if (!user || user.isBlocked) return null; // a reset never lifts a block
      // Students and ambassadors have no password (owner, 2026-11-10): an old link of theirs is just invalid.
      if (logsInWithParticipantId(user.role)) return null;
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
