import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { EnvVars } from '../../config/env';
import { ACCESS_COOKIE } from './access-token.service';

export const REFRESH_COOKIE = 'sirat_refresh';
/** The refresh cookie is only ever sent to the auth endpoints, never with page or API traffic. */
export const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * The two httpOnly session cookies (RULEBOOK §5). Host-only (no Domain attribute): web and API share one origin.
 * Access: SameSite=Lax, so a link from an email still opens the dashboard logged in. Refresh: SameSite=Strict, it is
 * only used by our own fetch calls.
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

  private accessOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/' };
  }

  private refreshOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH };
  }
}
