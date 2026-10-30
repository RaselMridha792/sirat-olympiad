import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvVars } from '../../config/env';
import { AccessTokenService, accessTokenJwtOptions } from './access-token.service';
import { PasswordService } from './password.service';

/**
 * Auth (A2). So far: access-token signing/verification used by the global AuthGuard (registered in AppModule), and
 * argon2id password hashing. Sessions, login and the other endpoints follow (docs/06-API.md). Rules: RULEBOOK §5.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) =>
        accessTokenJwtOptions(
          config.get('JWT_ACCESS_SECRET', { infer: true }),
          config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        ),
    }),
  ],
  providers: [AccessTokenService, PasswordService],
  exports: [AccessTokenService, PasswordService],
})
export class AuthModule {}
