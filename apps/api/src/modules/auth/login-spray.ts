import type Redis from 'ioredis';

/**
 * The spray defence (the lead, 2026-11-10; docs/plans/PARTICIPANT-LOGIN-PLAN.md §10): failed logins across ALL
 * accounts, counted by LoginLimiter's failure script beside the per-account limits. Nothing is refused for it. A spray
 * raises a security alert at once (`login.failure_burst`, `login.spray`), and ops-check warns while it holds
 * (`login_failures`):
 * - failures per minute, every account and IP together;
 * - distinct emails failing within the last 10 minutes, by their hash in a HyperLogLog per minute.
 * Normal exam-day failures are a few hundred per 10 minutes (25k students, a peak of 1,300-3,800 at once,
 * 02-SYSTEM-DESIGN), so these thresholds leave about five times that. A wrong check digit never gets this far: the
 * login refuses it before any count. Keys hold minute numbers and hashes only, never an email.
 */
export const LOGIN_SPRAY = {
  failuresPerMinute: 2_000,
  failedAccountsPer10Min: 1_000,
} as const;
export const SPRAY_WINDOW_MINUTES = 10;
/** The minute buckets outlive the window a little, so the window never reads an expired minute. */
export const SPRAY_BUCKET_TTL_MS = (SPRAY_WINDOW_MINUTES + 5) * 60_000;
/** After an alert the same signal stays quiet this long; ops-check's warning repeats hourly while it holds. */
export const SPRAY_ALERT_HOLD_MS = SPRAY_WINDOW_MINUTES * 60_000;

export const minuteOf = (ms: number): number => Math.floor(ms / 60_000);

/** Redis key names, shared with the failure script in login-limiter.ts (which builds the same names in Lua). */
export const sprayKeys = {
  failures: (prefix: string, minute: number) => `${prefix}global:fail:${minute}`,
  accounts: (prefix: string, minute: number) => `${prefix}global:acct:${minute}`,
};

export interface LoginGlobalFacts {
  /** The busiest of the last 5 minutes (the current one included). */
  maxFailuresPerMinute: number;
  /** Distinct emails that failed within the last 10 minutes (HyperLogLog: within about 1 %). */
  failedAccounts10Min: number;
}

/** For ops-check, every 5 minutes: read only, from the cache Redis. */
export async function readLoginGlobalFacts(
  redis: Redis,
  nowMs: number,
  prefix = 'login:',
): Promise<LoginGlobalFacts> {
  const minute = minuteOf(nowMs);
  const last = (n: number) => Array.from({ length: n }, (_, i) => minute - i);
  const counts = await redis.mget(...last(5).map((m) => sprayKeys.failures(prefix, m)));
  const accounts = await redis.pfcount(
    ...last(SPRAY_WINDOW_MINUTES).map((m) => sprayKeys.accounts(prefix, m)),
  );
  return {
    maxFailuresPerMinute: Math.max(0, ...counts.map((c) => Number(c ?? 0))),
    failedAccounts10Min: accounts,
  };
}

/** True when either measure is at its threshold: ops-check's `login_failures` warning. */
export const isLoginSpray = (facts: LoginGlobalFacts): boolean =>
  facts.maxFailuresPerMinute >= LOGIN_SPRAY.failuresPerMinute ||
  facts.failedAccounts10Min >= LOGIN_SPRAY.failedAccountsPer10Min;
