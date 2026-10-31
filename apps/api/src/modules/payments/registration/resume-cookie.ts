import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

/**
 * The `sirat_reg` cookie (plan 6.1): proves "this browser started this attempt" before an account exists. httpOnly,
 * SameSite=Lax (it must come back on PayStation's top-level redirect), only sent to /api/registrations, 7 days.
 * The database keeps only its SHA-256 (pending_registrations.resume_token_hash).
 */
export const RESUME_COOKIE = 'sirat_reg';
const PATH = '/api/registrations';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const newResumeToken = (): string => randomBytes(32).toString('base64url');
export const hashResumeToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function readResumeToken(req: Request): string | null {
  const token: unknown = req.cookies?.[RESUME_COOKIE];
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

const options = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: PATH,
});

export function setResumeCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(RESUME_COOKIE, token, { ...options(secure), maxAge: MAX_AGE_MS });
}

export function clearResumeCookie(res: Response, secure: boolean): void {
  res.clearCookie(RESUME_COOKIE, options(secure));
}
