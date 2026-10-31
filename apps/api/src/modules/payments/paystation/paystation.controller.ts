import {
  Controller,
  Get,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { EnvVars } from '../../../config/env';
import { Public, SkipCsrf } from '../../auth/auth.decorators';
import { PayStationHooks } from './paystation-hooks.service';

/** The web page that shows "confirming / paid / failed" from `GET /registrations/current` (payments PR 4). */
export const PAYMENT_RESULT_PATH = '/register/result';
/** Student browsers returning from PayStation: many can share one IP (a school, mobile CGNAT). */
export const CALLBACK_TIER = { default: { limit: 3_000, ttl: 60_000 } };
/** PayStation's servers. One IPN per successful payment; the per-payment window caps the status calls. */
export const IPN_TIER = { default: { limit: 600, ttl: 60_000 } };
/** payment_events_payload_size_check allows 16 KB; PayStation's IPN is a flat object of a few fields. */
export const MAX_IPN_BYTES = 16_384;

/** Public by necessity (PayStation calls them), so neither is trusted: see PayStationHooks. */
@Controller('payments/paystation')
export class PayStationController {
  private readonly resultUrl: string;

  constructor(
    private readonly hooks: PayStationHooks,
    config: ConfigService<EnvVars, true>,
  ) {
    const origin = config.get('APP_URL', { infer: true }) ?? 'http://localhost:3000';
    this.resultUrl = `${origin}${PAYMENT_RESULT_PATH}`;
  }

  /** Records the return, asks for a status check, and always sends the student on with 303 (never a result). */
  @Public()
  @Throttle(CALLBACK_TIER)
  @Get('callback/:invoice')
  async callback(
    @Param('invoice') invoice: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.hooks.callback(invoice, req.query);
    res.redirect(303, this.resultUrl);
  }

  /** CSRF-exempt: a server-to-server POST with no browser and no cookie. */
  @Public()
  @SkipCsrf()
  @Throttle(IPN_TIER)
  @Post('ipn')
  @HttpCode(200)
  async ipn(@Req() req: Request): Promise<{ received: true }> {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (
      declared > MAX_IPN_BYTES ||
      Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > MAX_IPN_BYTES
    )
      throw new PayloadTooLargeException();
    await this.hooks.ipn(req.body);
    return { received: true };
  }
}
