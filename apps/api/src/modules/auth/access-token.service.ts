import { Injectable } from '@nestjs/common';
import { JwtService, type JwtModuleOptions } from '@nestjs/jwt';
import { ROLES, type Role } from '@sirat/shared';
import type { Request } from 'express';

/** httpOnly cookie that carries the access token (RULEBOOK §5). The refresh cookie arrives with the session endpoints. */
export const ACCESS_COOKIE = 'sirat_access';
export const ACCESS_TOKEN_ISSUER = 'sirat-api';
export const ACCESS_TOKEN_AUDIENCE = 'sirat-web';

/** The session user as the guards see it. The role comes from the token; sensitive actions re-check the DB. */
export interface AuthUser {
  id: string;
  role: Role;
  sessionId: string;
  /**
   * The session proved a second factor (the `tfa` claim; DECISIONS "Admin two-factor login"). A session of a user with
   * 2FA on always did: turning it on or off and every reset end the user's other sessions. A token without the claim
   * (issued before 2FA existed) reads as false.
   */
  twoFactor: boolean;
}
export type AuthedRequest = Request & { user?: AuthUser };

/** HS256 only, issuer and audience pinned both ways: a token made for anything else never verifies. */
export function accessTokenJwtOptions(secret: string, ttlSeconds: number): JwtModuleOptions {
  return {
    secret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    },
    verifyOptions: {
      algorithms: ['HS256'],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    },
  };
}

/** What a verified token may carry; each claim is checked before use. */
type Claims = { sub?: unknown; role?: unknown; sid?: unknown; tfa?: unknown };

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** Signs and verifies access tokens locally (no DB call per request; 03-HOW-IT-WORKS §2). */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: AuthUser): Promise<string> {
    return this.jwt.signAsync(
      { role: user.role, sid: user.sessionId, tfa: user.twoFactor },
      { subject: user.id },
    );
  }

  /** The session user, or null for a missing, expired, tampered or malformed token. Never throws. */
  async verify(token: string): Promise<AuthUser | null> {
    let claims: Claims;
    try {
      claims = await this.jwt.verifyAsync<Claims>(token);
    } catch {
      return null;
    }
    const { sub, role, sid, tfa } = claims;
    if (typeof sub !== 'string' || typeof sid !== 'string' || !isRole(role)) return null;
    // Only a literal true counts: a missing claim (an older token) or any other value is "not proved".
    return { id: sub, role, sessionId: sid, twoFactor: tfa === true };
  }
}
