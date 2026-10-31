import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env';
import { buildPaymentConfig, describePaymentConfig, type PaymentEnv } from './payment.config';

/** The validated PayStation settings (payment.config.ts). Building them at boot makes a wrong .env stop the app. */
export const PAYMENT_CONFIG = Symbol('PAYMENT_CONFIG');

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
  providers: [
    {
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
  ],
  exports: [PAYMENT_CONFIG],
})
export class PaymentsModule {}
