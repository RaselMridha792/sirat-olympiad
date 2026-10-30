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

const ADDRESS = '[^<>\\s@]+@[^<>\\s@]+\\.[^<>\\s@]+';
const SENDER = new RegExp(`^([^<>]+ <${ADDRESS}>|${ADDRESS})$`);

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
  /** Optional override of the pino level (default: info in production, debug elsewhere). */
  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL?: string;

  // Email: only the worker sends, so only the worker requires these (validateWorkerEnv). Owner: Resend in
  // production, Mailpit in development.
  @IsOptional() @IsIn(['ses', 'resend', 'mailpit']) EMAIL_PROVIDER?: string;
  /** `Name <address>` or a bare address. */
  @IsOptional() @Matches(SENDER) EMAIL_FROM?: string;
  /** Never logged, committed or put in NEXT_PUBLIC_*. */
  @IsOptional() @IsString() RESEND_API_KEY?: string;
  /** Amazon SES (SESv2), e.g. ap-south-1. The keys belong to an IAM user allowed only ses:SendEmail. Never logged. */
  @IsOptional() @Matches(/^[a-z]{2}(-[a-z]+)+-\d$/) SES_REGION?: string;
  @IsOptional() @IsString() SES_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() SES_SECRET_ACCESS_KEY?: string;
  @IsOptional() @Matches(/^https?:\/\/\S+$/) MAILPIT_URL?: string;
  @IsInt() @Min(1) @Max(65535) WORKER_HEALTH_PORT: number = 4001;
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
  // `KEY=` in an env file means "not set": @IsOptional() only skips undefined, and a blank line copied from an
  // example must not stop the API (required variables still fail, as missing).
  const set = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
  const env = plainToInstance(EnvVars, set, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const names = errors.map((e) => e.property).join(', ');
    throw new Error(`Invalid environment. Fix these variables: ${names}`);
  }
  const problem = secretProblem(env.JWT_ACCESS_SECRET);
  if (problem) {
    throw new Error(`JWT_ACCESS_SECRET ${problem}. Generate one with: openssl rand -base64 48`);
  }
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false') {
    throw new Error(
      'COOKIE_SECURE=false is for local development only, never with NODE_ENV=production',
    );
  }
  return env;
}

/** Why the worker cannot send email with this configuration, or null. Never includes a key. */
export function emailConfigProblem(env: EnvVars): string | null {
  if (!env.EMAIL_PROVIDER) return 'EMAIL_PROVIDER must be ses or mailpit';
  if (env.EMAIL_PROVIDER === 'ses') {
    if (!env.SES_REGION) return 'SES_REGION is required with EMAIL_PROVIDER=ses (e.g. ap-south-1)';
    const id = env.SES_ACCESS_KEY_ID ?? '';
    const secret = env.SES_SECRET_ACCESS_KEY ?? '';
    // Long-term IAM user keys only (AKIA...); AWS documentation examples contain "EXAMPLE" and are refused.
    if (!/^AKIA[A-Z0-9]{16}$/.test(id) || PLACEHOLDER.test(id))
      return 'SES_ACCESS_KEY_ID is missing or is not an IAM access key id (AKIA...)';
    if (!/^[A-Za-z0-9/+]{40}$/.test(secret) || PLACEHOLDER.test(secret))
      return 'SES_SECRET_ACCESS_KEY is missing or is not an IAM secret access key';
  }
  if (!env.EMAIL_FROM)
    return 'EMAIL_FROM is required, e.g. "Sirat Olympiad <no-reply@your-domain>"';
  if (env.EMAIL_PROVIDER === 'resend') {
    const key = env.RESEND_API_KEY ?? '';
    if (!/^re_\S{16,}$/.test(key) || PLACEHOLDER.test(key))
      return 'RESEND_API_KEY is missing or is not a Resend API key (re_...)';
  }
  if (env.EMAIL_PROVIDER === 'mailpit' && !env.MAILPIT_URL)
    return 'MAILPIT_URL is required with EMAIL_PROVIDER=mailpit';
  return null;
}

/** The worker's environment: everything the API needs, plus a usable email configuration. */
export function validateWorkerEnv(raw: Record<string, unknown>): EnvVars {
  const env = validateEnv(raw);
  const problem = emailConfigProblem(env);
  if (problem) throw new Error(`Invalid email configuration: ${problem}`);
  return env;
}
