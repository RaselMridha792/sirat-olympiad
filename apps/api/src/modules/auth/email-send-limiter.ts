import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { emailHash } from './login-limiter';

export interface EmailSendLimits {
  perMinute: number;
  perHour: number;
}
export type EmailLinkKind = 'reset' | 'verify' | 'participant_id';

/**
 * Caps the link emails one address can receive (forgot-password, resend-verification, the participant-ID email of
 * forgot-ID and of a student's forgot-password): per minute and per hour,
 * keyed by the email hash, so nobody can mail-bomb an inbox or run up the SES bill. The caller answers the same way
 * whether or not an email was sent. Only allowed sends are counted. Fails open, like the login limiter.
 */
const SEND_LUA = `
local m = tonumber(redis.call('GET', KEYS[1]) or '0')
local h = tonumber(redis.call('GET', KEYS[2]) or '0')
if m >= tonumber(ARGV[1]) or h >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
if m == 0 then redis.call('PEXPIRE', KEYS[1], 60000) end
redis.call('INCR', KEYS[2])
if h == 0 then redis.call('PEXPIRE', KEYS[2], 3600000) end
return 1
`;

type SendScript = (
  minuteKey: string,
  hourKey: string,
  perMinute: number,
  perHour: number,
) => Promise<number>;

export class EmailSendLimiter {
  private readonly logger = new Logger(EmailSendLimiter.name);
  private readonly script: SendScript;

  constructor(
    private readonly redis: Redis,
    private readonly limits: EmailSendLimits,
    private readonly prefix = 'mailcap:',
  ) {
    redis.defineCommand('siratMailCap', { numberOfKeys: 2, lua: SEND_LUA });
    // defineCommand adds the method at runtime; ioredis cannot type it statically.
    this.script = (redis as unknown as { siratMailCap: SendScript }).siratMailCap.bind(redis);
  }

  /** Whether one more link email of this kind may go to this address now (and counts it if so). */
  async allow(kind: EmailLinkKind, email: string): Promise<boolean> {
    if (this.redis.status !== 'ready') return true;
    const base = `${this.prefix}${kind}:${emailHash(email)}`;
    try {
      const allowed = await withTimeout(
        this.script(`${base}:m`, `${base}:h`, this.limits.perMinute, this.limits.perHour),
        300,
      );
      return allowed === 1;
    } catch (err) {
      this.logger.warn(`email send limiter unavailable, not limiting: ${(err as Error).message}`);
      return true;
    }
  }
}
