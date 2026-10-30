import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';

/**
 * Login limits (owner, 2026-10-31). Only failed logins are counted:
 * - per IP, all accounts together (a school shares one IP: about 60-100 per minute);
 * - per account + IP pair: LOGIN_PAIR_MAX_FAILURES within 15 min lock that pair for 15 min, doubling with every
 *   repeat lock within 24 h up to a cap. During a lock even the right password is refused (the password is not
 *   checked at all). Without a lock, a right password resets the pair's count and its escalation;
 * - per account, all IPs together (about 50 per hour). At that limit only IPs that failed on the account within the
 *   hour are refused: an IP without failures (usually the student's own) can still log in, while an attacker gets
 *   one guess per fresh IP. So nobody can lock someone else's account on purpose from elsewhere (owner, A2 rule).
 * A completed password reset clears every lock and count of that account: the account's "generation" in the keys
 * changes, and old keys simply expire. Emails appear in keys only as SHA-256 hashes, and the same counting runs for
 * emails without an account, so nothing here reveals whether an account exists.
 *
 * State lives in the cache Redis, shared by all replicas. Keys are built inside the scripts (one Redis node).
 */

export interface LoginLimits {
  ipFailuresPerMinute: number;
  pairMaxFailures: number;
  lockBaseMs: number;
  lockMaxMs: number;
  accountFailuresPerHour: number;
  /** More distinct IPs than this failing on one account within the hour is a separate signal (no blocking). */
  alertDistinctIps: number;
}

/** Why an attempt is refused before the password is checked. The client sees one generic message for all three. */
export type LoginRefusal = 'pair_locked' | 'account_limit' | 'ip_limit';
export type LoginCheck =
  { allowed: true } | { allowed: false; reason: LoginRefusal; retryAfterMs: number };
export interface FailureResult {
  /** Set when this failure locked the pair. */
  lockedForMs: number;
  lockLevel: number;
  /** The account's failures in the current hour, this one included. */
  accountFailures: number;
  /** This failure brought the account to its hourly limit (true once per window). */
  accountLimitStarted: boolean;
  /** Distinct IPs that failed on the account within the hour (counted up to 1000). */
  distinctIps: number;
  /** This failure took the account past alertDistinctIps (true once per window). */
  distributedSignal: boolean;
}

const PAIR_WINDOW_MS = 15 * 60_000;
const LEVEL_TTL_MS = 24 * 3_600_000;
const ACCOUNT_WINDOW_MS = 3_600_000;
const IP_WINDOW_MS = 60_000;
/** Distinct IPs remembered per account and hour; enough for the signal, bounded against huge botnets. */
const MAX_TRACKED_IPS = 1_000;
/** Longer than any other key of a generation, so its keys always expire before the generation is forgotten. */
const GENERATION_TTL_MS = 48 * 3_600_000;
export const LOGIN_REDIS_TIMEOUT_MS = 300;
const WARN_EVERY_MS = 30_000;

const PRELUDE = `
local p, h, ip = ARGV[1], ARGV[2], ARGV[3]
local g = redis.call('GET', p .. 'gen:' .. h) or '0'
local scope = h .. ':' .. g
`;

/** Returns { code, retryAfterMs }: 0 allowed, 1 pair locked, 2 account limit, 3 IP limit. */
const CHECK_LUA = `${PRELUDE}
local lockLeft = redis.call('PTTL', p .. 'lock:' .. scope .. ':' .. ip)
if lockLeft > 0 then return { 1, lockLeft } end
local acctKey = p .. 'acct:' .. scope
local seenKey = p .. 'seen:' .. scope .. ':' .. ip
if tonumber(redis.call('GET', acctKey) or '0') >= tonumber(ARGV[5]) then
  local seenLeft = redis.call('PTTL', seenKey)
  if seenLeft > 0 then
    return { 2, math.max(math.min(seenLeft, redis.call('PTTL', acctKey)), 1000) }
  end
end
local ipKey = p .. 'ip:' .. ip
if tonumber(redis.call('GET', ipKey) or '0') >= tonumber(ARGV[4]) then
  return { 3, math.max(redis.call('PTTL', ipKey), 1000) }
end
return { 0, 0 }
`;

/** Counts one failure everywhere, marks and remembers the IP on the account, locks the pair at the limit. */
const FAIL_LUA = `${PRELUDE}
local function bump(key, ttl)
  local n = redis.call('INCR', key)
  if n == 1 then redis.call('PEXPIRE', key, ttl) end
  return n
end
if g ~= '0' then redis.call('PEXPIRE', p .. 'gen:' .. h, ARGV[11]) end
bump(p .. 'ip:' .. ip, ARGV[10])
local acct = bump(p .. 'acct:' .. scope, ARGV[9])
redis.call('SET', p .. 'seen:' .. scope .. ':' .. ip, '1', 'PX', ARGV[9])
local ipsKey = p .. 'ips:' .. scope
local added = 0
if redis.call('SCARD', ipsKey) < tonumber(ARGV[12]) then added = redis.call('SADD', ipsKey, ip) end
local distinct = redis.call('SCARD', ipsKey)
if added == 1 and distinct == 1 then redis.call('PEXPIRE', ipsKey, ARGV[9]) end
local pairKey = p .. 'pair:' .. scope .. ':' .. ip
if bump(pairKey, ARGV[4]) >= tonumber(ARGV[5]) then
  local levelKey = p .. 'level:' .. scope .. ':' .. ip
  local level = redis.call('INCR', levelKey)
  redis.call('PEXPIRE', levelKey, ARGV[8])
  local lockMs = math.floor(math.min(tonumber(ARGV[6]) * 2 ^ (level - 1), tonumber(ARGV[7])))
  redis.call('SET', p .. 'lock:' .. scope .. ':' .. ip, '1', 'PX', lockMs)
  redis.call('DEL', pairKey)
  return { lockMs, level, acct, distinct, added }
end
return { 0, 0, acct, distinct, added }
`;

/** A right password while not locked: the pair's count, escalation and failed mark start again from zero. */
const SUCCESS_LUA = `${PRELUDE}
redis.call('DEL', p .. 'pair:' .. scope .. ':' .. ip, p .. 'level:' .. scope .. ':' .. ip, p .. 'seen:' .. scope .. ':' .. ip)
return 1
`;

/** A completed password reset: a new generation, so every count and lock of the account is left behind. */
const RESET_LUA = `${PRELUDE}
redis.call('INCR', p .. 'gen:' .. h)
redis.call('PEXPIRE', p .. 'gen:' .. h, ARGV[4])
return 1
`;

type Script = (...args: (string | number)[]) => Promise<number[] | number>;
type ScriptName = 'check' | 'fail' | 'success' | 'reset';

/** One stable identity per account email (trimmed, lower-cased), never the email itself. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/** IPv4 as is (also when IPv4-mapped); IPv6 by its /64, since one client controls a whole /64. */
export function ipKey(ip: string | null | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return 'unknown';
  const parts = expandIPv6(ip);
  return parts ? `${parts.slice(0, 4).join(':')}::/64` : 'unknown';
}

function expandIPv6(ip: string): string[] | null {
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const toParts = (s: string | undefined) => (s ? s.split(':') : []);
  const tail = toParts(halves[1]);
  const last = tail.length > 0 ? tail[tail.length - 1] : undefined;
  if (last?.includes('.')) {
    const octets = last.split('.').map(Number);
    tail.splice(
      -1,
      1,
      ((octets[0]! << 8) | octets[1]!).toString(16),
      ((octets[2]! << 8) | octets[3]!).toString(16),
    );
  }
  const head = toParts(halves[0]);
  const parts =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
      : head;
  return parts.length === 8 ? parts.map((x) => x.padStart(4, '0')) : null;
}

export class LoginLimiter {
  private readonly logger = new Logger(LoginLimiter.name);
  private readonly scripts: Record<ScriptName, Script>;
  private lastWarnAt = 0;

  constructor(
    private readonly redis: Redis,
    private readonly limits: LoginLimits,
    private readonly prefix = 'login:',
  ) {
    const define = (name: string, lua: string): Script => {
      redis.defineCommand(name, { numberOfKeys: 0, lua });
      // defineCommand adds the method at runtime; ioredis cannot type it statically.
      return (redis as unknown as Record<string, Script>)[name]!.bind(redis);
    };
    this.scripts = {
      check: define('siratLoginCheck', CHECK_LUA),
      fail: define('siratLoginFail', FAIL_LUA),
      success: define('siratLoginSuccess', SUCCESS_LUA),
      reset: define('siratLoginReset', RESET_LUA),
    };
  }

  /** Before the password is checked. Fails open if the cache Redis is unavailable (logged; nginx still limits). */
  async check(email: string, ip: string | null | undefined): Promise<LoginCheck> {
    const result = await this.run(
      'check',
      emailHash(email),
      ipKey(ip),
      this.limits.ipFailuresPerMinute,
      this.limits.accountFailuresPerHour,
    );
    if (!Array.isArray(result)) return { allowed: true };
    const [code, retryAfterMs] = result as [number, number];
    const reason = ({ 1: 'pair_locked', 2: 'account_limit', 3: 'ip_limit' } as const)[
      code as 1 | 2 | 3
    ];
    return reason ? { allowed: false, reason, retryAfterMs } : { allowed: true };
  }

  /** A wrong password, or an email without an account. */
  async recordFailure(email: string, ip: string | null | undefined): Promise<FailureResult> {
    const result = await this.run(
      'fail',
      emailHash(email),
      ipKey(ip),
      PAIR_WINDOW_MS,
      this.limits.pairMaxFailures,
      this.limits.lockBaseMs,
      this.limits.lockMaxMs,
      LEVEL_TTL_MS,
      ACCOUNT_WINDOW_MS,
      IP_WINDOW_MS,
      GENERATION_TTL_MS,
      MAX_TRACKED_IPS,
    );
    const [lockedForMs, lockLevel, accountFailures, distinctIps, added] = Array.isArray(result)
      ? (result as [number, number, number, number, number])
      : [0, 0, 0, 0, 0];
    return {
      lockedForMs,
      lockLevel,
      accountFailures,
      accountLimitStarted: accountFailures === this.limits.accountFailuresPerHour,
      distinctIps,
      distributedSignal: added === 1 && distinctIps === this.limits.alertDistinctIps + 1,
    };
  }

  /** A right password while not locked. */
  async recordSuccess(email: string, ip: string | null | undefined): Promise<void> {
    await this.run('success', emailHash(email), ipKey(ip));
  }

  /** A completed password reset: unlocks the account everywhere. */
  async resetAccount(email: string): Promise<void> {
    await this.run('reset', emailHash(email), '-', GENERATION_TTL_MS);
  }

  private async run(
    name: ScriptName,
    hash: string,
    ip: string,
    ...args: number[]
  ): Promise<number[] | number | null> {
    if (this.redis.status !== 'ready') return this.unavailable(`redis ${this.redis.status}`);
    try {
      return await withTimeout(
        this.scripts[name](this.prefix, hash, ip, ...args),
        LOGIN_REDIS_TIMEOUT_MS,
      );
    } catch (err) {
      return this.unavailable(err instanceof Error ? err.message : 'unknown error');
    }
  }

  private unavailable(reason: string): null {
    const now = Date.now();
    if (now - this.lastWarnAt > WARN_EVERY_MS) {
      this.lastWarnAt = now;
      this.logger.warn(`login limiter unavailable, not limiting: ${reason}`);
    }
    return null;
  }
}
