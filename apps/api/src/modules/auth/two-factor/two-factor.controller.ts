import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth.decorators';
import { TooManyAttemptsException } from '../auth.service';
import { TwoFactorVerifyDto } from '../dto/two-factor.dto';
import { CHALLENGE_COOKIE, SessionCookies } from '../session-cookies';
import type { ClientInfo } from '../session.service';
import { ChallengeEndedException, TwoFactorService } from './two-factor.service';

const clientInfo = (req: Request): ClientInfo => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Two-factor login (06-API "Two-factor login"; DECISIONS "Admin two-factor login"). */
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly cookies: SessionCookies,
  ) {}

  /**
   * The login's code step: `{ code }` or `{ recoveryCode }` with the `sirat_2fa` cookie from the password step. 204 +
   * the session cookies. 401 TWO_FACTOR_CODE_INVALID for a wrong code (the 5th ends the challenge),
   * 401 TWO_FACTOR_CHALLENGE_INVALID when the challenge is gone (log in again; its cookie is cleared), 429 +
   * Retry-After under the login limits, 503 TWO_FACTOR_UNAVAILABLE while 2FA is off. Public like login, and like
   * every POST it needs the CSRF header; the global request limit applies (login's limiter counts the failures).
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
      const session = await this.twoFactor.verifyLogin(
        req.cookies?.[CHALLENGE_COOKIE],
        body,
        clientInfo(req),
      );
      this.cookies.clearChallenge(res);
      this.cookies.set(res, session);
    } catch (e) {
      if (e instanceof ChallengeEndedException) this.cookies.clearChallenge(res);
      if (e instanceof TooManyAttemptsException)
        res.setHeader('Retry-After', String(e.retryAfterSeconds));
      throw e;
    }
  }
}
