import 'reflect-metadata'; // class-transformer/validator decorators need it even when env.ts is loaded on its own
import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
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
import { parseSecretBoxKey } from '../modules/auth/two-factor/secret-box';

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
  /**
   * Admin two-factor login: the AES-256-GCM key for stored TOTP secrets, 32 random bytes as base64 or 64 hex
   * (`openssl rand -base64 32`). Required with NODE_ENV=production; without it elsewhere, 2FA is off. _PREVIOUS only
   * opens secrets sealed before a key rotation.
   */
  @IsOptional() @IsString() TOTP_ENCRYPTION_KEY?: string;
  @IsOptional() @IsString() TOTP_ENCRYPTION_KEY_PREVIOUS?: string;
  @IsInt() @Min(60) JWT_ACCESS_TTL_SECONDS: number = 900;
  @IsInt() @Min(1) REFRESH_TTL_DAYS: number = 7;
  /**
   * A refresh rotation must commit within this many ms of reaching the handler, so its answer (the only copy of the
   * new cookies) always goes out: with Prisma's 5 s margin it stays far below the 25 s request timeout, and it stays
   * inside the 10 s reuse grace. A rotation that cannot is rolled back and answers 503; the old token stays valid and
   * the browser tries again. Only tests lower it.
   */
  @IsInt() @Min(100) @Max(10_000) REFRESH_ROTATION_BUDGET_MS: number = 8_000;
  /**
   * Requests per minute and route for one signed-in user (a verified access cookie), whatever IP they share with
   * others. Leaves room for the exam checkpoint (every 60-120 s) and a payment status poll (every 2-10 s). Requests
   * without a verified session keep the per-IP limit (600). Only tests lower it.
   */
  @IsInt() @Min(10) @Max(10_000) API_LIMIT_PER_USER_PER_MINUTE: number = 120;
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
  /** Link emails (reset, verification) one address can receive, per kind: stops mail bombing and SES costs. */
  @IsInt() @Min(1) @Max(10) AUTH_LINK_EMAILS_PER_MINUTE: number = 1;
  @IsInt() @Min(1) @Max(100) AUTH_LINK_EMAILS_PER_HOUR: number = 5;

  /** Operator inbox for security alerts. Unset: alerts go to the audit log and the log only. */
  @IsOptional() @IsEmail() SECURITY_ALERT_EMAIL?: string;
  /**
   * Owner: at most one alert email per kind per 10 minutes, and at most this many alert emails per hour in each
   * category (security, payments, ops; owner Q2: 6 each), so a flood of one never silences another.
   */
  @IsInt() @Min(1) @Max(60) SECURITY_ALERT_EMAILS_PER_HOUR: number = 6;
  /** Optional override of the pino level (default: info in production, debug elsewhere). */
  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL?: string;

  // Email: only the worker sends, so only the worker requires these (validateWorkerEnv). Owner: Amazon SES in
  // production, Mailpit in development.
  @IsOptional() @IsIn(['ses', 'mailpit']) EMAIL_PROVIDER?: string;
  /** `Name <address>` or a bare address. */
  @IsOptional() @Matches(SENDER) EMAIL_FROM?: string;
  /** Amazon SES (SESv2), e.g. ap-south-1. The keys belong to an IAM user allowed only ses:SendEmail. Never logged. */
  @IsOptional() @Matches(/^[a-z]{2}(-[a-z]+)+-\d$/) SES_REGION?: string;
  @IsOptional() @IsString() SES_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() SES_SECRET_ACCESS_KEY?: string;
  @IsOptional() @Matches(/^https?:\/\/\S+$/) MAILPIT_URL?: string;
  @IsInt() @Min(1) @Max(65535) WORKER_HEALTH_PORT: number = 4001;

  // PayStation (payments plan section 3.5). Unset PAYSTATION_ENV = payments disabled; once set, the cross-field rules
  // in modules/payments/payment.config.ts apply at boot. The host is not configurable: an allow-list picks it.
  @IsOptional() @IsIn(['sandbox', 'live', 'fake']) PAYSTATION_ENV?: string;
  /** Blank, or exactly the allow-listed host of PAYSTATION_ENV; any URL only for the fake server. */
  @IsOptional() @Matches(/^https?:\/\/\S+$/) PAYSTATION_BASE_URL?: string;
  /** Used exactly as issued (keeps its "-"). Never logged. */
  @IsOptional() @IsString() PAYSTATION_MERCHANT_ID?: string;
  @IsOptional() @IsString() PAYSTATION_PASSWORD?: string;
  @IsOptional() @IsString() PAYSTATION_ACCOUNT_LABEL?: string;
  @IsOptional() @IsString() PAYSTATION_INVOICE_PREFIX?: string;
  @IsOptional() @Matches(/^https?:\/\/\S+$/) PAYSTATION_CALLBACK_URL?: string;
  @IsOptional() @Matches(/^https?:\/\/\S+$/) PAYSTATION_IPN_URL?: string;
  @IsOptional() @IsString() PAYSTATION_PAY_WITH_CHARGE?: string;
  @IsInt() @Min(1_000) @Max(30_000) PAYSTATION_TIMEOUT_MS: number = 10_000;
  /** Tests only: a run's own payments queue, so a worker running elsewhere never takes its jobs. Blank: "payments". */
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,64}$/) PAYMENTS_QUEUE_NAME?: string;
  /** Tests only: a run's own exam queue, so a worker running elsewhere never takes its jobs. Blank: "exam". */
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,64}$/) EXAM_QUEUE_NAME?: string;
  /** Tests only: a run's own housekeeping queue (the nightly cleanup). Blank: "housekeeping". */
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,64}$/) HOUSEKEEPING_QUEUE_NAME?: string;
  /** Tests only: a run's own ambassador points queue (the referral sweep). Blank: "ambassador-points". */
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,64}$/) AMBASSADOR_QUEUE_NAME?: string;
  /** Tests only: a run's own certificates queue (the issue job). Blank: "certificates". */
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,64}$/) CERTIFICATES_QUEUE_NAME?: string;
}

const MIN_SECRET_LENGTH = 32;
/** A random 32-byte secret (hex or base64) easily clears this; "aaaa…" or "abab…" do not. */
const MIN_DISTINCT_CHARS = 10;
/** Words that only appear in example values. Matching any of them means the secret was never really set. */
export const PLACEHOLDER = /(fake|change.?me|example|placeholder|dummy|sample|your.?secret|xxxx)/i;

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

/**
 * `app`: which process reads it. Only the API needs TOTP_ENCRYPTION_KEY (it seals and opens the secrets); the worker
 * never touches them, so a missing key can stop the API but never the jobs (A2).
 */
export function validateEnv(raw: Record<string, unknown>, app: 'api' | 'worker' = 'api'): EnvVars {
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
  if (env.NODE_ENV === 'production' && !env.APP_URL) {
    throw new Error('APP_URL is required in production: email links are built from it');
  }
  if (env.NODE_ENV === 'production' && env.APP_URL && !isHttpsOrLocal(env.APP_URL)) {
    throw new Error(
      'APP_URL must start with https:// in production (email links, the payment return and nginx take it); ' +
        'plain http only for localhost, 127.0.0.1 or [::1]',
    );
  }
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false') {
    throw new Error(
      'COOKIE_SECURE=false is for local development only, never with NODE_ENV=production',
    );
  }
  const totp = totpKeyProblem(env, app === 'api');
  if (totp) throw new Error(totp);
  return env;
}

/**
 * Why the two-factor key setting is unacceptable, or null. Each key: the signing-secret rules (length, no placeholder,
 * not repetitive) and exactly 32 bytes. Required in production. Never includes a value.
 */
export function totpKeyProblem(
  env: Pick<EnvVars, 'NODE_ENV' | 'TOTP_ENCRYPTION_KEY' | 'TOTP_ENCRYPTION_KEY_PREVIOUS'>,
  requiredInProduction = true,
): string | null {
  const generate = 'Generate one with: openssl rand -base64 32';
  for (const name of ['TOTP_ENCRYPTION_KEY', 'TOTP_ENCRYPTION_KEY_PREVIOUS'] as const) {
    const value = env[name];
    if (value === undefined) continue;
    const problem = secretProblem(value);
    if (problem) return `${name} ${problem}. ${generate}`;
    if (!parseSecretBoxKey(value))
      return `${name} must be 32 bytes as base64 or 64 hex characters. ${generate}`;
  }
  if (
    requiredInProduction &&
    env.NODE_ENV === 'production' &&
    env.TOTP_ENCRYPTION_KEY === undefined
  )
    return `TOTP_ENCRYPTION_KEY is required in production (admin two-factor login). ${generate}`;
  if (env.TOTP_ENCRYPTION_KEY_PREVIOUS !== undefined && env.TOTP_ENCRYPTION_KEY === undefined)
    return 'TOTP_ENCRYPTION_KEY_PREVIOUS needs TOTP_ENCRYPTION_KEY';
  return null;
}

/** https, or plain http on this machine only (the local stack runs in production mode on http://localhost:8080). */
function isHttpsOrLocal(appUrl: string): boolean {
  const url = new URL(appUrl);
  return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
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
  if (env.EMAIL_PROVIDER === 'mailpit' && !env.MAILPIT_URL)
    return 'MAILPIT_URL is required with EMAIL_PROVIDER=mailpit';
  return null;
}

/** The worker's environment: everything the API needs, plus a usable email configuration. */
export function validateWorkerEnv(raw: Record<string, unknown>): EnvVars {
  const env = validateEnv(raw, 'worker');
  const problem = emailConfigProblem(env);
  if (problem) throw new Error(`Invalid email configuration: ${problem}`);
  return env;
}
