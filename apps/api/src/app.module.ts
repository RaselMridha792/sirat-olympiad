import { AdmitCardModule } from './modules/admit-card/admit-card.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { BackgroundModule } from './common/background/background-tasks';
import { pinoHttpOptions } from './common/logging/pino-http.options';
import { DrainService } from './common/shutdown/drain.service';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { UserOrIpThrottlerGuard } from './common/throttler/user-or-ip-throttler.guard';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { REDIS_CACHE, RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { CsrfGuard } from './modules/auth/csrf.guard';
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
import { CertificateTemplatesModule } from './modules/certificates/templates/certificate-templates.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { DemoModule } from './modules/demo/demo.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Request logs: method, path (no query), status, request id. No headers, cookies or bodies (A2.0 gate 2).
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions() }),
    // Shared across replicas via the cache Redis (RULEBOOK §4). 600/min per route is the per-IP default for requests
    // without a verified session; signed-in requests count per user (API_LIMIT_PER_USER_PER_MINUTE) through
    // UserOrIpThrottlerGuard, and route tiers live on the controllers (DECISIONS "Per-user API limits").
    // blockDuration 0 = no penalty box: 429 + Retry-After only until the window resets.
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CACHE],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 600, blockDuration: 0 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    PrismaModule,
    RedisModule,
    BackgroundModule,
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
    CertificateTemplatesModule,
    AdmitCardModule,
    AnnouncementsModule,
    DemoModule,
  ],
  // Global guards, run in this order on every route: rate limit, CSRF header on state-changing requests, then
  // the session (deny by default; @Public() opens a route, @Roles() narrows it).
  providers: [
    { provide: APP_GUARD, useClass: UserOrIpThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    DrainService,
  ],
})
export class AppModule {}
