import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import { REDIS_CACHE } from '../../redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { EMAIL_TOKEN_TTLS, EmailTokenService } from '../auth/email-tokens.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway';
import { PayStationGateway } from './gateway/paystation.gateway';
import {
  buildPaymentConfig,
  describePaymentConfig,
  type PaymentConfig,
  type PaymentEnv,
} from './payment.config';
import { PAYMENT_CONFIG } from './payments-boot-check';
import { PaymentQueue } from './verify/payment-queue';
import { PaymentSettlement } from './verify/payment-settlement';
import { RegistrationEmails } from './verify/registration-emails';
import { VerifyHints } from './verify/verify-hints';
import { VERIFY_HINTS, VerifyRequests } from './verify/verify-requests';

const PAYMENT_ENV_KEYS = [
  'NODE_ENV',
  'PAYSTATION_ENV',
  'PAYSTATION_BASE_URL',
  'PAYSTATION_MERCHANT_ID',
  'PAYSTATION_PASSWORD',
  'PAYSTATION_ACCOUNT_LABEL',
  'PAYSTATION_INVOICE_PREFIX',
  'PAYSTATION_CALLBACK_URL',
  'PAYSTATION_IPN_URL',
  'PAYSTATION_PAY_WITH_CHARGE',
  'PAYSTATION_TIMEOUT_MS',
] as const satisfies readonly (keyof PaymentEnv)[];

/**
 * What the API and the worker share: the PayStation settings and client, the payments queue, and the settlement
 * (the only code that marks a payment paid or failed: the worker's verify job, and the admin reconcile in the API).
 */
@Module({
  imports: [AuditModule, NotificationsModule],
  providers: [
    {
      // The validated PayStation settings (payment.config.ts). Building them at boot makes a wrong .env stop the app.
      provide: PAYMENT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => {
        const env = Object.fromEntries(
          PAYMENT_ENV_KEYS.map((key) => [key, config.get(key, { infer: true })]),
        ) as PaymentEnv;
        const payment = buildPaymentConfig(env);
        new Logger('Payments').log(describePaymentConfig(payment));
        return payment;
      },
    },
    {
      // Null while payments are disabled: nothing can reach PayStation then.
      provide: PAYMENT_GATEWAY,
      inject: [PAYMENT_CONFIG],
      useFactory: (config: PaymentConfig) =>
        config.enabled ? new PayStationGateway(config) : null,
    },
    {
      provide: VERIFY_HINTS,
      inject: [REDIS_CACHE],
      useFactory: (redis: Redis) => new VerifyHints(redis),
    },
    {
      // Same lifetimes as AuthModule's (A2): the verification link a new account gets.
      provide: EMAIL_TOKEN_TTLS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        email_verify: config.get('EMAIL_VERIFY_TOKEN_HOURS', { infer: true }) * 3_600_000,
        password_reset: config.get('PASSWORD_RESET_TOKEN_MINUTES', { infer: true }) * 60_000,
      }),
    },
    EmailTokenService,
    PaymentQueue,
    VerifyRequests,
    RegistrationEmails,
    PaymentSettlement,
  ],
  exports: [
    AuditModule,
    PAYMENT_CONFIG,
    PAYMENT_GATEWAY,
    PaymentQueue,
    VerifyRequests,
    PaymentSettlement,
  ],
})
export class PaymentsCoreModule {}
