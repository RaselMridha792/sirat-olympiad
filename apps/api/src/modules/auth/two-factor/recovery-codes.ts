import { createHash, randomBytes } from 'node:crypto';
import { base32Encode } from './totp';

/**
 * One-time recovery codes (A2): 10 per set, each 10 base32 characters (50 bits), shown once as `XXXXX-XXXXX`, stored
 * only as SHA-256 of the normalised code. High entropy, so a fast hash is enough (no argon2).
 */
export const RECOVERY_CODE_COUNT = 10;
const CODE_CHARS = 10;

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const code = base32Encode(randomBytes(7)).slice(0, CODE_CHARS);
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** The code as stored before hashing: upper case, no spaces or dashes; null when it cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z2-7]{10}$/.test(code) ? code : null;
}

export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
