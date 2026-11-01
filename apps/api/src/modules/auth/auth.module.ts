import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import { REDIS_CACHE } from '../../redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccessTokenService, accessTokenJwtOptions } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailSendLimiter } from './email-send-limiter';
import { EMAIL_TOKEN_TTLS, EmailTokenService } from './email-tokens.service';
import { LoginLimiter } from './login-limiter';
import { PasswordService } from './password.service';
import { SessionCookies } from './session-cookies';
import { SessionService } from './session.service';
import { TwoFactorChallenges } from './two-factor/two-factor-challenges';
import { TwoFactorConfig } from './two-factor/two-factor.config';

/**
 * Auth (A2). So far: access tokens (verified by the global AuthGuard, registered in AppModule), argon2id passwords,
 * refresh sessions with rotation and reuse detection, and the session endpoints. Login, password and email-token
 * endpoints follow (docs/06-API.md). Rules: RULEBOOK §5.
 */
@Module({
  imports: [
    AuditModule,
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) =>
        accessTokenJwtOptions(
          config.get('JWT_ACCESS_SECRET', { infer: true }),
          config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        ),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    PasswordService,
    SessionService,
    SessionCookies,
    AuthService,
    EmailTokenService,
    TwoFactorConfig,
    TwoFactorChallenges,
    {
      provide: EmailSendLimiter,
      inject: [REDIS_CACHE, ConfigService],
      useFactory: (redis: Redis, config: ConfigService<EnvVars, true>) =>
        new EmailSendLimiter(redis, {
          perMinute: config.get('AUTH_LINK_EMAILS_PER_MINUTE', { infer: true }),
          perHour: config.get('AUTH_LINK_EMAILS_PER_HOUR', { infer: true }),
        }),
    },
    {
      provide: EMAIL_TOKEN_TTLS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        email_verify: config.get('EMAIL_VERIFY_TOKEN_HOURS', { infer: true }) * 3_600_000,
        password_reset: config.get('PASSWORD_RESET_TOKEN_MINUTES', { infer: true }) * 60_000,
      }),
    },
    {
      provide: LoginLimiter,
      inject: [REDIS_CACHE, ConfigService],
      useFactory: (redis: Redis, config: ConfigService<EnvVars, true>) =>
        new LoginLimiter(redis, {
          ipFailuresPerMinute: config.get('LOGIN_IP_FAILURES_PER_MINUTE', { infer: true }),
          pairMaxFailures: config.get('LOGIN_PAIR_MAX_FAILURES', { infer: true }),
          lockBaseMs: config.get('LOGIN_LOCK_MINUTES', { infer: true }) * 60_000,
          lockMaxMs: config.get('LOGIN_LOCK_MAX_MINUTES', { infer: true }) * 60_000,
          accountFailuresPerHour: config.get('LOGIN_ACCOUNT_FAILURES_PER_HOUR', { infer: true }),
          alertDistinctIps: config.get('LOGIN_ALERT_DISTINCT_IPS_PER_HOUR', { infer: true }),
        }),
    },
  ],
  // TwoFactorConfig: the global AuthGuard (AppModule) enforces 2FA with it.
  exports: [AccessTokenService, PasswordService, SessionService, TwoFactorConfig],
})
export class AuthModule {}
