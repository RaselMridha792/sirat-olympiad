import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthTokenType, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** RULEBOOK §5: e.g. 24 h to verify an email, 30 min to reset a password. */
export const EMAIL_TOKEN_TTL_MS: Readonly<Record<AuthTokenType, number>> = {
  [AuthTokenType.email_verify]: 24 * 3_600_000,
  [AuthTokenType.password_reset]: 30 * 60_000,
};

/** 32 random bytes as base64url: always 43 characters. DTOs check this shape before any lookup. */
export const EMAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export interface IssuedEmailToken {
  id: string; // also the email job key, never the token
  token: string; // goes into the link, nowhere else
  expiresAt: Date;
}

/**
 * Single-use email tokens (RULEBOOK §5): at least 32 bytes from a CSPRNG, only the hash stored, an expiry and a
 * used_at. A new token retires the user's earlier unused ones of the same type, so only the newest link works.
 */
@Injectable()
export class EmailTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, type: AuthTokenType): Promise<IssuedEmailToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS[type]);
    return this.prisma.$transaction(async (tx) => {
      await tx.authToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      });
      const row = await tx.authToken.create({
        data: { userId, type, tokenHash: sha256(token), expiresAt },
      });
      return { id: row.id, token, expiresAt };
    });
  }

  /**
   * Uses a token once and returns its user, or null for an unknown, used, expired or other-type token (callers give
   * one answer for all of these). Of two requests with the same token, exactly one succeeds. Pass `tx` to make the
   * use part of a larger transaction (a reset changes the password in the same one).
   */
  async consume(
    token: string,
    type: AuthTokenType,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ userId: string } | null> {
    if (!EMAIL_TOKEN_PATTERN.test(token)) return null;
    const row = await tx.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) return null;
    const { count } = await tx.authToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1 ? { userId: row.userId } : null;
  }
}
