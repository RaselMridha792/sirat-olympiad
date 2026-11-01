import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { EnvVars } from '../../config/env';
import { ACCESS_COOKIE } from './access-token.service';
import { CHALLENGE_TTL_SECONDS } from './two-factor/two-factor-challenges';

export const REFRESH_COOKIE = 'sirat_refresh';
/** The refresh cookie is only ever sent to the auth endpoints, never with page or API traffic. */
export const REFRESH_COOKIE_PATH = '/api/auth';
/** The login's code step (DECISIONS "Admin two-factor login"): the challenge id between the password and the code. */
export const CHALLENGE_COOKIE = 'sirat_2fa';
/** Sent only to the 2FA endpoints (verify reads it). */
export const CHALLENGE_COOKIE_PATH = '/api/auth/2fa';

/**
 * The two httpOnly session cookies (RULEBOOK §5). Host-only (no Domain attribute): web and API share one origin.
 * Access: SameSite=Lax, so a link from an email still opens the dashboard logged in. Refresh: SameSite=Strict, it is
 * only used by our own fetch calls. The 2FA challenge cookie: SameSite=Strict, 5 minutes, only for /api/auth/2fa.
 */
@Injectable()
export class SessionCookies {
  private readonly secure: boolean;
  private readonly accessMaxAgeMs: number;

  constructor(config: ConfigService<EnvVars, true>) {
    this.secure = config.get('COOKIE_SECURE', { infer: true }) !== 'false';
    this.accessMaxAgeMs = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }) * 1000;
  }

  set(
    res: Response,
    session: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
  ): void {
    res.cookie(ACCESS_COOKIE, session.accessToken, {
      ...this.accessOptions(),
      maxAge: this.accessMaxAgeMs,
    });
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.refreshOptions(),
      expires: session.refreshExpiresAt,
    });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.accessOptions());
    res.clearCookie(REFRESH_COOKIE, this.refreshOptions());
  }

  /** After the right password of a 2FA account: the challenge, as long as it lives in Redis (Max-Age 300). */
  setChallenge(res: Response, challengeId: string): void {
    res.cookie(CHALLENGE_COOKIE, challengeId, {
      ...this.challengeOptions(),
      maxAge: CHALLENGE_TTL_SECONDS * 1000,
    });
  }

  clearChallenge(res: Response): void {
    res.clearCookie(CHALLENGE_COOKIE, this.challengeOptions());
  }

  private accessOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/' };
  }

  private refreshOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH };
  }

  private challengeOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict', path: CHALLENGE_COOKIE_PATH };
  }
}
