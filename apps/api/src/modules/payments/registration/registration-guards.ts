import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { withTimeout } from '../../../common/with-timeout';

/**
 * Two small Redis guards for starting payments (plan 6.1). Both fail open (a Redis outage must not stop
 * registration), like the login limiter.
 * - Per email and per phone: at most `perHour` start or retry attempts an hour (the global throttler covers the IP).
 * - The payments pause: set for 10 minutes after PayStation answers "1001" Invalid Credential, so a configuration
 *   error is not retried blindly for every student (lead, 2026-10-31).
 */
const COUNT_LUA = `
local a = tonumber(redis.call('GET', KEYS[1]) or '0')
local b = tonumber(redis.call('GET', KEYS[2]) or '0')
if a >= tonumber(ARGV[1]) or b >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
if a == 0 then redis.call('PEXPIRE', KEYS[1], 3600000) end
redis.call('INCR', KEYS[2])
if b == 0 then redis.call('PEXPIRE', KEYS[2], 3600000) end
return 1
`;
type CountScript = (emailKey: string, phoneKey: string, limit: number) => Promise<number>;

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
export const PAUSE_MS = 10 * 60 * 1000;

export class RegistrationGuards {
  private readonly logger = new Logger('RegistrationGuards');
  private readonly count: CountScript;

  constructor(
    private readonly redis: Redis,
    private readonly perHour: number,
    private readonly prefix = 'reg:',
  ) {
    redis.defineCommand('siratRegCount', { numberOfKeys: 2, lua: COUNT_LUA });
    this.count = (redis as unknown as { siratRegCount: CountScript }).siratRegCount.bind(redis);
  }

  /** Counts one start/retry for this email and phone; false when either reached the hourly limit. */
  async allowAttempt(email: string, phone: string): Promise<boolean> {
    if (this.redis.status !== 'ready') return true;
    try {
      const ok = await withTimeout(
        this.count(
          `${this.prefix}e:${hash(email)}`,
          `${this.prefix}p:${hash(phone)}`,
          this.perHour,
        ),
        300,
      );
      return ok === 1;
    } catch (err) {
      this.logger.warn(`registration limiter unavailable, not limiting: ${(err as Error).name}`);
      return true;
    }
  }

  async isPaused(): Promise<boolean> {
    if (this.redis.status !== 'ready') return false;
    try {
      return (await withTimeout(this.redis.exists(`${this.prefix}payments-paused`), 300)) === 1;
    } catch {
      return false;
    }
  }

  async pause(): Promise<void> {
    try {
      await withTimeout(this.redis.set(`${this.prefix}payments-paused`, '1', 'PX', PAUSE_MS), 300);
    } catch {
      this.logger.warn('could not set the payments pause');
    }
  }
}
