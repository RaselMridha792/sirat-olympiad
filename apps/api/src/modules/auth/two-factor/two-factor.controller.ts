import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthUser } from '../access-token.service';
import { CurrentUser, Public, Roles, TwoFactorAlways, TwoFactorOptional } from '../auth.decorators';
import { TooManyAttemptsException } from '../auth.service';
import {
  TwoFactorCodeDto,
  TwoFactorDisableDto,
  TwoFactorRequirementDto,
  TwoFactorResetDto,
  TwoFactorSetupDto,
  TwoFactorVerifyDto,
} from '../dto/two-factor.dto';
import { CHALLENGE_COOKIE, SessionCookies } from '../session-cookies';
import type { ClientInfo } from '../session.service';
import { TwoFactorRequirement, type TwoFactorRequirementView } from './two-factor-requirement';
import {
  ChallengeEndedException,
  type TwoFactorStatus,
  TwoFactorService,
} from './two-factor.service';

const clientInfo = (req: Request): ClientInfo => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** A refusal under the login limits tells when to try again, like login. */
async function withRetryAfter<T>(res: Response, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof TooManyAttemptsException)
      res.setHeader('Retry-After', String(e.retryAfterSeconds));
    throw e;
  }
}

/**
 * Per acting admin (the per-user tracker; each route counts on its own): a reset ends sessions and a requirement
 * change opens or closes the admin pages, and both raise an alert, so very few an hour.
 */
const RESET_TIER = { default: { limit: 5, ttl: 3_600_000 } };

/**
 * Two-factor login (06-API "Two-factor login"; DECISIONS "Admin two-factor login"). Every route answers 503
 * TWO_FACTOR_UNAVAILABLE while 2FA is off (no TOTP_ENCRYPTION_KEY, development only). The roles that may enrol are
 * admin and manager; the status, setup and enable routes are @TwoFactorOptional so an admin without 2FA can enrol.
 */
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly cookies: SessionCookies,
  ) {}

  /** The caller's state: enabled, pending (setup not confirmed), required, verified (this session), codes left. */
  @Roles('admin', 'manager')
  @TwoFactorOptional()
  @Get()
  status(@CurrentUser() user: AuthUser): Promise<TwoFactorStatus> {
    return this.twoFactor.status(user);
  }

  /**
   * `{ password }` (under the login limits). 200 `{ otpauthUri, qrDataUri }`: the new secret, shown once, pending
   * until enable. 400 PASSWORD_INCORRECT, 409 TWO_FACTOR_ALREADY_ENABLED, 429 + Retry-After.
   */
  @Roles('admin', 'manager')
  @TwoFactorOptional()
  @Post('setup')
  @HttpCode(200)
  setup(
    @CurrentUser() user: AuthUser,
    @Body() body: TwoFactorSetupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ otpauthUri: string; qrDataUri: string }> {
    return withRetryAfter(res, () => this.twoFactor.setup(user, body.password, clientInfo(req)));
  }

  /**
   * `{ code }` from the pending secret. 200 `{ recoveryCodes }` (shown once) + new session cookies with the second
   * factor proved; every other session of the user ends. 400 TWO_FACTOR_CODE_INVALID, 409 TWO_FACTOR_SETUP_REQUIRED
   * or TWO_FACTOR_ALREADY_ENABLED.
   */
  @Roles('admin', 'manager')
  @TwoFactorOptional()
  @Post('enable')
  @HttpCode(200)
  async enable(
    @CurrentUser() user: AuthUser,
    @Body() body: TwoFactorCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ recoveryCodes: string[] }> {
    const { session, recoveryCodes } = await this.twoFactor.enable(
      user,
      body.code,
      clientInfo(req),
    );
    this.cookies.set(res, session);
    return { recoveryCodes };
  }

  /** `{ code }` (a current TOTP code, under the login limits). 200 `{ recoveryCodes }`: all new, shown once. */
  @Roles('admin', 'manager')
  @Post('recovery-codes')
  @HttpCode(200)
  async recoveryCodes(
    @CurrentUser() user: AuthUser,
    @Body() body: TwoFactorCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = await withRetryAfter(res, () =>
      this.twoFactor.replaceRecoveryCodesWithCode(user, body.code, clientInfo(req)),
    );
    return { recoveryCodes };
  }

  /**
   * `{ password, code | recoveryCode }`: both factors, under the login limits. 204 + new session cookies without the
   * second factor; every other session of the user ends. 400 PASSWORD_INCORRECT or TWO_FACTOR_CODE_INVALID.
   */
  @Roles('admin', 'manager')
  @Post('disable')
  @HttpCode(204)
  async disable(
    @CurrentUser() user: AuthUser,
    @Body() body: TwoFactorDisableDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await withRetryAfter(res, () =>
      this.twoFactor.disable(user, body, clientInfo(req)),
    );
    this.cookies.set(res, session);
  }

  /**
   * The login's code step: `{ code }` or `{ recoveryCode }` with the `sirat_2fa` cookie from the password step. 204 +
   * the session cookies. 401 TWO_FACTOR_CODE_INVALID for a wrong code (the 5th ends the challenge),
   * 401 TWO_FACTOR_CHALLENGE_INVALID when the challenge is gone (log in again; its cookie is cleared), 429 +
   * Retry-After under the login limits. Public like login, and like every POST it needs the CSRF header; the global
   * request limit applies (login's limiter counts the failures).
   */
  @Public()
  @Post('verify')
  @HttpCode(204)
  async verify(
    @Body() body: TwoFactorVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      const session = await withRetryAfter(res, () =>
        this.twoFactor.verifyLogin(req.cookies?.[CHALLENGE_COOKIE], body, clientInfo(req)),
      );
      this.cookies.clearChallenge(res);
      this.cookies.set(res, session);
    } catch (e) {
      if (e instanceof ChallengeEndedException) this.cookies.clearChallenge(res);
      throw e;
    }
  }
}

/** The lost-device path for another admin or manager (RUNBOOK "Admin lost the authenticator"). */
@Controller('admin/users')
export class TwoFactorAdminController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  /**
   * `{ reason, code }`: the acting admin's own current TOTP code (step-up, under the login limits). 200
   * `{ sessionsEnded }`. 403 TWO_FACTOR_RESET_NOT_ALLOWED for oneself or a target that is not admin or manager,
   * 404 for an unknown user, 409 TWO_FACTOR_NOT_ENABLED, 400 TWO_FACTOR_CODE_INVALID; 5 an hour per admin.
   */
  @Roles('admin')
  @Throttle(RESET_TIER)
  @Post(':id/2fa/reset')
  @HttpCode(200)
  reset(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TwoFactorResetDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ sessionsEnded: number }> {
    return withRetryAfter(res, () => this.twoFactor.adminReset(user, id, body, clientInfo(req)));
  }
}

/**
 * The admin two-factor requirement (06-API "Two-factor login"; DECISIONS "The admin 2FA requirement is a setting"):
 * which of admin and manager must prove a second factor on the admin routes. Role admin only (a manager gets 403).
 * Enrolments, the login's code step and sessions never change with it.
 */
@Controller('admin/security')
export class TwoFactorRequirementController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly requirement: TwoFactorRequirement,
  ) {}

  /** 200 `{ roles, updatedAt (ISO or null while the default applies), available (2FA on on this server) }`. */
  @Roles('admin')
  @Get('two-factor-requirement')
  current(): Promise<TwoFactorRequirementView> {
    return this.requirement.view();
  }

  /**
   * `{ roles, expected, reason (3-200), code }`: `code` is the acting admin's own current TOTP code (step-up, under the
   * login limits). Needs a session that proved the code even while the requirement is off (@TwoFactorAlways). 200
   * `{ roles, updatedAt }`. 400 TWO_FACTOR_CODE_INVALID or a refused body (an unknown role), 409
   * TWO_FACTOR_REQUIREMENT_CHANGED (`expected` is stale), 503 TWO_FACTOR_UNAVAILABLE while 2FA is off; 5 an hour per
   * admin.
   */
  @Roles('admin')
  @TwoFactorAlways()
  @Throttle(RESET_TIER)
  @Put('two-factor-requirement')
  change(
    @CurrentUser() user: AuthUser,
    @Body() body: TwoFactorRequirementDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ roles: string[]; updatedAt: string }> {
    return withRetryAfter(res, () => this.twoFactor.changeRequirement(user, body, clientInfo(req)));
  }
}
