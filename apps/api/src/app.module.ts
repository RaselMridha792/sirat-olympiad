import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
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
    // TODO(claude-code): back the throttler with Redis storage (rulebook sec. 4) + stricter limits on /auth/*.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
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
})
export class AppModule {}
