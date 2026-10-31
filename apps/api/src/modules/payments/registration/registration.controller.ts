import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Request, Response } from 'express';
import type { EnvVars } from '../../../config/env';
import type { AuthUser } from '../../auth/access-token.service';
import { CurrentUser, Public } from '../../auth/auth.decorators';
import { StartRegistrationDto } from './dto/start-registration.dto';
import { RegistrationService, StartFailure } from './registration.service';
import { clearResumeCookie, readResumeToken, setResumeCookie } from './resume-cookie';

/**
 * Per route and client IP, sized for shared IPs: a school, or a mobile operator's carrier-grade NAT, can put
 * thousands of students behind one address (DECISIONS "Per-user API limits"). The limit per person is elsewhere:
 * 10 starts or retries an hour per email and per phone (RegistrationGuards).
 * - start, retry: argon2 and a PayStation call each, so lower;
 * - info, current, resume, cancel: cheap reads by a unique key; the result page polls current every few seconds.
 */
export const START_TIER = { default: { limit: 300, ttl: 60_000 } };
export const STATUS_TIER = { default: { limit: 3_000, ttl: 60_000 } };

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

/**
 * Registration before an account exists (public; the `sirat_reg` cookie is the only proof of "my attempt", so no
 * route takes an id), and the logged-in student's own registration (06-API "Registration and payments").
 */
@Controller('registrations')
export class RegistrationController {
  private readonly secure: boolean;

  constructor(
    private readonly registrations: RegistrationService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.secure = config.get('COOKIE_SECURE', { infer: true }) !== 'false';
  }

  /** Open or closed, the fee, and the form's choices. Cached for 30 s. */
  @Public()
  @Throttle(STATUS_TIER)
  @Get('info')
  info() {
    return this.registrations.info();
  }

  /** 201 with the PayStation checkout URL; sets `sirat_reg`. Never accepts an amount, a fee or a role. */
  @Public()
  @Throttle(START_TIER)
  @Post('start')
  async start(
    @Body() body: StartRegistrationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { token, ...started } = await this.registrations.start(body, readResumeToken(req));
      if (token) setResumeCookie(res, token, this.secure);
      return started;
    } catch (e) {
      if (e instanceof StartFailure && e.token) setResumeCookie(res, e.token, this.secure);
      throw e;
    }
  }

  /** Where this browser's attempt stands. No personal data. */
  @Public()
  @Throttle(STATUS_TIER)
  @Get('current')
  current(@Req() req: Request) {
    return this.registrations.current(readResumeToken(req));
  }

  /** The stored checkout URL again, while it is valid. */
  @Public()
  @Throttle(STATUS_TIER)
  @Post('current/resume')
  @HttpCode(200)
  resume(@Req() req: Request) {
    return this.registrations.resume(readResumeToken(req));
  }

  /** A new payment with a new invoice, after the last one failed or expired, while registration is open. */
  @Public()
  @Throttle(START_TIER)
  @Post('current/retry')
  retry(@Req() req: Request) {
    return this.registrations.retry(readResumeToken(req));
  }

  /** "Check my payment status": 202; the page keeps polling `current`. Once per 10 s per payment. */
  @Public()
  @Throttle(STATUS_TIER)
  @Post('current/recheck')
  @HttpCode(202)
  recheck(@Req() req: Request) {
    return this.registrations.recheck(readResumeToken(req));
  }

  /** Gives up this attempt (only while no payment is active) and forgets the cookie. */
  @Public()
  @Throttle(STATUS_TIER)
  @Post('current/cancel')
  @HttpCode(204)
  async cancel(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.registrations.cancel(readResumeToken(req));
    clearResumeCookie(res, this.secure);
  }

  /** The logged-in student's registration and payment status (dashboard). */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.registrations.me(user.id);
  }
}

/** The logged-in user's own payments. Ownership: every query is filtered by the session user's id. */
@Controller('payments')
export class MyPaymentsController {
  constructor(private readonly registrations: RegistrationService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.registrations.myPayments(user.id, query.page ?? 1, query.pageSize ?? 20);
  }

  /** 404 for a payment of someone else, never 403 (no existence leak). */
  @Get(':id/status')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.registrations.paymentStatus(user.id, id);
  }

  /** 202: the worker asks PayStation; the dashboard reads the result with `status`. */
  @Throttle(STATUS_TIER)
  @Post(':id/recheck')
  @HttpCode(202)
  recheck(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.registrations.recheckMine(user.id, id);
  }
}
