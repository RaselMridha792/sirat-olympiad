import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import { REDIS_CACHE } from '../../redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway';
import { PayStationGateway } from './gateway/paystation.gateway';
import {
  buildPaymentConfig,
  describePaymentConfig,
  type PaymentConfig,
  type PaymentEnv,
} from './payment.config';
import { PAYMENT_CONFIG, PaymentsBootCheck } from './payments-boot-check';
import {
  MyPaymentsController,
  RegistrationController,
} from './registration/registration.controller';
import { RegistrationGuards } from './registration/registration-guards';
import { RegistrationService } from './registration/registration.service';

export { PAYMENT_CONFIG } from './payments-boot-check';

/** Start or retry attempts one email or one phone may make per hour (the IP has its own throttle tier). */
const ATTEMPTS_PER_HOUR = 10;

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
 * Registration and PayStation payments (docs/plans/PAYMENTS-PLAN.md). Registration endpoints live here and admin
 * endpoints in AdminModule, so app.module.ts does not change (plan D10).
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [RegistrationController, MyPaymentsController],
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
      provide: RegistrationGuards,
      inject: [REDIS_CACHE],
      useFactory: (redis: Redis) => new RegistrationGuards(redis, ATTEMPTS_PER_HOUR),
    },
    PaymentsBootCheck,
    RegistrationService,
  ],
  exports: [PAYMENT_CONFIG, PAYMENT_GATEWAY, RegistrationService],
})
export class PaymentsModule {}
