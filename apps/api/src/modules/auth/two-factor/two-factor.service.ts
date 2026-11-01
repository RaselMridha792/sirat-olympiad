import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SecurityAlerts } from '../../audit/security-alerts.service';
import { TooManyAttemptsException } from '../auth.service';
import { reportLoginFailure } from '../login-failure-report';
import { type FailureResult, LoginLimiter } from '../login-limiter';
import { type ClientInfo, type IssuedSession, SessionService } from '../session.service';
import { hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import type { SecretBox } from './secret-box';
import { TwoFactorChallenges } from './two-factor-challenges';
import { TwoFactorConfig } from './two-factor.config';
import { challengeInvalid, loginCodeInvalid, twoFactorUnavailable } from './two-factor.errors';
import { matchTotp } from './totp';

/** A second factor as the client sends it: exactly one of the two (the DTO makes sure). */
export interface SecondFactorInput {
  code?: string;
  recoveryCode?: string;
}

/** What a right second factor proved, before it is used up (conditionally, so it works once). */
type Proof =
  { kind: 'totp'; step: number; reseal: string | null } | { kind: 'recovery'; codeId: string };

/** The stored factor a code is checked against. */
interface StoredFactor {
  secretCiphertext: string;
  lastStep: bigint | null;
}

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
 * Two-factor login (DECISIONS "Admin two-factor login"). Never logs a code, a secret, a recovery code, a challenge id
 * or an email; audit rows carry none of them.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TwoFactorConfig,
    private readonly challenges: TwoFactorChallenges,
    private readonly limiter: LoginLimiter,
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
   * The login's code step. The challenge (from the cookie) names the user; the login limits apply as to a password
   * (a lock refuses even the right code). A wrong code counts there, and on the challenge (5 use it up). A right one
   * takes the challenge once (GETDEL) and uses the code once (a conditional update), so two parallel right codes give
   * exactly one session. Only then are the failure counts reset and the session started, with `tfa` true.
   */
  async verifyLogin(
    challengeId: unknown,
    input: SecondFactorInput,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const box = this.requireBox();
    const id = typeof challengeId === 'string' ? challengeId : '';
    const userId = id ? await this.challenges.peek(id) : null;
    if (!userId) throw new ChallengeEndedException(challengeInvalid());
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isBlocked: true,
        twoFactor: { select: { secretCiphertext: true, enabledAt: true, lastStep: true } },
      },
    });
    const factor = user?.twoFactor;
    if (!user || user.isBlocked || !factor?.enabledAt) {
      // Blocked, or 2FA reset since the password: this challenge can never succeed.
      await this.challenges.claim(id);
      throw new ChallengeEndedException(challengeInvalid());
    }

    const verdict = await this.limiter.check(user.email, client.ip);
    if (!verdict.allowed)
      throw new TooManyAttemptsException(Math.ceil(verdict.retryAfterMs / 1000));

    const proof = await this.prove(box, user.id, factor, input);
    if (!proof) {
      const usedUp = await this.challenges.fail(id);
      const failure = await this.limiter.recordFailure(user.email, client.ip);
      await this.recordFailure(user.id, 'login', input, failure, client, {
        challengeUsedUp: usedUp,
      });
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

  /** A wrong code under the login limits: audited (no code, no email), and a lock or limit raises what login raises. */
  private async recordFailure(
    userId: string,
    purpose: string,
    input: SecondFactorInput,
    failure: FailureResult,
    client: ClientInfo,
    extra: Record<string, boolean> = {},
  ): Promise<void> {
    await this.audit.record({
      action: 'auth.2fa_failed',
      actorId: userId,
      ip: client.ip,
      meta: {
        purpose,
        method: input.code !== undefined ? 'totp' : 'recovery',
        locked: failure.lockedForMs > 0,
        ...extra,
      },
    });
    await reportLoginFailure(
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
