import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@sirat/shared';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from './access-token.service';
import { CurrentUser, Public, TwoFactorOptional } from './auth.decorators';
import { AuthService, TooManyAttemptsException } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailOnlyDto } from './dto/email-only.dto';
import { ResetPasswordDto, VerifyEmailDto } from './dto/email-link.dto';
import { LoginDto } from './dto/login.dto';
import { REFRESH_COOKIE, SessionCookies } from './session-cookies';
import { type ClientInfo, SessionService } from './session.service';
import { TwoFactorService } from './two-factor/two-factor.service';

/**
 * Per client IP and route, for the email-link endpoints people use without a session (DECISIONS "Per-user API
 * limits"). Thousands of students can share one IP (a school, a mobile operator's carrier-grade NAT), so these are
 * sized for an exam-start crowd: resend, reset and verify 300/min (unverified students may all ask for a new link
 * at once; reset and verify take 256-bit single-use tokens refused before argon2). forgot-password gets 120/min:
 * it sends email too, and the per-address caps limit each inbox, not the total.
 */
const EMAIL_LINK_TIER = { default: { limit: 300, ttl: 60_000 } };
const FORGOT_TIER = { default: { limit: 120, ttl: 60_000 } };
/**
 * Renewal is anonymous too (the access cookie has expired), so it counts per client IP. Set above nginx's per-IP
 * api zone (30 r/s): behind nginx the API never refuses a renewal first.
 */
const REFRESH_TIER = { default: { limit: 3_000, ttl: 60_000 } };

const clientInfo = (req: Request): ClientInfo => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Auth endpoints (06-API). Password and email-token endpoints follow. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookies,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /**
   * Sets the session cookies; 204 with an empty body (no token, no personal data; the web reads /auth/me). Not counted by the global
   * limiter: only failed logins count (owner), in LoginLimiter. 401 for any failure, 429 + Retry-After while a
   * lock or limit applies, 403 for a blocked account (after the right password only).
   * An account with two-factor login on gets 200 `{ "twoFactorRequired": true }` and the `sirat_2fa` challenge cookie
   * instead, and no session until POST /auth/2fa/verify. The answer is sent here (not by Nest), since its status
   * depends on the account.
   */
  @Public()
  @SkipThrottle()
  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const outcome = await this.auth.login(body.email, body.password, clientInfo(req));
      if (outcome.kind === 'two_factor') {
        this.cookies.setChallenge(res, outcome.challengeId);
        res.status(200).json({ twoFactorRequired: true });
        return;
      }
      this.cookies.set(res, outcome.session);
      res.status(204).end();
    } catch (e) {
      if (e instanceof TooManyAttemptsException)
        res.setHeader('Retry-After', String(e.retryAfterSeconds));
      throw e;
    }
  }

  /**
   * Rotation. Public, because the access token may already have expired: the refresh cookie is the credential.
   * 409 means another tab refreshed a moment ago; the browser already has the new cookies, so just retry.
   * 503 means the rotation could not finish within its budget and was rolled back: the old cookies still work.
   */
  @Public()
  @Throttle(REFRESH_TIER)
  @Post('refresh')
  @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const startedAt = Date.now();
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    const result =
      typeof token === 'string' && token !== ''
        ? await this.sessions.rotate(token, clientInfo(req), startedAt)
        : ({ status: 'invalid' } as const);
    if (result.status === 'rotated') return this.cookies.set(res, result.session);
    if (result.status === 'race') throw new ConflictException('Session was just refreshed, retry');
    // No Retry-After: the browser's own growing, jittered pause spreads the retries while the database is slow.
    if (result.status === 'busy')
      throw new ServiceUnavailableException('Session renewal is busy, try again');
    this.cookies.clear(res);
    throw new UnauthorizedException('Session expired, log in again');
  }

  /** Ends the session family on this device. The access token alone stays valid until it expires (<= 15 min). */
  @TwoFactorOptional() // an admin who has not enrolled yet can still log out
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.endFamilyOfSession(user.sessionId, user.id);
    this.cookies.clear(res);
  }

  /** Ends every session of the user, on every device. */
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const ended = await this.sessions.endAllForUser(user.id);
    await this.audit.record({
      action: 'auth.logout_all',
      actorId: user.id,
      ip: req.ip ?? null,
      meta: { sessions: ended },
    });
    this.cookies.clear(res);
  }

  /**
   * Ends every session on every device; this device gets a fresh one (cookies). 400 for a wrong current password,
   * 429 + Retry-After under the login limits.
   */
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      const session = await this.auth.changePassword(
        user,
        body.currentPassword,
        body.newPassword,
        clientInfo(req),
      );
      this.cookies.set(res, session);
    } catch (e) {
      if (e instanceof TooManyAttemptsException)
        res.setHeader('Retry-After', String(e.retryAfterSeconds));
      throw e;
    }
  }

  /**
   * Sets a new password from an emailed link. 204, or 400 with one message for every bad link; 400 "Validation
   * failed" for a refused password (the link stays usable). Ends every session; never logs in.
   */
  @Public()
  @Throttle(EMAIL_LINK_TIER)
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: ResetPasswordDto, @Req() req: Request): Promise<void> {
    await this.auth.resetPassword(body.token, body.password, clientInfo(req));
  }

  /**
   * Asks for a password-reset email. Always 204 at once, whatever the address: an email follows only for an
   * existing, unblocked account, and nothing in the answer or its timing tells which.
   */
  @Public()
  @Throttle(FORGOT_TIER)
  @Post('forgot-password')
  @HttpCode(204)
  forgotPassword(@Body() body: EmailOnlyDto): void {
    this.auth.requestPasswordReset(body.email);
  }

  /** Asks for a new verification email. Always 204 at once, like forgot-password. */
  @Public()
  @Throttle(EMAIL_LINK_TIER)
  @Post('resend-verification')
  @HttpCode(204)
  resendVerification(@Body() body: EmailOnlyDto): void {
    this.auth.requestVerificationEmail(body.email);
  }

  /** Verifies an email address from its link. 204, or 400 with one message for every bad link. Never logs in. */
  @Public()
  @Throttle(EMAIL_LINK_TIER)
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() body: VerifyEmailDto, @Req() req: Request): Promise<void> {
    await this.auth.verifyEmail(body.token, clientInfo(req));
  }

  /** The session user, read fresh from the database (role included). A blocked user is logged out. */
  @TwoFactorOptional() // the web reads the 2FA state here to send an admin to enrolment
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true, role: true, isBlocked: true },
    });
    if (!row || row.isBlocked) throw new UnauthorizedException('Authentication required');
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      // Enabled, required and whether this session proved it: the web sends an admin to enrolment or the code step.
      twoFactor: await this.twoFactor.sessionState(row, user.twoFactor),
    };
  }
}
