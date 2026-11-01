import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CACHE } from '../../../redis/redis.module';

/** How long the code step may take after the password (A2: 5 minutes). */
export const CHALLENGE_TTL_SECONDS = 300;
/** Wrong codes one challenge takes before it is used up (each also counts in the login limits). */
export const CHALLENGE_MAX_FAILURES = 5;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const challengeKey = (id: string) => `2fa:challenge:${sha256(id)}`;
const failuresKey = (id: string) => `2fa:challenge-failures:${sha256(id)}`;
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The login step between the password and the code (A2): a random id in an httpOnly cookie, its SHA-256 in the cache
 * Redis holding the user id only (no email: personal data stays out of the cache), for 5 minutes. Single use: the
 * right code claims it with GETDEL, so two parallel right codes give one session. No migration.
 */
@Injectable()
export class TwoFactorChallenges {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  async create(userId: string): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.redis.set(challengeKey(id), userId, 'EX', CHALLENGE_TTL_SECONDS);
    return id;
  }

  /** The user the challenge belongs to, or null (unknown, expired, used up, or not even the shape of an id). */
  async peek(id: string): Promise<string | null> {
    if (!ID_PATTERN.test(id)) return null;
    return this.redis.get(challengeKey(id));
  }

  /** Counts one wrong code (atomically); true when that used the challenge up, which then is gone. */
  async fail(id: string): Promise<boolean> {
    const failures = await this.redis
      .multi()
      .incr(failuresKey(id))
      .expire(failuresKey(id), CHALLENGE_TTL_SECONDS)
      .exec();
    const count = Number(failures?.[0]?.[1] ?? CHALLENGE_MAX_FAILURES);
    if (count < CHALLENGE_MAX_FAILURES) return false;
    await this.redis.del(challengeKey(id), failuresKey(id));
    return true;
  }

  /** Takes the challenge once: the user id for the caller that won it, null for any other (or after expiry). */
  async claim(id: string): Promise<string | null> {
    if (!ID_PATTERN.test(id)) return null;
    const userId = await this.redis.getdel(challengeKey(id));
    await this.redis.del(failuresKey(id));
    return userId;
  }
}
