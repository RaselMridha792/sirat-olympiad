import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';

/** Owner: at most one alert email of the same kind per 10 minutes. */
export const ALERT_EMAIL_KIND_INTERVAL_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;

/**
 * KEYS[1] = "this kind was mailed" marker (expires after the interval), KEYS[2] = alert emails this hour.
 * Returns 1 when one more email may go out now.
 */
const ALERT_MAIL_LUA = `
if not redis.call('SET', KEYS[1], '1', 'NX', 'PX', ARGV[1]) then return 0 end
local n = redis.call('INCR', KEYS[2])
if n == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
if n > tonumber(ARGV[3]) then return 0 end
return 1
`;

type AlertMailScript = (
  kindKey: string,
  hourKey: string,
  intervalMs: number,
  hourMs: number,
  perHour: number,
) => Promise<number>;

/**
 * Rate limit for operator alert emails (owner, 2026-10-31), so an attack cannot flood the inbox or hurt the SES
 * sending reputation: one email per alert kind per 10 minutes, and at most `perHour` in all. Shared by every replica
 * through the cache Redis. When Redis cannot answer, no email goes out: the audit row and the log line stay the
 * source of truth.
 */
export class AlertEmailLimiter {
  private readonly script: AlertMailScript;

  constructor(
    private readonly redis: Redis,
    private readonly perHour: number,
    private readonly prefix = 'alertmail:',
  ) {
    redis.defineCommand('siratAlertMail', { numberOfKeys: 2, lua: ALERT_MAIL_LUA });
    // defineCommand adds the method at runtime; ioredis cannot type it statically.
    this.script = (redis as unknown as { siratAlertMail: AlertMailScript }).siratAlertMail.bind(
      redis,
    );
  }

  async allow(kind: string): Promise<boolean> {
    if (this.redis.status !== 'ready') return false;
    try {
      const allowed = await withTimeout(
        this.script(
          `${this.prefix}kind:${kind}`,
          `${this.prefix}hour`,
          ALERT_EMAIL_KIND_INTERVAL_MS,
          HOUR_MS,
          this.perHour,
        ),
        300,
      );
      return allowed === 1;
    } catch {
      return false;
    }
  }
}
