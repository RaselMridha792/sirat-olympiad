import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { REDIS_CACHE, RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ExamsModule } from './modules/exams/exams.module';
import { AttemptsModule } from './modules/attempts/attempts.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { AmbassadorsModule } from './modules/ambassadors/ambassadors.module';
import { RoundsModule } from './modules/rounds/rounds.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { CertificatesModule } from './modules/certificates/certificates.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        // Never log credentials or tokens.
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      },
    }),
    // Shared across replicas via the cache Redis (RULEBOOK §4). Stricter per-route limits for /auth/* come with A2.
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CACHE],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ExamsModule,
    AttemptsModule,
    PaymentsModule,
    NotificationsModule,
    AdminModule,
    AmbassadorsModule,
    RoundsModule,
    LeaderboardModule,
    CertificatesModule,
  ],
  // The scaffold declared the throttler but never applied it; this guard makes it active on every route.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
