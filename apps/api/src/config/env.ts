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
  return env;
}
