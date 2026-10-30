import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { argon2id, hash, needsRehash, verify } from 'argon2';
import { commonPasswords, normalizePassword } from './password-policy';

/**
 * argon2id at the OWASP baseline: 19 MiB, 2 iterations, 1 lane (~tens of ms per hash). 02-SYSTEM-DESIGN: tune with
 * the login load test; raising the cost later is safe, because `needsRehash` lets login upgrade old hashes.
 */
export const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes and verifies passwords (RULEBOOK §5). Never logs or returns a password. */
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash?: Promise<string>;

  /** Loads the common-passwords list at boot: a missing or truncated file stops the API from starting. */
  onModuleInit(): void {
    commonPasswords();
  }

  hash(password: string): Promise<string> {
    return hash(normalizePassword(password), ARGON2_OPTIONS);
  }

  /** False for a wrong password or an unreadable hash; never throws. */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, normalizePassword(password));
    } catch {
      return false;
    }
  }

  /** True when the hash was made with weaker parameters than ARGON2_OPTIONS (re-hash after a successful login). */
  needsRehash(passwordHash: string): boolean {
    try {
      return needsRehash(passwordHash, ARGON2_OPTIONS);
    } catch {
      return true;
    }
  }

  /**
   * Costs the same as a real verify and always fails. Login runs it for unknown emails, so the response time does
   * not reveal whether an account exists.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
