import 'reflect-metadata'; // class-transformer/validator decorators need it even when env.ts is loaded on its own
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/** Fail fast at startup if any required variable is missing (rulebook section 4). */
export class EnvVars {
  @IsIn(['development', 'test', 'production']) NODE_ENV!: string;
  @IsInt() @Min(1) @Max(65535) PORT: number = 4000;
  @IsString() @Matches(/^postgres(ql)?:\/\/\S+$/) DATABASE_URL!: string;
  @IsString() @Matches(/^rediss?:\/\/\S+$/) REDIS_CACHE_URL!: string;
  @IsString() @Matches(/^rediss?:\/\/\S+$/) REDIS_QUEUE_URL!: string;
  @IsString() @IsNotEmpty() JWT_ACCESS_SECRET!: string;
  @IsInt() @Min(60) JWT_ACCESS_TTL_SECONDS: number = 900;
  @IsInt() @Min(1) REFRESH_TTL_DAYS: number = 7;
  /** Session cookies carry `Secure` unless this is 'false' (local plain-http development only; refused in production). */
  @IsIn(['true', 'false']) COOKIE_SECURE: string = 'true';

  // Login limits (owner, 2026-10-31). Only failed logins count.
  /** Failed logins per minute from one IP, all accounts together (owner: about 60-100; a school shares one IP). */
  @IsInt() @Min(10) @Max(10_000) LOGIN_IP_FAILURES_PER_MINUTE: number = 100;
  /** Failures of one account from one IP (within 15 min) that lock that pair. */
  @IsInt() @Min(3) @Max(100) LOGIN_PAIR_MAX_FAILURES: number = 10;
  /** First lock of a pair; each repeat within 24 h doubles it, up to LOGIN_LOCK_MAX_MINUTES. */
  @IsInt() @Min(1) @Max(1_440) LOGIN_LOCK_MINUTES: number = 15;
  @IsInt() @Min(1) @Max(10_080) LOGIN_LOCK_MAX_MINUTES: number = 240;
  /** Failures per hour for one account from all IPs together (owner: about 50). */
  @IsInt() @Min(10) @Max(10_000) LOGIN_ACCOUNT_FAILURES_PER_HOUR: number = 50;
  /** Owner: failures on one account from more distinct IPs than this within an hour raise an alert (no blocking). */
  @IsInt() @Min(2) @Max(999) LOGIN_ALERT_DISTINCT_IPS_PER_HOUR: number = 20;

  /** The web origin used in email links, e.g. https://example.org (no path). Required in production. */
  @IsOptional() @Matches(/^https?:\/\/[^\s/?#]+$/) APP_URL?: string;
  /** Email link lifetimes (RULEBOOK §5: e.g. 24 h to verify, 30 min to reset). */
  @IsInt() @Min(1) @Max(168) EMAIL_VERIFY_TOKEN_HOURS: number = 24;
  @IsInt() @Min(5) @Max(1_440) PASSWORD_RESET_TOKEN_MINUTES: number = 30;
  /** Optional override of the pino level (default: info in production, debug elsewhere). */
  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL?: string;
}

const MIN_SECRET_LENGTH = 32;
/** A random 32-byte secret (hex or base64) easily clears this; "aaaa…" or "abab…" do not. */
const MIN_DISTINCT_CHARS = 10;
/** Words that only appear in example values. Matching any of them means the secret was never really set. */
const PLACEHOLDER = /(fake|change.?me|example|placeholder|dummy|sample|your.?secret|xxxx)/i;

/**
 * Why a signing secret is unacceptable, or null if it is fine. Applies in every environment (A2.0 gate 3): compose
 * env files can override NODE_ENV, so "only in production" would let the committed example value through.
 * Never includes the value itself.
 */
export function secretProblem(value: string): string | null {
  if (value.length < MIN_SECRET_LENGTH) return `must be at least ${MIN_SECRET_LENGTH} characters`;
  if (PLACEHOLDER.test(value)) return 'looks like a placeholder';
  if (new Set(value).size < MIN_DISTINCT_CHARS) return 'is too repetitive';
  return null;
}

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const env = plainToInstance(EnvVars, raw, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const names = errors.map((e) => e.property).join(', ');
    throw new Error(`Invalid environment. Fix these variables: ${names}`);
  }
  const problem = secretProblem(env.JWT_ACCESS_SECRET);
  if (problem) {
    throw new Error(`JWT_ACCESS_SECRET ${problem}. Generate one with: openssl rand -base64 48`);
  }
  if (env.NODE_ENV === 'production' && !env.APP_URL) {
    throw new Error('APP_URL is required in production: email links are built from it');
  }
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false') {
    throw new Error(
      'COOKIE_SECURE=false is for local development only, never with NODE_ENV=production',
    );
  }
  return env;
}
