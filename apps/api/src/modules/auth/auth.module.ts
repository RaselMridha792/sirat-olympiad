import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvVars } from '../../config/env';
import { AuditModule } from '../audit/audit.module';
import { AccessTokenService, accessTokenJwtOptions } from './access-token.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { SessionCookies } from './session-cookies';
import { SessionService } from './session.service';

/**
 * Auth (A2). So far: access tokens (verified by the global AuthGuard, registered in AppModule), argon2id passwords,
 * refresh sessions with rotation and reuse detection, and the session endpoints. Login, password and email-token
 * endpoints follow (docs/06-API.md). Rules: RULEBOOK §5.
 */
@Module({
  imports: [
    AuditModule,
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
  providers: [AccessTokenService, PasswordService, SessionService, SessionCookies],
  exports: [AccessTokenService, PasswordService, SessionService],
})
export class AuthModule {}
