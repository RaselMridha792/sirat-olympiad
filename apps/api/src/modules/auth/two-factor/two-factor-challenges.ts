import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CACHE } from '../../../redis/redis.module';

/** How long the code step may take after the password (A2: 5 minutes). */
export const CHALLENGE_TTL_SECONDS = 300;
/** Codes one challenge may have checked (each also counts in the login limits when wrong). */
export const CHALLENGE_MAX_ATTEMPTS = 5;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const challengeKey = (id: string) => `2fa:challenge:${sha256(id)}`;
const attemptsKey = (id: string) => `2fa:challenge-attempts:${sha256(id)}`;
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reserves one attempt BEFORE a code is checked, in one step: a missing challenge gives nil; the attempt past the
 * cap ends the challenge (both keys) and gives nil; else { userId, attempt }. So parallel guesses can never have more
 * than CHALLENGE_MAX_ATTEMPTS codes checked.
 */
const RESERVE_LUA = `
local userId = redis.call('GET', KEYS[1])
if not userId then return false end
local attempt = redis.call('INCR', KEYS[2])
if attempt == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
if attempt > tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1], KEYS[2])
  return false
end
return { userId, attempt }
`;

/**
 * The login step between the password and the code (A2): a random id in an httpOnly cookie, its SHA-256 in the cache
 * Redis holding the user id only (no email: personal data stays out of the cache), for 5 minutes. Every code checked
 * first reserves an attempt (at most 5); the right code claims it with GETDEL, so two parallel right codes give one
 * session. No migration.
 */
@Injectable()
export class TwoFactorChallenges {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  async create(userId: string): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.redis.set(challengeKey(id), userId, 'EX', CHALLENGE_TTL_SECONDS);
    return id;
  }

  /**
   * One attempt for this challenge, before its code is checked: the user and the attempt number (1 to 5), or null
   * (unknown, expired, used, used up, or not even the shape of an id). The 6th call ends the challenge.
   */
  async reserve(id: string): Promise<{ userId: string; attempt: number } | null> {
    if (!ID_PATTERN.test(id)) return null;
    const reply = (await this.redis.eval(
      RESERVE_LUA,
      2,
      challengeKey(id),
      attemptsKey(id),
      CHALLENGE_MAX_ATTEMPTS,
      CHALLENGE_TTL_SECONDS,
    )) as [string, number] | null;
    return reply ? { userId: reply[0], attempt: Number(reply[1]) } : null;
  }

  /** Ends the challenge (its last attempt was wrong, or it can never succeed). */
  async discard(id: string): Promise<void> {
    if (!ID_PATTERN.test(id)) return;
    await this.redis.del(challengeKey(id), attemptsKey(id));
  }

  /** Takes the challenge once: the user id for the caller that won it, null for any other (or after expiry). */
  async claim(id: string): Promise<string | null> {
    if (!ID_PATTERN.test(id)) return null;
    const userId = await this.redis.getdel(challengeKey(id));
    await this.redis.del(attemptsKey(id));
    return userId;
  }
}
