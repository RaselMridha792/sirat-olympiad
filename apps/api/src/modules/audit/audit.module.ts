import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import { REDIS_CACHE } from '../../redis/redis.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertEmailLimiter } from './alert-email-limiter';
import { AuditService } from './audit.service';
import {
  ALERTS_IN_PRODUCTION,
  SECURITY_ALERT_RECIPIENT,
  SecurityAlerts,
} from './security-alerts.service';

/** Security audit trail and alerts. The admin read endpoint (GET /admin/audit) comes with the admin module. */
@Module({
  imports: [NotificationsModule],
  providers: [
    AuditService,
    SecurityAlerts,
    {
      provide: AlertEmailLimiter,
      inject: [REDIS_CACHE, ConfigService],
      useFactory: (redis: Redis, config: ConfigService<EnvVars, true>) =>
        new AlertEmailLimiter(redis, config.get('SECURITY_ALERT_EMAILS_PER_HOUR', { infer: true })),
    },
    {
      provide: SECURITY_ALERT_RECIPIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) =>
        config.get('SECURITY_ALERT_EMAIL', { infer: true }),
    },
    {
      provide: ALERTS_IN_PRODUCTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) =>
        config.get('NODE_ENV', { infer: true }) === 'production',
    },
  ],
  exports: [AuditService, SecurityAlerts],
})
export class AuditModule {}
