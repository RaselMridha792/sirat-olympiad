import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min, validateSync } from 'class-validator';

/** Fail fast at startup if any required variable is missing (rulebook section 4). */
export class EnvVars {
  @IsIn(['development', 'test', 'production']) NODE_ENV!: string;
  @IsInt() @Min(1) @Max(65535) PORT: number = 4000;
  @IsString() @IsNotEmpty() DATABASE_URL!: string;
  @IsString() @IsNotEmpty() REDIS_CACHE_URL!: string;
  @IsString() @IsNotEmpty() REDIS_QUEUE_URL!: string;
  @IsString() @IsNotEmpty() JWT_ACCESS_SECRET!: string;
  @IsInt() @Min(60) JWT_ACCESS_TTL_SECONDS: number = 900;
  @IsInt() @Min(1) REFRESH_TTL_DAYS: number = 7;
}

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const env = plainToInstance(EnvVars, raw, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const names = errors.map((e) => e.property).join(', ');
    throw new Error(`Invalid environment. Fix these variables: ${names}`);
  }
  if (env.JWT_ACCESS_SECRET.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
  }
  return env;
}
