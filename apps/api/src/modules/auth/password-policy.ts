import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Owner-approved policy (A2): 8 to 128 characters, and not one of the 10,000 most common passwords. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * NFKC, so visually identical input (full-width digits, ligatures) checks and hashes the same on every device
 * (NIST SP 800-63B). Every password is normalized before it is checked, hashed or verified.
 */
export const normalizePassword = (password: string): string => password.normalize('NFKC');

const COMMON_PASSWORDS_FILE = join(__dirname, 'data', 'common-passwords-10k.txt');
let common: ReadonlySet<string> | undefined;

/** The common-passwords list, lower-cased (data/README.md). Throws if the file is missing or truncated. */
export function commonPasswords(): ReadonlySet<string> {
  if (!common) {
    const entries = readFileSync(COMMON_PASSWORDS_FILE, 'utf8')
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
    if (entries.length < 10_000)
      throw new Error(`common password list looks truncated (${entries.length} entries)`);
    common = new Set(entries);
  }
  return common;
}

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common';

/** Why a new password is refused, or null. Applies wherever a user sets a password (register, reset, change). */
export function passwordProblem(password: string): PasswordProblem | null {
  const normalized = normalizePassword(password);
  const characters = [...normalized].length; // code points, so one emoji or Bangla letter counts once
  if (characters < PASSWORD_MIN_LENGTH) return 'too_short';
  if (characters > PASSWORD_MAX_LENGTH) return 'too_long';
  if (commonPasswords().has(normalized.toLowerCase())) return 'too_common';
  return null;
}

const MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  too_long: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  too_common: 'This password is too common. Choose another one',
};

/** DTO validator for a new password. The message names the rule, never the value. */
export function IsAcceptablePassword(options?: ValidationOptions) {
  return (object: object, propertyName: string): void =>
    registerDecorator({
      name: 'isAcceptablePassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && passwordProblem(value) === null,
        defaultMessage: (args) =>
          typeof args?.value === 'string'
            ? MESSAGES[passwordProblem(args.value) ?? 'too_short']
            : 'Password must be a string',
      },
    });
}
