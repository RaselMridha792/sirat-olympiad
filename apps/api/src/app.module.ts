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
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        // Never log credentials or tokens.
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      },
    }),
    // Shared across replicas via the cache Redis (RULEBOOK §4). A1 safety net per route + client IP, sized for a
    // school NAT (~100 students start/reload together: ~300 req/min on one route); 600 leaves 2x headroom and stays
    // well under nginx's per-IP ceiling for /api/ (30 r/s + burst 60), so nginx remains the flood guard.
    // blockDuration 0 = no penalty box: 429 + Retry-After only until the window resets.
    // A2 adds per-user keys for exam routes and strict tiers for auth/registration/payment.
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CACHE],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 600, blockDuration: 0 }],
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
