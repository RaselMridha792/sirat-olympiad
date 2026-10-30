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

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** Signs and verifies access tokens locally (no DB call per request; 03-HOW-IT-WORKS §2). */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: AuthUser): Promise<string> {
    return this.jwt.signAsync({ role: user.role, sid: user.sessionId }, { subject: user.id });
  }

  /** The session user, or null for a missing, expired, tampered or malformed token. Never throws. */
  async verify(token: string): Promise<AuthUser | null> {
    let claims: { sub?: unknown; role?: unknown; sid?: unknown };
    try {
      claims = await this.jwt.verifyAsync<{ sub?: unknown; role?: unknown; sid?: unknown }>(token);
    } catch {
      return null;
    }
    const { sub, role, sid } = claims;
    if (typeof sub !== 'string' || typeof sid !== 'string' || !isRole(role)) return null;
    return { id: sub, role, sessionId: sid };
  }
}
