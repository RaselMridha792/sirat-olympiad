import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import type { SessionTwoFactor } from '@sirat/shared';
import { toDataURL } from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SecurityAlerts } from '../../audit/security-alerts.service';
import type { AuthUser } from '../access-token.service';
import { TooManyAttemptsException } from '../auth.service';
import { reportLoginFailure } from '../login-failure-report';
import { type FailureResult, LoginLimiter } from '../login-limiter';
import { PasswordService } from '../password.service';
import { type ClientInfo, type IssuedSession, SessionService } from '../session.service';
import { hashRecoveryCode, newRecoveryCodes, normalizeRecoveryCode } from './recovery-codes';
import type { SecretBox } from './secret-box';
import { CHALLENGE_MAX_ATTEMPTS, TwoFactorChallenges } from './two-factor-challenges';
import { removeTwoFactor } from './two-factor-reset';
import { TWO_FACTOR_ROLES, TwoFactorConfig } from './two-factor.config';
import {
  alreadyEnabled,
  challengeInvalid,
  codeInvalid,
  loginCodeInvalid,
  notEnabled,
  passwordIncorrect,
  resetNotAllowed,
  setupRequired,
  twoFactorRequired,
  twoFactorUnavailable,
} from './two-factor.errors';
import { matchTotp, newTotpSecret, otpauthUri } from './totp';

/** The issuer authenticator apps show next to the account (the email). */
export const TOTP_ISSUER = 'Sirat Olympiad';
/** Codes one pending setup may have checked by enable; the 5th wrong one deletes it (the DB CHECK holds 0-5). */
export const ENABLE_MAX_ATTEMPTS = 5;

/** A second factor as the client sends it: exactly one of the two (the DTO makes sure). */
export interface SecondFactorInput {
  code?: string;
  recoveryCode?: string;
}

/** GET /auth/2fa. */
export interface TwoFactorStatus {
  /** On: enrolled and confirmed with a code. */
  enabled: boolean;
  /** A setup was started and not confirmed yet (POST /auth/2fa/enable). */
  pending: boolean;
  /** This role must sign in with a second factor. */
  required: boolean;
  /** This session proved the second factor. */
  verified: boolean;
  recoveryCodesRemaining: number;
}

/** What a right second factor proved, before it is used up (conditionally, so it works once). */
type Proof =
  { kind: 'totp'; step: number; reseal: string | null } | { kind: 'recovery'; codeId: string };

/** The stored factor a code is checked against. */
interface StoredFactor {
  secretCiphertext: string;
  lastStep: bigint | null;
}

const FACTOR_SELECT = { secretCiphertext: true, enabledAt: true, lastStep: true } as const;

const methodOf = (input: SecondFactorInput) => (input.code !== undefined ? 'totp' : 'recovery');

/**
 * A refusal after which the login challenge is gone (expired, used, used up): the controller also clears its cookie,
 * so the web goes back to the password step.
 */
export class ChallengeEndedException extends HttpException {
  constructor(inner: HttpException) {
    super(inner.getResponse(), inner.getStatus());
  }
}

/**
 * Two-factor login (DECISIONS "Admin two-factor login"). Invariant: a live session of a user with 2FA on proved the
 * code, because turning it on or off and every reset end the user's other sessions. Never logs a code, a secret, a
 * recovery code, a challenge id or an email; audit rows carry none of them.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TwoFactorConfig,
    private readonly challenges: TwoFactorChallenges,
    private readonly limiter: LoginLimiter,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly alerts: SecurityAlerts,
  ) {}

  /** The box that seals the secrets; 503 TWO_FACTOR_UNAVAILABLE while 2FA is off. Every 2FA route starts here. */
  requireBox(): SecretBox {
    if (!this.config.box) throw twoFactorUnavailable();
    return this.config.box;
  }

  /**
   * The login's code step. The challenge (from the cookie) names the user, and every code first reserves one of its 5
   * attempts atomically, so parallel guesses never get more than 5 codes checked. The login limits apply as to a
   * password (a lock refuses even the right code), and a wrong code counts there. A right one takes the challenge once
   * (GETDEL) and uses the code once (a conditional update), so two parallel right codes give exactly one session. Only
   * then are the failure counts reset and the session started, with the proof.
   */
  async verifyLogin(
    challengeId: unknown,
    input: SecondFactorInput,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const box = this.requireBox();
    const id = typeof challengeId === 'string' ? challengeId : '';
    const reserved = id ? await this.challenges.reserve(id) : null;
    if (!reserved) throw new ChallengeEndedException(challengeInvalid());
    const { userId, attempt } = reserved;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isBlocked: true,
        twoFactor: { select: FACTOR_SELECT },
      },
    });
    const factor = user?.twoFactor;
    if (!user || user.isBlocked || !factor?.enabledAt) {
      // Blocked, or 2FA reset since the password: this challenge can never succeed.
      await this.challenges.discard(id);
      throw new ChallengeEndedException(challengeInvalid());
    }

    await this.checkLimits(user.email, client);
    const proof = await this.prove(box, user.id, factor, input);
    if (!proof) {
      const usedUp = attempt >= CHALLENGE_MAX_ATTEMPTS;
      if (usedUp) await this.challenges.discard(id);
      await this.countFailure(user, 'login', input, client, { challengeUsedUp: usedUp });
      throw usedUp ? new ChallengeEndedException(loginCodeInvalid()) : loginCodeInvalid();
    }
    // Single use: of two requests with the right code, one takes the challenge; the other was too late.
    if ((await this.challenges.claim(id)) !== user.id)
      throw new ChallengeEndedException(challengeInvalid());
    // The same code (or recovery code) through another challenge a moment earlier: refused, it works once.
    if (!(await this.consume(this.prisma, user.id, proof)))
      throw new ChallengeEndedException(loginCodeInvalid());

    await this.limiter.recordSuccess(user.email, client.ip);
    const session = await this.sessions.startVerified({ id: user.id, role: user.role }, client);
    if (proof.kind === 'recovery') await this.recoveryCodeUsed(user.id, 'login', client);
    return session;
  }

  /** GET /auth/2fa: the caller's own state. */
  async status(actor: AuthUser): Promise<TwoFactorStatus> {
    this.requireBox();
    const row = await this.prisma.userTwoFactor.findUnique({
      where: { userId: actor.id },
      select: { enabledAt: true },
    });
    const enabled = row?.enabledAt != null;
    return {
      enabled,
      pending: row !== null && !enabled,
      required: this.config.requiredFor(actor.role),
      verified: actor.twoFactor,
      recoveryCodesRemaining: enabled
        ? await this.prisma.twoFactorRecoveryCode.count({
            where: { userId: actor.id, usedAt: null },
          })
        : 0,
    };
  }

  /**
   * For GET /auth/me (no 503: with 2FA off nothing is required). Only the roles that may enrol are looked up, so a
   * student's /auth/me reads nothing more.
   */
  async sessionState(
    user: { id: string; role: Role },
    verified: boolean,
  ): Promise<SessionTwoFactor> {
    const enrolable = TWO_FACTOR_ROLES.includes(user.role);
    const row = enrolable
      ? await this.prisma.userTwoFactor.findUnique({
          where: { userId: user.id },
          select: { enabledAt: true },
        })
      : null;
    return {
      enabled: row?.enabledAt != null,
      required: this.config.requiredFor(user.role),
      verified,
    };
  }

  /**
   * POST /auth/2fa/setup: the password again, under the login limits (a stolen session alone cannot enrol). Creates or
   * replaces the PENDING factor with a new sealed secret and returns it once as an otpauth URI and a QR code. Refused
   * while 2FA is on (turn it off first).
   */
  async setup(
    actor: AuthUser,
    password: string,
    client: ClientInfo,
  ): Promise<{ otpauthUri: string; qrDataUri: string }> {
    const box = this.requireBox();
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        isBlocked: true,
        passwordHash: true,
        twoFactor: { select: { enabledAt: true } },
      },
    });
    if (!user || user.isBlocked) throw new UnauthorizedException('Authentication required');
    if (user.twoFactor?.enabledAt) throw alreadyEnabled();
    await this.checkPassword(user, password, 'setup', client);
    await this.limiter.recordSuccess(user.email, client.ip);

    const secret = newTotpSecret();
    const sealed = box.seal(secret);
    const uri = otpauthUri(secret, user.email, TOTP_ISSUER);
    secret.fill(0);
    // Never over a confirmed factor: a parallel enable that won keeps its secret.
    const written = await this.prisma.$executeRaw`
      INSERT INTO "user_two_factor" ("user_id", "secret_ciphertext") VALUES (${user.id}::uuid, ${sealed})
      ON CONFLICT ("user_id") DO UPDATE
        SET "secret_ciphertext" = EXCLUDED."secret_ciphertext", "enable_attempts" = 0, "updated_at" = now()
        WHERE "user_two_factor"."enabled_at" IS NULL`;
    if (written !== 1) throw alreadyEnabled();
    await this.audit.record({ action: 'auth.2fa_setup_started', actorId: user.id, ip: client.ip });
    const qrDataUri = await toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 256 });
    return { otpauthUri: uri, qrDataUri };
  }

  /**
   * POST /auth/2fa/enable: a code from the pending secret confirms it (and is its first used step). Creates 10
   * recovery codes (only their hashes are stored; the codes are returned once), ends every session of the user, and
   * starts a new one for this device with the proof. Not under the login limits (the caller holds the secret it is
   * confirming), but a stolen session must not guess at the pending secret either: each attempt is reserved on the
   * pending row before its code is checked, and the 5th wrong code deletes the row (409 TWO_FACTOR_SETUP_REQUIRED),
   * so setup, which asks for the password, must run again. A column, not Redis: the count dies with the row, a new
   * setup resets it in the same statement, and the cache Redis may evict keys.
   */
  async enable(
    actor: AuthUser,
    code: string,
    client: ClientInfo,
  ): Promise<{ session: IssuedSession; recoveryCodes: string[] }> {
    const box = this.requireBox();
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        role: true,
        isBlocked: true,
        twoFactor: { select: { secretCiphertext: true, enabledAt: true } },
      },
    });
    if (!user || user.isBlocked) throw new UnauthorizedException('Authentication required');
    const pending = user.twoFactor;
    if (pending?.enabledAt) throw alreadyEnabled();
    if (!pending) throw setupRequired();
    // Reserve this attempt first (atomic, conditional): parallel guesses cannot pass the cap.
    const reserved = await this.prisma.$queryRaw<{ attempt: number }[]>`
      UPDATE "user_two_factor"
      SET "enable_attempts" = "enable_attempts" + 1, "updated_at" = now()
      WHERE "user_id" = ${user.id}::uuid AND "enabled_at" IS NULL
        AND "secret_ciphertext" = ${pending.secretCiphertext}
        AND "enable_attempts" < ${ENABLE_MAX_ATTEMPTS}
      RETURNING "enable_attempts" AS "attempt"`;
    const attempt = reserved[0]?.attempt;
    if (attempt === undefined) {
      // Used up (by parallel attempts), or replaced by a new setup meanwhile (then it stays).
      await this.dropPending(user.id, { enableAttempts: { gte: ENABLE_MAX_ATTEMPTS } });
      throw setupRequired();
    }
    const proof = await this.prove(
      box,
      user.id,
      { secretCiphertext: pending.secretCiphertext, lastStep: null },
      { code },
    );
    if (proof?.kind !== 'totp') {
      const usedUp = attempt >= ENABLE_MAX_ATTEMPTS;
      await this.audit.record({
        action: 'auth.2fa_failed',
        actorId: user.id,
        ip: client.ip,
        meta: { purpose: 'enable', method: 'totp', locked: false, setupUsedUp: usedUp },
      });
      if (!usedUp) throw codeInvalid();
      await this.dropPending(user.id, { secretCiphertext: pending.secretCiphertext });
      throw setupRequired();
    }

    const recoveryCodes = newRecoveryCodes();
    const ended = await this.prisma.$transaction(async (tx) => {
      // Only the secret this code proved: a setup that replaced it meanwhile wins, and so does a parallel enable.
      // The right code clears the attempt count.
      const { count } = await tx.userTwoFactor.updateMany({
        where: { userId: user.id, enabledAt: null, secretCiphertext: pending.secretCiphertext },
        data: { enabledAt: new Date(), lastStep: BigInt(proof.step), enableAttempts: 0 },
      });
      if (count !== 1) return null;
      await this.replaceRecoveryCodes(tx, user.id, recoveryCodes);
      return this.sessions.endAllForUser(user.id, tx);
    });
    if (ended === null) throw setupRequired();
    const session = await this.sessions.startVerified({ id: user.id, role: user.role }, client);
    await this.audit.record({
      action: 'auth.2fa_enabled',
      actorId: user.id,
      ip: client.ip,
      meta: { sessionsEnded: ended },
    });
    return { session, recoveryCodes };
  }

  /** POST /auth/2fa/recovery-codes: a current TOTP code (under the login limits) replaces every recovery code. */
  async replaceRecoveryCodesWithCode(
    actor: AuthUser,
    code: string,
    client: ClientInfo,
  ): Promise<string[]> {
    const box = this.requireBox();
    const user = await this.enrolledUser(actor.id);
    await this.checkLimits(user.email, client);
    const proof = await this.prove(box, user.id, user.twoFactor, { code });
    if (!proof) {
      await this.countFailure(user, 'recovery_codes', { code }, client);
      throw codeInvalid();
    }
    const codes = newRecoveryCodes();
    const done = await this.prisma.$transaction(async (tx) => {
      if (!(await this.consume(tx, user.id, proof))) return false;
      await this.replaceRecoveryCodes(tx, user.id, codes);
      return true;
    });
    if (!done) throw codeInvalid();
    await this.audit.record({
      action: 'auth.2fa_recovery_codes_replaced',
      actorId: user.id,
      ip: client.ip,
      meta: { count: codes.length },
    });
    return codes;
  }

  /**
   * POST /auth/2fa/disable: both factors, the password and a code (TOTP or recovery), under the login limits. Removes
   * the factor and the recovery codes, ends every session of the user, and starts a new one for this device with
   * `tfa` false (an admin or manager is then sent to enrolment again).
   */
  async disable(
    actor: AuthUser,
    input: SecondFactorInput & { password: string },
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const box = this.requireBox();
    const user = await this.enrolledUser(actor.id);
    await this.checkPassword(user, input.password, 'disable', client);
    const factor = { code: input.code, recoveryCode: input.recoveryCode };
    const proof = await this.prove(box, user.id, user.twoFactor, factor);
    if (!proof) {
      await this.countFailure(user, 'disable', factor, client);
      throw codeInvalid();
    }
    const ended = await this.prisma.$transaction(async (tx) => {
      if (!(await this.consume(tx, user.id, proof))) return null;
      return removeTwoFactor(tx, user.id);
    });
    if (ended === null) throw codeInvalid();
    await this.limiter.recordSuccess(user.email, client.ip);
    const session = await this.sessions.start({ id: user.id, role: user.role }, client);
    await this.audit.record({
      action: 'auth.2fa_disabled',
      actorId: user.id,
      ip: client.ip,
      meta: { method: methodOf(factor), sessionsEnded: ended },
    });
    if (proof.kind === 'recovery') await this.recoveryCodeUsed(user.id, 'disable', client);
    return session;
  }

  /**
   * POST /admin/users/:id/2fa/reset (a lost device): an admin whose own session proved 2FA, with a current code of
   * their OWN (step-up; not a recovery code, under the login limits), removes the 2FA of another admin or manager and
   * ends all of the target's sessions. Never their own (recovery codes, or another admin). Audited with the reason;
   * a security alert. The target's access tokens stay valid until they expire (DECISIONS, the known gap).
   */
  async adminReset(
    actor: AuthUser,
    targetId: string,
    input: { code: string; reason: string },
    client: ClientInfo,
  ): Promise<{ sessionsEnded: number }> {
    const box = this.requireBox();
    if (!actor.twoFactor) throw twoFactorRequired(); // the guard refuses this already; kept explicit
    if (targetId === actor.id)
      throw resetNotAllowed(
        'You cannot reset your own two-factor login: use a recovery code, or ask another admin',
      );
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, twoFactor: { select: { userId: true } } },
    });
    if (!target) throw new NotFoundException('User not found');
    if (!TWO_FACTOR_ROLES.includes(target.role))
      throw resetNotAllowed('Only an admin or manager has two-factor login');
    if (!target.twoFactor) throw notEnabled();

    const me = await this.enrolledUser(actor.id, true);
    await this.checkLimits(me.email, client);
    const proof = await this.prove(box, me.id, me.twoFactor, { code: input.code });
    if (!proof) {
      await this.countFailure(me, 'reset', { code: input.code }, client);
      throw codeInvalid();
    }
    const ended = await this.prisma.$transaction(async (tx) => {
      if (!(await this.consume(tx, me.id, proof))) return null;
      return removeTwoFactor(tx, target.id);
    });
    if (ended === null) throw codeInvalid();
    await this.audit.record({
      action: 'auth.2fa_reset',
      actorId: actor.id,
      entityType: 'user',
      entityId: target.id,
      ip: client.ip,
      meta: { via: 'admin', reason: input.reason, sessionsEnded: ended },
    });
    await this.alerts.raise('two_factor.reset', {
      actorId: actor.id,
      ip: client.ip,
      meta: { via: 'admin', targetUserId: target.id, sessionsEnded: ended },
    });
    return { sessionsEnded: ended };
  }

  /**
   * The caller with an enrolled factor; 409 TWO_FACTOR_NOT_ENABLED without one (`asActor`: 403 TWO_FACTOR_REQUIRED,
   * for the admin reset's step-up). A blocked account is no session at all.
   */
  private async enrolledUser(userId: string, asActor = false) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isBlocked: true,
        passwordHash: true,
        twoFactor: { select: FACTOR_SELECT },
      },
    });
    if (!user || user.isBlocked) throw new UnauthorizedException('Authentication required');
    const factor = user.twoFactor;
    if (!factor?.enabledAt) throw asActor ? twoFactorRequired() : notEnabled();
    return { ...user, twoFactor: factor };
  }

  /** The login limits before a code or password is checked: a lock refuses even the right one (429). */
  private async checkLimits(email: string, client: ClientInfo): Promise<void> {
    const verdict = await this.limiter.check(email, client.ip);
    if (!verdict.allowed)
      throw new TooManyAttemptsException(Math.ceil(verdict.retryAfterMs / 1000));
  }

  /** The password again, under the login limits (like change-password); a wrong one counts there. */
  private async checkPassword(
    user: { id: string; email: string; passwordHash: string },
    password: string,
    purpose: string,
    client: ClientInfo,
  ): Promise<void> {
    await this.checkLimits(user.email, client);
    if (await this.passwords.verify(user.passwordHash, password)) return;
    const failure = await this.limiter.recordFailure(user.email, client.ip);
    await this.audit.record({
      action: 'auth.2fa_password_failed',
      actorId: user.id,
      ip: client.ip,
      meta: { purpose, locked: failure.lockedForMs > 0 },
    });
    await this.report(failure, user.id, client);
    throw passwordIncorrect();
  }

  /**
   * Checks a second factor against the stored one, without using it: the TOTP code against the secret and the newest
   * step already used, or the recovery code by its hash among the unused ones. Null for a wrong code.
   */
  private async prove(
    box: SecretBox,
    userId: string,
    factor: StoredFactor,
    input: SecondFactorInput,
  ): Promise<Proof | null> {
    if (input.code !== undefined) {
      let secret: Buffer;
      try {
        secret = box.open(factor.secretCiphertext);
      } catch {
        // A key that does not match (a wrong or rotated-away TOTP_ENCRYPTION_KEY). Only the user id is logged.
        this.logger.error({
          msg: 'two-factor secret does not open with the configured keys',
          userId,
        });
        return null;
      }
      const lastStep = factor.lastStep === null ? null : Number(factor.lastStep);
      const step = matchTotp(secret, input.code, Date.now(), lastStep);
      // After a key rotation, a right code re-seals the secret with the current key.
      const reseal =
        step !== null && box.isStale(factor.secretCiphertext) ? box.seal(secret) : null;
      secret.fill(0);
      return step === null ? null : { kind: 'totp', step, reseal };
    }
    const normalized = normalizeRecoveryCode(input.recoveryCode ?? '');
    if (!normalized) return null;
    const row = await this.prisma.twoFactorRecoveryCode.findFirst({
      where: { userId, codeHash: hashRecoveryCode(normalized), usedAt: null },
      select: { id: true },
    });
    return row ? { kind: 'recovery', codeId: row.id } : null;
  }

  /**
   * Uses a proof up, once: a TOTP step only if it is newer than the last one used (replay), a recovery code only if
   * still unused. False when a parallel request used it first.
   */
  private async consume(
    db: Prisma.TransactionClient,
    userId: string,
    proof: Proof,
  ): Promise<boolean> {
    if (proof.kind === 'totp') {
      const step = BigInt(proof.step);
      const updated = await db.$executeRaw`
        UPDATE "user_two_factor"
        SET "last_step" = ${step},
            "secret_ciphertext" = COALESCE(${proof.reseal}::text, "secret_ciphertext"),
            "updated_at" = now()
        WHERE "user_id" = ${userId}::uuid AND "enabled_at" IS NOT NULL
          AND ("last_step" IS NULL OR "last_step" < ${step})`;
      return updated === 1;
    }
    const updated = await db.$executeRaw`
      UPDATE "two_factor_recovery_codes" SET "used_at" = now()
      WHERE "id" = ${proof.codeId}::uuid AND "user_id" = ${userId}::uuid AND "used_at" IS NULL`;
    return updated === 1;
  }

  /** Deletes the user's PENDING factor (never a confirmed one) when it also matches `where`. */
  private async dropPending(userId: string, where: Prisma.UserTwoFactorWhereInput): Promise<void> {
    await this.prisma.userTwoFactor.deleteMany({ where: { ...where, userId, enabledAt: null } });
  }

  private async replaceRecoveryCodes(
    tx: Prisma.TransactionClient,
    userId: string,
    codes: string[],
  ): Promise<void> {
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
    await tx.twoFactorRecoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        codeHash: hashRecoveryCode(normalizeRecoveryCode(code) ?? ''),
      })),
    });
  }

  /** A wrong code counted in the login limits: audited (no code, no email); a lock or limit raises what login raises. */
  private async countFailure(
    user: { id: string; email: string },
    purpose: string,
    input: SecondFactorInput,
    client: ClientInfo,
    extra: Record<string, boolean> = {},
  ): Promise<void> {
    const failure = await this.limiter.recordFailure(user.email, client.ip);
    await this.audit.record({
      action: 'auth.2fa_failed',
      actorId: user.id,
      ip: client.ip,
      meta: { purpose, method: methodOf(input), locked: failure.lockedForMs > 0, ...extra },
    });
    await this.report(failure, user.id, client);
  }

  private report(failure: FailureResult, userId: string, client: ClientInfo): Promise<void> {
    return reportLoginFailure(
      { audit: this.audit, alerts: this.alerts },
      failure,
      userId,
      client.ip,
    );
  }

  /** A recovery code was used: audited with the number left, and an alert (a human checks it was the owner). */
  private async recoveryCodeUsed(
    userId: string,
    purpose: string,
    client: ClientInfo,
  ): Promise<void> {
    const remaining = await this.prisma.twoFactorRecoveryCode.count({
      where: { userId, usedAt: null },
    });
    await this.audit.record({
      action: 'auth.2fa_recovery_used',
      actorId: userId,
      ip: client.ip,
      meta: { purpose, remaining },
    });
    await this.alerts.raise('two_factor.recovery_used', {
      actorId: userId,
      ip: client.ip,
      meta: { purpose, remaining },
    });
  }
}
